// Cambio della PROPRIA password (anche quello obbligatorio al primo accesso).
// Serve la password attuale; la nuova deve rispettare le regole. Nessuno cambia la password di altri da qui.
import { CORS, chiamante, clientAdmin, clientAnonimo, corpoJson, errore, problemaPassword, risposta } from "../_shared/comune.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errore("Metodo non consentito", 405);
  const admin = clientAdmin();
  const io = await chiamante(req, admin);
  if (!io) return errore("Sessione non valida. Accedi di nuovo.", 401);
  if (!io.profilo.attivo) return errore("Account disattivato.", 403);

  const { attuale, nuova } = await corpoJson(req);
  if (typeof attuale !== "string" || typeof nuova !== "string") return errore("Dati mancanti.");
  const problema = problemaPassword(nuova, io.profilo.username);
  if (problema) return errore(problema);
  if (nuova === attuale) return errore("La nuova password deve essere diversa da quella attuale.");

  const verifica = await clientAnonimo().auth.signInWithPassword({ email: io.email, password: attuale });
  if (verifica.error) return errore("La password attuale non è corretta.", 401);
  // chiude solo la sessione usata per la verifica (non quella del telefono)
  if (verifica.data.session) await admin.auth.admin.signOut(verifica.data.session.access_token, "local").catch(() => {});

  const { error } = await admin.auth.admin.updateUserById(io.profilo.id, { password: nuova });
  if (error) return errore("Non è stato possibile cambiare la password.", 500);
  await admin.from("profili").update({ deve_cambiare_password: false, password_temporanea_scade: null }).eq("id", io.profilo.id);
  // Supabase Auth chiude tutte le sessioni quando cambia la password: se ne apre una nuova per questo telefono
  const nuovaSessione = await clientAnonimo().auth.signInWithPassword({ email: io.email, password: nuova });
  return risposta({ ok: true, sessione: nuovaSessione.data.session
    ? { access_token: nuovaSessione.data.session.access_token, refresh_token: nuovaSessione.data.session.refresh_token }
    : null });
});
