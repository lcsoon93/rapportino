// PDF: elementi comuni a tutti i documenti (stile COMP.HAS): colori, intestazione, intestazione
// compatta delle pagine successive, filigrana, titoli di sezione, etichette di stato, piede di pagina,
// misure della firma. Carattere: Helvetica (incluso in jsPDF, nessun font esterno).
import { LOGO_B64, LOGO_RAPPORTO } from "../../../assets/logo/logo.js";

export const COLORI = {
  blu:        [27, 54, 93],     // colore principale: titoli, numeri, linee di intestazione
  testo:      [33, 37, 41],
  grigio:     [108, 117, 125],  // testi secondari ed etichette
  linea:      [222, 226, 230],  // separatori
  sfondo:     [244, 246, 248],  // riquadri e intestazioni di tabella
  rosso:      [168, 52, 40],
  rossoSfondo:[251, 236, 234],
};
const ML = 18, MR = 18, W = 210;

export function coloreTesto(doc, c){ doc.setTextColor(c[0], c[1], c[2]); }
export function coloreRiempimento(doc, c){ doc.setFillColor(c[0], c[1], c[2]); }
export function coloreLinea(doc, c){ doc.setDrawColor(c[0], c[1], c[2]); }
export function stileTesto(doc, dim, peso, colore){
  doc.setFont("helvetica", peso || "normal");
  doc.setFontSize(dim);
  coloreTesto(doc, colore || COLORI.testo);
}
// riga "N. RIF  ·  Data gg/mm/aaaa" sotto il titolo
function testoRiferimento(info){
  if(!info) return "";
  return [info.riferimento ? "N. " + info.riferimento : "", info.data ? "Data " + info.data : "", info.extra || ""].filter(Boolean).join("   ·   ");
}

// intestazione della prima pagina: logo contenuto a sinistra, titolo e numero/data a destra, filo blu.
// info facoltativo: { riferimento, data, extra }. Restituisce la quota da cui iniziare (43 mm).
export function intestazionePDF(doc, titolo, info){
  const larg = 38, alt = larg / LOGO_RAPPORTO;
  try{ doc.addImage(LOGO_B64, "JPEG", ML, 11, larg, alt); }catch(e){}
  stileTesto(doc, 15, "bold", COLORI.blu);
  doc.text(titolo, W - MR, info ? 19.5 : 22, {align:"right"});
  const rif = testoRiferimento(info);
  if(rif){
    stileTesto(doc, 9, "normal", COLORI.grigio);
    doc.text(rif, W - MR, 25.5, {align:"right"});
  }
  coloreLinea(doc, COLORI.blu);
  doc.setLineWidth(0.6);
  doc.line(ML, 32.5, W - MR, 32.5);
  stileTesto(doc, 10);
  return 43;
}
// intestazione compatta delle pagine successive (anche dentro una mezza pagina: x0..x1, yTop).
// Restituisce la quota sotto il filo.
export function intestazioneCompatta(doc, titolo, info, x0 = ML, x1 = W - MR, yTop = 10){
  const larg = 22, alt = larg / LOGO_RAPPORTO;
  try{ doc.addImage(LOGO_B64, "JPEG", x0, yTop, larg, alt); }catch(e){}
  stileTesto(doc, 10.5, "bold", COLORI.blu);
  doc.text(titolo, x1, yTop + 4.2, {align:"right"});
  const rif = testoRiferimento(info);
  if(rif){
    stileTesto(doc, 7.8, "normal", COLORI.grigio);
    doc.text(rif, x1, yTop + 8.4, {align:"right"});
  }
  const yl = yTop + Math.max(alt, 9.5) + 1.8;
  coloreLinea(doc, COLORI.blu);
  doc.setLineWidth(0.4);
  doc.line(x0, yl, x1, yl);
  stileTesto(doc, 10);
  return yl;
}
// filigrana: logo centrato in (cx, cy), molto tenue (4%), disegnato PRIMA dei contenuti cosi' resta
// sullo sfondo. Se la versione di jsPDF non gestisce la trasparenza, la filigrana non si disegna.
export function filigranaPDF(doc, cx, cy, larg){
  if(typeof doc.GState !== "function" || typeof doc.setGState !== "function") return;
  const alt = larg / LOGO_RAPPORTO;
  try{
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.04 }));
    doc.addImage(LOGO_B64, "JPEG", cx - larg / 2, cy - alt / 2, larg, alt);
  }catch(e){}
  finally{ try{ doc.restoreGraphicsState(); }catch(e){} }
}
// titolo di sezione: maiuscolo, blu, con un filo grigio chiaro sotto. Restituisce la quota successiva.
export function titoloSezione(doc, testo, x, y, larg, dim = 10){
  stileTesto(doc, dim, "bold", COLORI.blu);
  doc.text(testo.toUpperCase(), x, y, {charSpace: 0.35});
  coloreLinea(doc, COLORI.linea);
  doc.setLineWidth(0.3);
  doc.line(x, y + 2, x + larg, y + 2);
  stileTesto(doc, 10);
  return y + 8;
}
// sottotitolo dentro una sezione (Attivita' svolte, Materiali, Fotografie, Note, Firma)
export function sottotitolo(doc, testo, x, y, dim = 7.8){
  stileTesto(doc, dim, "bold", COLORI.blu);
  doc.text(testo.toUpperCase(), x, y, {charSpace: 0.3});
  stileTesto(doc, 10);
}
// etichetta di stato (URGENZA, DA ULTIMARE) allineata a destra in xDestra: rettangolo arrotondato
// rosso chiaro con testo rosso. Restituisce la larghezza occupata.
export function etichetteStato(doc, testi, xDestra, yBase, dim = 7.2){
  let x = xDestra, tot = 0;
  [...testi].reverse().forEach(t=>{
    stileTesto(doc, dim, "bold", COLORI.rosso);
    const w = doc.getTextWidth(t) + 4;
    x -= w;
    coloreRiempimento(doc, COLORI.rossoSfondo);
    doc.roundedRect(x, yBase - 3.4, w, 4.8, 1.2, 1.2, "F");
    doc.text(t, x + 2, yBase);
    x -= 1.5; tot += w + 1.5;
  });
  stileTesto(doc, 10);
  return tot;
}
// piede di pagina su tutte le pagine: filo grigio, azienda, riferimento al centro, "Pagina x di N"
export function aggiungiPiePagina(doc, centro){
  const totale = doc.getNumberOfPages();
  for(let i = 1; i <= totale; i++){
    doc.setPage(i);
    coloreLinea(doc, COLORI.linea);
    doc.setLineWidth(0.3);
    doc.line(ML, 284, W - MR, 284);
    stileTesto(doc, 7.8, "normal", COLORI.grigio);
    doc.text("COMP.HAS assistance SRL", ML, 289);
    if(centro) doc.text(centro, W / 2, 289, {align:"center"});
    doc.text("Pagina " + i + " di " + totale, W - MR, 289, {align:"right"});
  }
  stileTesto(doc, 10);
}
// righe di dati separati da " · " (indirizzo, tipologia, "Fatturare a"...): si va a capo solo tra un dato
// e l'altro, cosi' una riga non comincia mai con il separatore; un dato troppo lungo va a capo da solo.
// Usa il carattere gia' impostato su doc.
export function righeConSeparatori(doc, parti, separatore, larghezza){
  const righe = [];
  let corrente = "";
  parti.filter(Boolean).forEach(p=>{
    const prova = corrente ? corrente + separatore + p : p;
    if(doc.getTextWidth(prova) <= larghezza){ corrente = prova; return; }
    if(corrente) righe.push(corrente);
    const pezzi = doc.splitTextToSize(p, larghezza);
    corrente = pezzi.pop();
    righe.push(...pezzi);
  });
  if(corrente) righe.push(corrente);
  return righe;
}
// riferimento leggibile del documento: quello passato (es. il rapportino) oppure "RG-AAAAMMGG"
// dalla data della giornata (gg/mm/aaaa)
export function riferimentoGiornata(dataItaliana){
  const p = String(dataItaliana || "").split("/");
  return p.length === 3 ? "RG-" + p[2] + p[1] + p[0] : "RG";
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
