// Test dell'assistente AI lato server (Edge Function "ai"), senza rete e senza il progetto vero:
// database, utente, limiti e Groq sono finti. Esecuzione: npm test (vedi tests/LEGGIMI.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gestisci } from "../../supabase/functions/_shared/ai-gestore.ts";
import { ErroreAI, chiediJson, configurazione, estraiJson, MODELLI_PREDEFINITI } from "../../supabase/functions/_shared/groq.ts";
import {
  LIMITI, PERMESSI_AI, contestoDomanda, dataValida, parolaSicura, rispostaRicerca, statistiche, validaFoto,
} from "../../supabase/functions/_shared/ai-logica.ts";

const CHIAVE = "gsk_test_non_reale_0123456789";
const OGGI = "2026-11-13";
const IMG = "data:image/jpeg;base64," + "A".repeat(400);

// ---------------------------------------------------------------- finti
type Op = [string, ...unknown[]];
function dbFinto(dati: Record<string, unknown> = {}) {
  const chiamate: { tabella: string; ops: Op[] }[] = [];
  const rpc: string[] = [];
  const from = (tabella: string) => {
    const ops: Op[] = [];
    chiamate.push({ tabella, ops });
    const q: Record<string, unknown> = new Proxy({}, {
      get(_t, k) {
        if (k === "then") {
          const err = (dati.errori as Record<string, unknown> | undefined)?.[tabella];
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve({ data: err ? null : (dati[tabella] ?? []), error: err ?? null }).then(ok, ko);
        }
        return (...a: unknown[]) => { ops.push([String(k), ...a]); return q; };
      },
    });
    return q;
  };
  const db = { from, rpc: async (f: string) => { rpc.push(f); return { data: (dati.rpc as Record<string, unknown> | undefined)?.[f] ?? [], error: null }; } };
  return { db, chiamate, rpc };
}
function groqFinto(risposte: (object | string | ((body: Record<string, unknown>) => Response | Promise<Response>))[]) {
  const richieste: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    richieste.push({ url, body, headers: init.headers as Record<string, string> });
    const r = risposte.length > 1 ? risposte.shift()! : risposte[0];
    if (typeof r === "function") return r(body);
    if (typeof r === "string") return new Response(JSON.stringify({ choices: [{ message: { content: r } }], usage: { total_tokens: 7 }, model: body.model }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }], usage: { total_tokens: 7 }, model: body.model }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, richieste };
}
function richiesta(corpo: unknown, extra: Record<string, string> = {}) {
  return new Request("http://localhost/functions/v1/ai", {
    method: "POST", headers: { "Authorization": "Bearer token-utente", "Content-Type": "application/json", ...extra },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}
function dipendenze(o: {
  ruolo?: string; attivo?: boolean; nessuno?: boolean; env?: Record<string, string>; db?: ReturnType<typeof dbFinto>;
  groq?: ReturnType<typeof groqFinto>; limite?: (k: string, m: number, s: number) => Promise<boolean>;
} = {}) {
  const log: Record<string, unknown>[] = [];
  const limiti: [string, number, number][] = [];
  const usatoDb: Request[] = [];
  const db = o.db || dbFinto();
  const d = {
    env: (k: string) => ({ GROQ_API_KEY: CHIAVE, ...(o.env || {}) } as Record<string, string>)[k],
    chiamante: async () => o.nessuno ? null : { profilo: { id: "11111111-1111-4111-8111-111111111111", ruolo: (o.ruolo || "admin") as "admin", attivo: o.attivo ?? true } },
    dbUtente: (req: Request) => { usatoDb.push(req); return db.db; },
    limite: o.limite || (async (k: string, m: number, s: number) => { limiti.push([k, m, s]); return true; }),
    cors: { "Access-Control-Allow-Origin": "*" },
    fetchImpl: (o.groq || groqFinto([{}])).f,
    oggi: () => OGGI,
    log: (x: Record<string, unknown>) => log.push(x),
  };
  return { d, log, limiti, usatoDb, db };
}
const corpo = async (r: Response) => JSON.parse(await r.text());

// ---------------------------------------------------------------- autenticazione e permessi
test("senza sessione o con account disattivato: 401, nessuna chiamata", async () => {
  for (const o of [{ nessuno: true }, { attivo: false }]) {
    const g = groqFinto([{ testo: "x" }]);
    const { d, usatoDb } = dipendenze({ ...o, groq: g });
    const r = await gestisci(richiesta({ azione: "testo", modo: "migliora", testo: "abc" }), d);
    assert.equal(r.status, 401);
    assert.equal(g.richieste.length, 0);
    assert.equal(usatoDb.length, 0);
  }
});

test("matrice dei permessi: ruolo non autorizzato = 403 prima di dati, limiti e modello", async () => {
  for (const azione of Object.keys(PERMESSI_AI)) {
    for (const ruolo of ["admin", "company", "worker"]) {
      const g = groqFinto([{}]);
      const { d, usatoDb, limiti } = dipendenze({ ruolo, groq: g });
      const r = await gestisci(richiesta({ azione }), d);
      if (!PERMESSI_AI[azione].includes(ruolo as "admin")) {
        assert.equal(r.status, 403, azione + " / " + ruolo);
        assert.equal(g.richieste.length, 0);
        assert.equal(usatoDb.length, 0);
        assert.equal(limiti.length, 0);
      } else {
        assert.notEqual(r.status, 403, azione + " / " + ruolo);
      }
    }
  }
  assert.deepEqual(PERMESSI_AI.domanda, ["admin", "company"]);
  assert.deepEqual(PERMESSI_AI.testo, ["admin", "worker"]);
  assert.deepEqual(PERMESSI_AI.modelli, ["admin"]);
});

test("richieste non valide: azione sconosciuta, JSON rotto, corpo troppo grande, metodo", async () => {
  const { d } = dipendenze();
  assert.equal((await gestisci(richiesta({ azione: "elimina_tutto" }), d)).status, 400);
  assert.equal((await gestisci(richiesta("{non json"), d)).status, 400);
  assert.equal((await gestisci(richiesta({ azione: "testo" }, { "content-length": String(LIMITI.corpoByte + 1) }), d)).status, 413);
  assert.equal((await gestisci(new Request("http://x", { method: "GET" }), d)).status, 405);
  assert.equal((await gestisci(new Request("http://x", { method: "OPTIONS" }), d)).status, 200);
});

test("chiave Groq assente: 503 'non configurata', nessuna chiamata", async () => {
  const g = groqFinto([{}]);
  const { d } = dipendenze({ env: { GROQ_API_KEY: "" }, groq: g });
  const r = await gestisci(richiesta({ azione: "testo", modo: "migliora", testo: "abc" }), d);
  assert.equal(r.status, 503);
  assert.equal((await corpo(r)).codice, "non_configurata");
  assert.equal(g.richieste.length, 0);
});

// ---------------------------------------------------------------- limiti
test("limiti: al minuto 429 con Retry-After; giornaliero per ruolo; controllo impossibile = rifiuto", async () => {
  let r = await gestisci(richiesta({ azione: "testo", modo: "migliora", testo: "abc" }),
    dipendenze({ limite: async (k) => !k.startsWith("ai-min:") }).d);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("Retry-After"), "60");
  r = await gestisci(richiesta({ azione: "testo", modo: "migliora", testo: "abc" }), dipendenze({ limite: async (k) => !k.startsWith("ai-giorno:") }).d);
  assert.equal(r.status, 429);
  assert.equal((await corpo(r)).codice, "limite_giorno");
  r = await gestisci(richiesta({ azione: "testo", modo: "migliora", testo: "abc" }), dipendenze({ limite: async () => { throw new Error("db giu'"); } }).d);
  assert.equal(r.status, 503);
  const x = dipendenze({ ruolo: "worker", groq: groqFinto([{ testo: "ok" }]) });
  await gestisci(richiesta({ azione: "testo", modo: "migliora", testo: "abc" }), x.d);
  assert.deepEqual(x.limiti.map((l) => [l[0].split(":")[0], l[1], l[2]]), [["ai-min", 10, 60], ["ai-giorno", LIMITI.perGiorno.worker, 86400]]);
});

// ---------------------------------------------------------------- assistente testo
test("testo: prompt con dati delimitati, JSON mode, ragionamento escluso, chiave solo nell'intestazione", async () => {
  const g = groqFinto([{ testo: "Sostituito il filtro della caldaia.", avvisi: ["Manca l'esito della prova"] }]);
  const { d, log } = dipendenze({ ruolo: "worker", groq: g });
  const r = await gestisci(richiesta({ azione: "testo", modo: "genera", testo: "filtro caldaia cambiato", contesto: { cliente: "Rossi", firma: "data:image/png;base64,AAAA" } }), d);
  assert.equal(r.status, 200);
  const j = await corpo(r);
  assert.equal(j.testo, "Sostituito il filtro della caldaia.");
  assert.deepEqual(j.avvisi, ["Manca l'esito della prova"]);
  const req = g.richieste[0];
  assert.equal(req.body.model, MODELLI_PREDEFINITI.testo);
  assert.deepEqual(req.body.response_format, { type: "json_object" });
  assert.equal(req.body.include_reasoning, false);
  assert.equal(req.headers.Authorization, "Bearer " + CHIAVE);
  const testoPrompt = JSON.stringify(req.body.messages);
  assert.match(testoPrompt, /<dati>/);
  assert.doesNotMatch(testoPrompt, /data:image/, "la firma non va mai al modello");
  assert.doesNotMatch(JSON.stringify(j), new RegExp(CHIAVE));
  // nei log: niente testi
  assert.doesNotMatch(JSON.stringify(log), /filtro|caldaia|Rossi/);
  assert.equal(log[0].ai, "testo");
});

test("testo: input non valido = 400 senza chiamare il modello", async () => {
  for (const c of [{ modo: "inventa", testo: "x" }, { modo: "migliora", testo: "  " }, { modo: "migliora", testo: "x".repeat(LIMITI.testo + 1) }]) {
    const g = groqFinto([{ testo: "x" }]);
    const r = await gestisci(richiesta({ azione: "testo", ...c }), dipendenze({ groq: g }).d);
    assert.equal(r.status, 400);
    assert.equal(g.richieste.length, 0);
  }
});

// ---------------------------------------------------------------- errori di Groq
test("errori Groq tradotti: chiave, limite, server, timeout, rete", async () => {
  const casi: [Response | (() => never), number, string][] = [
    [new Response('{"error":{"message":"Invalid API Key ' + CHIAVE + '"}}', { status: 401 }), 503, "chiave"],
    [new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429, headers: { "retry-after": "12" } }), 429, "limite_groq"],
    [new Response("Bad gateway", { status: 502 }), 503, "non_disponibile"],
    [() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, 504, "timeout"],
    [() => { throw new TypeError("fetch failed"); }, 502, "rete"],
  ];
  for (const [risp, stato, codice] of casi) {
    const g = groqFinto([() => (typeof risp === "function" ? risp() : risp.clone())]);
    const r = await gestisci(richiesta({ azione: "testo", modo: "correggi", testo: "abc" }), dipendenze({ groq: g }).d);
    assert.equal(r.status, stato, codice);
    const t = await r.text();
    assert.equal(JSON.parse(t).codice, codice);
    assert.doesNotMatch(t, new RegExp(CHIAVE), "la chiave non torna mai al browser");
    if (codice === "limite_groq") assert.equal(r.headers.get("Retry-After"), "12");
  }
});

test("risposta non valida: un secondo tentativo, poi 502", async () => {
  let g = groqFinto(["non e' json", { testo: "Corretto." }]);
  let r = await gestisci(richiesta({ azione: "testo", modo: "correggi", testo: "abc" }), dipendenze({ groq: g }).d);
  assert.equal(r.status, 200);
  assert.equal(g.richieste.length, 2);
  assert.equal(g.richieste[1].body.temperature, 0);
  g = groqFinto(["{}", '{"testo": ""}']);
  r = await gestisci(richiesta({ azione: "testo", modo: "correggi", testo: "abc" }), dipendenze({ groq: g }).d);
  assert.equal(r.status, 502);
  assert.equal((await corpo(r)).codice, "risposta_non_valida");
});

test("modello non disponibile: si usa il modello di riserva", async () => {
  const g = groqFinto([() => new Response('{"error":{"code":"model_not_found"}}', { status: 404 }), { testo: "ok" }]);
  const r = await gestisci(richiesta({ azione: "testo", modo: "migliora", testo: "abc" }), dipendenze({ groq: g }).d);
  assert.equal(r.status, 200);
  assert.deepEqual(g.richieste.map((x) => x.body.model), [MODELLI_PREDEFINITI.testo, MODELLI_PREDEFINITI.riserva]);
});

test("modelli configurabili dai secret", () => {
  const c = configurazione((k) => ({ GROQ_API_KEY: " k ", GROQ_MODELLO_TESTO: "m1", GROQ_MODELLO_VISIONE: "v1" } as Record<string, string>)[k]);
  assert.deepEqual(c, { chiave: "k", testo: "m1", riserva: MODELLI_PREDEFINITI.riserva, visione: "v1" });
});

// ---------------------------------------------------------------- foto
test("foto: formato, numero e dimensione controllati; modello di visione con le immagini", async () => {
  assert.throws(() => validaFoto({ immagini: [] }));
  assert.throws(() => validaFoto({ immagini: [IMG, IMG, IMG, IMG] }));
  assert.throws(() => validaFoto({ immagini: ["data:image/svg+xml;base64,AAAA"] }));
  assert.throws(() => validaFoto({ immagini: ["https://esempio.it/foto.jpg"] }), "niente URL esterni");
  assert.throws(() => validaFoto({ immagini: ["data:image/jpeg;base64," + "A".repeat(LIMITI.immagineCaratteri)] }));
  const g = groqFinto([{ descrizione: "Quadro elettrico aperto con interruttori.", elementi: ["quadro"], materiali: [], incertezze: ["marca non leggibile"] }]);
  const r = await gestisci(richiesta({ azione: "foto", immagini: [IMG, IMG] }), dipendenze({ ruolo: "worker", groq: g }).d);
  assert.equal(r.status, 200);
  const j = await corpo(r);
  assert.deepEqual(j.incertezze, ["marca non leggibile"]);
  const b = g.richieste[0].body;
  assert.equal(b.model, MODELLI_PREDEFINITI.visione);
  assert.equal(b.reasoning_format, "hidden");
  const parti = (b.messages as { content: unknown }[])[1].content as { type: string }[];
  assert.equal(parti.filter((p) => p.type === "image_url").length, 2);
  assert.equal((await gestisci(richiesta({ azione: "foto", immagini: [IMG] }), dipendenze({ ruolo: "company" }).d)).status, 403);
});

// ---------------------------------------------------------------- ricerca
test("ricerca: filtri del modello ripuliti, letture solo con il client dell'utente (RLS)", async () => {
  const db = dbFinto({ rpc: { nomi_utenti: [{ id: "u-mario", nome: "Mario Bianchi", username: "mario" }] },
    rapportini: [{ id: "r1", data: "2026-10-02", cliente: "Rossi Srl", stato: "completato", attivita: "Sostituita pompa", rapportino_operai: [{ operaio_id: "u-mario" }] }] });
  const g = groqFinto([{ tipo: "tutti", dal: "2026-10-01", al: "2026-10-31", cliente: "Rossi),stato.eq.bozza", operaio: "Mario", stato: "completato",
    parole: ["pompa,attivita.is.null", "(x)", "a"], spiegazione: "Rapportini completati di Mario per Rossi a ottobre" }]);
  const x = dipendenze({ ruolo: "worker", db, groq: g });
  const r = await gestisci(richiesta({ azione: "ricerca", domanda: "lavori di Mario da Rossi a ottobre con la pompa" }), x.d);
  assert.equal(r.status, 200);
  const j = await corpo(r);
  assert.equal(j.rapportini.length, 1);
  assert.deepEqual(j.rapportini[0].operai, ["Mario Bianchi"]);
  assert.equal(x.usatoDb.length, 1, "un solo client, con il token dell'utente");
  assert.equal(x.usatoDb[0].headers.get("Authorization"), "Bearer token-utente");
  const tutteOps = db.chiamate.flatMap((c) => c.ops);
  const or = tutteOps.filter((o) => o[0] === "or").map((o) => String(o[1]));
  assert.ok(or.length >= 1);
  for (const s of or) for (const parte of s.split(",")) assert.match(parte, /^\w+\.ilike\.\*[^,()]*\*$/, "nessuna iniezione nei filtri: " + parte);
  const ilike = tutteOps.filter((o) => o[0] === "ilike" && o[1] === "cliente").map((o) => String(o[2]));
  assert.ok(ilike.every((v) => !/[(),]/.test(v)));
  assert.ok(tutteOps.some((o) => o[0] === "in" && String(o[1]).endsWith("operaio_id") && JSON.stringify(o[2]) === '["u-mario"]'));
  // interventi: stato "completato" valido anche per gli interventi; con l'operaio si usa !inner
  assert.ok(db.chiamate.some((c) => c.tabella === "interventi" && c.ops.some((o) => o[0] === "select" && String(o[1]).includes("intervento_operai!inner("))));
});

test("ricerca: date non valide e periodi eccessivi corretti", () => {
  const f = rispostaRicerca({ dal: "2026-02-30", al: "ieri", stato: "cancellato", tipo: "tutto", parole: ["ok", "x"] }, OGGI);
  assert.equal(f.al, OGGI);
  assert.equal(f.dal, "2026-08-15");
  assert.equal(f.stato, "");
  assert.equal(f.tipo, "tutti");
  assert.deepEqual(f.parole, ["ok"]);
  assert.equal(parolaSicura("a.b,c(d)*e%f"), "a b c d e f");
  assert.equal(dataValida("2026-13-01"), "");
});

test("ricerca: operaio sconosciuto = nessun risultato e nessuna query", async () => {
  const db = dbFinto({ rpc: { nomi_utenti: [{ id: "u1", nome: "Anna", username: "anna" }] } });
  const g = groqFinto([{ operaio: "Zorro", parole: [] }]);
  const r = await gestisci(richiesta({ azione: "ricerca", domanda: "lavori di Zorro" }), dipendenze({ db, groq: g }).d);
  const j = await corpo(r);
  assert.equal(j.rapportini.length + j.interventi.length, 0);
  assert.match(j.nota, /Zorro/);
  assert.equal(db.chiamate.length, 0);
});

// ---------------------------------------------------------------- assistente dati
test("domanda: senza dati non si chiama il modello; con dati totali esatti e righe", async () => {
  let g = groqFinto([{ risposta: "x" }]);
  let r = await gestisci(richiesta({ azione: "domanda", domanda: "quante ore?" }), dipendenze({ ruolo: "company", groq: g }).d);
  assert.equal(r.status, 200);
  assert.equal((await corpo(r)).senzaModello, true);
  assert.equal(g.richieste.length, 0);

  const db = dbFinto({ rpc: { nomi_utenti: [{ id: "u1", nome: "Anna" }] }, interventi: [],
    rapportini: [{ id: "r1", data: "2026-11-02", cliente: "Bar Sole", stato: "completato", firmatario: "", attivita: "Pulizia filtri",
      rapportino_operai: [{ operaio_id: "u1", dalle: "08:00", alle: "10:30" }], allegati: [{ count: 0 }] }] });
  g = groqFinto([{ risposta: "Anna ha lavorato 2h30.", dati_usati: ["ORE PER OPERAIO"], limiti: "" }]);
  r = await gestisci(richiesta({ azione: "domanda", domanda: "quante ore ha fatto Anna?", dal: "2026-11-01", al: "2026-11-13" }), dipendenze({ db, groq: g }).d);
  const j = await corpo(r);
  assert.equal(j.risposta, "Anna ha lavorato 2h30.");
  assert.deepEqual(j.periodo, { dal: "2026-11-01", al: "2026-11-13" });
  const prompt = JSON.stringify(g.richieste[0].body.messages);
  assert.match(prompt, /ORE PER OPERAIO: Anna 2h30/);
  assert.match(prompt, /completati senza firmatario 1/);
  // limiti sulle letture
  const sel = db.chiamate.find((c) => c.tabella === "rapportini")!.ops;
  assert.ok(sel.some((o) => o[0] === "limit" && o[1] === LIMITI.righeDati));
  assert.ok(!sel.some((o) => o[0] === "select" && /\bfirma\b(?!tario)/.test(String(o[1]))), "la firma non si legge");
  // periodo oltre 12 mesi rifiutato
  r = await gestisci(richiesta({ azione: "domanda", domanda: "x", dal: "2024-01-01", al: "2026-01-01" }), dipendenze().d);
  assert.equal(r.status, 400);
});

test("contesto della domanda: si ferma al limite di caratteri ma i totali comprendono tutto", () => {
  const rr = Array.from({ length: 400 }, (_, i) => ({ id: "r" + i, data: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), cliente: "Cliente " + i,
    stato: "completato", attivita: "x".repeat(150), rapportino_operai: [{ operaio_id: "u", dalle: "08:00", alle: "09:00" }] }));
  const t = contestoDomanda([], rr, () => "Op", OGGI);
  assert.ok(t.length <= LIMITI.caratteriDati + 200);
  assert.match(t, /TOTALI: interventi 0, rapportini 400, ore 400h/);
  assert.match(t, /righe piu' vecchie non incluse/);
});

// ---------------------------------------------------------------- predittiva
test("predittiva: con pochi dati nessuna previsione e nessuna chiamata al modello", async () => {
  const db = dbFinto({ rapportini: [{ id: "r1", data: "2026-10-01", cliente: "A", stato: "completato", firmatario: "X" }] });
  const g = groqFinto([{ sintesi: "x" }]);
  const r = await gestisci(richiesta({ azione: "predittiva" }), dipendenze({ db, groq: g }).d);
  const j = await corpo(r);
  assert.equal(j.sufficienti, false);
  assert.ok(j.statistiche.insufficienti.length >= 3);
  assert.equal(g.richieste.length, 0);
});

test("predittiva: ricorrenza regolare, anomalie e tendenza calcolate; il modello commenta soltanto", async () => {
  const rap = (id: string, data: string, cliente: string, min: number, extra = {}) => ({ id, data, cliente, stato: "completato", firmatario: "F",
    rapportino_operai: [{ operaio_id: "u", dalle: "08:00", alle: String(8 + Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0") }], ...extra });
  const rapportini = [
    rap("a1", "2026-05-04", "Condominio Verdi", 60), rap("a2", "2026-07-03", "Condominio Verdi", 60), rap("a3", "2026-09-01", "Condominio Verdi", 60),
    rap("b1", "2026-06-10", "B", 60), rap("b2", "2026-08-10", "B", 60), rap("b3", "2026-08-20", "B", 60), rap("b4", "2026-10-10", "B", 60),
    rap("c1", "2026-10-11", "C", 60), rap("c2", "2026-10-12", "C", 60), rap("c3", "2026-10-13", "C", 600, { stato: "bozza" }),
  ];
  const db = dbFinto({ rapportini, interventi: [{ id: "i1", data: "2026-11-01", cliente: "D", stato: "pianificato" }] });
  const g = groqFinto([{ sintesi: "Il condominio Verdi ha manutenzioni ogni due mesi circa.", suggerimenti: ["Pianificare la prossima visita"] }]);
  const r = await gestisci(richiesta({ azione: "predittiva", dal: "2026-01-01", al: OGGI }), dipendenze({ db, groq: g }).d);
  const j = await corpo(r);
  assert.equal(j.sufficienti, true);
  const verdi = j.statistiche.ricorrenze.find((x: { cliente: string }) => x.cliente === "Condominio Verdi");
  assert.equal(verdi.regolare, true);
  assert.equal(verdi.ogniGiorni, 60);
  assert.equal(verdi.prossimaStimata, "2026-10-31");
  const tipi = j.statistiche.anomalie.map((a: { tipo: string }) => a.tipo);
  assert.ok(tipi.includes("ore elevate"));
  assert.ok(tipi.includes("bozza ferma"));
  assert.ok(tipi.includes("intervento scaduto"));
  assert.ok(j.statistiche.tendenze && j.statistiche.tendenze.mesi.length >= 4);
  assert.equal(j.commento.suggerimenti[0], "Pianificare la prossima visita");
  // Groq non disponibile: restano le statistiche
  const g2 = groqFinto([() => new Response("x", { status: 503 })]);
  const r2 = await gestisci(richiesta({ azione: "predittiva", dal: "2026-01-01", al: OGGI }), dipendenze({ db: dbFinto({ rapportini }), groq: g2 }).d);
  const j2 = await corpo(r2);
  assert.equal(r2.status, 200);
  assert.equal(j2.commento, null);
  assert.ok(j2.avviso);
});

test("statistiche: soglie rispettate (niente previsioni con 2 visite)", () => {
  const s = statistiche([], [{ id: "1", data: "2026-01-01", cliente: "X", stato: "completato" }, { id: "2", data: "2026-02-01", cliente: "X", stato: "completato" }], "2026-01-01", OGGI, OGGI);
  assert.equal(s.ricorrenze.length, 0);
  assert.equal(s.tendenze, null);
});

// ---------------------------------------------------------------- suggerimenti e controllo
test("suggerimenti: storico dello stesso cliente con RLS; materiali gia' presenti esclusi", async () => {
  const db = dbFinto({ rapportini: [{ id: "x", data: "2026-09-01", cliente: "Rossi", tipologia: "Manutenzione ordinaria", attivita: "Pulizia bruciatore", materiali: [{ a: "Ugello 0.6", q: "1" }] }] });
  const g = groqFinto([{ attivita: ["Analisi fumi"], materiali: [{ a: "Ugello 0.6", q: "1" }, { a: "Guarnizione", q: "" }], controlli: ["Verifica tiraggio"] }]);
  const r = await gestisci(richiesta({ azione: "suggerimenti", id: "22222222-2222-4222-8222-222222222222",
    rapportino: { cliente: "Rossi", materiali: [{ a: "ugello 0.6", q: "2" }] } }), dipendenze({ ruolo: "worker", db, groq: g }).d);
  const j = await corpo(r);
  assert.deepEqual(j.materiali, [{ a: "Guarnizione", q: "" }]);
  assert.equal(j.storico, 1);
  const ops = db.chiamate[0].ops;
  assert.ok(ops.some((o) => o[0] === "neq" && o[1] === "id"));
  assert.ok(ops.some((o) => o[0] === "limit" && o[1] === 8));
  assert.match(JSON.stringify(g.richieste[0].body.messages), /Pulizia bruciatore/);
});

test("controllo AI: livello 'errore' declassato, risposta limitata; dati mancanti = 400", async () => {
  const g = groqFinto([{ segnalazioni: [{ livello: "errore", campo: "materiali", messaggio: "Materiale non coerente" }, { livello: "info", messaggio: "" }] }]);
  const r = await gestisci(richiesta({ azione: "controllo", rapportino: { cliente: "A", attivita: "Pulizia" }, segnalate: ["Firma mancante"] }), dipendenze({ ruolo: "company", groq: g }).d);
  const j = await corpo(r);
  assert.deepEqual(j.segnalazioni, [{ livello: "attenzione", campo: "materiali", messaggio: "Materiale non coerente", origine: "ai" }]);
  assert.equal((await gestisci(richiesta({ azione: "controllo", rapportino: {} }), dipendenze().d)).status, 400);
});

test("modelli: elenco Groq e configurati mancanti (solo admin)", async () => {
  const g = groqFinto([() => new Response(JSON.stringify({ data: [{ id: MODELLI_PREDEFINITI.testo, active: true }, { id: "altro", active: true }, { id: MODELLI_PREDEFINITI.visione, active: false }] }), { status: 200 })]);
  const r = await gestisci(richiesta({ azione: "modelli" }), dipendenze({ groq: g }).d);
  const j = await corpo(r);
  assert.deepEqual(j.mancanti.sort(), [MODELLI_PREDEFINITI.riserva, MODELLI_PREDEFINITI.visione].sort());
  assert.match(g.richieste[0].url, /\/models$/);
});

// ---------------------------------------------------------------- parsing
test("estraiJson tollera recinti e ragionamento, rifiuta il resto", () => {
  assert.deepEqual(estraiJson('<think>pensiero</think>\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(estraiJson('Ecco: {"a": {"b": 2}} fine'), { a: { b: 2 } });
  assert.throws(() => estraiJson("[1,2]"), ErroreAI);
  assert.throws(() => estraiJson("niente"), ErroreAI);
});

test("chiediJson: errore di input del servizio (400) non viene ripetuto", async () => {
  const g = groqFinto([() => new Response('{"error":{"code":"invalid_request"}}', { status: 400 })]);
  await assert.rejects(chiediJson(configurazione(() => "k"), { tipo: "testo", messaggi: [], maxToken: 10, timeoutMs: 1000, valida: (o) => o, fetchImpl: g.f }),
    (e: ErroreAI) => e.stato === 400);
  assert.equal(g.richieste.length, 1);
});
