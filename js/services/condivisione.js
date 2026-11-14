// Invio: condivisione del PDF (Mail/Gmail) e testo via mailto. Sul computer il PDF si apre nella
// finestra di stampa del browser (da li' anche "Salva come PDF").
import { DESTINATARIO } from "../core/config.js";
import { dataIt } from "../utils/dates.js";
import { datiMese, datiSettimana, testoMese, testoRapporto, testoSettimana } from "../modules/report.js";
import { generaPDF } from "./pdf/giornata.js";
import { sulComputer } from "../utils/dispositivo.js";

// Stampa sul computer: il PDF in una cornice nascosta e la finestra di stampa del browser.
// Safari (macOS) non stampa bene un PDF in una cornice: lo apre in una nuova scheda (Cmd+P).
// Se il browser blocca anche quella, si scarica il file.
export function stampaPDF(doc, nome){
  const url = URL.createObjectURL(doc.output("blob"));
  const safari = /^((?!chrome|chromium|crios|edg|firefox|fxios).)*safari/i.test(navigator.userAgent);
  const libera = ()=>setTimeout(()=>URL.revokeObjectURL(url), 120000);
  if(safari){
    const w = window.open(url, "_blank");
    if(!w) doc.save(nome);
    libera();
    return "scheda";
  }
  const f = document.createElement("iframe");
  f.className = "cornice-stampa";
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  f.onload = ()=>{
    try{ f.contentWindow.focus(); f.contentWindow.print(); }
    catch(e){ if(!window.open(url, "_blank")) doc.save(nome); }
    setTimeout(()=>{ f.remove(); URL.revokeObjectURL(url); }, 120000);
  };
  f.src = url;
  document.body.appendChild(f);
  return "stampa";
}
import { generaPDFMese, generaPDFSettimana } from "./pdf/report.js";

export async function condividi(btn, generatore, nome){
  const etichetta = btn.querySelector("span");
  const originale = etichetta.textContent;
  btn.disabled = true;
  etichetta.textContent = sulComputer() ? "Preparazione stampa…" : "Generazione…";
  try{
    const doc = generatore();
    if(sulComputer()){ stampaPDF(doc, nome); return; }
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
