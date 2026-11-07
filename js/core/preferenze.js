// Preferenze di stampa salvate in localStorage e opzioni lette dalle spunte.
import { minutiOperaio, oreConStraordinario } from "../services/calculations.js";
import { oreTesto } from "../utils/formatters.js";

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
