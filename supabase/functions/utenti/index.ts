// Gestione utenti: SOLO l'amministratore.
// Azioni:
//   elenco                                  tutti i profili (nome, cognome, ruoli, stato, PIN attivo)
//   crea { nome, cognome, username, password }   sempre e solo ruolo "worker"
//   modifica { id, nome, cognome, operaio? }     nome e cognome di qualsiasi account; "operaio" solo
//                                                per gli amministratori (ruoli admin + worker)
//   rimuovi_pin { id }                      elimina il PIN di qualsiasi account (si rientra con la password)
//   disattiva / riattiva / reset_password   solo account operaio, mai se stessi (eliminano anche il PIN)
// Nessuna azione elimina utenti: interventi e rapportini storici restano collegati al loro UUID.
import {
  CAMPI_PROFILO, chiamante, clientAdmin, corpoJson, CORS, emailInterna, errore, problemaPassword, risposta, USERNAME_VALIDO,
} from "../_shared/comune.ts";

const PER_SEMPRE = "876000h"; // ~100 anni: blocca anche il rinnovo delle sessioni aperte
const testo = (v: unknown) => typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errore("Metodo non consentito", 405);
  const admin = clientAdmin();
  const io = await chiamante(req, admin);
  if (!io) return errore("Sessione non valida. Accedi di nuovo.", 401);
  if (!io.profilo.attivo || io.profilo.ruolo !== "admin") return errore("Operazione riservata all'amministratore.", 403);
  if (io.profilo.deve_cambiare_password) return errore("Cambia prima la tua password.", 403);

  const corpo = await corpoJson(req);
  const azione = corpo.azione;

  if (azione === "elenco") {
    const { data, error } = await admin.from("profili").select(CAMPI_PROFILO + ", creato_il").order("ruolo").order("username");
    if (error) return errore("Errore nel leggere gli utenti.", 500);
    const { data: pin } = await admin.from("pin_accesso").select("utente_id");
    const conPin = new Set((pin || []).map((x) => x.utente_id));
    return risposta({ utenti: (data || []).map((u) => ({ ...u, pin: conPin.has(u.id) })) });
  }

  if (azione === "crea") {
    if (corpo.ruolo !== undefined && corpo.ruolo !== "worker") return errore("Da qui si possono creare solo account operaio.", 403);
    const nome = testo(corpo.nome), cognome = testo(corpo.cognome);
    const username = typeof corpo.username === "string" ? corpo.username.trim() : "";
    const password = typeof corpo.password === "string" ? corpo.password : "";
    if (nome.length < 1 || nome.length > 80 || cognome.length < 1 || cognome.length > 80) return errore("Inserisci nome e cognome.");
    if (!USERNAME_VALIDO.test(username)) return errore("Username: da 3 a 30 caratteri tra lettere, numeri, punto, trattino e trattino basso.");
    const problema = problemaPassword(password, username);
    if (problema) return errore(problema);

    const { data: esiste } = await admin.from("profili").select("id")
      .ilike("username", username.replace(/[\\%_]/g, "\\$&")).maybeSingle();
    if (esiste) return errore("Username già in uso.", 409);

    const { data: creato, error: e1 } = await admin.auth.admin.createUser({
      email: emailInterna(), password, email_confirm: true,
    });
    if (e1 || !creato.user) return errore("Non è stato possibile creare l'account.", 500);

    const { error: e2 } = await admin.from("profili").insert({
      id: creato.user.id, username, nome, cognome, ruolo: "worker", ruoli: ["worker"], attivo: true,
      deve_cambiare_password: true, creato_da: io.profilo.id,
    });
    if (e2) {
      // compensazione: niente account Auth senza profilo (e mai due profili: id e username sono unici)
      const { error: e3 } = await admin.auth.admin.deleteUser(creato.user.id);
      if (e3) console.error("account orfano da rimuovere:", creato.user.id);
      return errore(e2.code === "23505" ? "Username già in uso." : "Non è stato possibile creare l'account.", e2.code === "23505" ? 409 : 500);
    }
    return risposta({ utente: { id: creato.user.id, username, nome, cognome, ruolo: "worker", ruoli: ["worker"], attivo: true, deve_cambiare_password: true, pin: false } });
  }

  const id = typeof corpo.id === "string" ? corpo.id : "";
  const { data: bersaglio } = await admin.from("profili").select("id, username, ruolo, ruoli").eq("id", id).maybeSingle();
  if (!bersaglio) return errore("Utente non trovato.", 404);

  if (azione === "modifica") {
    const nome = testo(corpo.nome), cognome = testo(corpo.cognome);
    if (nome.length < 1 || nome.length > 80 || cognome.length > 80) return errore("Inserisci il nome (e il cognome, massimo 80 caratteri).");
    const modifiche: Record<string, unknown> = { nome, cognome };
    if (corpo.operaio !== undefined) {
      if (typeof corpo.operaio !== "boolean") return errore("Valore non valido.");
      if (bersaglio.ruolo === "admin") modifiche.ruoli = corpo.operaio ? ["admin", "worker"] : ["admin"];
      else if (corpo.operaio !== (bersaglio.ruolo === "worker")) return errore("Il ruolo di operaio si cambia solo sugli amministratori.", 403);
    }
    const { error } = await admin.from("profili").update(modifiche).eq("id", id);
    if (error) return errore("Operazione non riuscita.", 500);
    return risposta({ ok: true });
  }

  if (azione === "rimuovi_pin") {
    const { error } = await admin.from("pin_accesso").delete().eq("utente_id", id);
    if (error) return errore("Operazione non riuscita.", 500);
    return risposta({ ok: true });
  }

  // le azioni seguenti valgono solo su account operaio (mai su admin o company, mai su se stessi)
  if (bersaglio.ruolo !== "worker" || bersaglio.id === io.profilo.id) return errore("Operazione consentita solo sugli account operaio.", 403);

  if (azione === "disattiva" || azione === "riattiva") {
    const attivo = azione === "riattiva";
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: attivo ? "none" : PER_SEMPRE });
    if (error) return errore("Operazione non riuscita.", 500);
    await admin.from("profili").update({ attivo, tentativi_falliti: 0, bloccato_fino: null }).eq("id", id);
    if (!attivo) await admin.from("pin_accesso").delete().eq("utente_id", id);
    return risposta({ ok: true });
  }

  if (azione === "reset_password") {
    const password = typeof corpo.password === "string" ? corpo.password : "";
    const problema = problemaPassword(password, bersaglio.username);
    if (problema) return errore(problema);
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return errore("Operazione non riuscita.", 500);
    await admin.from("profili").update({ deve_cambiare_password: true, tentativi_falliti: 0, bloccato_fino: null }).eq("id", id);
    // password reimpostata (dimenticata o compromessa): anche il PIN va scelto di nuovo
    await admin.from("pin_accesso").delete().eq("utente_id", id);
    return risposta({ ok: true });
  }

  return errore("Azione sconosciuta.");
});
