// Impostazioni condivise (tabella "impostazioni" su Supabase): le decide l'amministratore e valgono
// per tutti gli utenti. Copia in localStorage per usarle anche offline o prima che arrivi il server.
import { client } from "../core/sessione.js";

const LOCALE = "impostazioni-condivise";
let valori = leggiLocale();

function leggiLocale(){
  try{ return JSON.parse(localStorage.getItem(LOCALE) || "{}") || {}; }catch(e){ return {}; }
}
function salvaLocale(){
  try{ localStorage.setItem(LOCALE, JSON.stringify(valori)); }catch(e){}
}

export function impostazione(chiave, predefinito){
  return chiave in valori ? valori[chiave] : predefinito;
}

// legge dal server; senza rete (o tabella non ancora creata) restano gli ultimi valori noti
export async function caricaImpostazioni(){
  const { data, error } = await client.from("impostazioni").select("chiave, valore");
  if(error) throw new Error(error.message);
  valori = {};
  (data || []).forEach(r=>{ valori[r.chiave] = r.valore; });
  salvaLocale();
  return valori;
}

// solo admin (lo garantisce la policy RLS)
export async function salvaImpostazione(chiave, valore){
  const { error } = await client.from("impostazioni").upsert({ chiave, valore }, { onConflict: "chiave" });
  if(error) throw new Error(error.message);
  valori[chiave] = valore;
  salvaLocale();
}
