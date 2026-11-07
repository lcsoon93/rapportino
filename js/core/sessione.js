// Sessione utente con Supabase Auth.
// - Il login con username passa dalla Edge Function "accesso" (l'email interna non arriva mai al browser);
//   la sessione restituita e' quella standard di Supabase, gestita da supabase-js
//   (salvata nel browser solo come token, rinnovata in automatico; MAI la password).
// - Il ruolo si legge dalla tabella "profili" (protetta da RLS), non da valori del frontend.
import { SUPABASE_KEY, SUPABASE_URL } from "./config.js";
import { emetti } from "./eventi.js";

const FUNZIONI = SUPABASE_URL + "/functions/v1/";
export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "rapportino-sessione" },
});

// profilo dell'utente collegato: { id, username, nome, ruolo, attivo, deve_cambiare_password }
export let profilo = null;

export async function tokenAccesso(){
  const { data } = await client.auth.getSession();
  return data.session ? data.session.access_token : null;
}

// chiamata a una Edge Function (con la sessione, se c'e')
export async function chiamaFunzione(nome, corpo, conSessione = true){
  const token = conSessione ? await tokenAccesso() : null;
  let risposta;
  try{
    risposta = await fetch(FUNZIONI + nome, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + (token || SUPABASE_KEY) },
      body: JSON.stringify(corpo || {}),
    });
  }catch(e){
    return { ok: false, stato: 0, errore: "Nessuna connessione. Controlla la rete e riprova." };
  }
  let j = {};
  try{ j = await risposta.json(); }catch(e){}
  return { ok: risposta.ok, stato: risposta.status, errore: j.errore || (risposta.ok ? "" : "Errore del server (" + risposta.status + ")."), dati: j };
}

// rilegge il profilo dal database; null se manca o l'account e' disattivato
export async function caricaProfilo(){
  const { data: u } = await client.auth.getUser();
  if(!u || !u.user){ profilo = null; return null; }
  const { data, error } = await client.from("profili")
    .select("id, username, nome, ruolo, attivo, deve_cambiare_password").eq("id", u.user.id).maybeSingle();
  if(error || !data || !data.attivo){ profilo = null; return null; }
  profilo = data;
  return profilo;
}

export async function accedi(username, password){
  const r = await chiamaFunzione("accesso", { username: (username || "").trim(), password }, false);
  if(!r.ok) return { ok: false, errore: r.errore };
  const { error } = await client.auth.setSession(r.dati.sessione);
  if(error) return { ok: false, errore: "Sessione non valida. Riprova." };
  const p = await caricaProfilo();
  if(!p){ await esci(); return { ok: false, errore: "Account non attivo." }; }
  emetti("accesso", p);
  return { ok: true, profilo: p };
}

// ripristina la sessione salvata (apertura dell'app)
export async function ripristina(){
  const { data } = await client.auth.getSession();
  if(!data.session) return null;
  const p = await caricaProfilo();
  if(!p){ await client.auth.signOut({ scope: "local" }); return null; }
  return p;
}

export async function esci(){
  profilo = null;
  await client.auth.signOut({ scope: "local" }).catch(()=>{});
  emetti("uscita");
}

export async function cambiaPassword(attuale, nuova){
  const r = await chiamaFunzione("cambia-password", { attuale, nuova });
  if(r.ok){
    // cambiando password Supabase chiude le sessioni: si usa quella nuova restituita dal server
    if(r.dati.sessione) await client.auth.setSession(r.dati.sessione);
    if(profilo) profilo.deve_cambiare_password = false;
  }
  return r;
}

// sessione scaduta o revocata (es. account disattivato): si torna al login
client.auth.onAuthStateChange((evento)=>{
  if(evento === "SIGNED_OUT" && profilo){
    profilo = null;
    emetti("uscita", "scaduta");
  }
});
