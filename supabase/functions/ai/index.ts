// Assistente AI di Rapportino (Groq). Tutta la logica e' in _shared/ai-gestore.ts (provata con i test
// in tests/); qui solo il collegamento con Supabase.
// Secret: GROQ_API_KEY (obbligatorio); facoltativi GROQ_MODELLO_TESTO, GROQ_MODELLO_RISERVA, GROQ_MODELLO_VISIONE.
import { chiamante, clientAdmin, clientUtente, CORS } from "../_shared/comune.ts";
import { gestisci } from "../_shared/ai-gestore.ts";

Deno.serve((req) => {
  const admin = clientAdmin();
  return gestisci(req, {
    env: (k) => Deno.env.get(k),
    chiamante: (r) => chiamante(r, admin),
    dbUtente: (r) => clientUtente(r),
    // limite per utente (stessa funzione del limite sugli accessi, eseguibile solo con service_role)
    limite: async (chiave, massimo, secondi) => {
      const { data, error } = await admin.rpc("limite_tentativi", { p_chiave: chiave, p_massimo: massimo, p_secondi: secondi });
      if (error) throw new Error("limite non verificabile");
      return data !== false;
    },
    cors: CORS,
  });
});
