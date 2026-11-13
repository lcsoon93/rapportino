// Gestore delle richieste all'assistente AI (Edge Function "ai").
// Le dipendenze (utente, database, limiti, fetch) arrivano da fuori: in produzione da ai/index.ts,
// nei test (tests/ai-gestore.test.mjs) da finti oggetti, senza rete e senza il progetto vero.
//
// Sicurezza:
// - utente: dal token della sessione (verify_jwt + profilo attivo); il ruolo lo legge il server;
// - permessi per azione (PERMESSI_AI) prima di qualsiasi lettura o chiamata al modello;
// - dati: letti con il token DELL'UTENTE (client anon + Authorization), quindi filtrati da RLS:
//   nessun dato di altri utenti oltre a quelli che l'utente vede gia' nell'app;
// - limiti: per minuto e per giorno (funzione limite_tentativi, solo service_role); se il controllo
//   non e' possibile la richiesta viene rifiutata;
// - nessuna scrittura sui dati: l'assistente restituisce solo proposte;
// - log: azione, ruolo, esito, durata, modello e token; mai testi, foto o risultati.
import { type ConfigAI, ErroreAI, chiediJson, configurazione, elencoModelli } from "./groq.ts";
import {
  AZIONI, ErroreInput, type Filtri, LIMITI, PERMESSI_AI, type RigaIntervento, type RigaRapportino, type Ruolo,
  contestoDomanda, lista, norma, promptControllo, promptDomanda, promptFoto, promptPredittiva, promptRicerca,
  promptSuggerimenti, promptTesto, rapportinoDaInput, rispostaControllo, rispostaDomanda, rispostaFoto,
  rispostaPredittiva, rispostaRicerca, rispostaSuggerimenti, rispostaTesto, statistiche, statisticheUtili,
  storicoClienteTesto, validaDomanda, validaFoto, validaPeriodo, validaRicerca, validaTesto,
} from "./ai-logica.ts";

// sottoinsieme del client Supabase usato qui (il query builder e' "thenable")
// deno-lint-ignore no-explicit-any
export type DB = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };
export type Dipendenze = {
  env: (k: string) => string | undefined;
  chiamante: (req: Request) => Promise<{ profilo: { id: string; ruolo: Ruolo; attivo: boolean } } | null>;
  dbUtente: (req: Request) => DB;
  limite: (chiave: string, massimo: number, secondi: number) => Promise<boolean>;
  cors: Record<string, string>;
  fetchImpl?: typeof fetch;
  oggi?: () => string;
  log?: (o: Record<string, unknown>) => void;
};

const oggiRoma = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

function json(corpo: unknown, stato: number, cors: Record<string, string>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(corpo), { status: stato, headers: { ...cors, ...extra, "Content-Type": "application/json" } });
}

// lettura dal database con il token dell'utente; errori in forma leggibile
async function leggi<T>(q: PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) {
    if (/42501|permission|policy/i.test(String(error.code) + error.message)) throw new ErroreAI("Dati non consentiti a questo account.", 403, "permesso");
    throw new ErroreAI("Impossibile leggere i dati in questo momento.", 502, "dati");
  }
  return (data ?? []) as T;
}
async function nomiUtenti(db: DB): Promise<{ id: string; nome: string; username: string }[]> {
  try {
    const { data, error } = await db.rpc("nomi_utenti");
    return error ? [] : (data || []).map((x: { id: string; nome?: string; username?: string }) => ({ id: x.id, nome: String(x.nome || x.username || ""), username: String(x.username || "") }));
  } catch { return []; }
}
const funzioneNome = (nomi: { id: string; nome: string }[]) => {
  const m = new Map(nomi.map((n) => [n.id, n.nome]));
  return (id: string) => m.get(id) || "operaio";
};

const CAMPI_INT = "id, data, ora, cliente, indirizzo, descrizione, priorita, tipologia, stato, intervento_operai(operaio_id, rimosso_il)";
const CAMPI_RAP = "id, intervento_id, autore_id, data, cliente, indirizzo, tipologia, attivita, materiali, note, esito, stato, completato_il, firmatario, " +
  "rapportino_operai(operaio_id, dalle, alle), allegati(count)";
async function leggiPeriodo(db: DB, dal: string, al: string) {
  const [interventi, rapportini, nomi] = await Promise.all([
    leggi<RigaIntervento[]>(db.from("interventi").select(CAMPI_INT).gte("data", dal).lte("data", al).order("data", { ascending: false }).limit(LIMITI.righeDati)),
    leggi<RigaRapportino[]>(db.from("rapportini").select(CAMPI_RAP).gte("data", dal).lte("data", al).order("data", { ascending: false }).limit(LIMITI.righeDati)),
    nomiUtenti(db),
  ]);
  return { interventi, rapportini, nomi };
}

// "%testo%" per ilike, con i caratteri jolly del testo resi letterali
const comeLike = (s: string) => "%" + s.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ricerca con i filtri proposti dal modello (gia' ripuliti da rispostaRicerca): solo letture, con RLS
export async function eseguiRicerca(db: DB, f: Filtri, nomi: { id: string; nome: string; username: string }[]) {
  const corto = (s: unknown, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  let ids: string[] = [];
  if (f.operaio) {
    const cerca = norma(f.operaio);
    ids = nomi.filter((n) => norma(n.nome).includes(cerca) || norma(n.username) === cerca || norma(n.nome).split(" ")[0] === cerca.split(" ")[0]).map((n) => n.id);
    if (!ids.length) return { interventi: [], rapportini: [], nota: "Nessun operaio corrisponde a \"" + f.operaio + "\"." };
  }
  const nome = funzioneNome(nomi);
  let interventi: RigaIntervento[] = [], rapportini: RigaRapportino[] = [];
  const statiInt = ["pianificato", "in_corso", "completato", "annullato"];
  if (f.tipo !== "rapportini" && (!f.stato || statiInt.includes(f.stato))) {
    let q = db.from("interventi").select(ids.length ? CAMPI_INT.replace("intervento_operai(", "intervento_operai!inner(") : CAMPI_INT)
      .gte("data", f.dal).lte("data", f.al);
    if (f.cliente) q = q.ilike("cliente", comeLike(f.cliente));
    if (f.tipologia) q = q.ilike("tipologia", comeLike(f.tipologia));
    if (f.stato) q = q.eq("stato", f.stato);
    for (const p of f.parole) q = q.or("cliente.ilike.*" + p + "*,indirizzo.ilike.*" + p + "*,descrizione.ilike.*" + p + "*");
    if (ids.length) q = q.in("intervento_operai.operaio_id", ids);
    interventi = await leggi<RigaIntervento[]>(q.order("data", { ascending: false }).limit(40));
  }
  if (f.tipo !== "interventi" && (!f.stato || f.stato === "bozza" || f.stato === "completato")) {
    let q = db.from("rapportini").select(ids.length ? CAMPI_RAP.replace("rapportino_operai(", "rapportino_operai!inner(") : CAMPI_RAP)
      .gte("data", f.dal).lte("data", f.al);
    if (f.cliente) q = q.ilike("cliente", comeLike(f.cliente));
    if (f.tipologia) q = q.ilike("tipologia", comeLike(f.tipologia));
    if (f.stato) q = q.eq("stato", f.stato);
    for (const p of f.parole) q = q.or("cliente.ilike.*" + p + "*,indirizzo.ilike.*" + p + "*,attivita.ilike.*" + p + "*,note.ilike.*" + p + "*");
    if (ids.length) q = q.in("rapportino_operai.operaio_id", ids);
    rapportini = await leggi<RigaRapportino[]>(q.order("data", { ascending: false }).limit(40));
  }
  return {
    interventi: interventi.map((i) => ({ id: i.id, data: i.data, ora: i.ora ? String(i.ora).slice(0, 5) : "", cliente: i.cliente, indirizzo: i.indirizzo || "",
      stato: i.stato, descrizione: corto(i.descrizione, 140) })),
    rapportini: rapportini.map((r) => ({ id: r.id, data: r.data, cliente: r.cliente, indirizzo: r.indirizzo || "", stato: r.stato, esito: r.esito || "",
      attivita: corto(r.attivita, 140), operai: (r.rapportino_operai || []).map((o) => nome(o.operaio_id)).filter((x, i, a) => a.indexOf(x) === i) })),
    nota: "",
  };
}

// ---------------------------------------------------------------- azioni
type Contesto = { c: Record<string, unknown>; cfg: ConfigAI; db: () => DB; oggi: string; fetchImpl?: typeof fetch; uso: { modello: string; token: number } };
const TIMEOUT = { testo: 25000, visione: 45000 };

const AZIONE: Record<string, (x: Contesto) => Promise<Record<string, unknown>>> = {
  async testo(x) {
    const v = validaTesto(x.c);
    const r = await chiediJson(x.cfg, { tipo: "testo", messaggi: promptTesto(v), maxToken: 1500, timeoutMs: TIMEOUT.testo, valida: rispostaTesto, fetchImpl: x.fetchImpl });
    x.uso.modello = r.modello; x.uso.token = r.token;
    return { ...r.dati, modo: v.modo };
  },
  async foto(x) {
    const v = validaFoto(x.c);
    const r = await chiediJson(x.cfg, { tipo: "visione", messaggi: promptFoto(v), maxToken: 1200, timeoutMs: TIMEOUT.visione, valida: rispostaFoto, fetchImpl: x.fetchImpl });
    x.uso.modello = r.modello; x.uso.token = r.token;
    return r.dati;
  },
  async controllo(x) {
    const r0 = rapportinoDaInput(x.c.rapportino);
    if (!r0.cliente && !r0.attivita) throw new ErroreInput("Compila almeno cliente e attività prima del controllo.");
    const r = await chiediJson(x.cfg, { tipo: "testo", messaggi: promptControllo(r0, lista(x.c.segnalate, 20)), maxToken: 800, timeoutMs: TIMEOUT.testo, valida: rispostaControllo, fetchImpl: x.fetchImpl });
    x.uso.modello = r.modello; x.uso.token = r.token;
    return r.dati;
  },
  async suggerimenti(x) {
    const r0 = rapportinoDaInput(x.c.rapportino);
    if (!r0.cliente) throw new ErroreInput("Indica prima il cliente.");
    let q = x.db().from("rapportini").select("id, data, cliente, tipologia, attivita, materiali").ilike("cliente", r0.cliente.replace(/[\\%_]/g, (m) => "\\" + m));
    if (typeof x.c.id === "string" && UUID.test(x.c.id)) q = q.neq("id", x.c.id);
    const storico = await leggi<RigaRapportino[]>(q.order("data", { ascending: false }).limit(8));
    const r = await chiediJson(x.cfg, { tipo: "testo", messaggi: promptSuggerimenti(r0, storicoClienteTesto(storico)), maxToken: 900, timeoutMs: TIMEOUT.testo,
      valida: (o) => rispostaSuggerimenti(o, r0), fetchImpl: x.fetchImpl });
    x.uso.modello = r.modello; x.uso.token = r.token;
    return { ...r.dati, storico: storico.length };
  },
  async ricerca(x) {
    const v = validaRicerca(x.c);
    const db = x.db();
    const nomi = await nomiUtenti(db);
    const r = await chiediJson(x.cfg, { tipo: "testo", messaggi: promptRicerca(v.domanda, x.oggi, nomi.map((n) => n.nome)), maxToken: 500, timeoutMs: TIMEOUT.testo,
      valida: (o) => rispostaRicerca(o, x.oggi), fetchImpl: x.fetchImpl });
    x.uso.modello = r.modello; x.uso.token = r.token;
    return { filtri: r.dati, ...(await eseguiRicerca(db, r.dati, nomi)) };
  },
  async domanda(x) {
    const v = validaDomanda(x.c, x.oggi);
    const { interventi, rapportini, nomi } = await leggiPeriodo(x.db(), v.dal, v.al);
    const periodo = { dal: v.dal, al: v.al };
    if (!interventi.length && !rapportini.length) {
      return { risposta: "Nel periodo scelto non ci sono interventi o rapportini visibili al tuo account: non posso rispondere.", dati_usati: [], limiti: "", periodo, senzaModello: true };
    }
    const r = await chiediJson(x.cfg, { tipo: "testo", messaggi: promptDomanda(v.domanda, v.dal, v.al, contestoDomanda(interventi, rapportini, funzioneNome(nomi), x.oggi)),
      maxToken: 1500, timeoutMs: 30000, valida: rispostaDomanda, fetchImpl: x.fetchImpl });
    x.uso.modello = r.modello; x.uso.token = r.token;
    return { ...r.dati, periodo, righe: { interventi: interventi.length, rapportini: rapportini.length } };
  },
  async predittiva(x) {
    const p = validaPeriodo(x.c, x.oggi, 365);
    const { interventi, rapportini } = await leggiPeriodo(x.db(), p.dal, p.al);
    const s = statistiche(interventi, rapportini, p.dal, p.al, x.oggi);
    if (!statisticheUtili(s)) return { sufficienti: false, statistiche: s, commento: null };
    try {
      const r = await chiediJson(x.cfg, { tipo: "testo", messaggi: promptPredittiva(s), maxToken: 900, timeoutMs: TIMEOUT.testo, valida: rispostaPredittiva, fetchImpl: x.fetchImpl });
      x.uso.modello = r.modello; x.uso.token = r.token;
      return { sufficienti: true, statistiche: s, commento: r.dati };
    } catch (e) {
      // il commento e' facoltativo: le statistiche calcolate restano valide anche senza il modello
      if (e instanceof ErroreAI && e.stato !== 400) return { sufficienti: true, statistiche: s, commento: null, avviso: e.message };
      throw e;
    }
  },
  async modelli(x) {
    const disponibili = await elencoModelli(x.cfg.chiave, x.fetchImpl);
    const configurati = { testo: x.cfg.testo, riserva: x.cfg.riserva, visione: x.cfg.visione };
    return { configurati, disponibili, mancanti: Object.values(configurati).filter((m) => !disponibili.includes(m)) };
  },
};

export async function gestisci(req: Request, d: Dipendenze): Promise<Response> {
  const cors = d.cors;
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ errore: "Metodo non consentito" }, 405, cors);
  const inizio = Date.now();
  const log = d.log || ((o) => console.log(JSON.stringify(o)));
  let azione = "", ruolo = "";
  const fine = (corpo: Record<string, unknown>, stato: number, extra: Record<string, unknown> = {}, intestazioni: Record<string, string> = {}) => {
    log({ ai: azione || "?", ruolo: ruolo || "?", stato, ms: Date.now() - inizio, ...extra });
    return json(corpo, stato, cors, intestazioni);
  };

  const lunghezza = Number(req.headers.get("content-length") || 0);
  if (lunghezza > LIMITI.corpoByte) return fine({ errore: "Richiesta troppo grande." }, 413);
  const io = await d.chiamante(req);
  if (!io || !io.profilo.attivo) return fine({ errore: "Sessione non valida. Accedi di nuovo." }, 401);
  ruolo = io.profilo.ruolo;

  let c: Record<string, unknown>;
  try {
    const t = await req.text();
    if (t.length > LIMITI.corpoByte) return fine({ errore: "Richiesta troppo grande." }, 413);
    const j = JSON.parse(t);
    c = j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch { return fine({ errore: "Richiesta non valida." }, 400); }
  azione = String(c.azione || "");
  if (!AZIONI.includes(azione)) return fine({ errore: "Azione non valida." }, 400);
  if (!PERMESSI_AI[azione].includes(io.profilo.ruolo)) return fine({ errore: "Funzione non disponibile per il tuo ruolo." }, 403);

  const cfg = configurazione(d.env);
  if (!cfg.chiave) return fine({ errore: "L'assistente AI non è ancora configurato sul server.", codice: "non_configurata" }, 503);

  // limiti per utente: prima al minuto, poi al giorno (rifiuto se non verificabili)
  try {
    if (!(await d.limite("ai-min:" + io.profilo.id, LIMITI.perMinuto, 60))) {
      return fine({ errore: "Troppe richieste all'assistente: aspetta un minuto.", codice: "limite" }, 429, {}, { "Retry-After": "60" });
    }
    if (!(await d.limite("ai-giorno:" + io.profilo.id, LIMITI.perGiorno[io.profilo.ruolo], 86400))) {
      return fine({ errore: "Hai raggiunto il limite giornaliero dell'assistente AI. Riprova domani.", codice: "limite_giorno" }, 429);
    }
  } catch {
    return fine({ errore: "Assistente AI momentaneamente non disponibile.", codice: "limiti" }, 503);
  }

  const uso = { modello: "", token: 0 };
  let dbCache: DB | null = null;
  try {
    const dati = await AZIONE[azione]({ c, cfg, db: () => (dbCache = dbCache || d.dbUtente(req)), oggi: (d.oggi || oggiRoma)(), fetchImpl: d.fetchImpl, uso });
    return fine({ ok: true, ...dati, modello: uso.modello || undefined }, 200, { modello: uso.modello, token: uso.token });
  } catch (e) {
    if (e instanceof ErroreInput) return fine({ errore: e.message, codice: "input" }, 400);
    if (e instanceof ErroreAI) {
      return fine({ errore: e.message, codice: e.codice }, e.stato, { codice: e.codice, modello: uso.modello },
        e.riprovaTra ? { "Retry-After": String(e.riprovaTra) } : {});
    }
    log({ ai: azione, errore: String((e as Error).name || "Error") });
    return fine({ errore: "Errore dell'assistente AI.", codice: "interno" }, 500);
  }
}
