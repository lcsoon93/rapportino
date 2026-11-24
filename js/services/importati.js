// Schede della vecchia app gia' importate come rapportini (rapportini.origine): l'app le mostra una volta
// sola, come rapportini; l'archivio del foglio giornaliero resta intatto (orari della giornata compresi).
// Solo admin e company consultano le giornate della vecchia app. Elenco tenuto anche sul telefono
// (ultimo noto, per l'uso senza rete) e riletto al massimo ogni minuto.
import { client } from "../core/sessione.js";
import { puo } from "../core/permessi.js";
import { leggiDB } from "../core/storage.js";
import { archivioSenzaImportate, giornataSenzaImportate } from "./importati-logica.js";

const CHIAVE = "importate";
let importate = new Set((()=>{ try{ return JSON.parse(localStorage.getItem(CHIAVE) || "[]"); }catch(e){ return []; } })());
let letto = 0, inCorso = null;

export function caricaImportate(forza){
  if(!puo("giornate.consulta")) return Promise.resolve(importate);
  if(inCorso) return inCorso;
  if(!forza && Date.now() - letto < 60000) return Promise.resolve(importate);
  inCorso = (async()=>{
    try{
      const r = await client.from("rapportini").select("origine").not("origine", "is", null).limit(10000);
      if(!r.error){                         // colonna assente (database non ancora aggiornato): nulla di importato
        importate = new Set((r.data || []).map(x=>x.origine).filter(Boolean));
        try{ localStorage.setItem(CHIAVE, JSON.stringify([...importate])); }catch(e){}
        letto = Date.now();
      }
    }catch(e){ /* senza rete: ultimo elenco noto */ }
    finally{ inCorso = null; }
    return importate;
  })();
  return inCorso;
}
export const schedeImportate = ()=>importate;
// archivio e giornata della vecchia app da MOSTRARE (senza le schede gia' tra i rapportini)
export const archivioVisibile = ()=>archivioSenzaImportate(importate, leggiDB());
export const giornataVisibile = iso=>giornataSenzaImportate(importate, iso, leggiDB()[iso]);
