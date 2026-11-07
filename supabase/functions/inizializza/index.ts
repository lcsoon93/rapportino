// Creazione UNA TANTUM degli account iniziali "Luca" (admin) e "comphas" (company).
// I codici iniziali NON stanno nel codice: il proprietario li imposta come segreti delle
// Edge Functions (CODICE_INIZIALE_LUCA, CODICE_INIZIALE_COMPHAS) dal pannello Supabase.
// Funziona solo finche' non esiste un amministratore; gli account dovranno cambiare password
// al primo accesso. Dopo l'uso si possono cancellare segreti e funzione.
import { CORS, clientAdmin, emailInterna, errore, risposta } from "../_shared/comune.ts";

const INIZIALI = [
  { username: "Luca", nome: "Luca", ruolo: "admin", segreto: "CODICE_INIZIALE_LUCA" },
  { username: "comphas", nome: "COMPHAS", ruolo: "company", segreto: "CODICE_INIZIALE_COMPHAS" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errore("Metodo non consentito", 405);
  const admin = clientAdmin();
  const { count } = await admin.from("profili").select("id", { count: "exact", head: true }).eq("ruolo", "admin");
  if ((count || 0) > 0) return errore("Inizializzazione gia' eseguita.", 409);

  for (const a of INIZIALI) {
    if (!Deno.env.get(a.segreto)) return errore(`Manca il segreto ${a.segreto}.`, 412);
  }
  const creati: string[] = [];
  for (const a of INIZIALI) {
    const { data: esiste } = await admin.from("profili").select("id").ilike("username", a.username).maybeSingle();
    if (esiste) continue;
    const { data, error } = await admin.auth.admin.createUser({
      email: emailInterna(), password: Deno.env.get(a.segreto)!, email_confirm: true,
    });
    if (error || !data.user) return errore(`Creazione di ${a.username} non riuscita: ${error?.message || ""}`, 500);
    const { error: e2 } = await admin.from("profili").insert({
      id: data.user.id, username: a.username, nome: a.nome, ruolo: a.ruolo, deve_cambiare_password: true,
    });
    if (e2) {
      await admin.auth.admin.deleteUser(data.user.id);
      return errore(`Profilo di ${a.username} non creato.`, 500);
    }
    creati.push(a.username);
  }
  return risposta({ creati });
});
