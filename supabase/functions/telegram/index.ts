// Bot Telegram privato per creare rapportini (webhook). Tutta la logica e' in _shared/telegram-gestore.ts
// (provata in tests/server/telegram.test.mts); qui solo il collegamento con Supabase.
// Secret obbligatori: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_UTENTE_ID, TELEGRAM_PROFILO, GROQ_API_KEY.
// Facoltativi: GROQ_MODELLO_TESTO, GROQ_MODELLO_RISERVA, GROQ_MODELLO_AUDIO. Istruzioni: docs/telegram.md
import { createClient } from "jsr:@supabase/supabase-js@2";
import { clientAdmin, clientAnonimo } from "../_shared/comune.ts";
import { gestisci, type Sessione } from "../_shared/telegram-gestore.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// sessione dell'utente dell'app collegato al bot (stesso meccanismo dell'accesso con PIN: link monouso
// generato dal server e verificato subito). Tutto cio' che il bot legge e salva passa da RLS come nell'app.
async function sessione(admin: ReturnType<typeof clientAdmin>, profiloId: string): Promise<Sessione> {
  const { data: u, error: e0 } = await admin.auth.admin.getUserById(profiloId);
  if (e0 || !u.user || !u.user.email) throw new Error("utente");
  const { data: link, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  const hash = link && link.properties && link.properties.hashed_token;
  if (e1 || !hash) throw new Error("link");
  const { data: s, error: e2 } = await clientAnonimo().auth.verifyOtp({ token_hash: hash, type: "magiclink" });
  if (e2 || !s.session) throw new Error("sessione");
  const accesso = s.session.access_token;
  const db = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: "Bearer " + accesso } } });
  return { db, profiloId, chiudi: async () => { await admin.auth.admin.signOut(accesso, "local").catch(() => {}); } };
}

Deno.serve((req) => {
  const admin = clientAdmin();
  return gestisci(req, { env: (k) => Deno.env.get(k), admin, sessione: (id) => sessione(admin, id) });
});
