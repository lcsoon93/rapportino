// Bot Telegram dei rapportini (Edge Function "telegram"), senza rete e senza il progetto vero:
// Telegram, Groq (testo e trascrizione), database e sessione dell'utente sono finti.
// Esecuzione: node --experimental-strip-types --test tests/server/telegram.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gestisci, type Dipendenze } from "../../supabase/functions/_shared/telegram-gestore.ts";
import {
  anteprima, bozzaVuota, cercaCliente, controlla, dataLavoro, datiSalvataggio, leggiPulsante, risolviOre, validaRispostaAI,
} from "../../supabase/functions/_shared/telegram-logica.ts";

const TOKEN = "123456:TOKEN_FINTO_non_reale";
const SEGRETO = "segreto-webhook-di-prova-1234567890";
const UTENTE = "777000111";
const OGGI = "2026-11-28";
const LUCA = "11111111-1111-4111-8111-111111111111", MARIO = "22222222-2222-4222-8222-222222222222";
const ENV: Record<string, string> = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SEGRETO, TELEGRAM_UTENTE_ID: UTENTE, TELEGRAM_PROFILO: "luca", GROQ_API_KEY: "gsk_finta" };
const CLIENTI = [
  { id: "c1", nome: "Mario Rossi", indirizzo: "Via Roma 1", telefono: "333", archiviato: false },
  { id: "c2", nome: "Mario Rossi", indirizzo: "Via Verdi 9", telefono: "", archiviato: false },
  { id: "c3", nome: "Condominio Aurora", indirizzo: "Via Aurora 5", telefono: "02", archiviato: false },
  { id: "c4", nome: "Bianchi Impianti Srl", indirizzo: "", telefono: "", archiviato: false },
];
const TECNICI = [{ id: LUCA, username: "luca", nome: "Luca Admin", attivo: true }, { id: MARIO, username: "mario", nome: "Mario Bianchi", attivo: true }];

// ---------------------------------------------------------------- database finto (sottoinsieme di PostgREST)
type Riga = Record<string, unknown>;
function tabelle() { return { telegram_aggiornamenti: [] as Riga[], telegram_bozze: [] as Riga[], profili: [{ id: LUCA, username: "luca", attivo: true }] as Riga[], clienti: CLIENTI as Riga[] }; }
function dbFinto(t: Record<string, Riga[]>, opz: { erroreScrittura?: boolean } = {}) {
  return {
    from(nome: string) {
      const filtri: ((r: Riga) => boolean)[] = [];
      let op = "select", valori: Riga | null = null, singolo = false;
      const q: Record<string, unknown> = {
        select: () => q, limit: () => q,
        insert: (v: Riga) => { op = "insert"; valori = v; return q; },
        update: (v: Riga) => { op = "update"; valori = v; return q; },
        delete: () => { op = "delete"; return q; },
        eq: (k: string, v: unknown) => { filtri.push((r) => String(r[k]) === String(v)); return q; },
        lt: (k: string, v: string) => { filtri.push((r) => String(r[k]) < v); return q; },
        or: (s: string) => {
          const parti = s.split(",").map((p) => { const [k, o, ...v] = p.split("."); return { k, o, v: v.join(".") }; });
          filtri.push((r) => parti.some((p) => p.o === "eq" ? String(r[p.k]) === p.v : String(r[p.k]) < p.v));
          return q;
        },
        maybeSingle: () => { singolo = true; return q; }, single: () => { singolo = true; return q; },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(() => {
          const righe = t[nome];
          if (!righe) return { data: null, error: { message: "tabella" } };
          const scelte = righe.filter((r) => filtri.every((f) => f(r)));
          if (op === "insert") {
            if (opz.erroreScrittura) return { data: null, error: { code: "XX000", message: "errore" } };
            const chiave = nome === "telegram_aggiornamenti" ? "update_id" : "chat_id";
            if (righe.some((r) => r[chiave] === valori![chiave])) return { data: null, error: { code: "23505", message: "duplicate key" } };
            const nuova = { stato: nome === "telegram_aggiornamenti" ? "in_corso" : "aperta", versione: 1, rapportino_id: crypto.randomUUID(),
              ricevuto_il: new Date().toISOString(), aggiornato_il: new Date().toISOString(), ...valori };
            righe.push(nuova);
            return { data: singolo ? nuova : [nuova], error: null };
          }
          if (op === "update") { scelte.forEach((r) => Object.assign(r, valori)); return { data: singolo ? scelte[0] ?? null : scelte, error: null }; }
          if (op === "delete") { t[nome] = righe.filter((r) => !scelte.includes(r)); return { data: scelte, error: null }; }
          return { data: singolo ? scelte[0] ?? null : scelte, error: null };
        }).then(ok, ko),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

// ---------------------------------------------------------------- Telegram e Groq finti
type Ambiente = ReturnType<typeof ambiente>;
function ambiente(opz: { ai?: (msg: string, bozza: unknown) => unknown; aiErrore?: number; trascrizione?: string; salvaErrore?: boolean; erroreScrittura?: boolean } = {}) {
  const t = tabelle();
  const inviati: { metodo: string; corpo: Record<string, unknown> }[] = [];
  const salvati: Record<string, unknown>[] = [];
  const log: Record<string, unknown>[] = [];
  const richiesteAI: unknown[] = [];
  let sessioniAperte = 0, sessioniChiuse = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/file/")) return new Response(new Uint8Array([79, 103, 103, 83, 1, 2, 3]), { status: 200 });
    if (u.startsWith("https://api.telegram.org/bot")) {
      const metodo = u.split("/").pop()!;
      const corpo = JSON.parse(String(init!.body));
      inviati.push({ metodo, corpo });
      const result = metodo === "getFile" ? { file_path: "voice/file_1.oga" } : { message_id: 1 };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }
    if (u.endsWith("/audio/transcriptions")) {
      const form = init!.body as FormData;
      richiesteAI.push({ audio: true, modello: form.get("model"), lingua: form.get("language") });
      return new Response(JSON.stringify({ text: opz.trascrizione ?? "" }), { status: 200 });
    }
    if (u.endsWith("/chat/completions")) {
      if (opz.aiErrore) return new Response(JSON.stringify({ error: { code: "x" } }), { status: opz.aiErrore });
      const corpo = JSON.parse(String(init!.body));
      const dati = JSON.parse(corpo.messages[1].content.replace(/^<dati>\n|\n<\/dati>$/g, ""));
      richiesteAI.push(dati);
      const r = opz.ai ? opz.ai(dati.messaggio, dati.bozza_attuale) : { modifiche: {} };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }], usage: { total_tokens: 10 }, model: corpo.model }), { status: 200 });
    }
    throw new Error("richiesta inattesa " + u);
  }) as typeof fetch;
  const d: Dipendenze = {
    env: (k) => ENV[k], admin: dbFinto(t, { erroreScrittura: opz.erroreScrittura }), fetchImpl, oggi: () => OGGI, log: (o) => log.push(o),
    sessione: async (id) => {
      assert.equal(id, LUCA, "sessione dell'utente collegato al bot");
      sessioniAperte++;
      const db = dbFinto({ clienti: CLIENTI as Riga[] });
      return {
        profiloId: id, chiudi: async () => { sessioniChiuse++; },
        db: { from: db.from, rpc: async (f: string, a?: Record<string, unknown>) => {
          if (f === "operai_attivi") return { data: TECNICI, error: null };
          if (f === "salva_rapportino") {
            if (opz.salvaErrore) return { data: null, error: { code: "XX000", message: "errore interno" } };
            const id = (a!.p_rapportino as Riga).id;
            const gia = salvati.find((s) => (s.p_rapportino as Riga).id === id);
            if (gia) return { data: { esito: "conflitto", rapportino: { id } }, error: null };
            salvati.push(a!);
            return { data: { esito: "ok", rapportino: { id } }, error: null };
          }
          return { data: null, error: { message: "rpc" } };
        } },
      };
    },
  };
  return { t, d, inviati, salvati, log, richiesteAI, sessioni: () => [sessioniAperte, sessioniChiuse] };
}
let prossimo = 1000;
const req = (corpo: unknown, segreto = SEGRETO) => new Request("https://x.supabase.co/functions/v1/telegram", {
  method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": segreto }, body: JSON.stringify(corpo) });
const daMe = { id: +UTENTE, is_bot: false, first_name: "Luca" };
const chatMia = { id: +UTENTE, type: "private" };
const testo = (t: string, extra: Record<string, unknown> = {}) => ({ update_id: ++prossimo, message: { message_id: prossimo, from: daMe, chat: chatMia, date: 1, text: t, ...extra } });
const vocale = (v: Record<string, unknown>) => ({ update_id: ++prossimo, message: { message_id: prossimo, from: daMe, chat: chatMia, date: 1, voice: { file_id: "F1", duration: 12, mime_type: "audio/ogg", file_size: 20000, ...v } } });
const tocco = (data: string) => ({ update_id: ++prossimo, callback_query: { id: "cb" + prossimo, from: daMe, data, message: { message_id: 5, chat: chatMia } } });
async function manda(a: Ambiente, u: unknown) { const r = await gestisci(req(u), a.d); assert.equal(r.status, 200); return a.inviati.filter((x) => x.metodo === "sendMessage").at(-1); }
const ultimo = (a: Ambiente) => String(a.inviati.filter((x) => x.metodo === "sendMessage").at(-1)?.corpo.text || "");
const pulsanti = (a: Ambiente) => ((a.inviati.filter((x) => x.metodo === "sendMessage").at(-1)?.corpo.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard || []).flat();
const bozza = (a: Ambiente) => a.t.telegram_bozze[0] as Riga & { dati: Record<string, unknown>; versione: number };
const LAVORO = { modifiche: { cliente: "Condominio Aurora", data: OGGI, attivita: "Sostituita la valvola della caldaia.", materiali: [{ a: "Raccordo 1/2", q: "2" }],
  ore: [{ tecnico: "", dalle: "08:00", alle: "11:00" }, { tecnico: "Mario", dalle: "08:00", alle: "10:30" }] } };

// ---------------------------------------------------------------- test
test("1. messaggio scritto: bozza con cliente, data, descrizione, ore e materiali; anteprima con pulsanti; nessun salvataggio", async () => {
  const a = ambiente({ ai: () => LAVORO });
  await manda(a, testo("Oggi al condominio Aurora sostituita valvola caldaia dalle 8 alle 11, con Mario fino alle 10:30, 2 raccordi da 1/2"));
  const t = ultimo(a);
  for (const s of ["Condominio Aurora (anagrafica)", "28/11/2026", "Sostituita la valvola", "Luca Admin 08:00–11:00", "Mario Bianchi 08:00–10:30", "totale 5 ore 30 min", "Raccordo 1/2 (2)", "Completato"])
    assert.ok(t.includes(s), "manca nell'anteprima: " + s + "\n" + t);
  assert.deepEqual(pulsanti(a).map((p) => p.callback_data), ["ok:1", "mod:1", "no:1"]);
  assert.equal(bozza(a).dati.cliente_id, "c3");
  assert.equal(a.salvati.length, 0, "nessun rapportino senza conferma");
  assert.deepEqual(a.sessioni(), [1, 1], "sessione chiusa");
  const ai = a.richiesteAI[0] as Record<string, unknown>;
  assert.equal(ai.oggi, OGGI);
  assert.deepEqual(ai.tecnici_dell_app, ["Luca Admin", "Mario Bianchi"]);
});

test("2. vocale: scaricato da Telegram, trascritto con Whisper (italiano), poi stessa estrazione del testo", async () => {
  const a = ambiente({ trascrizione: "Oggi da Bianchi Impianti, pulizia bruciatore", ai: (m) => (assert.equal(m, "Oggi da Bianchi Impianti, pulizia bruciatore"),
    { modifiche: { cliente: "Bianchi Impianti Srl", data: OGGI, attivita: "Pulizia del bruciatore." } }) });
  await manda(a, vocale({}));
  const msgs = a.inviati.filter((x) => x.metodo === "sendMessage").map((x) => String(x.corpo.text));
  assert.match(msgs[0], /Ho capito: «Oggi da Bianchi Impianti, pulizia bruciatore»/);
  assert.match(msgs[1], /Bianchi Impianti Srl \(anagrafica\)/);
  assert.deepEqual(a.richiesteAI[0], { audio: true, modello: "whisper-large-v3-turbo", lingua: "it" });
  assert.ok(a.inviati.some((x) => x.metodo === "getFile"));
  // limiti: troppo lungo, troppo grande, formato non ammesso -> nessuna trascrizione
  for (const [v, re] of [[{ duration: 400 }, /troppo lungo/], [{ file_size: 30 * 1024 * 1024 }, /troppo grande/], [{ mime_type: "video/mp4" }, /non supportato/]] as const) {
    const b = ambiente({ trascrizione: "x" });
    await manda(b, vocale(v));
    assert.match(ultimo(b), re);
    assert.equal(b.richiesteAI.length, 0);
  }
  const vuoto = ambiente({ trascrizione: "  " });
  await manda(vuoto, vocale({}));
  assert.match(ultimo(vuoto), /Non ho capito il vocale/);
});

test("3-4. cliente: riconosciuto, omonimi da scegliere (pulsante o numero), simile da confermare, non in anagrafica", async () => {
  const a = ambiente({ ai: () => ({ modifiche: { cliente: "mario rossi", data: OGGI, attivita: "Riparazione" } }) });
  await manda(a, testo("Oggi da Mario Rossi riparazione"));
  assert.match(ultimo(a), /Quale cliente\?/);
  assert.deepEqual(pulsanti(a).map((p) => p.callback_data), ["cli:0:1", "cli:1:1", "lib:1", "mod:1", "no:1"], "senza «Conferma» finché il cliente non è scelto");
  await manda(a, testo("2"));
  assert.equal(bozza(a).dati.cliente_id, "c2");
  assert.match(ultimo(a), /Mario Rossi \(anagrafica\)/);
  assert.ok(pulsanti(a).some((p) => p.callback_data === "ok:2"));

  const b = ambiente({ ai: () => ({ modifiche: { cliente: "Aurora", data: OGGI, attivita: "x" } }) });
  await manda(b, testo("lavoro all'Aurora"));
  assert.deepEqual(pulsanti(b).map((p) => p.callback_data).slice(0, 2), ["cli:0:1", "lib:1"]);
  await manda(b, tocco("cli:0:1"));
  assert.equal(bozza(b).dati.cliente_id, "c3");

  const c = ambiente({ ai: () => ({ modifiche: { cliente: "Pinco Pallino", data: OGGI, attivita: "x" } }) });
  await manda(c, testo("da Pinco Pallino"));
  assert.match(ultimo(c), /Pinco Pallino \(da confermare\)/);
  await manda(c, tocco("lib:1"));
  assert.match(ultimo(c), /Pinco Pallino \(non in anagrafica\)/);
  assert.equal(bozza(c).dati.cliente_id, null);
  assert.deepEqual(cercaCliente("Bianchi", CLIENTI).esito, "simili");
  assert.deepEqual(cercaCliente("  ", CLIENTI).esito, "vuoto");
});

test("5. dati mancanti: nessuna conferma possibile, elencati nell'anteprima; ore senza orario segnalate", async () => {
  const a = ambiente({ ai: () => ({ modifiche: { attivita: "Pulizia filtri", ore: [{ tecnico: "", durata_minuti: 120 }] } }) });
  await manda(a, testo("pulizia filtri, 2 ore"));
  const t = ultimo(a);
  assert.match(t, /Mancano:<\/b> cliente, data\./);
  assert.match(t, /indica anche l'ora di inizio/);
  assert.ok(!pulsanti(a).some((p) => p.callback_data.startsWith("ok:")));
  // conferma forzata (pulsante vecchio o costruito a mano): rifiutata
  await manda(a, tocco("ok:1"));
  assert.match(ultimo(a), /Non posso ancora creare il rapportino/);
  assert.equal(a.salvati.length, 0);
});

test("6. correzioni: ore, materiali, cliente e descrizione; dati non validi dell'AI scartati", async () => {
  let giro = 0;
  const a = ambiente({ ai: (_m, b) => {
    giro++;
    if (giro === 1) return LAVORO;
    assert.ok(b, "la bozza attuale arriva all'AI");
    if (giro === 2) return { modifiche: { ore: [{ tecnico: "", dalle: "09:00", alle: "12:00" }], materiali: [] } };
    if (giro === 3) return { modifiche: { cliente: "Bianchi Impianti Srl", attivita: "Sostituita la valvola e spurgato l'impianto." } };
    return { modifiche: { data: "2027-01-01", ore: [{ tecnico: "", dalle: "25:00", alle: "26:00" }], esito: "boh" } };
  } });
  await manda(a, testo("lavoro"));
  await manda(a, testo("no, ho fatto dalle 9 alle 12 da solo e togli i raccordi"));
  assert.match(ultimo(a), /Luca Admin 09:00–12:00 — totale 3 ore/);
  assert.match(ultimo(a), /Materiali:<\/b> nessuno/);
  assert.equal(bozza(a).versione, 2);
  await manda(a, testo("il cliente è Bianchi impianti, aggiungi che ho spurgato"));
  assert.equal(bozza(a).dati.cliente_id, "c4");
  assert.match(ultimo(a), /spurgato/);
  await manda(a, testo("domani alle 25"));
  const t = ultimo(a);
  assert.match(t, /la data è nel futuro/);
  assert.match(t, /Orario non valido/);
  assert.equal(bozza(a).dati.data, OGGI, "data non valida scartata, resta quella di prima");
  // riprende la bozza con /bozza
  await manda(a, testo("/bozza"));
  assert.match(ultimo(a), /Bianchi Impianti Srl/);
});

test("7. conferma: salva_rapportino con la sessione dell'utente, cliente collegato, completato; conferma ripetuta senza doppioni", async () => {
  const a = ambiente({ ai: () => LAVORO });
  await manda(a, testo("lavoro"));
  const idRapportino = bozza(a).rapportino_id;
  await manda(a, tocco("ok:1"));
  assert.match(ultimo(a), /Rapportino creato/);
  assert.match(ultimo(a), /nella scheda del cliente/);
  assert.equal(a.salvati.length, 1);
  const s = a.salvati[0] as Record<string, Record<string, unknown>>;
  assert.equal(s.p_rapportino.id, idRapportino);
  assert.equal(s.p_rapportino.cliente_id, "c3");
  assert.equal(s.p_rapportino.cliente, "Condominio Aurora");
  assert.equal(s.p_rapportino.indirizzo, "Via Aurora 5", "luogo dalla scheda se non detto");
  assert.equal(s.p_rapportino.esito, "Completato");
  assert.equal(s.p_completa, true);
  assert.deepEqual(s.p_ore, [{ operaio_id: LUCA, dalle: "08:00", alle: "11:00" }, { operaio_id: MARIO, dalle: "08:00", alle: "10:30" }]);
  assert.equal(a.t.telegram_bozze.length, 0, "bozza eliminata dopo il salvataggio");
  // pulsante premuto di nuovo (o aggiornamento ripetuto): niente doppioni
  await manda(a, tocco("ok:1"));
  assert.match(ultimo(a), /bozza non c'è più/);
  assert.equal(a.salvati.length, 1);
  // conferma interrotta dopo il salvataggio: rifatta con lo stesso id -> "conflitto" = gia' salvato
  const b = ambiente({ ai: () => LAVORO });
  await manda(b, testo("lavoro"));
  const riga = bozza(b);
  b.salvati.push(datiSalvataggio(riga.dati as never, String(riga.rapportino_id), []) as never);
  riga.stato = "salvataggio"; riga.aggiornato_il = "2026-11-28T00:00:00Z";       // bloccata da tempo
  await manda(b, tocco("ok:1"));
  assert.match(ultimo(b), /Rapportino creato/);
  assert.equal(b.salvati.length, 1);
});

test("8. annullamento: pulsante, comando e richiesta a parole; nessun rapportino", async () => {
  const a = ambiente({ ai: () => LAVORO });
  await manda(a, testo("lavoro"));
  await manda(a, tocco("no:1"));
  assert.match(ultimo(a), /Bozza annullata/);
  assert.equal(a.t.telegram_bozze.length, 0);
  await manda(a, testo("lavoro"));
  await manda(a, testo("/annulla"));
  assert.equal(a.t.telegram_bozze.length, 0);
  const b = ambiente({ ai: (m) => m === "lascia perdere, cancella" ? { modifiche: {}, annulla: true } : LAVORO });
  await manda(b, testo("lavoro"));
  await manda(b, testo("lascia perdere, cancella"));
  assert.match(ultimo(b), /Bozza annullata/);
  assert.equal(b.salvati.length + a.salvati.length, 0);
  // pulsante di un'anteprima superata: non conferma dati cambiati
  const c = ambiente({ ai: () => LAVORO });
  await manda(c, testo("lavoro"));
  await manda(c, testo("correzione"));
  await manda(c, tocco("ok:1"));
  assert.match(ultimo(c), /non è più attuale/);
  assert.equal(c.salvati.length, 0);
});

test("9. sicurezza: secret del webhook, mittente non autorizzato, gruppi, configurazione incompleta", async () => {
  const a = ambiente({ ai: () => LAVORO });
  assert.equal((await gestisci(req(testo("x"), "sbagliato"), a.d)).status, 401);
  assert.equal((await gestisci(new Request("https://x", { method: "POST", body: "{}" }), a.d)).status, 401);
  const estraneo = { update_id: ++prossimo, message: { message_id: 1, from: { id: 999, first_name: "X" }, chat: { id: 999, type: "private" }, text: "crea rapportino" } };
  assert.equal((await gestisci(req(estraneo), a.d)).status, 200);
  const gruppo = { update_id: ++prossimo, message: { message_id: 1, from: daMe, chat: { id: -5, type: "group" }, text: "lavoro" } };
  await gestisci(req(gruppo), a.d);
  const cbEstraneo = { update_id: ++prossimo, callback_query: { id: "z", from: { id: 999 }, data: "ok:1", message: { message_id: 1, chat: { id: 999, type: "private" } } } };
  await gestisci(req(cbEstraneo), a.d);
  assert.equal(a.inviati.length, 0, "nessuna risposta a chi non e' autorizzato");
  assert.equal(a.richiesteAI.length, 0);
  assert.equal(a.t.telegram_bozze.length, 0);
  assert.ok(a.log.some((l) => l.esito === "mittente_non_autorizzato"));
  const senza = ambiente();
  senza.d.env = (k) => k === "TELEGRAM_WEBHOOK_SECRET" ? "" : ENV[k];
  assert.equal((await gestisci(req(testo("x"), ""), senza.d)).status, 503, "senza secret non accetta nulla");
  assert.equal((await gestisci(new Request("https://x", { method: "GET" }), a.d)).status, 405);
  // nessun token o chiave nei log
  const tutto = JSON.stringify(a.log);
  assert.ok(!tutto.includes(TOKEN) && !tutto.includes("gsk_finta") && !tutto.includes(UTENTE));
});

test("10. aggiornamento duplicato: elaborato una sola volta; rielaborato solo se il primo si e' interrotto", async () => {
  const a = ambiente({ ai: () => LAVORO });
  const u = testo("lavoro");
  await manda(a, u);
  const prima = a.inviati.length;
  await gestisci(req(u), a.d);
  assert.equal(a.inviati.length, prima, "duplicato ignorato");
  assert.equal(a.richiesteAI.length, 1);
  const t = tocco("ok:1");
  await gestisci(req(t), a.d); await gestisci(req(t), a.d);
  assert.equal(a.salvati.length, 1);
  // elaborazione interrotta (rimasta "in_corso" da piu' di 2 minuti): rielaborata
  const b = ambiente({ ai: () => LAVORO });
  const v = testo("lavoro");
  b.t.telegram_aggiornamenti.push({ update_id: v.update_id, stato: "in_corso", aggiornato_il: "2026-11-27T10:00:00Z", ricevuto_il: "2026-11-27T10:00:00Z" });
  await manda(b, v);
  assert.match(ultimo(b), /Bozza di rapportino/);
});

test("11. errore AI: messaggio chiaro, bozza invariata, nessun dettaglio tecnico", async () => {
  const a = ambiente({ ai: () => LAVORO });
  await manda(a, testo("lavoro"));
  const prima = JSON.stringify(bozza(a));
  const errAI = ambiente({ aiErrore: 503 });
  errAI.t.telegram_bozze.push(...a.t.telegram_bozze);
  await manda(errAI, testo("correggi le ore"));
  assert.match(ultimo(errAI), /Servizio AI momentaneamente non disponibile\. La bozza non è cambiata/);
  assert.equal(JSON.stringify(errAI.t.telegram_bozze[0]), prima);
  assert.ok(errAI.log.some((l) => l.esito === "ai_non_disponibile"));
  const limite = ambiente({ aiErrore: 429 });
  await manda(limite, testo("x"));
  assert.match(ultimo(limite), /Troppe richieste/);
  // risposta senza i campi attesi -> nessuna modifica inventata
  const vuota = ambiente({ ai: () => ({ qualcosa: 1 }) });
  await manda(vuota, testo("ciao"));
  assert.match(ultimo(vuota), /Non ho trovato dati di un lavoro/);
  assert.equal(vuota.t.telegram_bozze.length, 0);
});

test("12. errore del database: al salvataggio la bozza resta (niente persa) e si puo' riconfermare; errore sulla bozza segnalato", async () => {
  const a = ambiente({ ai: () => LAVORO, salvaErrore: true });
  await manda(a, testo("lavoro"));
  await manda(a, tocco("ok:1"));
  assert.match(ultimo(a), /Rapportino NON creato: errore del database/);
  assert.equal(bozza(a).stato, "aperta", "bozza conservata e di nuovo confermabile");
  assert.ok(pulsanti(a).some((p) => p.callback_data === "ok:1"));
  const b = ambiente({ ai: () => LAVORO, erroreScrittura: true });
  const r = await gestisci(req(testo("lavoro")), b.d);
  assert.equal(r.status, 500, "aggiornamento non registrato: Telegram lo rimandera'");
});

test("13. dati per l'app: stessi campi e regole della RPC salva_rapportino; logica pura", () => {
  const b = { ...bozzaVuota(), cliente: "Condominio Aurora", cliente_id: "c3", cliente_stato: "confermato" as const, data: OGGI, attivita: " Lavoro ",
    ore: [{ tecnico: "mario", dalle: "", alle: "12:00", durata: 90 }] };
  const c = controlla(b, TECNICI, LUCA);
  assert.equal(c.pronto, true);
  assert.deepEqual(c.righe, [{ operaio_id: MARIO, nome: "Mario Bianchi", dalle: "10:30", alle: "12:00" }]);
  const d = datiSalvataggio(b, "id-1", c.righe);
  assert.deepEqual(Object.keys(d.p_rapportino).sort(), ["attivita", "cliente", "cliente_id", "data", "esito", "firma", "firmatario", "id", "indirizzo", "intervento_id", "materiali", "note", "telefono", "tipologia"]);
  assert.equal(d.p_rapportino.attivita, "Lavoro");
  assert.deepEqual(risolviOre([{ tecnico: "Sconosciuto", dalle: "08:00", alle: "09:00", durata: 0 }], TECNICI, LUCA).bloccanti.length, 1);
  assert.deepEqual(risolviOre([{ tecnico: "", dalle: "10:00", alle: "09:00", durata: 0 }], TECNICI, LUCA).bloccanti.length, 1);
  assert.equal(risolviOre([{ tecnico: "", dalle: "08:00", alle: "09:00", durata: 0 }, { tecnico: "luca", dalle: "10:00", alle: "11:00", durata: 0 }], TECNICI, LUCA).bloccanti.length, 1, "un intervallo per tecnico");
  assert.deepEqual(dataLavoro("2026-02-30", OGGI).problema, "data non valida");
  assert.deepEqual(dataLavoro("2024-01-01", OGGI).problema, "la data è più vecchia di due anni");
  assert.deepEqual(leggiPulsante("cli:2:7"), { azione: "cli", indice: 2, versione: 7 });
  assert.equal(leggiPulsante("ok:abc"), null);
  assert.equal(leggiPulsante("cli:7"), null);
  const v = validaRispostaAI({ modifiche: { cliente: "<b>X</b>", materiali: [{ a: "Tubo", q: 3 }, { a: "" }], esito: "da ultimare", sconosciuto: 1 } }, OGGI);
  assert.deepEqual(v.modifiche, { cliente: "<b>X</b>", materiali: [{ a: "Tubo", q: "3" }], esito: "Da ultimare" });
  const ant = anteprima({ ...bozzaVuota(), cliente: "<b>X</b>", note: "a & b" }, 1, TECNICI, LUCA).testo;
  assert.ok(ant.includes("&lt;b&gt;X&lt;/b&gt;") && ant.includes("a &amp; b"), "testo dell'utente scappato nell'HTML");
});
