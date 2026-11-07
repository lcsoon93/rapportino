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
  id: string; username: string; nome: string; ruolo: "admin" | "company" | "worker";
  attivo: boolean; deve_cambiare_password: boolean;
};

// utente che chiama la funzione (dal token della sessione) e il suo profilo
export async function chiamante(req: Request, admin: SupabaseClient): Promise<{ profilo: Profilo; email: string } | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: p } = await admin.from("profili")
    .select("id, username, nome, ruolo, attivo, deve_cambiare_password").eq("id", data.user.id).maybeSingle();
  if (!p) return null;
  return { profilo: p as Profilo, email: data.user.email || "" };
}

export async function corpoJson(req: Request): Promise<Record<string, unknown>> {
  try { const j = await req.json(); return (j && typeof j === "object") ? j : {}; } catch { return {}; }
}
