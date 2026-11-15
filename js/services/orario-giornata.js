// Orario della giornata: 08:00-17:00 per tutti, salvo quello inserito dall'amministratore per un giorno
// (e la spunta "escludi dal monte ore"). Si salva nella tabella "impostazioni" gia' esistente, una chiave
// per giorno modificato ("giornata:AAAA-MM-GG"): lo leggono tutti, lo scrive solo l'admin (policy RLS).
// Per i giorni storici vale, finche' non si inserisce altro, l'orario del vecchio foglio giornaliero.
import { caricaImpostazioni, impostazione, salvaImpostazione } from "./impostazioni.js";
import { leggiDB } from "../core/storage.js";
import { chiaveGiornata, leggiOrarioInserito, orarioGiornata } from "./giornate-logica.js";
import { emetti } from "../core/eventi.js";

export const orarioInserito = iso=>leggiOrarioInserito(impostazione(chiaveGiornata(iso), null));
// { dalle, alle, minuti, escludi, origine } del giorno
export function orarioDelGiorno(iso){
  return orarioGiornata(orarioInserito(iso), leggiDB()[iso]);
}
// orari inseriti di piu' giorni: { iso: valore }
export function orariInseriti(giorni){
  const out = {};
  giorni.forEach(g=>{ const o = orarioInserito(g); if(o) out[g] = o; });
  return out;
}
export async function aggiornaOrari(){ try{ await caricaImpostazioni(); }catch(e){ /* senza rete: ultimi valori noti */ } }
// salva l'orario del giorno (solo admin); avvisa le schermate aperte
export async function salvaOrarioGiorno(iso, { dalle, alle, escludi }){
  const valore = leggiOrarioInserito({ dalle, alle, escludi: !!escludi });
  if(!valore || !valore.dalle) throw new Error("Indica l'ora di inizio e di fine (es. 08:00 e 17:00).");
  await salvaImpostazione(chiaveGiornata(iso), valore);
  emetti("orario-giornata", iso);
  return orarioDelGiorno(iso);
}
