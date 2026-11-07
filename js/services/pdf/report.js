// PDF dei report settimanale e mensile.
import { dataIt } from "../../utils/dates.js";
import { ORARIO_ORDINARIO } from "../calculations.js";
import { confrontoAttivo, datiMese, datiSettimana, monteOreMese, oreMeseNascoste, oreMeseTesto } from "../../modules/report.js";
import { euro, oreTesto, saldoTesto } from "../../utils/formatters.js";
import { aggiungiPiePagina, intestazionePDF } from "./comune.js";

export function generaPDFSettimana(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const ML = 18, MR = 18, W = 210, CW = W - ML - MR;
  const s = datiSettimana();
  const mostraExtra = document.getElementById("stampa-extra-sett").checked;
  let y = intestazionePDF(doc, "REPORT SETTIMANALE");

  doc.setFontSize(11);
  doc.text("Settimana: " + s.dal + " - " + s.al, ML, y);
  y += 11;

  const colGiorno = ML, colData = ML + 22, colOperai = ML + 50, colOre = W - MR - 25;
  function intestazioneTabella(){
    doc.setFillColor(230,231,232);
    doc.rect(ML, y - 5, CW, 8, "F");
    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.text("Giorno", colGiorno + 2, y);
    doc.text("Data", colData + 2, y);
    doc.text("Operai (ore)", colOperai + 2, y);
    doc.text("Totale", colOre + 2, y);
    y += 8;
    doc.setFont("helvetica","normal");
    doc.setFontSize(10.5);
  }
  intestazioneTabella();

  let cEscluse = false;
  s.righe.forEach(r=>{
    if(y > 265){ doc.addPage(); y = 22; intestazioneTabella(); }
    const opTesto = r.dati ? (r.operai.map(o=>o.nome + " " + oreTesto(o.minuti)).join(" / ") || "—") : "—";
    const opRighe = doc.splitTextToSize(opTesto, colOre - colOperai - 4);
    const altezza = Math.max(opRighe.length * 5, 7);
    if(r.escluso) cEscluse = true;
    doc.text(r.nome, colGiorno + 2, y);
    doc.text(dataIt(r.iso) + (r.escluso ? " *" : ""), colData + 2, y);
    doc.text(opRighe, colOperai + 2, y);
    doc.text(r.dati ? oreTesto(r.totGiorno) : "-", colOre + 2, y);
    y += altezza + 2.5;
    doc.setDrawColor(200,205,210);
    doc.setLineWidth(0.2);
    doc.line(ML, y - 4.5, W - MR, y - 4.5);
  });

  if(cEscluse){
    doc.setFontSize(8.5);
    doc.setTextColor(130,135,140);
    doc.text("* giornata esclusa dal monte ore", ML, y + 2);
    doc.setTextColor(0,0,0);
    y += 8;
  }

  y += 5;
  doc.setFont("helvetica","normal");
  doc.setFontSize(10.5);
  doc.text("Giorni lavorati", ML + 2, y);
  doc.text(String(s.giorniLavorati), W - MR - 3, y, {align:"right"});
  y += 6;
  Object.keys(s.operaiTotali).sort().forEach(n=>{
    const info = s.operaiTotali[n];
    const saldo = info.minuti - (info.giorni * ORARIO_ORDINARIO);
    doc.text(n + " (" + info.giorni + " g.)", ML + 2, y);
    doc.text(oreTesto(info.minuti) + (mostraExtra && saldo ? "  " + saldoTesto(saldo) : ""), W - MR - 3, y, {align:"right"});
    y += 6;
  });
  y += 3;

  doc.setFillColor(47,161,137);
  doc.rect(ML, y - 5.5, CW, 10, "F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold");
  doc.setFontSize(12);
  doc.text("TOTALE", ML + 3, y + 1);
  doc.text(oreTesto(s.totGenerale), W - MR - 3, y + 1, {align:"right"});
  doc.setTextColor(0,0,0);

  aggiungiPiePagina(doc);
  return doc;
}
export function generaPDFMese(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const ML = 18, MR = 18, W = 210, CW = W - ML - MR;
  const s = datiMese();
  const mostraExtra = document.getElementById("stampa-extra-mese").checked;
  let y = intestazionePDF(doc, "REPORT MENSILE");

  doc.setFontSize(11);
  doc.text("Mese: " + s.etichetta, ML, y);
  y += 11;

  // elenco operai comparsi nel mese (anche nei giorni esclusi dal monte ore): una colonna ciascuno
  const nomiOperai = [];
  s.righe.forEach(r=>{
    (r.operai || []).forEach(o=>{ if(!nomiOperai.includes(o.nome)) nomiOperai.push(o.nome); });
  });
  nomiOperai.sort();

  const colGiorno = 13, colData = 20;
  let colOperaio = 32, colClienti = CW - colGiorno - colData - colOperaio * nomiOperai.length;
  if(colClienti < 42){
    colClienti = 42;
    colOperaio = (CW - colGiorno - colData - colClienti) / Math.max(1, nomiOperai.length);
  }
  const xGiorno = ML, xData = xGiorno + colGiorno, xOperai = xData + colData,
        xClienti = xOperai + colOperaio * nomiOperai.length;

  function intestazioneTabella(){
    doc.setFillColor(230,231,232);
    doc.rect(ML, y - 5, CW, 8, "F");
    doc.setFont("helvetica","bold");
    doc.setFontSize(9.5);
    doc.text("Giorno", xGiorno + 1.5, y);
    doc.text("Data", xData + 1.5, y);
    nomiOperai.forEach((n,i)=>{
      const righeNome = doc.splitTextToSize(n, colOperaio - 3);
      doc.text(righeNome[0], xOperai + i * colOperaio + 1.5, y);
    });
    doc.text("Clienti", xClienti + 1.5, y);
    y += 8;
    doc.setFont("helvetica","normal");
    doc.setFontSize(9.5);
  }
  intestazioneTabella();

  if(s.righe.length === 0){
    doc.text("Nessun rapporto in questo mese.", ML + 2, y);
    y += 8;
  }
  let cEscluse = false;
  s.righe.forEach(r=>{
    if(y > 262){ doc.addPage(); y = 22; intestazioneTabella(); }
    if(r.escluso) cEscluse = true;
    const clientiRighe = doc.splitTextToSize(r.clienti || "—", colClienti - 3);
    const altezza = Math.max(clientiRighe.length * 5, 7);

    doc.text(r.nome, xGiorno + 1.5, y);
    doc.text(dataIt(r.iso) + (r.escluso ? " *" : ""), xData + 1.5, y);
    nomiOperai.forEach((n,i)=>{
      const op = r.operai.find(o=>o.nome === n);
      doc.text(op ? oreTesto(op.minuti) : "-", xOperai + i * colOperaio + 1.5, y);
    });
    doc.text(clientiRighe, xClienti + 1.5, y);

    y += altezza + 2.5;
    doc.setDrawColor(200,205,210);
    doc.setLineWidth(0.2);
    doc.line(ML, y - 4.5, W - MR, y - 4.5);
  });

  if(cEscluse){
    if(y > 260){ doc.addPage(); y = 22; }
    doc.setFontSize(8.5);
    doc.setTextColor(130,135,140);
    doc.text("* giornata esclusa dal monte ore", ML, y + 2);
    doc.setTextColor(0,0,0);
    y += 8;
  }

  if(y > 235){ doc.addPage(); y = 22; }
  y += 5;
  doc.setFont("helvetica","normal");
  doc.setFontSize(10.5);
  doc.text("Giorni lavorati", ML + 2, y);
  doc.text(String(s.giorniLavorati), W - MR - 3, y, {align:"right"});
  y += 6;
  const mostraOre = !oreMeseNascoste();
  if(mostraOre && confrontoAttivo()){
    doc.text("Monte ore del mese (" + monteOreMese().giorni + " giorni lavorativi x 9 ore)", ML + 2, y);
    doc.text(oreTesto(monteOreMese().minuti), W - MR - 3, y, {align:"right"});
    y += 6;
  }
  if(mostraOre) Object.keys(s.operaiTotali).sort().forEach(n=>{
    const info = s.operaiTotali[n];
    doc.text(n + " (" + info.giorni + " g.)", ML + 2, y);
    doc.text(oreMeseTesto(info), W - MR - 3, y, {align:"right"});
    y += 6;
    if(confrontoAttivo()){
      const dd = info.minuti - monteOreMese().minuti;
      doc.setFontSize(9.5);
      doc.text("Confronto con monte ore (" + oreTesto(monteOreMese().minuti) + "): " + oreTesto(info.minuti) + " lavorate", ML + 6, y);
      doc.text(dd === 0 ? "pari" : saldoTesto(dd), W - MR - 3, y, {align:"right"});
      doc.setFontSize(10.5);
      y += 6;
    }
  });
  if(s.totSpese){
    doc.text("Spese anticipate", ML + 2, y);
    doc.text(euro(s.totSpese), W - MR - 3, y, {align:"right"});
    y += 6;
  }

  aggiungiPiePagina(doc);
  return doc;
}
