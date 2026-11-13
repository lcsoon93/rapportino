// Sessione utente con Supabase Auth.
// - Il login con username passa dalla Edge Function "accesso" (l'email interna non arriva mai al browser);
//   la sessione restituita e' quella standard di Supabase, gestita da supabase-js
//   (salvata nel browser solo come token, rinnovata in automatico; MAI la password).
// - Il ruolo si legge dalla tabella "profili" (protetta da RLS), non da valori del frontend.
import { SUPABASE_KEY, SUPABASE_URL } from "./config.js";
import { emetti } from "./eventi.js";

const FUNZIONI = SUPABASE_URL + "/functions/v1/";
// ogni richiesta a Supabase ha un tempo massimo: su una rete "appesa" (Wi-Fi senza Internet) la
// richiesta fallisce invece di restare in attesa per minuti (30 s; 120 s per i file dello Storage)
function fetchConLimite(url, opz = {}, msRichiesti){
  const ms = msRichiesti || (/\/storage\/v1\/object/.test(String(url)) ? 120000 : 30000);
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), ms);
  if(opz.signal){ if(opz.signal.aborted) ctl.abort(); else opz.signal.addEventListener("abort", ()=>ctl.abort()); }
  return fetch(url, { ...opz, signal: ctl.signal }).finally(()=>clearTimeout(t));
}
export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "rapportino-sessione" },
  global: { fetch: fetchConLimite },
});

// profilo dell'utente collegato: { id, username, nome, cognome, ruolo, ruoli, attivo, deve_cambiare_password }
// ruolo = ruolo principale (menu e permessi); ruoli = tutti i ruoli (es. admin + worker)
export let profilo = null;

export async function tokenAccesso(){
  const { data } = await client.auth.getSession();
  return data.session ? data.session.access_token : null;
}

// chiamata a una Edge Function (con la sessione, se c'e'); opzioni.timeout in ms (predefinito 30 s)
export async function chiamaFunzione(nome, corpo, conSessione = true, opzioni = {}){
  const token = conSessione ? await tokenAccesso() : null;
  let risposta;
  try{
    // stesso tempo massimo delle altre richieste: su una rete "appesa" non si resta in attesa
    risposta = await fetchConLimite(FUNZIONI + nome, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + (token || SUPABASE_KEY) },
      body: JSON.stringify(corpo || {}),
    }, opzioni.timeout);
  }catch(e){
    return { ok: false, stato: 0, errore: "Nessuna connessione. Controlla la rete e riprova." };
  }
  let j = {};
  try{ j = await risposta.json(); }catch(e){}
  return { ok: risposta.ok, stato: risposta.status, errore: j.errore || (risposta.ok ? "" : "Errore del server (" + risposta.status + ")."), dati: j };
}

// profilo dell'ultimo accesso (id, username, nome, ruolo: niente token) per riaprire l'app quando il
// server non risponde: serve solo all'interfaccia, i dati restano protetti da RLS sul server
const PROFILO_LOCALE = "rapportino-profilo";
const erroreRete = e=>!!e && (/fetch|network|abort|timeout|Load failed/i.test(String(e.message || e)) || /Retryable/i.test(String(e.name || "")));
class ErroreRete extends Error {}

// nome da mostrare: "nome cognome" (mai l'identificativo); in mancanza lo username
export function nomeCompleto(p){
  if(!p) return "";
  return [p.nome, p.cognome].map(x=>String(x || "").trim()).filter(Boolean).join(" ") || p.username || "";
}
// il profilo ha questo ruolo? (ruoli: admin + worker per chi e' amministratore e operaio)
export function haRuolo(r, p = profilo){
  return !!p && (Array.isArray(p.ruoli) ? p.ruoli.includes(r) : p.ruolo === r);
}

const CAMPI_PROFILO = "id, username, nome, cognome, ruolo, ruoli, attivo, deve_cambiare_password";
const CAMPI_PROFILO_PRIMA = "id, username, nome, ruolo, attivo, deve_cambiare_password";   // senza la migrazione 20261112

// rilegge il profilo dal database; null se manca o l'account e' disattivato; ErroreRete se il server
// non e' raggiungibile (in quel caso non si decide nulla sulla sessione)
export async function caricaProfilo(){
  const { data: u, error: ue } = await client.auth.getUser();
  if(erroreRete(ue)) throw new ErroreRete("rete");
  if(!u || !u.user){ profilo = null; return null; }
  let { data, error } = await client.from("profili").select(CAMPI_PROFILO).eq("id", u.user.id).maybeSingle();
  // database non ancora aggiornato (colonne cognome/ruoli assenti): si legge come prima
  if(error && /42703|cognome|ruoli/i.test((error.code || "") + (error.message || ""))){
    ({ data, error } = await client.from("profili").select(CAMPI_PROFILO_PRIMA).eq("id", u.user.id).maybeSingle());
  }
  if(erroreRete(error)) throw new ErroreRete("rete");
  if(error || !data || !data.attivo){ profilo = null; try{ localStorage.removeItem(PROFILO_LOCALE); }catch(e){} return null; }
  if(!Array.isArray(data.ruoli)) data.ruoli = [data.ruolo];
  if(typeof data.cognome !== "string") data.cognome = "";
  profilo = data;
  try{ localStorage.setItem(PROFILO_LOCALE, JSON.stringify({ id: data.id, username: data.username, nome: data.nome, cognome: data.cognome, ruolo: data.ruolo, ruoli: data.ruoli, attivo: true, deve_cambiare_password: false })); }catch(e){}
  return profilo;
}

// ---------------------------------------------------------------- PIN
// Su questo telefono si ricorda SOLO lo username di chi ha attivato il PIN (per proporre l'accesso
// con PIN); il PIN non viene mai salvato nel browser.
const UTENTE_PIN = "rapportino-pin-utente";
export function utentePin(){ try{ return localStorage.getItem(UTENTE_PIN) || ""; }catch(e){ return ""; } }
export function ricordaUtentePin(username){ try{ username ? localStorage.setItem(UTENTE_PIN, username) : localStorage.removeItem(UTENTE_PIN); }catch(e){} }

export function accediConPin(username, pin){
  return completaAccesso(chiamaFunzione("accesso", { username: (username || "").trim(), pin }, false));
}
export async function statoPin(){
  const r = await chiamaFunzione("pin", { azione: "stato" });
  return r.ok ? { ok: true, attivo: !!r.dati.attivo } : { ok: false, errore: r.errore };
}
export async function impostaPin(pin, credenziale){
  const r = await chiamaFunzione("pin", { azione: "imposta", pin, ...credenziale });
  if(r.ok && profilo) ricordaUtentePin(profilo.username);
  return r;
}
export async function rimuoviPin(){
  const r = await chiamaFunzione("pin", { azione: "rimuovi" });
  if(r.ok && profilo && utentePin().toLowerCase() === profilo.username.toLowerCase()) ricordaUtentePin("");
  return r;
}

export function accedi(username, password){
  return completaAccesso(chiamaFunzione("accesso", { username: (username || "").trim(), password }, false));
}
async function completaAccesso(richiesta){
  const r = await richiesta;
  if(!r.ok) return { ok: false, errore: r.errore, stato: r.stato };
  const { error } = await client.auth.setSession(r.dati.sessione);
  if(error) return { ok: false, errore: "Sessione non valida. Riprova." };
  const p = await caricaProfilo();
  if(!p){ await esci(); return { ok: false, errore: "Account non attivo." }; }
  emetti("accesso", p);
  return { ok: true, profilo: p };
}

// ripristina la sessione salvata (apertura dell'app). Senza rete la sessione NON viene chiusa: si
// riapre con il profilo dell'ultimo accesso dello stesso utente (le bozze restano consultabili e
// partiranno quando il server torna raggiungibile).
export async function ripristina(){
  const { data } = await client.auth.getSession();
  if(!data.session) return null;
  let p;
  try{ p = await caricaProfilo(); }
  catch(e){
    if(!(e instanceof ErroreRete)) throw e;
    let c = null;
    try{ c = JSON.parse(localStorage.getItem(PROFILO_LOCALE) || "null"); }catch(x){}
    if(c && data.session.user && c.id === data.session.user.id){ profilo = c; return c; }
    return null;
  }
  if(!p){ await client.auth.signOut({ scope: "local" }); return null; }
  return p;
}

export async function esci(){
  profilo = null;
  try{ localStorage.removeItem(PROFILO_LOCALE); }catch(e){}
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
