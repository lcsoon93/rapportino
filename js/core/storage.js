// Archivio dei rapporti: IndexedDB (un record per giorno) con copia in memoria,
// migrazione dal vecchio localStorage "rapporti" e timbri di modifica per la sincronizzazione.
import { SINC_ATTIVA } from "./config.js";

// L'archivio sta in IndexedDB: localStorage su iPhone tiene circa 5 MB e con foto e firme si riempiva.
// In memoria si tiene una copia completa, cosi' le letture restano immediate; su disco si scrivono
// solo i giorni cambiati (un record per giorno).
export const IDB_NOME = "rapportino", IDB_STORE = "giorni";
export let archivio = {};        // { "AAAA-MM-GG": giornata }
export let scritti = {};         // ultima versione scritta su disco di ogni giorno (stessi riferimenti di archivio)
export let idb = null;           // null = IndexedDB non disponibile: si ripiega su localStorage
export function apriIDB(){
  return new Promise((ok, ko)=>{
    const r = indexedDB.open(IDB_NOME, 1);
    r.onupgradeneeded = ()=>r.result.createObjectStore(IDB_STORE);
    r.onsuccess = ()=>ok(r.result);
    r.onerror = ()=>ko(r.error);
  });
}
export function leggiTuttoIDB(){
  return new Promise((ok, ko)=>{
    const out = {};
    const req = idb.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).openCursor();
    req.onsuccess = ()=>{
      const c = req.result;
      if(c){ out[c.key] = c.value; c.continue(); } else ok(out);
    };
    req.onerror = ()=>ko(req.error);
  });
}
// scrive su IndexedDB i giorni indicati (e cancella quelli tolti); risolve true se la transazione va a buon fine
export function scriviGiorniIDB(cambiati, tolti){
  return new Promise(ok=>{
    try{
      const tx = idb.transaction(IDB_STORE, "readwrite");
      const st = tx.objectStore(IDB_STORE);
      cambiati.forEach(k=>st.put(archivio[k], k));
      tolti.forEach(k=>st.delete(k));
      tx.oncomplete = ()=>ok(true);
      tx.onerror = tx.onabort = ()=>ok(false);
    }catch(e){ ok(false); }
  });
}
// all'avvio: carica l'archivio e, la prima volta, sposta i dati dal vecchio localStorage
export async function caricaArchivio(){
  try{
    idb = await apriIDB();
    archivio = await leggiTuttoIDB();
  }catch(e){
    console.error(e);
    idb = null;
  }
  let vecchio = null;
  try{ vecchio = JSON.parse(localStorage.getItem("rapporti") || "null"); }catch(e){}
  if(!idb){
    archivio = vecchio || {};
  } else if(vecchio && typeof vecchio === "object"){
    const daSpostare = Object.keys(vecchio).filter(k=>!(k in archivio));
    daSpostare.forEach(k=>{ archivio[k] = vecchio[k]; });
    // libero localStorage solo quando i dati sono davvero su IndexedDB
    if(await scriviGiorniIDB(daSpostare, [])){
      try{ localStorage.removeItem("rapporti"); }catch(e){}
    }
  }
  scritti = Object.assign({}, archivio);
  // chiedo al browser di non cancellare i dati quando lo spazio scarseggia
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
}
export function leggiDB(){ return archivio; }
// restituisce false solo se il salvataggio fallisce subito; gli errori di IndexedDB arrivano dopo
// e vengono mostrati da avvisoArchivio()
export function scriviDB(db){
  archivio = db;
  if(!idb){
    try{ localStorage.setItem("rapporti", JSON.stringify(db)); return true; }
    catch(e){ return false; }
  }
  const cambiati = Object.keys(db).filter(k=>scritti[k] !== db[k]);
  const tolti = Object.keys(scritti).filter(k=>!(k in db));
  if(!cambiati.length && !tolti.length) return true;
  cambiati.forEach(k=>{ scritti[k] = db[k]; });
  tolti.forEach(k=>{ delete scritti[k]; });
  scriviGiorniIDB(cambiati, tolti).then(ok=>{
    if(ok) return;
    // al prossimo salvataggio questi giorni verranno riscritti
    cambiati.forEach(k=>{ delete scritti[k]; });
    tolti.forEach(k=>{ scritti[k] = null; });
    avvisoArchivio();
  });
  return true;
}
export function avvisoArchivio(){
  const s = document.getElementById("statosalvataggio");
  if(!s) return;
  s.style.color = "#B3413A";
  s.textContent = SINC_ATTIVA()
    ? "⚠ Non riesco a salvare sul telefono. La modifica è stata inviata al server."
    : "⚠ Non riesco a salvare sul telefono: esporta un backup.";
}
// quando e' stato modificato ogni giorno, per capire chi ha la versione buona
export function leggiTimbri(){
  try{ return JSON.parse(localStorage.getItem("timbri") || "{}"); }catch(e){ return {}; }
}
export function scriviTimbri(t){
  try{ localStorage.setItem("timbri", JSON.stringify(t)); }catch(e){}
}

// ---- archivio del telefono legato all'utente collegato ----
// Le mappe di servizio stanno in localStorage: "assegnazioni" (giorno -> operai assegnati, dal server),
// "inSospeso" (giorni salvati qui ma non ancora confermati dal server), "rifiutati" (giorni che il
// server non accetta da questo utente: non si ritentano finche' non cambiano).
export function leggiMappa(nome){
  try{ return JSON.parse(localStorage.getItem(nome) || "{}"); }catch(e){ return {}; }
}
export function scriviMappa(nome, valore){
  try{ localStorage.setItem(nome, JSON.stringify(valore)); }catch(e){}
}
export function proprietarioArchivio(){
  try{ return localStorage.getItem("archivioUtente"); }catch(e){ return null; }
}
export function impostaProprietarioArchivio(id){
  try{ localStorage.setItem("archivioUtente", id); }catch(e){}
}
// toglie dal telefono i rapporti (es. quando entra un utente diverso); le preferenze restano
export function svuotaArchivioLocale(){
  const db = leggiDB();
  Object.keys(db).forEach(k=>{ delete db[k]; });
  scriviDB(db);
  ["timbri", "assegnazioni", "inSospeso", "rifiutati", "basi", "confermati"].forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
}
