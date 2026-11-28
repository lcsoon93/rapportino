// Gestore del webhook Telegram (Edge Function "telegram"): bot PRIVATO che crea rapportini da messaggi
// scritti e vocali. Le dipendenze arrivano da fuori (telegram/index.ts in produzione, finti oggetti nei
// test tests/server/telegram.test.mts): nessuna rete o database reali nei test.
//
// Sicurezza
// - ogni richiesta deve avere l'intestazione X-Telegram-Bot-Api-Secret-Token uguale al secret
//   TELEGRAM_WEBHOOK_SECRET (impostato con setWebhook): altrimenti 401, senza elaborare nulla;
// - ogni aggiornamento deve venire dall'utente Telegram TELEGRAM_UTENTE_ID in chat privata: gli altri
//   sono ignorati in silenzio (il bot non risponde e non rivela nulla);
// - aggiornamenti ripetuti (stesso update_id) elaborati una volta sola (tabella telegram_aggiornamenti);
// - il rapportino si salva SOLO dopo il tocco su «Conferma», con salva_rapportino e la sessione
//   dell'utente dell'app TELEGRAM_PROFILO (RLS, autore e notifiche come nell'app). L'id del rapportino
//   e' deciso alla creazione della bozza: una conferma ripetuta o interrotta non crea doppioni;
// - token Telegram e chiave Groq solo nei secret; nei log solo eventi ed esiti, mai testi, nomi o id.
import { type ConfigAI, ErroreAI, chiediJson, configurazione, trascriviAudio, MAX_AUDIO_BYTE } from "./groq.ts";
import { rispondiDomanda } from "./ai-gestore.ts";
import {
  type Bozza, MAX_DURATA_VOCALE_S, MAX_TESTO_MESSAGGIO, SCADENZA_BOZZA_ORE, type Tastiera, type Tecnico, anteprima, applicaModifiche,
  bozzaVuota, cercaCliente, clienteLibero, collegaCliente, controlla, datiSalvataggio, html, leggiPulsante, promptBozza, scegliCandidato,
  validaRispostaAI, ELENCO_MAX, type RigaElenco, confermaEliminazioneTesto, elencoTesto, filtroElenco, leggiPulsanteElenco, richiestaElenco,
  type RigaIntervento, bozzaDaIntervento, elencoInterventiTesto, filtroInterventi, richiestaInterventi, COMANDI_MENU,
} from "./telegram-logica.ts";

// deno-lint-ignore no-explicit-any
export type DB = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };
export type Sessione = { db: DB; profiloId: string; chiudi: () => Promise<void> };
export type Dipendenze = {
  env: (k: string) => string | undefined;
  // utente dell'app che chiama (per il collegamento del webhook dall'app: solo amministratore)
  chiamante?: (req: Request) => Promise<{ profilo: { id: string; ruolo: string; attivo: boolean } } | null>;
  admin: DB;                                   // service_role: solo tabelle del bot e profilo del proprietario
  sessione: (profiloId: string) => Promise<Sessione>;   // sessione dell'utente dell'app (letture e salvataggio)
  // toglie dallo Storage le foto di un rapportino gia' eliminato (service_role: dopo l'eliminazione le
  // policy del bucket non riconoscono piu' il rapportino)
  rimuoviFoto?: (percorsi: string[]) => Promise<void>;
  fetchImpl?: typeof fetch;
  oggi?: () => string;
  adesso?: () => number;
  log?: (o: Record<string, unknown>) => void;
};

const TG = "https://api.telegram.org";
const RIELABORA_DOPO_MS = 2 * 60 * 1000;
const TIMEOUT = { testo: 25000, audio: 40000, telegram: 15000 };
const oggiRoma = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
const AUDIO_AMMESSI = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/webm", "audio/flac", "audio/opus"];
const AIUTO = [
  "<b>Rapportini da Telegram</b>",
  "Scrivimi o mandami un vocale con il lavoro fatto, ad esempio:",
  "<i>«Oggi da Rossi in via Roma 3, sostituita la valvola della caldaia, dalle 8 alle 11 con Mario, usati 2 raccordi da 1/2»</i>",
  "",
  "Preparo una bozza e te la mostro: puoi correggerla scrivendo (es. «le ore erano dalle 9», «togli i raccordi», «il cliente è Bianchi»).",
  "Il rapportino si crea solo quando tocchi <b>Conferma</b>.",
  "Tutti i comandi sono nel pulsante <b>Menu</b> a sinistra del campo di testo.",
  "Comandi: /bozza mostra la bozza, /annulla la cancella. Le bozze non confermate scadono dopo " + SCADENZA_BOZZA_ORE + " ore.",
  "/interventi elenca gli interventi programmati da compilare: scegline uno e il rapportino sarà collegato a quell'intervento. Un lavoro nuovo scritto o detto a voce diventa un rapportino <b>fuori programma</b> (non un imprevisto).",
  "/rapportini elenca gli ultimi rapportini (anche <i>/rapportini oggi</i>, <i>ieri</i>, <i>settimana</i>, <i>mese</i> o il nome di un cliente); da lì puoi eliminarne uno, con conferma.",
].join("\n");

// Secret del webhook: TELEGRAM_WEBHOOK_SECRET se impostato, altrimenti ricavato dal token del bot
// (HMAC-SHA256): nessuno deve crearlo o copiarlo a mano, e cambia se cambia il token.
export async function segretoWebhook(token: string, impostato: string): Promise<string> {
  if (impostato) return impostato;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("rapportino-telegram-webhook")));
  return [...firma].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const json = (o: unknown, stato = 200) => new Response(JSON.stringify(o), { status: stato, headers: { "Content-Type": "application/json", ...CORS_APP } });
const CORS_APP = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

// Collegamento dall'app (Altro -> Bot Telegram), solo amministratore con sessione valida:
//   "stato"   -> bot configurato? webhook collegato? ultimo errore di Telegram (senza dati sensibili)
//   "collega" -> setWebhook con l'indirizzo di questa funzione e il secret, un aggiornamento alla volta
async function gestioneApp(req: Request, d: Dipendenze): Promise<Response> {
  const c = d.chiamante ? await d.chiamante(req).catch(() => null) : null;
  if (!c || !c.profilo.attivo || c.profilo.ruolo !== "admin") return json({ errore: "Solo l'amministratore può configurare il bot." }, 403);
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* corpo vuoto */ }
  const token = String(d.env("TELEGRAM_BOT_TOKEN") || "").trim();
  const utente = String(d.env("TELEGRAM_UTENTE_ID") || "").trim();
  const profilo = String(d.env("TELEGRAM_PROFILO") || "").trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
  const mancano = [!token && "TELEGRAM_BOT_TOKEN", !/^\d+$/.test(utente) && "TELEGRAM_UTENTE_ID", !profilo && "TELEGRAM_PROFILO",
    !String(d.env("GROQ_API_KEY") || "").trim() && "GROQ_API_KEY"].filter(Boolean);
  if (!token) return json({ configurato: false, mancano });
  const f = d.fetchImpl || fetch;
  const chiama = async (metodo: string, b: Record<string, unknown> = {}) => {
    try {
      const r = await f(TG + "/bot" + token + "/" + metodo, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return await r.json() as { ok?: boolean; result?: Record<string, unknown>; description?: string };
    } catch { return { ok: false, description: "Telegram non raggiungibile" }; }
  };
  const me = await chiama("getMe");
  if (!me.ok) return json({ configurato: false, mancano, errore: "Token del bot non valido (controlla TELEGRAM_BOT_TOKEN)." });
  const indirizzo = String(d.env("SUPABASE_URL") || "").replace(/\/+$/, "") + "/functions/v1/telegram";
  if (corpo.azione === "collega") {
    if (mancano.length) return json({ configurato: false, mancano, errore: "Mancano dei secret: " + mancano.join(", ") + "." });
    const r = await chiama("setWebhook", { url: indirizzo, secret_token: await segretoWebhook(token, String(d.env("TELEGRAM_WEBHOOK_SECRET") || "").trim()),
      max_connections: 1, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    log(d, { evento: "collega_webhook", esito: r.ok ? "ok" : "errore" });
    if (!r.ok) return json({ errore: "Telegram ha rifiutato il collegamento: " + String(r.description || "errore").slice(0, 200) }, 502);
    // pulsante «Menu» con i comandi (solo chat private); un errore qui non blocca il collegamento
    const m = await chiama("setMyCommands", { commands: COMANDI_MENU, scope: { type: "all_private_chats" }, language_code: "" });
    const b = await chiama("setChatMenuButton", { menu_button: { type: "commands" } });
    log(d, { evento: "menu_comandi", esito: m.ok && b.ok ? "ok" : "errore" });
  }
  const info = (await chiama("getWebhookInfo")).result || {};
  return json({
    configurato: !mancano.length, mancano, bot: "@" + String((me.result || {}).username || ""),
    collegato: info.url === indirizzo, inAttesa: Number(info.pending_update_count) || 0,
    ultimoErrore: info.last_error_message ? String(info.last_error_message).slice(0, 200) : "",
  });
}

// confronto a tempo costante (il secret non si indovina un carattere alla volta)
function uguali(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
const ok = () => new Response("ok", { status: 200 });

type RigaBozza = { chat_id: number; dati: Bozza; stato: string; versione: number; rapportino_id: string; scade_il: string; aggiornato_il: string };
type Contesto = {
  d: Dipendenze; cfg: ConfigAI; token: string; chat: number; profiloNome: string; adesso: number; oggi: string;
  sess: Sessione | null; tecnici: Tecnico[] | null; profiloId: string; ruolo: string;
};

// ---------------------------------------------------------------- Telegram Bot API
async function tg(x: Contesto, metodo: string, corpo: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const f = x.d.fetchImpl || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT.telegram);
  try {
    const r = await f(TG + "/bot" + x.token + "/" + metodo, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: ctl.signal });
    const j = await r.json().catch(() => null) as { ok?: boolean; result?: Record<string, unknown> } | null;
    if (!r.ok || !j || !j.ok) { log(x.d, { evento: "telegram_api", metodo, esito: "errore", stato: r.status }); return null; }
    return j.result || {};
  } catch {
    log(x.d, { evento: "telegram_api", metodo, esito: "rete" });
    return null;
  } finally { clearTimeout(t); }
}
const invia = (x: Contesto, testo: string, tastiera?: Tastiera) =>
  tg(x, "sendMessage", { chat_id: x.chat, text: testo, parse_mode: "HTML", disable_web_page_preview: true, ...(tastiera ? { reply_markup: { inline_keyboard: tastiera } } : {}) });
function log(d: Dipendenze, o: Record<string, unknown>) { (d.log || ((v) => console.log(JSON.stringify(v))))({ funzione: "telegram", ...o }); }

// ---------------------------------------------------------------- sessione e dati dell'app
async function sessione(x: Contesto): Promise<Sessione> {
  if (!x.sess) x.sess = await x.d.sessione(x.profiloId);
  return x.sess;
}
async function tecnici(x: Contesto): Promise<Tecnico[]> {
  if (x.tecnici) return x.tecnici;
  const s = await sessione(x);
  // stessi tecnici selezionabili nell'app (attivi, che lavorano sul campo): il database accetta le ore solo per loro
  const { data, error } = await s.db.rpc("operai_attivi");
  if (error) throw new Error("operai_attivi");
  x.tecnici = ((data || []) as Tecnico[]).map((t) => ({ id: t.id, nome: t.nome || t.username, username: t.username, attivo: true }));
  return x.tecnici;
}
async function clienti(x: Contesto) {
  const s = await sessione(x);
  const { data, error } = await s.db.from("clienti").select("id, nome, indirizzo, telefono, archiviato").limit(5000);
  if (error) throw new Error("clienti");
  return data || [];
}

// ---------------------------------------------------------------- bozza
async function leggiBozza(x: Contesto): Promise<{ riga: RigaBozza | null; scaduta: boolean }> {
  const { data, error } = await x.d.admin.from("telegram_bozze").select("*").eq("chat_id", x.chat).maybeSingle();
  if (error) throw new Error("bozza");
  if (!data) return { riga: null, scaduta: false };
  if (Date.parse(data.scade_il) < x.adesso && data.stato === "aperta") {
    await x.d.admin.from("telegram_bozze").delete().eq("chat_id", x.chat).eq("versione", data.versione);
    return { riga: null, scaduta: true };
  }
  return { riga: { ...data, dati: { ...bozzaVuota(), ...(data.dati || {}) } }, scaduta: false };
}
const scadenza = (x: Contesto) => new Date(x.adesso + SCADENZA_BOZZA_ORE * 3600 * 1000).toISOString();
// salva la bozza (nuova o modifica con controllo di versione). null = cambiata nel frattempo.
async function scriviBozza(x: Contesto, riga: RigaBozza | null, dati: Bozza): Promise<RigaBozza | null> {
  const ora = new Date(x.adesso).toISOString();
  if (!riga) {
    const { data, error } = await x.d.admin.from("telegram_bozze")
      .insert({ chat_id: x.chat, dati, stato: "aperta", versione: 1, scade_il: scadenza(x), aggiornato_il: ora }).select().maybeSingle();
    if (error) { if (/23505|duplicate/i.test(String(error.code) + error.message)) return null; throw new Error("bozza"); }
    return data;
  }
  const { data, error } = await x.d.admin.from("telegram_bozze")
    .update({ dati, versione: riga.versione + 1, scade_il: scadenza(x), aggiornato_il: ora })
    .eq("chat_id", x.chat).eq("versione", riga.versione).eq("stato", "aperta").select();
  if (error) throw new Error("bozza");
  return data && data[0] ? data[0] : null;
}
async function mostraBozza(x: Contesto, riga: RigaBozza, premessa = "") {
  const a = anteprima(riga.dati, riga.versione, await tecnici(x), x.profiloId);
  await invia(x, (premessa ? premessa + "\n\n" : "") + a.testo, a.tastiera);
}
const cambiataNelFrattempo = async (x: Contesto) => {
  const { riga } = await leggiBozza(x);
  if (riga) await mostraBozza(x, riga, "La bozza è cambiata mentre la aggiornavo: ecco quella attuale. Ripeti la modifica se serve.");
  else await invia(x, "La bozza non c'è più. Mandami di nuovo il lavoro.");
};

// ---------------------------------------------------------------- messaggio (scritto o trascritto)
async function messaggioTesto(x: Contesto, testo: string) {
  const { riga, scaduta } = await leggiBozza(x);
  const premessa = scaduta ? "La bozza precedente era scaduta ed è stata cancellata." : "";
  if (riga && riga.stato !== "aperta") { await invia(x, "Sto ancora salvando il rapportino: attendi un attimo."); return; }
  // scelta del cliente con il numero
  if (riga && riga.dati.cliente_stato === "da_scegliere" && /^\s*\d{1,2}\s*$/.test(testo)) {
    const c = riga.dati.candidati[+testo.trim() - 1];
    if (!c) { await invia(x, "Numero non valido: scegli tra 1 e " + riga.dati.candidati.length + "."); return; }
    const nuova = await scriviBozza(x, riga, scegliCandidato(riga.dati, c));
    return nuova ? mostraBozza(x, nuova) : cambiataNelFrattempo(x);
  }
  const nomi = (await tecnici(x)).filter((t) => t.attivo !== false).map((t) => t.nome);
  const r = await chiediJson(x.cfg, {
    tipo: "testo", messaggi: promptBozza(riga ? riga.dati : null, testo.slice(0, MAX_TESTO_MESSAGGIO), x.oggi, nomi),
    maxToken: 1500, timeoutMs: TIMEOUT.testo, fetchImpl: x.d.fetchImpl, valida: (o) => validaRispostaAI(o, x.oggi),
  });
  log(x.d, { evento: "ai", esito: "ok", modello: r.modello, token: r.token });
  const ai = r.dati;
  if (ai.annulla) {
    if (riga) await x.d.admin.from("telegram_bozze").delete().eq("chat_id", x.chat).eq("versione", riga.versione);
    await invia(x, riga ? "Bozza annullata. Nessun rapportino creato." : "Non c'era nessuna bozza da annullare.");
    return;
  }
  const vuote = !Object.keys(ai.modifiche).length;
  if (vuote && ai.aiuto) { await invia(x, AIUTO); return; }
  // domanda sui dati: risponde l'assistente dell'app (dati letti con la sessione dell'utente); la bozza non cambia
  if (vuote && ai.domanda) {
    const d = ai.domanda;
    const ris = await rispondiDomanda(x.cfg, (await sessione(x)).db, d.testo, d.dal, d.al, x.oggi, x.d.fetchImpl);
    log(x.d, { evento: "domanda", esito: "ok", modello: ris.modello || "nessuno", token: ris.token });
    const periodo = d.dal.split("-").reverse().join("/") + " – " + d.al.split("-").reverse().join("/");
    await invia(x, "💬 " + html(ris.risposta) + (ris.limiti ? "\n\n<i>" + html(ris.limiti) + "</i>" : "") +
      "\n\n<i>Dati dal " + periodo + ". Puoi indicare un altro periodo nella domanda.</i>" + (riga ? "\n\nLa bozza in corso è ancora aperta: /bozza per vederla." : ""));
    return;
  }
  if (vuote && !riga) {
    await invia(x, (premessa ? premessa + "\n\n" : "") + (ai.problemi.length ? html(ai.problemi.join(" ")) + "\n\n" : "") + (ai.fuoriTema ? "" : "Non ho trovato dati di un lavoro nel messaggio.\n\n") + AIUTO);
    return;
  }
  if (vuote) {
    await mostraBozza(x, riga!, (ai.problemi.length ? html(ai.problemi.join(" ")) : "Non ho trovato modifiche nel messaggio.") + " Ecco la bozza attuale.");
    return;
  }
  let { bozza, clienteCambiato } = applicaModifiche(riga ? riga.dati : bozzaVuota(), ai.modifiche);
  if (clienteCambiato) bozza = collegaCliente(bozza, cercaCliente(bozza.cliente, await clienti(x)));
  const nuova = await scriviBozza(x, riga, bozza);
  if (!nuova) return cambiataNelFrattempo(x);
  const avvisi = [premessa, ai.problemi.length ? "⚠️ " + html(ai.problemi.join(" ")) : ""].filter(Boolean).join("\n");
  await mostraBozza(x, nuova, avvisi);
}

// ---------------------------------------------------------------- vocale
async function messaggioVocale(x: Contesto, v: Record<string, unknown>): Promise<string | null> {
  const durata = Number(v.duration) || 0, dim = Number(v.file_size) || 0;
  const mime = String(v.mime_type || "audio/ogg").toLowerCase();
  if (durata > MAX_DURATA_VOCALE_S) { await invia(x, "Vocale troppo lungo: massimo " + MAX_DURATA_VOCALE_S / 60 + " minuti. Dividilo in più messaggi."); return null; }
  if (dim > MAX_AUDIO_BYTE) { await invia(x, "File audio troppo grande (massimo 20 MB)."); return null; }
  if (!AUDIO_AMMESSI.includes(mime.split(";")[0])) { await invia(x, "Formato audio non supportato. Manda un messaggio vocale di Telegram."); return null; }
  const file = await tg(x, "getFile", { file_id: v.file_id });
  const percorso = file && String(file.file_path || "");
  if (!percorso || !/^[\w./-]+$/.test(percorso)) { await invia(x, "Non riesco a scaricare il vocale da Telegram. Riprova."); return null; }
  const f = x.d.fetchImpl || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT.telegram);
  let audio: Uint8Array;
  try {
    const r = await f(TG + "/file/bot" + x.token + "/" + percorso, { signal: ctl.signal });
    if (!r.ok) throw new Error("download");
    audio = new Uint8Array(await r.arrayBuffer());
  } catch {
    await invia(x, "Non riesco a scaricare il vocale da Telegram. Riprova."); return null;
  } finally { clearTimeout(t); }
  if (audio.length > MAX_AUDIO_BYTE) { await invia(x, "File audio troppo grande (massimo 20 MB)."); return null; }
  // Telegram salva i vocali come ".oga" (OGG/Opus): Groq riconosce il formato dall'estensione e accetta
  // flac mp3 mp4 mpeg mpga m4a ogg wav webm, quindi .oga/.opus si inviano come .ogg (stesso contenuto)
  const est = (percorso.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const ESTENSIONI: Record<string, string> = { oga: "ogg", opus: "ogg", ogg: "ogg", mp3: "mp3", mpga: "mpga", mpeg: "mpeg", m4a: "m4a", mp4: "mp4", wav: "wav", webm: "webm", flac: "flac" };
  const nome = "vocale." + (ESTENSIONI[est] || "ogg");
  const tipo = ({ ogg: "audio/ogg", mp3: "audio/mpeg", mpga: "audio/mpeg", mpeg: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", webm: "audio/webm", flac: "audio/flac" } as Record<string, string>)[ESTENSIONI[est] || "ogg"];
  const r = await trascriviAudio(x.cfg, { audio, nomeFile: nome, mime: tipo, lingua: "it", timeoutMs: TIMEOUT.audio, fetchImpl: x.d.fetchImpl });
  log(x.d, { evento: "trascrizione", esito: r.testo ? "ok" : "vuota", modello: r.modello, secondi: durata });
  if (!r.testo) { await invia(x, "Non ho capito il vocale (nessuna parola riconosciuta). Riprova o scrivimi."); return null; }
  await invia(x, "🎙️ Ho capito: «" + html(r.testo.slice(0, 1500)) + (r.testo.length > 1500 ? "…" : "") + "»");
  return r.testo;
}

// ---------------------------------------------------------------- elenco ed eliminazione
// Letture ed eliminazione con la sessione dell'utente collegato: vede ed elimina solo cio' che RLS gli
// consente nell'app (l'amministratore tutti i rapportini, l'operaio solo le proprie bozze).
const CAMPI_ELENCO = "id, data, cliente, stato, esito, attivita, autore_id, completato_il, rapportino_operai(dalle, alle)";
async function elencaRapportini(x: Contesto, filtro: string) {
  const f = filtroElenco(filtro, x.oggi);
  const s = await sessione(x);
  let q = s.db.from("rapportini").select(CAMPI_ELENCO);
  if (f.dal) q = q.gte("data", f.dal);
  if (f.al) q = q.lte("data", f.al);
  if (f.cliente) q = q.ilike("cliente", "%" + f.cliente.replace(/[\\%_]/g, "\\$&") + "%");
  const { data, error } = await q.order("data", { ascending: false }).order("aggiornato_il", { ascending: false }).limit(ELENCO_MAX);
  if (error) throw new Error("elenco");
  const e = elencoTesto((data || []) as RigaElenco[], f.titolo);
  await invia(x, e.testo, e.tastiera.length ? e.tastiera : undefined);
  log(x.d, { evento: "elenco", esito: "ok", righe: (data || []).length });
}
async function leggiRapportino(x: Contesto, id: string): Promise<RigaElenco & { autore_id?: string } | null> {
  const s = await sessione(x);
  const { data, error } = await s.db.from("rapportini").select(CAMPI_ELENCO).eq("id", id).maybeSingle();
  if (error) throw new Error("rapportino");
  return data;
}
async function pulsanteElenco(x: Contesto, p: { azione: "del" | "dok" | "dno"; id: string }, togliPulsanti: () => unknown) {
  if (p.azione === "dno") { await togliPulsanti(); await invia(x, "Va bene, non ho eliminato nulla."); return; }
  const r = await leggiRapportino(x, p.id);
  if (!r) { await togliPulsanti(); await invia(x, "Rapportino non trovato: forse è già stato eliminato."); return; }
  if (p.azione === "del") { const c = confermaEliminazioneTesto(r); await invia(x, c.testo, c.tastiera); return; }
  // eliminazione confermata: prima i percorsi delle foto (i metadati spariscono con il rapportino)
  await togliPulsanti();
  const s = await sessione(x);
  const { data: foto } = await s.db.from("allegati").select("percorso").eq("rapportino_id", p.id).not("percorso", "is", null);
  const { data: tolti, error } = await s.db.from("rapportini").delete().eq("id", p.id).select("id");
  if (error || !tolti || !tolti.length) {
    log(x.d, { evento: "eliminazione", esito: error ? "errore" : "non_consentita" });
    await invia(x, "❌ Rapportino NON eliminato: " + (error && !/42501|permission|policy|row-level/i.test(String(error.code) + " " + (error.message || ""))
      ? "errore del database, riprova tra poco." : "il tuo utente non ha il permesso di eliminarlo (nell'app solo l'amministratore elimina i rapportini completati)."));
    return;
  }
  const percorsi = ((foto || []) as { percorso: string }[]).map((f) => f.percorso).filter(Boolean);
  if (percorsi.length && x.d.rimuoviFoto) await x.d.rimuoviFoto(percorsi).catch(() => log(x.d, { evento: "eliminazione_foto", esito: "errore" }));
  log(x.d, { evento: "eliminazione", esito: "ok", foto: percorsi.length });
  await invia(x, "🗑 Rapportino eliminato: " + html(r.cliente || "(senza cliente)") + " — " + r.data.split("-").reverse().join("/") + ".");
}

// ---------------------------------------------------------------- interventi programmati
// Letti con la sessione dell'utente collegato: l'amministratore vede tutti gli interventi, l'operaio
// quelli a cui e' assegnato (RLS, come nell'app). Solo quelli ancora da fare (pianificato / in corso).
const CAMPI_INTERVENTO = "id, data, ora, cliente, cliente_id, indirizzo, telefono, descrizione, tipologia, stato, priorita, " +
  "intervento_operai(operaio_id, rimosso_il), rapportini(id, autore_id, stato)";
async function elencaInterventi(x: Contesto, filtro: string) {
  const f = filtroInterventi(filtro, x.oggi);
  const s = await sessione(x);
  const { data, error } = await s.db.from("interventi").select(CAMPI_INTERVENTO).in("stato", ["pianificato", "in_corso"])
    .gte("data", f.dal).lte("data", f.al).order("data").order("ora", { nullsFirst: true }).limit(ELENCO_MAX);
  if (error) throw new Error("interventi");
  const e = elencoInterventiTesto((data || []) as RigaIntervento[], f.titolo, x.profiloId);
  await invia(x, e.testo, e.tastiera.length ? e.tastiera : undefined);
  log(x.d, { evento: "elenco_interventi", esito: "ok", righe: (data || []).length });
}
async function compilaIntervento(x: Contesto, id: string, togliPulsanti: () => unknown) {
  const s = await sessione(x);
  const { data: i, error } = await s.db.from("interventi").select(CAMPI_INTERVENTO).eq("id", id).maybeSingle();
  if (error) throw new Error("intervento");
  if (!i) { await invia(x, "Intervento non trovato (eliminato o non visibile al tuo utente)."); return; }
  const int = i as RigaIntervento;
  if (int.stato === "annullato" || int.stato === "completato") { await invia(x, "Questo intervento è " + (int.stato === "annullato" ? "annullato" : "già completato") + ": non c'è niente da compilare."); return; }
  const mio = (int.rapportini || []).find((r) => r.autore_id === x.profiloId);
  if (mio) {
    await invia(x, mio.stato === "completato" ? "Hai già completato il rapportino di questo intervento."
      : "Per questo intervento hai già una bozza di rapportino nell'app: completala dall'app (Giornata o Rapportini), così non ne nasce un secondo.");
    return;
  }
  const assegnato = (int.intervento_operai || []).some((o) => o.operaio_id === x.profiloId && !o.rimosso_il);
  if (!assegnato && x.ruolo !== "admin") { await invia(x, "Non sei assegnato a questo intervento: il rapportino lo compila chi è assegnato."); return; }
  const { riga } = await leggiBozza(x);
  if (riga && riga.dati.intervento_id === int.id) { await togliPulsanti(); await mostraBozza(x, riga, "Stai già compilando questo intervento:"); return; }
  if (riga) { await invia(x, "Hai già una bozza in corso (" + html(riga.dati.cliente || "senza cliente") + "): confermala o annullala con /annulla, poi scegli l'intervento."); return; }
  const nuova = await scriviBozza(x, null, bozzaDaIntervento(int, x.oggi));
  if (!nuova) return cambiataNelFrattempo(x);
  await togliPulsanti();
  await mostraBozza(x, nuova, "📝 Rapportino dell'intervento di <b>" + html(int.cliente) + "</b>. Ora scrivimi o dimmi a voce cosa hai fatto, le ore e i materiali.");
  log(x.d, { evento: "intervento_scelto", esito: "ok" });
}

// ---------------------------------------------------------------- pulsanti
async function pulsante(x: Contesto, cb: Record<string, unknown>) {
  await tg(x, "answerCallbackQuery", { callback_query_id: cb.id });
  const msg = cb.message as Record<string, unknown> | undefined;
  const togliPulsanti = () => msg && tg(x, "editMessageReplyMarkup", { chat_id: x.chat, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
  const pe = leggiPulsanteElenco(cb.data);
  if (pe && pe.azione === "int") return compilaIntervento(x, pe.id, togliPulsanti);
  if (pe) return pulsanteElenco(x, pe as { azione: "del" | "dok" | "dno"; id: string }, togliPulsanti);
  const p = leggiPulsante(cb.data);
  if (!p) return;
  const { riga } = await leggiBozza(x);
  if (!riga) { await togliPulsanti(); await invia(x, "Questa bozza non c'è più (confermata, annullata o scaduta). Mandami un nuovo lavoro."); return; }
  if (riga.versione !== p.versione) { await togliPulsanti(); await mostraBozza(x, riga, "Quell'anteprima non è più attuale: ecco la bozza aggiornata."); return; }
  if (p.azione === "mod") { await invia(x, "Scrivimi o dimmi a voce cosa cambiare, ad esempio:\n<i>«dalle 9 alle 12»</i>, <i>«togli i raccordi»</i>, <i>«aggiungi 3 m di tubo»</i>, <i>«il cliente è Bianchi»</i>, <i>«lavoro da ultimare»</i>."); return; }
  if (p.azione === "no") {
    await x.d.admin.from("telegram_bozze").delete().eq("chat_id", x.chat).eq("versione", riga.versione);
    await togliPulsanti();
    await invia(x, "Bozza annullata. Nessun rapportino creato.");
    return;
  }
  if (p.azione === "cli" || p.azione === "lib") {
    if (riga.dati.cliente_stato !== "da_scegliere") return mostraBozza(x, riga);
    const c = riga.dati.candidati[p.indice];
    if (p.azione === "cli" && !c) return;
    const nuova = await scriviBozza(x, riga, p.azione === "cli" ? scegliCandidato(riga.dati, c) : clienteLibero(riga.dati));
    await togliPulsanti();
    return nuova ? mostraBozza(x, nuova) : cambiataNelFrattempo(x);
  }
  if (p.azione === "ok") return conferma(x, riga, togliPulsanti);
}

async function conferma(x: Contesto, riga: RigaBozza, togliPulsanti: () => unknown) {
  const c = controlla(riga.dati, await tecnici(x), x.profiloId);
  if (!c.pronto) { await mostraBozza(x, riga, "Non posso ancora creare il rapportino:"); return; }
  // prenotazione: una sola conferma alla volta (anche con tocchi ripetuti o richieste concorrenti).
  // Un salvataggio interrotto da piu' di 2 minuti si puo' ripetere: stesso id, nessun doppione.
  const limite = new Date(x.adesso - RIELABORA_DOPO_MS).toISOString();
  const { data: presa, error } = await x.d.admin.from("telegram_bozze")
    .update({ stato: "salvataggio", aggiornato_il: new Date(x.adesso).toISOString() })
    .eq("chat_id", x.chat).eq("versione", riga.versione)
    .or("stato.eq.aperta,aggiornato_il.lt." + limite).select();
  if (error) throw new Error("bozza");
  if (!presa || !presa.length) { await invia(x, "Sto già salvando questo rapportino."); return; }
  await togliPulsanti();
  const s = await sessione(x);
  const corpo = datiSalvataggio(riga.dati, riga.rapportino_id, c.righe);
  const { data, error: e2 } = await s.db.rpc("salva_rapportino", corpo);
  // "conflitto" con lo stesso id = gia' salvato da una conferma precedente interrotta: va bene
  const salvato = !e2 && data && (data.esito === "ok" || (data.esito === "conflitto" && data.rapportino && data.rapportino.id === riga.rapportino_id));
  if (!salvato) {
    await x.d.admin.from("telegram_bozze").update({ stato: "aperta" }).eq("chat_id", x.chat).eq("versione", riga.versione);
    log(x.d, { evento: "salvataggio", esito: "errore", codice: e2 ? String(e2.code || "") : String(data && data.esito || "") });
    const perm = e2 && /42501|permission|policy|row-level/i.test(String(e2.code) + " " + (e2.message || ""));
    await mostraBozza(x, { ...riga }, "❌ Rapportino NON creato: " + (perm ? "l'utente collegato al bot non ha il permesso di creare rapportini." : "errore del database, riprova tra poco.") + " La bozza è conservata.");
    return;
  }
  // lavoro nuovo (senza intervento): "fuori programma", non un imprevisto. Lo segna la funzione (service_role)
  // solo su questo rapportino senza intervento; un errore non annulla il salvataggio (resta come prima).
  if (!riga.dati.intervento_id) {
    const { error: e3 } = await x.d.admin.from("rapportini").update({ fuori_programma: true }).eq("id", riga.rapportino_id).is("intervento_id", null);
    if (e3) log(x.d, { evento: "fuori_programma", esito: "errore" });
  }
  await x.d.admin.from("telegram_bozze").delete().eq("chat_id", x.chat).eq("rapportino_id", riga.rapportino_id);
  log(x.d, { evento: "salvataggio", esito: "ok", ripetuto: data.esito === "conflitto", tipo: riga.dati.intervento_id ? "intervento" : "fuori_programma" });
  const b = riga.dati;
  await invia(x, "✅ <b>Rapportino creato</b>" + (b.intervento_id ? " (intervento programmato)" : " (fuori programma)") + "\n" + html(b.cliente) + " — " + html(b.data.split("-").reverse().join("/")) +
    "\nLo trovi nell'app in Rapportini" + (b.cliente_id ? " e nella scheda del cliente" : "") + ". Firma e foto si aggiungono dall'app se servono.");
}

// ---------------------------------------------------------------- ingresso
export async function gestisci(req: Request, d: Dipendenze): Promise<Response> {
  const inizio = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_APP });
  if (req.method !== "POST") return new Response("metodo non ammesso", { status: 405 });
  // dall'app (sessione dell'amministratore), non da Telegram: stato e collegamento del webhook
  if (!req.headers.has("x-telegram-bot-api-secret-token") && /^Bearer\s+\S+/i.test(req.headers.get("Authorization") || "")) return gestioneApp(req, d);
  const token = String(d.env("TELEGRAM_BOT_TOKEN") || "").trim();
  const segreto = token ? await segretoWebhook(token, String(d.env("TELEGRAM_WEBHOOK_SECRET") || "").trim()) : "";
  const utente = String(d.env("TELEGRAM_UTENTE_ID") || "").trim();
  const profilo = String(d.env("TELEGRAM_PROFILO") || "").trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
  if (!token || segreto.length < 16 || !/^\d+$/.test(utente) || !profilo) {
    log(d, { evento: "configurazione", esito: "incompleta" });
    return new Response("non configurato", { status: 503 });
  }
  if (!uguali(req.headers.get("x-telegram-bot-api-secret-token") || "", segreto)) {
    log(d, { evento: "richiesta", esito: "secret_non_valido" });
    return new Response("non autorizzato", { status: 401 });
  }
  let u: Record<string, unknown>;
  try { u = await req.json(); } catch { return new Response("richiesta non valida", { status: 400 }); }
  const updateId = Number(u && u.update_id);
  if (!Number.isSafeInteger(updateId)) return new Response("richiesta non valida", { status: 400 });

  const msg = (u.message || null) as Record<string, unknown> | null;
  const cb = (u.callback_query || null) as Record<string, unknown> | null;
  const da = ((msg && msg.from) || (cb && cb.from)) as Record<string, unknown> | undefined;
  const chat = ((msg && msg.chat) || (cb && cb.message && (cb.message as Record<string, unknown>).chat)) as Record<string, unknown> | undefined;
  if (!da || !chat) return ok();                                 // altri tipi di aggiornamento: ignorati
  if (String(da.id) !== utente || chat.type !== "private" || String(chat.id) !== utente) {
    log(d, { evento: "richiesta", esito: "mittente_non_autorizzato" });
    return ok();
  }

  // aggiornamenti ripetuti: una sola elaborazione (rielaborato solo se quella prima si e' interrotta)
  const adesso = d.adesso ? d.adesso() : Date.now();
  const { error: eIns } = await d.admin.from("telegram_aggiornamenti").insert({ update_id: updateId });
  if (eIns) {
    if (!/23505|duplicate/i.test(String(eIns.code) + " " + eIns.message)) { log(d, { evento: "duplicati", esito: "errore" }); return new Response("errore", { status: 500 }); }
    const { data: prima } = await d.admin.from("telegram_aggiornamenti").select("stato, aggiornato_il").eq("update_id", updateId).maybeSingle();
    if (!prima || prima.stato === "fatto" || Date.parse(prima.aggiornato_il) > adesso - RIELABORA_DOPO_MS) {
      log(d, { evento: "richiesta", esito: "duplicato" });
      return ok();
    }
    await d.admin.from("telegram_aggiornamenti").update({ aggiornato_il: new Date(adesso).toISOString() }).eq("update_id", updateId);
  }

  const x: Contesto = { d, cfg: configurazione(d.env), token, chat: Number(chat.id), profiloNome: profilo, adesso, oggi: d.oggi ? d.oggi() : oggiRoma(), sess: null, tecnici: null, profiloId: "", ruolo: "" };
  let esito = "ok";
  try {
    // utente dell'app a cui appartengono i rapportini creati dal bot
    // stessa ricerca del login: maiuscole e minuscole indifferenti ("luca" = "Luca")
    const { data: p } = await d.admin.from("profili").select("id, attivo, ruolo").ilike("username", profilo.replace(/[\\%_]/g, "\\$&")).maybeSingle();
    if (!p || !p.attivo) { esito = "profilo"; await invia(x, "Il bot non è collegato a un utente attivo dell'app (controlla il secret TELEGRAM_PROFILO)."); }
    else {
      x.profiloId = p.id; x.ruolo = String(p.ruolo || "");
      if (cb) await pulsante(x, cb);
      else if (msg) {
        const t = typeof msg.text === "string" ? msg.text.trim() : "";
        const vocale = (msg.voice || msg.audio) as Record<string, unknown> | undefined;
        if (/^\/start\b/i.test(t)) {
          // registra il pulsante «Menu» con i comandi (anche senza passare dall'app)
          await tg(x, "setMyCommands", { commands: COMANDI_MENU, scope: { type: "chat", chat_id: x.chat } });
          await tg(x, "setChatMenuButton", { chat_id: x.chat, menu_button: { type: "commands" } });
          await invia(x, AIUTO);
        } else if (/^\/(aiuto|help)\b/i.test(t)) await invia(x, AIUTO);
        else if (/^\/annulla\b/i.test(t)) {
          const { riga } = await leggiBozza(x);
          if (riga) await d.admin.from("telegram_bozze").delete().eq("chat_id", x.chat).eq("versione", riga.versione);
          await invia(x, riga ? "Bozza annullata. Nessun rapportino creato." : "Non c'è nessuna bozza da annullare.");
        } else if (/^\/bozza\b/i.test(t)) {
          const { riga } = await leggiBozza(x);
          if (riga) await mostraBozza(x, riga); else await invia(x, "Nessuna bozza in corso. Mandami il lavoro da registrare.");
        } else if (richiestaElenco(t)) await elencaRapportini(x, richiestaElenco(t)!.filtro);
        else if (richiestaInterventi(t)) await elencaInterventi(x, richiestaInterventi(t)!.filtro);
        else if (t.startsWith("/")) await invia(x, AIUTO);
        else if (t) await messaggioTesto(x, t);
        else if (vocale) { const testo = await messaggioVocale(x, vocale); if (testo) await messaggioTesto(x, testo); }
        else await invia(x, "Mandami un messaggio scritto o un vocale con il lavoro fatto.");
      }
    }
  } catch (e) {
    esito = e instanceof ErroreAI ? "ai_" + e.codice : "errore";
    log(d, { evento: "elaborazione", esito });
    const testo = e instanceof ErroreAI
      ? "⚠️ " + html(e.message) + " La bozza non è cambiata: riprova tra poco."
      : "⚠️ Si è verificato un errore. La bozza non è cambiata: riprova tra poco.";
    await invia(x, testo).catch(() => {});
  } finally {
    if (x.sess) await x.sess.chiudi().catch(() => {});
    await d.admin.from("telegram_aggiornamenti").update({ stato: "fatto", aggiornato_il: new Date().toISOString() }).eq("update_id", updateId);
    // pulizia: aggiornamenti vecchi e bozze scadute da piu' di un giorno
    await d.admin.from("telegram_aggiornamenti").delete().lt("ricevuto_il", new Date(adesso - 7 * 86400000).toISOString());
    await d.admin.from("telegram_bozze").delete().lt("scade_il", new Date(adesso - 86400000).toISOString());
  }
  log(d, { evento: "richiesta", esito, durata_ms: Date.now() - inizio, tipo: cb ? "pulsante" : msg && (msg.voice || msg.audio) ? "vocale" : "testo" });
  return ok();
}
