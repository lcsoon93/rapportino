// Navigazione tra le viste. I moduli registrano la propria funzione di disegno con registraVista.
// Le viste e le voci di menu disponibili dipendono dal ruolo (core/permessi.js).
import { emetti } from "./eventi.js";
import { puo, vistaIniziale, vocinav } from "./permessi.js";

// giornata = schermata iniziale di tutti; Agenda = interventi (elenco) + calgiorno / sett / mese;
// rapporti = Rapportini (elenco, PDF del giorno e del mese, report ore); rapportino = modulo;
// cerca = clienti; altro = account, impostazioni, strumenti; utenti = gestione utenti (admin);
// archivio = giornate della vecchia app (consultazione); giorno = foglio della vecchia app (solo per i
// suoi PDF); home e lavoro = schermate precedenti, non piu' raggiungibili (nessun permesso).
// "reportmese" = la vista mese aperta da Rapportini come "Report ore del mese".
export const VISTE = ["home","giornata","giorno","calgiorno","sett","mese","cerca","altro","lavoro","interventi","rapportino","rapporti","utenti","storico","archivio"];
export const VOCE_NAV = {home:"giornata", giornata:"giornata", giorno:"altro", calgiorno:"agenda", sett:"agenda", mese:"agenda", cerca:"clienti", altro:"altro",
  lavoro:"giornata", interventi:"agenda", storico:"altro", rapportino:"rapporti", rapporti:"rapporti", utenti:"altro", archivio:"altro"};
let modoMese = "agenda";             // "agenda" = solo calendario; "report" = report ore del mese
export let vistaCorrente = "home";
export let ultimaVistaCal = "mese";
export const disegnatori = {};          // vista -> funzione che la ridisegna quando viene mostrata
export function registraVista(nome, disegna){ disegnatori[nome] = disegna; }
export function mostraVista(v){
  if(v === "cal") v = ultimaVistaCal;   // voce "Agenda" dell'operaio: ultima tra giorno, settimana e mese
  if(v === "reportmese"){ v = "mese"; modoMese = "report"; } else if(v === "mese") modoMese = "agenda";
  if(!VISTE.includes(v) || !puo("vista." + v)) v = vistaIniziale();
  const report = v === "mese" && modoMese === "report";
  emetti("vista-cambiata", v);
  vistaCorrente = v;
  const calendario = (v === "calgiorno" || v === "sett" || v === "mese") && !report;
  if(calendario) ultimaVistaCal = v;
  VOCE_NAV.mese = report ? "rapporti" : "agenda";
  document.body.classList.toggle("mese-report", report);
  document.body.classList.toggle("mese-agenda", v === "mese" && !report);
  VISTE.forEach(k=>{
    document.getElementById("vista-" + k).classList.toggle("nascosto", k !== v);
    const barra = document.getElementById("barra-" + k);
    if(barra) barra.classList.toggle("nascosto", k !== v || (k === "mese" && !report));
  });
  const barra = document.getElementById("barra-" + v);
  document.body.classList.toggle("con-barra", !!barra && !barra.classList.contains("vietato") && !barra.classList.contains("nascosto"));
  document.getElementById("cal-testa").classList.toggle("nascosto", !calendario && v !== "interventi");
  document.getElementById("seg-elenco").setAttribute("aria-pressed", v === "interventi");
  document.getElementById("seg-giorno").setAttribute("aria-pressed", v === "calgiorno");
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
