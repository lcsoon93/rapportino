// Ritorni da programmare ("Da ultimare"): uno per rapportino di origine, conservati sul telefono
// per utente. Restano finché l'intervento di ritorno non è stato salvato sul server; quelli
// programmati restano registrati (con l'id dell'intervento) per non programmarli due volte.
import { profilo } from "../core/sessione.js";

const VECCHIA_CHIAVE = "followup_pendenti";
const GIORNI_CONSERVAZIONE = 60;
const chiave = ()=>"followup:" + (profilo ? profilo.id : "anonimo");

function leggi(){
  try{ return JSON.parse(localStorage.getItem(chiave()) || "[]"); }catch(e){ return []; }
}
function scrivi(lista){
  const limite = Date.now() - GIORNI_CONSERVAZIONE * 86400000;
  const tenuti = lista.filter(f=>f.stato !== "programmato" || Date.parse(f.aggiornato || 0) >= limite);
  try{ localStorage.setItem(chiave(), JSON.stringify(tenuti)); }catch(e){ /* spazio esaurito o storage bloccato */ }
}
// formato precedente (array senza id, senza utente): importato una volta nel nuovo
function importaVecchi(){
  let vecchi;
  try{ vecchi = JSON.parse(localStorage.getItem(VECCHIA_CHIAVE) || "null"); }catch(e){ vecchi = null; }
  if(!Array.isArray(vecchi)) return;
  const lista = leggi();
  vecchi.forEach((v, n)=>{
    const id = "vecchio-" + (v.salvato || n) + "-" + (v.cliente || "");
    if(!lista.some(f=>f.id === id)) lista.push({ ...v, id, rapportino_id: null, stato: "da_programmare", creato: v.salvato || new Date().toISOString(), aggiornato: new Date().toISOString() });
  });
  scrivi(lista);
  try{ localStorage.removeItem(VECCHIA_CHIAVE); }catch(e){}
}

export function elencoFollowup({ tutti = false } = {}){
  importaVecchi();
  const lista = leggi();
  return tutti ? lista : lista.filter(f=>f.stato !== "programmato");
}
export function leggiFollowup(id){ return leggi().find(f=>f.id === id) || null; }
export function followupDelRapportino(rapportinoId){ return leggi().find(f=>f.rapportino_id === rapportinoId) || null; }

// crea o aggiorna il ritorno del rapportino (uno solo per rapportino); uno già programmato non cambia
export function salvaFollowup(dati){
  const lista = leggi();
  const ora = new Date().toISOString();
  const id = dati.rapportino_id || dati.id;
  const i = lista.findIndex(f=>f.id === id);
  if(i >= 0 && lista[i].stato === "programmato") return lista[i];
  const rec = Object.assign({}, i >= 0 ? lista[i] : { creato: ora, stato: "da_programmare" }, dati, { id, aggiornato: ora });
  if(i >= 0) lista[i] = rec; else lista.push(rec);
  scrivi(lista);
  return rec;
}
export function segnaProgrammato(id, interventoId){
  const lista = leggi();
  const f = lista.find(x=>x.id === id);
  if(!f) return;
  Object.assign(f, { stato: "programmato", intervento_id: interventoId || null, aggiornato: new Date().toISOString() });
  scrivi(lista);
}
// solo se non ancora programmato (es. l'esito torna "Completato")
export function rimuoviFollowup(id){
  scrivi(leggi().filter(f=>f.id !== id));
}
