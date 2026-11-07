// PIN di accesso dell'utente collegato (solo il PROPRIO: l'admin puo' solo rimuovere quello degli
// altri, dalla funzione "utenti").
// Azioni:
//   stato                      -> { attivo }
//   imposta { pin, password }  -> imposta o cambia il PIN; serve la password attuale
//   imposta { pin, pin_attuale } -> cambia il PIN conoscendo quello attuale (conta come tentativo)
//   rimuovi                    -> elimina il proprio PIN
// Nel database c'e' solo l'impronta del PIN; PIN e password non vengono mai scritti nei log.
import {
  attesaTesto, chiamante, clientAdmin, clientAnonimo, controllaPin, corpoJson, CORS, entroLimite, errore,
  improntaPin, problemaPin, risposta,
} from "../_shared/comune.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errore("Metodo non consentito", 405);
  const admin = clientAdmin();
  const io = await chiamante(req, admin);
  if (!io) return errore("Sessione non valida. Accedi di nuovo.", 401);
  if (!io.profilo.attivo) return errore("Account disattivato.", 403);
  const corpo = await corpoJson(req);
  const id = io.profilo.id;

  if (corpo.azione === "stato") {
    const { data, error } = await admin.from("pin_accesso").select("utente_id").eq("utente_id", id).maybeSingle();
    if (error) return errore("Accesso con PIN non disponibile sul server.", 500);
    return risposta({ attivo: !!data });
  }

  if (corpo.azione === "rimuovi") {
    const { error } = await admin.from("pin_accesso").delete().eq("utente_id", id);
    if (error) return errore("Operazione non riuscita.", 500);
    return risposta({ ok: true });
  }

  if (corpo.azione === "imposta") {
    if (io.profilo.deve_cambiare_password) return errore("Cambia prima la tua password.", 403);
    const problema = problemaPin(corpo.pin);
    if (problema) return errore(problema);
    if (!(await entroLimite(admin, req, "pin-imposta", 20, 15 * 60))) return errore(attesaTesto(15 * 60), 429);

    if (typeof corpo.password === "string" && corpo.password) {
      const verifica = await clientAnonimo().auth.signInWithPassword({ email: io.email, password: corpo.password });
      if (verifica.error) return errore("La password attuale non è corretta.", 401);
      // chiude solo la sessione usata per la verifica (non quella del telefono)
      if (verifica.data.session) await admin.auth.admin.signOut(verifica.data.session.access_token, "local").catch(() => {});
    } else if (typeof corpo.pin_attuale === "string" && corpo.pin_attuale) {
      let r;
      try { r = await controllaPin(admin, id, corpo.pin_attuale); } catch { return errore("Errore del server. Riprova.", 500); }
      if (r.esito === "nessuno") return errore("Non hai ancora un PIN: inserisci la password attuale.", 400);
      if (r.esito === "attesa" || r.esito === "bloccato") return errore(attesaTesto(r.attesa || 900), 429);
      if (r.esito === "eliminato") return errore("Troppi PIN sbagliati: il PIN è stato disattivato. Impostane uno nuovo con la password.", 401);
      if (r.esito !== "ok") return errore("Il PIN attuale non è corretto.", 401);
    } else {
      return errore("Inserisci la password attuale.");
    }

    const { error } = await admin.from("pin_accesso").upsert({
      utente_id: id, impronta: await improntaPin(corpo.pin as string), tentativi: 0, errori_consecutivi: 0,
      bloccato_fino: null, aggiornato_il: new Date().toISOString(),
    });
    if (error) return errore("Non è stato possibile salvare il PIN.", 500);
    return risposta({ ok: true });
  }

  return errore("Azione sconosciuta.");
});
