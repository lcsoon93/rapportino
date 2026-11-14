// PDF della pagina di ricerca (search.html), stile comune COMP.HAS:
// - scheda di una voce (rapportino o scheda del foglio giornaliero), con gli intervalli orari (non il totale ore);
// - riepilogo dei materiali delle voci selezionate.
import { COLORI, aggiungiPiePagina, intestazionePDF, stileTesto, titoloSezione, etichetteStato } from "./comune.js";
import { dataItaliana } from "../ricerca-logica.js";

const ML = 18, LARG = 174, FONDO = 276;
function nuovoDoc(){ return new window.jspdf.jsPDF({ unit: "mm", format: "a4" }); }
function spazio(doc, y, serve){
  if(y + serve <= FONDO) return y;
  doc.addPage();
  return 20;
}
// testo a capo nella larghezza indicata; restituisce la quota successiva
function paragrafo(doc, testo, x, y, larg, dim = 10){
  stileTesto(doc, dim);
  doc.splitTextToSize(String(testo || "-"), larg).forEach(r=>{ y = spazio(doc, y, 5); doc.text(r, x, y); y += 4.8; });
  return y;
}
function campo(doc, etichetta, valore, x, y, larg){
  stileTesto(doc, 7.5, "bold", COLORI.grigio);
  doc.text(etichetta.toUpperCase(), x, y);
  stileTesto(doc, 10);
  const r = doc.splitTextToSize(String(valore || "-"), larg);
  doc.text(r, x, y + 5);
  return y + 5 + r.length * 4.6;
}
function materiali(doc, elenco, y){
  if(!elenco.length){ stileTesto(doc, 9.5, "italic", COLORI.grigio); doc.text("Nessun materiale segnato", ML + 2, y); return y + 6; }
  elenco.forEach(m=>{
    y = spazio(doc, y, 6);
    stileTesto(doc, 10);
    const r = doc.splitTextToSize(m.a, LARG - 40);
    doc.text(r, ML + 2, y);
    if(m.q){ stileTesto(doc, 10, "bold"); doc.text(m.q, ML + LARG, y, { align: "right" }); }
    y += r.length * 4.6 + 1.4;
  });
  return y;
}

export function pdfVoce(v){
  const doc = nuovoDoc();
  let y = intestazionePDF(doc, v.fonte === "foglio" ? "SCHEDA FOGLIO GIORNALIERO" : "RAPPORTINO DI INTERVENTO",
    { data: dataItaliana(v.data), extra: v.fonte === "foglio" ? "" : (v.stato === "completato" ? "Completato" : "Bozza") });
  stileTesto(doc, 14, "bold", COLORI.blu);
  const nome = doc.splitTextToSize(v.cliente || "(senza nome)", LARG - 30);
  doc.text(nome, ML, y);
  if(v.urgente) etichetteStato(doc, ["URGENTE"], ML + LARG, y);
  y += nome.length * 6;
  if(v.indirizzo || v.telefono){ stileTesto(doc, 9.5, "normal", COLORI.grigio); doc.text([v.indirizzo, v.telefono].filter(Boolean).join("  ·  "), ML, y); y += 7; }
  y += 2;
  const ya = campo(doc, "Tipologia", v.tipologia, ML, y, 80);
  const yb = campo(doc, "Operai", v.operai.map(o=>o.dalle && o.alle ? o.nome + " (" + o.dalle + "-" + o.alle + ")" : o.nome).join(", "), ML + 90, y, 84);
  y = Math.max(ya, yb) + 4;
  if(v.descrizioneIntervento){ y = titoloSezione(doc, "Richiesta", ML, y, LARG); y = paragrafo(doc, v.descrizioneIntervento, ML, y, LARG) + 3; }
  y = titoloSezione(doc, "Lavoro eseguito", ML, spazio(doc, y, 14), LARG);
  y = paragrafo(doc, v.lavoro, ML, y, LARG) + 3;
  y = titoloSezione(doc, "Materiale utilizzato", ML, spazio(doc, y, 14), LARG);
  y = materiali(doc, v.materiali, y) + 3;
  if(v.note){ y = titoloSezione(doc, "Note", ML, spazio(doc, y, 14), LARG); y = paragrafo(doc, v.note, ML, y, LARG) + 3; }
  if(v.esito || v.firmatario){
    y = spazio(doc, y, 14);
    const y1 = campo(doc, "Esito", v.esito, ML, y, 80);
    const y2 = campo(doc, "Firmatario", v.firmatario, ML + 90, y, 84);
    y = Math.max(y1, y2);
  }
  aggiungiPiePagina(doc, v.cliente);
  return doc;
}

export function pdfMateriali(voci, titoloPeriodo){
  const doc = nuovoDoc();
  let y = intestazionePDF(doc, "MATERIALI UTILIZZATI", { extra: titoloPeriodo || "" });
  voci.forEach(v=>{
    y = spazio(doc, y, 16);
    stileTesto(doc, 10.5, "bold", COLORI.blu);
    doc.text(dataItaliana(v.data) + "  ·  " + (v.cliente || "(senza nome)"), ML, y);
    y += 1.8;
    doc.setDrawColor(COLORI.linea[0], COLORI.linea[1], COLORI.linea[2]); doc.setLineWidth(0.3); doc.line(ML, y, ML + LARG, y);
    y = materiali(doc, v.materiali, y + 5.5) + 4;
  });
  aggiungiPiePagina(doc, titoloPeriodo || "");
  return doc;
}
