// Login con username e password.
// Il browser non conosce l'email interna: qui si risale all'account dallo username e la
// password la verifica Supabase Auth (signInWithPassword). Si restituisce la sessione standard.
// Dopo 5 tentativi sbagliati lo username resta bloccato per 15 minuti.
import { CORS, clientAdmin, clientAnonimo, corpoJson, errore, risposta, USERNAME_VALIDO } from "../_shared/comune.ts";

const MAX_TENTATIVI = 5;
const BLOCCO_MINUTI = 15;
const CREDENZIALI_ERRATE = "Username o password non corretti.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errore("Metodo non consentito", 405);
  const { username, password } = await corpoJson(req);
  if (typeof username !== "string" || typeof password !== "string" || !password || !USERNAME_VALIDO.test(username.trim())) {
    return errore(CREDENZIALI_ERRATE, 401);
  }
  const admin = clientAdmin();
  const { data: p } = await admin.from("profili")
    .select("id, username, nome, ruolo, attivo, deve_cambiare_password, tentativi_falliti, bloccato_fino")
    .ilike("username", username.trim().replace(/[\\%_]/g, "\\$&")).maybeSingle();

  // username inesistente: stessa risposta (e tempi simili) di una password sbagliata
  if (!p) {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
    return errore(CREDENZIALI_ERRATE, 401);
  }
  if (p.bloccato_fino && new Date(p.bloccato_fino) > new Date()) {
    const minuti = Math.ceil((new Date(p.bloccato_fino).getTime() - Date.now()) / 60000);
    return errore(`Troppi tentativi. Riprova tra ${minuti} minut${minuti === 1 ? "o" : "i"}.`, 429);
  }

  if (!p.attivo) return errore("Account disattivato. Contatta l'amministratore.", 403);

  const { data: u } = await admin.auth.admin.getUserById(p.id);
  if (!u?.user?.email) return errore(CREDENZIALI_ERRATE, 401);
  const { data: s, error } = await clientAnonimo().auth.signInWithPassword({ email: u.user.email, password });

  if (error || !s.session) {
    const tentativi = (p.tentativi_falliti || 0) + 1;
    await admin.from("profili").update(tentativi >= MAX_TENTATIVI
      ? { tentativi_falliti: 0, bloccato_fino: new Date(Date.now() + BLOCCO_MINUTI * 60000).toISOString() }
      : { tentativi_falliti: tentativi }).eq("id", p.id);
    return errore(CREDENZIALI_ERRATE, 401);
  }
  if (p.tentativi_falliti || p.bloccato_fino) {
    await admin.from("profili").update({ tentativi_falliti: 0, bloccato_fino: null }).eq("id", p.id);
  }
  return risposta({
    sessione: {
      access_token: s.session.access_token,
      refresh_token: s.session.refresh_token,
    },
    profilo: { username: p.username, nome: p.nome, ruolo: p.ruolo, deve_cambiare_password: p.deve_cambiare_password },
  });
});
