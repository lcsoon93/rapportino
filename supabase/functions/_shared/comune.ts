// Parti comuni alle Edge Functions di Rapportino.
// La service_role key esiste SOLO qui, sul server (variabile d'ambiente fornita da Supabase).
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function risposta(corpo: unknown, stato = 200): Response {
  return new Response(JSON.stringify(corpo), { status: stato, headers: { ...CORS, "Content-Type": "application/json" } });
}
export function errore(messaggio: string, stato = 400): Response {
  return risposta({ errore: messaggio }, stato);
}

// client con privilegi amministrativi (mai inviato al browser)
export function clientAdmin(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}
// client "anonimo" usato solo per verificare una password (signInWithPassword)
export function clientAnonimo(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const USERNAME_VALIDO = /^[A-Za-z0-9._-]{3,30}$/;

// email interna, mai mostrata: Supabase Auth vuole un'email per il login con password.
// Casuale (non derivata dallo username) e su dominio riservato .invalid: non riceve posta.
export function emailInterna(): string {
  return crypto.randomUUID() + "@utenti.rapportino.invalid";
}

// regole per le password personali
export function problemaPassword(password: string, username: string): string | null {
  if (typeof password !== "string" || password.length < 10) return "La password deve avere almeno 10 caratteri.";
  if (password.length > 72) return "La password può avere al massimo 72 caratteri.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "La password deve contenere lettere e numeri.";
  if (username && password.toLowerCase().includes(username.toLowerCase())) return "La password non può contenere lo username.";
  if (/^(.)\1+$/.test(password)) return "La password è troppo semplice.";
  return null;
}

export type Profilo = {
  id: string; username: string; nome: string; cognome: string; ruolo: "admin" | "company" | "worker";
  ruoli: string[]; attivo: boolean; deve_cambiare_password: boolean;
};
export const CAMPI_PROFILO = "id, username, nome, cognome, ruolo, ruoli, attivo, deve_cambiare_password";

// ---------------------------------------------------------------- PIN di accesso (6 cifre)
// Il PIN non viene mai salvato ne' scritto nei log: nel database c'e' solo l'impronta PBKDF2-SHA256
// (sale casuale per utente). La protezione vera contro i tentativi e' nel database (pin_prenota /
// pin_esito: 5 tentativi, blocco di 15 minuti, PIN eliminato dopo 10 errori) e per indirizzo di rete.
const ITERAZIONI_PIN = 310000;
const PIN_DEBOLI = new Set(["123123", "112233", "121212", "101010", "123321", "111222", "100000", "200000", "696969", "007007"]);
export function problemaPin(pin: unknown): string | null {
  if (typeof pin !== "string" || !/^[0-9]{6}$/.test(pin)) return "Il PIN deve essere di 6 cifre.";
  if (/^(.)\1{5}$/.test(pin)) return "Il PIN è troppo semplice: non usare sei cifre uguali.";
  if ("01234567890".includes(pin) || "09876543210".includes(pin)) return "Il PIN è troppo semplice: non usare cifre in sequenza.";
  if (PIN_DEBOLI.has(pin)) return "Il PIN è troppo semplice: scegline un altro.";
  return null;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const daB64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function pbkdf2(pin: string, sale: Uint8Array, iterazioni: number): Promise<Uint8Array> {
  const chiave = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sale as BufferSource, iterations: iterazioni }, chiave, 256));
}
export async function improntaPin(pin: string): Promise<string> {
  const sale = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERAZIONI_PIN}$${b64(sale)}$${b64(await pbkdf2(pin, sale, ITERAZIONI_PIN))}`;
}
export async function verificaPin(pin: string, salvata: string): Promise<boolean> {
  const [tipo, it, sale, valore] = String(salvata || "").split("$");
  if (tipo !== "pbkdf2-sha256" || !it || !sale || !valore || typeof pin !== "string") return false;
  const atteso = daB64(valore), calcolato = await pbkdf2(pin, daB64(sale), Number(it));
  if (atteso.length !== calcolato.length) return false;
  let diff = 0;                                   // confronto a tempo costante
  for (let i = 0; i < atteso.length; i++) diff |= atteso[i] ^ calcolato[i];
  return diff === 0;
}
// impronta dell'indirizzo di rete di chi chiama (l'IP in chiaro non viene salvato)
async function chiaveRete(req: Request, uso: string): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "sconosciuto";
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rapportino|" + uso + "|" + ip)));
  return uso + ":" + b64(h);
}
// limite per indirizzo di rete: true se la richiesta e' entro il limite (e la registra)
export async function entroLimite(admin: SupabaseClient, req: Request, uso: string, massimo: number, secondi: number): Promise<boolean> {
  const { data, error } = await admin.rpc("limite_tentativi", { p_chiave: await chiaveRete(req, uso), p_massimo: massimo, p_secondi: secondi });
  if (error) return true;                         // limite non disponibile: restano i blocchi per account
  return data !== false;
}
export function attesaTesto(secondi: number): string {
  const minuti = Math.max(1, Math.ceil(secondi / 60));
  return `Troppi tentativi. Riprova tra ${minuti} minut${minuti === 1 ? "o" : "i"}.`;
}
// verifica del PIN di un utente con i contatori del database. Esiti: ok | nessuno | attesa | errato | bloccato | eliminato
export async function controllaPin(admin: SupabaseClient, utente: string, pin: string): Promise<{ esito: string; attesa?: number }> {
  const { data, error } = await admin.rpc("pin_prenota", { p_utente: utente });
  if (error) throw new Error("pin_prenota");
  const riga = Array.isArray(data) ? data[0] : data;
  if (!riga) return { esito: "nessuno" };
  if (!riga.impronta) return { esito: "attesa", attesa: riga.attesa };
  const giusto = await verificaPin(pin, riga.impronta);
  const { data: esito, error: e2 } = await admin.rpc("pin_esito", { p_utente: utente, p_corretto: giusto });
  if (e2) throw new Error("pin_esito");
  return { esito: String(esito), attesa: esito === "bloccato" ? 900 : undefined };
}

// utente che chiama la funzione (dal token della sessione) e il suo profilo
export async function chiamante(req: Request, admin: SupabaseClient): Promise<{ profilo: Profilo; email: string } | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: p } = await admin.from("profili").select(CAMPI_PROFILO).eq("id", data.user.id).maybeSingle();
  if (!p) return null;
  return { profilo: p as Profilo, email: data.user.email || "" };
}

export async function corpoJson(req: Request): Promise<Record<string, unknown>> {
  try { const j = await req.json(); return (j && typeof j === "object") ? j : {}; } catch { return {}; }
}
