// Invio: condivisione del PDF (Mail/Gmail) e testo via mailto.
import { DESTINATARIO } from "../core/config.js";
import { dataIt } from "../utils/dates.js";
import { datiMese, datiSettimana, testoMese, testoRapporto, testoSettimana } from "../modules/report.js";
import { generaPDF } from "./pdf/giornata.js";
import { generaPDFMese, generaPDFSettimana } from "./pdf/report.js";

export async function condividi(btn, generatore, nome){
  const etichetta = btn.querySelector("span");
  const originale = etichetta.textContent;
  btn.disabled = true;
  etichetta.textContent = "Generazione…";
  try{
    const doc = generatore();
    const blob = doc.output("blob");
    const file = new File([blob], nome, {type:"application/pdf"});
    if (navigator.canShare && navigator.canShare({files:[file]})){
      try{
        await navigator.share({files:[file]});
        return;
      }catch(e){
        if (e && e.name === "AbortError") return;
      }
    }
    doc.save(nome);
    alert("PDF scaricato: allegalo a una mail per " + DESTINATARIO + ".");
  } finally {
    btn.disabled = false;
    etichetta.textContent = originale;
  }
}
export function inviaPDF(btn){
  if(!btn || !btn.querySelector("span")) btn = document.getElementById("btn-pdf-giorno");
  condividi(btn, generaPDF,
    "Rapporto_" + dataIt().replaceAll("/","-") + ".pdf");
}
export function inviaPDFSettimana(){
  const s = datiSettimana();
  condividi(document.getElementById("btn-pdf-sett"), generaPDFSettimana,
    "Report_settimana_" + s.dal.replaceAll("/","-") + ".pdf");
}
export function inviaTesto(){
  window.location.href = "mailto:" + DESTINATARIO +
    "?subject=" + encodeURIComponent("Rapporto di lavoro " + dataIt()) +
    "&body=" + encodeURIComponent(testoRapporto());
}
export function inviaPDFMese(){
  const s = datiMese();
  condividi(document.getElementById("btn-pdf-mese"), generaPDFMese,
    "Report_" + s.etichetta.replaceAll(" ","_") + ".pdf");
}
export function inviaTestoMese(){
  const s = datiMese();
  window.location.href = "mailto:" + DESTINATARIO +
    "?subject=" + encodeURIComponent("Report mensile " + s.etichetta) +
    "&body=" + encodeURIComponent(testoMese());
}
export function inviaTestoSettimana(){
  const s = datiSettimana();
  window.location.href = "mailto:" + DESTINATARIO +
    "?subject=" + encodeURIComponent("Report settimanale " + s.dal + " - " + s.al) +
    "&body=" + encodeURIComponent(testoSettimana());
}
