// Login con username e password, oppure con username e PIN di 6 cifre.
// Il browser non conosce l'email interna: qui si risale all'account dallo username.
// - Password: la verifica Supabase Auth (signInWithPassword). Dopo 5 errori lo username resta bloccato 15 minuti.
// - PIN: si confronta con l'impronta salvata (mai il PIN); i tentativi li conta il database
//   (5 tentativi, blocco di 15 minuti, PIN eliminato dopo 10 errori consecutivi) con un limite in piu'
//   per indirizzo di rete. Se il PIN e' giusto la sessione la crea Supabase Auth (link monouso
//   generato e consumato qui sul server: non arriva mai al browser e non viene inviato per email).
// In entrambi i casi si restituisce la sessione standard di Supabase.
import {
  attesaTesto, clientAdmin, clientAnonimo, controllaPin, corpoJson, CORS, entroLimite, errore,
  risposta, USERNAME_VALIDO,
} from "../_shared/comune.ts";

const MAX_TENTATIVI = 5;
const BLOCCO_MINUTI = 15;
const CREDENZIALI_ERRATE = "Username o password non corretti.";
const PIN_NON_ATTIVO = "Accesso con PIN non attivo per questo username. Accedi con la password.";

const pausa = () => new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
const profiloPubblico = (p: Record<string, unknown>) => ({
  username: p.username, nome: p.nome, cognome: p.cognome ?? "", ruolo: p.ruolo, ruoli: p.ruoli ?? [p.ruolo],
  deve_cambiare_password: p.deve_cambiare_password,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errore("Metodo non consentito", 405);
  const { username, password, pin } = await corpoJson(req);
  const admin = clientAdmin();
  const cerca = (u: string) => admin.from("profili")
    .select("id, username, nome, cognome, ruolo, ruoli, attivo, deve_cambiare_password, tentativi_falliti, bloccato_fino")
    .ilike("username", u.trim().replace(/[\\%_]/g, "\\$&")).maybeSingle();

  // ---------------------------------------------------------------- PIN
  if (pin !== undefined) {
    if (typeof username !== "string" || !USERNAME_VALIDO.test(username.trim()) || typeof pin !== "string" || !/^[0-9]{6}$/.test(pin)) {
      return errore("Inserisci username e PIN di 6 cifre.", 401);
    }
    if (!(await entroLimite(admin, req, "pin", 30, 15 * 60))) return errore(attesaTesto(15 * 60), 429);
    const { data: p } = await cerca(username);
    // username inesistente: stessa risposta di un account senza PIN
    if (!p) { await pausa(); return errore(PIN_NON_ATTIVO, 401); }
    if (!p.attivo) return errore("Account disattivato. Contatta l'amministratore.", 403);
    if (p.deve_cambiare_password) return errore(PIN_NON_ATTIVO, 401);
    let r;
    try { r = await controllaPin(admin, p.id, pin); } catch { return errore("Errore del server. Riprova.", 500); }
    if (r.esito === "nessuno") { await pausa(); return errore(PIN_NON_ATTIVO, 401); }
    if (r.esito === "attesa" || r.esito === "bloccato") return errore(attesaTesto(r.attesa || 900), 429);
    if (r.esito === "eliminato") return errore("Troppi PIN sbagliati: il PIN è stato disattivato. Accedi con la password.", 401);
    if (r.esito !== "ok") return errore("PIN non corretto.", 401);

    const { data: u } = await admin.auth.admin.getUserById(p.id);
    if (!u?.user?.email) return errore("Errore del server. Riprova.", 500);
    const { data: link, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    const tokenHash = link?.properties?.hashed_token;
    if (e1 || !tokenHash) return errore("Errore del server. Riprova.", 500);
    const { data: s, error: e2 } = await clientAnonimo().auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (e2 || !s.session) return errore("Errore del server. Riprova.", 500);
    return risposta({
      sessione: { access_token: s.session.access_token, refresh_token: s.session.refresh_token },
      profilo: profiloPubblico(p),
    });
  }

  // ---------------------------------------------------------------- password
  if (typeof username !== "string" || typeof password !== "string" || !password || !USERNAME_VALIDO.test(username.trim())) {
    return errore(CREDENZIALI_ERRATE, 401);
  }
  const { data: p } = await cerca(username);

  // username inesistente: stessa risposta (e tempi simili) di una password sbagliata
  if (!p) {
    await pausa();
    return errore(CREDENZIALI_ERRATE, 401);
  }
  if (p.bloccato_fino && new Date(p.bloccato_fino) > new Date()) {
    return errore(attesaTesto((new Date(p.bloccato_fino).getTime() - Date.now()) / 1000), 429);
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
    profilo: profiloPubblico(p),
  });
});
