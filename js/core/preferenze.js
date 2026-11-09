// Preferenze di stampa salvate in localStorage e opzioni lette dalle spunte.
import { minutiOperaio, oreConStraordinario } from "../services/calculations.js";
import { oreTesto } from "../utils/formatters.js";
import { impostazione } from "../services/impostazioni.js";

export function leggiPrefNascondiOreMese(){
  try{ return localStorage.getItem("nascondiOreMese") === "1"; }catch(e){ return false; }
}
export function salvaPrefNascondiOreMese(v){
  try{ localStorage.setItem("nascondiOreMese", v ? "1" : "0"); }catch(e){}
}
export function leggiPrefExtra(){
  try{ return localStorage.getItem("stampaExtra") === "1"; }catch(e){ return false; }
}
export function salvaPrefExtra(v){
  try{ localStorage.setItem("stampaExtra", v ? "1" : "0"); }catch(e){}
}
export function leggiPrefFoglioUnico(){
  try{ return localStorage.getItem("pdfFoglioUnico") === "1"; }catch(e){ return false; }
}
export function salvaPrefFoglioUnico(v){
  try{ localStorage.setItem("pdfFoglioUnico", v ? "1" : "0"); }catch(e){}
}
export function leggiPrefNascondiOre(){
  try{ return localStorage.getItem("nascondiOreGiorno") === "1"; }catch(e){ return false; }
}
export function salvaPrefNascondiOre(v){
  try{ localStorage.setItem("nascondiOreGiorno", v ? "1" : "0"); }catch(e){}
}
// Stampe con le ore per cliente e non per operaio (spunta condivisa da giornata, rapportino, settimana,
// mese e Storico): nei PDF e nei testi niente orari e ore dei singoli operai, solo i nomi dei tecnici e le
// ore di lavoro presso il cliente (tempo sul posto). Nell'app le ore per operaio restano visibili.
export const SPUNTE_ORE_CLIENTE = ["ore-cliente-giorno", "ore-cliente-rapportino", "ore-cliente-sett", "ore-cliente-mese", "ore-cliente-storico"];
// Decisa dall'amministratore e condivisa (tabella "impostazioni"): vale per le stampe di tutti.
export function orePerCliente(){
  return impostazione("ore_per_cliente", false) === true;
}
export function aggiornaSpunteOreCliente(){
  const v = orePerCliente();
  SPUNTE_ORE_CLIENTE.forEach(id=>{ const el = document.getElementById(id); if(el) el.checked = v; });
}
// " (9 ore)" accanto a dalle-alle, oppure niente se la spunta e' attiva
export function contoOreOperaio(op, spazio){
  if(document.getElementById("nascondi-ore-giorno").checked) return "";
  return spazio + "(" + oreTesto(minutiOperaio(op)) + ")";
}
export function stampaExtraAttivo(){
  return document.getElementById("stampa-extra").checked;
}
// il PDF usa questa: mostra "9 ore +1h 30m" oppure solo il totale
export function oreStampa(min){
  return stampaExtraAttivo() ? oreConStraordinario(min) : oreTesto(min);
}
