// PDF: intestazione, piede di pagina e misure della firma comuni a tutti i documenti.
import { LOGO_B64, LOGO_RAPPORTO } from "../../../assets/logo/logo.js";

export function intestazionePDF(doc, titolo){
  const ML = 18, MR = 18, W = 210;
  const larghezzaLogo = 46, altezzaLogo = 46 / LOGO_RAPPORTO;
  try{ doc.addImage(LOGO_B64, "JPEG", ML, 11, larghezzaLogo, altezzaLogo); }catch(e){}
  doc.setTextColor(28,31,35);
  doc.setFont("helvetica","bold");
  doc.setFontSize(14);
  doc.text(titolo, W - MR, 22, {align:"right"});
  doc.setDrawColor(47,161,137);   // verde acqua del logo
  doc.setLineWidth(1.1);
  doc.line(ML, 33, W - MR, 33);
  doc.setDrawColor(140,151,196);  // azzurro lavanda del logo
  doc.setLineWidth(0.5);
  doc.line(ML, 34.6, W - MR, 34.6);
  doc.setTextColor(0,0,0);
  return 43;
}
export function aggiungiPiePagina(doc){
  const totale = doc.getNumberOfPages();
  for(let i = 1; i <= totale; i++){
    doc.setPage(i);
    doc.setFont("helvetica","normal");
    doc.setFontSize(8.5);
    doc.setTextColor(130,135,140);
    doc.text("COMP.HAS assistance SRL", 18, 289);
    doc.text("Pagina " + i + " di " + totale, 210 - 18, 289, {align:"right"});
    doc.setTextColor(0,0,0);
  }
}
// misure della firma nel PDF: proporzioni reali, dentro maxW x maxH (mm)
export function misureFirmaPDF(doc, src, maxW, maxH){
  let w = maxW, h = maxH;
  try{
    const p = doc.getImageProperties(src);
    const s = Math.min(maxW / p.width, maxH / p.height);
    w = p.width * s; h = p.height * s;
  }catch(e){}
  return {w, h};
}
