// Navigazione tra le viste. I moduli registrano la propria funzione di disegno con registraVista.
// Le viste e le voci di menu disponibili dipendono dal ruolo (core/permessi.js).
import { emetti } from "./eventi.js";
import { puo, vistaIniziale, vocinav } from "./permessi.js";

// home = cruscotto (admin); giorno = rapportino (editor); sett/mese = calendario; cerca = clienti;
// altro = strumenti; lavoro = dashboard operaio; company = pianificazione; rapporti = rapportini
// compilati (company); utenti = gestione utenti (admin)
export const VISTE = ["home","giorno","sett","mese","cerca","altro","lavoro","company","rapporti","utenti"];
export const VOCE_NAV = {home:"home", giorno:"home", sett:"cal", mese:"cal", cerca:"clienti", altro:"altro",
  lavoro:"lavoro", company:"company", rapporti:"rapporti", utenti:"altro"};
export let vistaCorrente = "home";
export let ultimaVistaCal = "mese";
export const disegnatori = {};          // vista -> funzione che la ridisegna quando viene mostrata
export function registraVista(nome, disegna){ disegnatori[nome] = disegna; }
export function mostraVista(v){
  if(v === "cal") v = ultimaVistaCal;   // voce "Calendario": ultima tra settimana e mese
  if(!VISTE.includes(v) || !puo("vista." + v)) v = vistaIniziale();
  emetti("vista-cambiata", v);
  vistaCorrente = v;
  if(v === "sett" || v === "mese") ultimaVistaCal = v;
  // il rapportino dell'operaio torna alla sua dashboard
  VOCE_NAV.giorno = puo("vista.home") ? "home" : "lavoro";
  VISTE.forEach(k=>{
    document.getElementById("vista-" + k).classList.toggle("nascosto", k !== v);
    const barra = document.getElementById("barra-" + k);
    if(barra) barra.classList.toggle("nascosto", k !== v);
  });
  document.body.classList.toggle("con-barra", !!document.getElementById("barra-" + v));
  document.getElementById("cal-testa").classList.toggle("nascosto", !(v === "sett" || v === "mese"));
  document.getElementById("seg-sett").setAttribute("aria-pressed", v === "sett");
  document.getElementById("seg-mese").setAttribute("aria-pressed", v === "mese");
  document.querySelectorAll(".navbar .nav-btn").forEach(b=>{
    if(VOCE_NAV[v] === b.dataset.voce) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  if(disegnatori[v]) disegnatori[v]();
}
// voci della barra in basso in base al ruolo
export function costruisciNav(){
  document.querySelector(".navbar .nav-in").innerHTML = vocinav().map(([id, etichetta, icona, vista])=>
    '<button type="button" class="nav-btn" data-voce="' + id + '" onclick="mostraVista(\'' + vista + '\')">' +
    '<span class="nav-pill"><svg class="i" aria-hidden="true"><use href="#i-' + icona + '"/></svg></span>' + etichetta + '</button>'
  ).join("");
}
