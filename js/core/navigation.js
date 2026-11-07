// Navigazione tra le viste. I moduli registrano la propria funzione di disegno con registraVista.
import { emetti } from "./eventi.js";

// home = cruscotto della giornata; giorno = rapportino (editor); sett/mese = calendario;
// cerca = clienti; altro = strumenti, report, documenti e archivio
export const VISTE = ["home","giorno","sett","mese","cerca","altro"];
export const VOCE_NAV = {home:"home", giorno:"home", sett:"cal", mese:"cal", cerca:"clienti", altro:"altro"};
export let vistaCorrente = "home";
export let ultimaVistaCal = "mese";
export const disegnatori = {};          // vista -> funzione che la ridisegna quando viene mostrata
export function registraVista(nome, disegna){ disegnatori[nome] = disegna; }
export function mostraVista(v){
  if(v === "cal") v = ultimaVistaCal;   // voce "Calendario": ultima tra settimana e mese
  if(!VISTE.includes(v)) v = "home";
  emetti("vista-cambiata", v);
  vistaCorrente = v;
  if(v === "sett" || v === "mese") ultimaVistaCal = v;
  VISTE.forEach(k=>{
    document.getElementById("vista-" + k).classList.toggle("nascosto", k !== v);
    const barra = document.getElementById("barra-" + k);
    if(barra) barra.classList.toggle("nascosto", k !== v);
  });
  document.body.classList.toggle("con-barra", !!document.getElementById("barra-" + v));
  document.getElementById("cal-testa").classList.toggle("nascosto", !(v === "sett" || v === "mese"));
  document.getElementById("seg-sett").setAttribute("aria-pressed", v === "sett");
  document.getElementById("seg-mese").setAttribute("aria-pressed", v === "mese");
  ["home","cal","clienti","altro"].forEach(n=>{
    const b = document.getElementById("nav-" + n);
    if(VOCE_NAV[v] === n) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  if(disegnatori[v]) disegnatori[v]();
}
