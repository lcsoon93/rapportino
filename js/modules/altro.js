// Sezione Altro: collegamenti alle sezioni e informazioni sull'archivio.
import { DESTINATARIO, SINC_ATTIVA } from "../core/config.js";
import { leggiDB } from "../core/storage.js";
import { mostraVista, registraVista } from "../core/navigation.js";
import { aggiornaTestiData } from "./rapportini.js";

export function vaiASezione(cls){
  mostraVista("giorno");
  const el = document.querySelector("#vista-giorno ." + cls);
  if(el) el.scrollIntoView({block:"start"});
}
export function aggiornaAltro(){
  aggiornaTestiData();
  const n = Object.keys(leggiDB()).length;
  document.getElementById("info-giorni").textContent = n;
  document.getElementById("info-sinc").textContent = SINC_ATTIVA() ? (navigator.onLine === false ? "Attiva (offline)" : "Attiva") : "Non configurata";
  document.getElementById("info-mail").textContent = DESTINATARIO;
}

registraVista("altro", aggiornaAltro);
