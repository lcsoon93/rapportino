// PDF dei report settimanale e mensile.
import { dataIt } from "../../utils/dates.js";
import { ORARIO_ORDINARIO } from "../calculations.js";
import { clientiConOre, confrontoAttivo, datiMese, datiSettimana, monteOreMese, oreMeseTesto } from "../../modules/report.js";
import { orePerCliente } from "../../core/preferenze.js";
import { euro, oreTesto, saldoTesto } from "../../utils/formatters.js";
import { aggiungiPiePagina, intestazionePDF } from "./comune.js";

export function generaPDFSettimana(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const ML = 18, MR = 18, W = 210, CW = W - ML - MR;
  const s = datiSettimana();
  const soloCliente = orePerCliente();     // spunta "solo ore per cliente": niente ore dei singoli operai
  const mostraExtra = !soloCliente && document.getElementById("stampa-extra-sett").checked;
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
    doc.text(soloCliente ? "Tecnici e clienti" : "Operai (ore)", colOperai + 2, y);
    doc.text("Totale", colOre + 2, y);
    y += 8;
    doc.setFont("helvetica","normal");
    doc.setFontSize(10.5);
  }
  intestazioneTabella();

  let cEscluse = false;
  s.righe.forEach(r=>{
    if(y > 265){ doc.addPage(); y = 22; intestazioneTabella(); }
    const opTesto = !r.dati ? "—" : soloCliente
      ? ([r.tecnici.join(" / "), clientiConOre(r)].filter(Boolean).join("  —  ") || "—")
      : (r.operai.map(o=>o.nome + " " + oreTesto(o.minuti)).join(" / ") || "—");
    const opRighe = doc.splitTextToSize(opTesto, colOre - colOperai - 4);
    const altezza = Math.max(opRighe.length * 5, 7);
    if(r.escluso) cEscluse = true;
    doc.text(r.nome, colGiorno + 2, y);
    doc.text(dataIt(r.iso) + (r.escluso ? " *" : ""), colData + 2, y);
    doc.text(opRighe, colOperai + 2, y);
    doc.text(r.dati ? oreTesto(soloCliente ? r.sulPosto : r.totGiorno) : "-", colOre + 2, y);
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
  if(!soloCliente) Object.keys(s.operaiTotali).sort().forEach(n=>{
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
  doc.text(oreTesto(soloCliente ? s.totSulPosto : s.totGenerale), W - MR - 3, y + 1, {align:"right"});
  doc.setTextColor(0,0,0);

  aggiungiPiePagina(doc);
  return doc;
}
export function generaPDFMese(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const ML = 18, MR = 18, W = 210, CW = W - ML - MR;
  const s = datiMese();
  // formato unico: una colonna di ore per operaio (ore della giornata) e i clienti con le ore passate da ciascuno
  let y = intestazionePDF(doc, "REPORT MENSILE");

  doc.setFontSize(11);
  doc.text("Mese: " + s.etichetta, ML, y);
  y += 11;

  // per ogni giorno: data e nome del giorno, poi una riga per cliente con la sintesi dell'intervento e il
  // materiale usato (le ore per operaio sono nel riepilogo in fondo)
  const colCliente = 44, colMateriale = 48, colSintesi = CW - colCliente - colMateriale;
  const xCliente = ML, xSintesi = xCliente + colCliente, xMateriale = xSintesi + colSintesi;
  const LH = 4.3;
  function intestazioneTabella(){
    doc.setFillColor(230,231,232);
    doc.rect(ML, y - 5, CW, 8, "F");
    doc.setFont("helvetica","bold");
    doc.setFontSize(9.5);
    doc.text("Cliente", xCliente + 1.5, y);
    doc.text("Intervento", xSintesi + 1.5, y);
    doc.text("Materiale utilizzato", xMateriale + 1.5, y);
    y += 8;
    doc.setFont("helvetica","normal");
  }
  intestazioneTabella();

  if(s.righe.length === 0){
    doc.setFontSize(9.5);
    doc.text("Nessun lavoro in questo mese.", ML + 2, y);
    y += 8;
  }
  let cEscluse = false;
  s.righe.forEach(r=>{
    if(r.escluso) cEscluse = true;
    doc.setFontSize(9.5);
    const lavori = r.lavori.map(l=>{
      const cli = doc.splitTextToSize(l.cliente || "—", colCliente - 3);
      const sin = doc.splitTextToSize(l.sintesi || "—", colSintesi - 3);
      const mat = doc.splitTextToSize(l.materiali.length ? l.materiali.map(m=>m.q ? m.a + " (" + m.q + ")" : m.a).join(", ") : "—", colMateriale - 3);
      return { cli, sin, mat, h: Math.max(cli.length, sin.length, mat.length) * LH + 2.5 };
    });
    // la riga del giorno non resta sola in fondo alla pagina
    if(y + 7 + (lavori[0] ? lavori[0].h : 0) > 275){ doc.addPage(); y = 22; intestazioneTabella(); }
    doc.setFillColor(243,244,246);
    doc.rect(ML, y - 4.2, CW, 6.2, "F");
    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.text(dataIt(r.iso) + " " + r.nomeEsteso + (r.escluso ? " *" : ""), ML + 1.5, y);
    doc.setFont("helvetica","normal");
    y += 6.5;
    doc.setFontSize(9.5);
    lavori.forEach(l=>{
      if(y + l.h > 280){ doc.addPage(); y = 22; intestazioneTabella(); }
      doc.setFont("helvetica","bold");
      doc.text(l.cli, xCliente + 1.5, y);
      doc.setFont("helvetica","normal");
      doc.text(l.sin, xSintesi + 1.5, y);
      doc.text(l.mat, xMateriale + 1.5, y);
      y += l.h;
      doc.setDrawColor(215,219,223);
      doc.setLineWidth(0.15);
      doc.line(ML, y - 3.6, W - MR, y - 3.6);
    });
    y += 2;
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
  if(s.giorniLavorati - s.giorniConteggiati > 0){
    doc.text("di cui esclusi dal monte ore", ML + 2, y);
    doc.text(String(s.giorniLavorati - s.giorniConteggiati), W - MR - 3, y, {align:"right"});
    y += 6;
  }
  if(confrontoAttivo()){
    doc.text("Monte ore del mese (" + monteOreMese().giorni + " giorni lavorativi x 9 ore)", ML + 2, y);
    doc.text(oreTesto(monteOreMese().minuti), W - MR - 3, y, {align:"right"});
    y += 6;
  }
  Object.keys(s.operaiTotali).sort().forEach(n=>{
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
