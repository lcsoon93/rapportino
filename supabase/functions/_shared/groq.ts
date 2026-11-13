// Client minimo per Groq (API compatibile OpenAI), usato SOLO dalle Edge Functions.
// La chiave GROQ_API_KEY esiste solo nei secret di Supabase: non arriva mai al browser.
// Nessuna dipendenza esterna: fetch + AbortController. Nessun contenuto (testi, foto) finisce nei log.

export const GROQ_URL = "https://api.groq.com/openai/v1";

// Modelli predefiniti (verificati sulla documentazione Groq, novembre 2026; sovrascrivibili con i secret):
// - testo:   openai/gpt-oss-120b      (produzione, JSON mode, 131k token di contesto)
// - riserva: llama-3.3-70b-versatile  (produzione, usato se il modello testo non e' disponibile)
// - visione: qwen/qwen3.8-27b         (immagini: max 3 per richiesta, JSON mode)
export const MODELLI_PREDEFINITI = {
  testo: "openai/gpt-oss-120b",
  riserva: "llama-3.3-70b-versatile",
  visione: "qwen/qwen3.8-27b",
};

export type ConfigAI = { chiave: string; testo: string; riserva: string; visione: string };
export function configurazione(env: (k: string) => string | undefined): ConfigAI {
  const pulito = (v: string | undefined) => String(v || "").trim();
  return {
    chiave: pulito(env("GROQ_API_KEY")),
    testo: pulito(env("GROQ_MODELLO_TESTO")) || MODELLI_PREDEFINITI.testo,
    riserva: pulito(env("GROQ_MODELLO_RISERVA")) || MODELLI_PREDEFINITI.riserva,
    visione: pulito(env("GROQ_MODELLO_VISIONE")) || MODELLI_PREDEFINITI.visione,
  };
}

// errore con messaggio per l'utente (italiano), stato HTTP da restituire all'app e codice tecnico
export class ErroreAI extends Error {
  stato: number; codice: string; riprovaTra?: number;
  constructor(messaggio: string, stato: number, codice: string, riprovaTra?: number) {
    super(messaggio); this.stato = stato; this.codice = codice; this.riprovaTra = riprovaTra;
  }
}

export type Messaggio = { role: "system" | "user" | "assistant"; content: unknown };
export type EsitoGroq = { testo: string; modello: string; token: number };

// parametri di ragionamento per famiglia di modello (il ragionamento non deve finire nel testo)
function parametriModello(modello: string): Record<string, unknown> {
  if (modello.startsWith("openai/gpt-oss")) return { include_reasoning: false, reasoning_effort: "low" };
  if (modello.startsWith("qwen/")) return { reasoning_format: "hidden" };
  return {};
}

// traduce la risposta d'errore di Groq in un ErroreAI
export function erroreDaRisposta(stato: number, corpo: string, riprova: string | null): ErroreAI {
  let codice = "";
  try { const j = JSON.parse(corpo); codice = String((j.error && (j.error.code || j.error.type)) || ""); } catch { /* corpo non JSON */ }
  if (stato === 401 || stato === 403) return new ErroreAI("Assistente AI non configurato correttamente sul server.", 503, "chiave");
  if (stato === 404 || /model_not_found|model_decommissioned/.test(codice)) return new ErroreAI("Modello AI non disponibile.", 503, "modello");
  if (stato === 413 || /context_length|too_large/.test(codice)) return new ErroreAI("Testo o immagini troppo grandi per l'assistente AI.", 413, "troppo_grande");
  if (stato === 429) {
    const s = Math.min(3600, Math.max(1, Math.ceil(Number(riprova) || 30)));
    return new ErroreAI("Troppe richieste al servizio AI: riprova tra poco.", 429, "limite_groq", s);
  }
  if (stato === 400 && /json_validate_failed/.test(codice)) return new ErroreAI("Risposta dell'assistente AI non valida.", 502, "risposta_non_valida");
  if (stato === 400) return new ErroreAI("Richiesta non accettata dal servizio AI.", 400, "richiesta");
  return new ErroreAI("Servizio AI momentaneamente non disponibile.", 503, "non_disponibile");
}

// una chiamata chat/completions. timeoutMs: tempo massimo, poi errore 504.
export async function chiamaGroq(opz: {
  chiave: string; modello: string; messaggi: Messaggio[]; maxToken: number; timeoutMs: number;
  json?: boolean; temperatura?: number; fetchImpl?: typeof fetch;
}): Promise<EsitoGroq> {
  const f = opz.fetchImpl || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opz.timeoutMs);
  const corpo: Record<string, unknown> = {
    model: opz.modello,
    messages: opz.messaggi,
    temperature: opz.temperatura ?? 0.2,
    max_completion_tokens: opz.maxToken,
    ...parametriModello(opz.modello),
  };
  if (opz.json) corpo.response_format = { type: "json_object" };
  let r: Response;
  try {
    r = await f(GROQ_URL + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + opz.chiave, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    if ((e as Error).name === "AbortError") throw new ErroreAI("L'assistente AI non ha risposto in tempo. Riprova.", 504, "timeout");
    throw new ErroreAI("Servizio AI non raggiungibile.", 502, "rete");
  }
  let testo = "";
  try { testo = await r.text(); } catch { /* corpo illeggibile */ } finally { clearTimeout(t); }
  if (!r.ok) throw erroreDaRisposta(r.status, testo, r.headers.get("retry-after"));
  let j: { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; usage?: { total_tokens?: number }; model?: string };
  try { j = JSON.parse(testo); } catch { throw new ErroreAI("Risposta dell'assistente AI non valida.", 502, "risposta_non_valida"); }
  const scelta = j.choices && j.choices[0];
  const contenuto = scelta && scelta.message && scelta.message.content;
  if (typeof contenuto !== "string" || !contenuto.trim()) {
    throw new ErroreAI("Risposta dell'assistente AI vuota o non valida.", 502, "risposta_non_valida");
  }
  return { testo: contenuto, modello: String(j.model || opz.modello), token: Number(j.usage && j.usage.total_tokens) || 0 };
}

// estrae l'oggetto JSON dal testo del modello (tollera ```json, <think> e testo attorno)
export function estraiJson(testo: string): Record<string, unknown> {
  let s = String(testo || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new ErroreAI("Risposta dell'assistente AI non valida.", 502, "risposta_non_valida");
  try {
    const o = JSON.parse(s.slice(a, b + 1));
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("non oggetto");
    return o as Record<string, unknown>;
  } catch {
    throw new ErroreAI("Risposta dell'assistente AI non valida.", 502, "risposta_non_valida");
  }
}

// Chiamata con risposta JSON validata:
// - risposta non valida: un secondo tentativo a temperatura 0;
// - modello testo non disponibile: il modello di riserva.
export async function chiediJson<T>(cfg: ConfigAI, opz: {
  tipo: "testo" | "visione"; messaggi: Messaggio[]; maxToken: number; timeoutMs: number;
  valida: (o: Record<string, unknown>) => T; fetchImpl?: typeof fetch;
}): Promise<{ dati: T; modello: string; token: number }> {
  const modelli = opz.tipo === "visione" ? [cfg.visione] : [cfg.testo, cfg.riserva].filter((m, i, a) => m && a.indexOf(m) === i);
  let ultimo: unknown = null;
  for (const modello of modelli) {
    let token = 0;
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      try {
        const r = await chiamaGroq({
          chiave: cfg.chiave, modello, messaggi: opz.messaggi, maxToken: opz.maxToken, timeoutMs: opz.timeoutMs,
          json: true, temperatura: tentativo ? 0 : 0.2, fetchImpl: opz.fetchImpl,
        });
        token += r.token;
        let dati: T;
        try { dati = opz.valida(estraiJson(r.testo)); } catch (e) {
          if (e instanceof ErroreAI) throw e;
          // JSON valido ma senza i campi richiesti: come una risposta non valida
          throw new ErroreAI("Risposta dell'assistente AI non valida.", 502, "risposta_non_valida");
        }
        return { dati, modello: r.modello, token };
      } catch (e) {
        ultimo = e;
        if (!(e instanceof ErroreAI)) throw e;
        if (e.codice === "risposta_non_valida" && tentativo === 0) continue;   // riprova una volta
        if (e.codice === "modello") break;                                      // passa al modello di riserva
        throw e;
      }
    }
  }
  throw ultimo instanceof ErroreAI ? ultimo : new ErroreAI("Servizio AI momentaneamente non disponibile.", 503, "non_disponibile");
}

// elenco dei modelli attivi sull'account Groq (per verificare quelli configurati)
export async function elencoModelli(chiave: string, fetchImpl?: typeof fetch): Promise<string[]> {
  const f = fetchImpl || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await f(GROQ_URL + "/models", { headers: { "Authorization": "Bearer " + chiave }, signal: ctl.signal });
    const testo = await r.text();
    if (!r.ok) throw erroreDaRisposta(r.status, testo, r.headers.get("retry-after"));
    const j = JSON.parse(testo);
    return (Array.isArray(j.data) ? j.data : []).filter((m: { active?: boolean }) => m.active !== false).map((m: { id: string }) => String(m.id)).sort();
  } catch (e) {
    if (e instanceof ErroreAI) throw e;
    if ((e as Error).name === "AbortError") throw new ErroreAI("Il servizio AI non ha risposto in tempo.", 504, "timeout");
    throw new ErroreAI("Servizio AI non raggiungibile.", 502, "rete");
  } finally { clearTimeout(t); }
}
