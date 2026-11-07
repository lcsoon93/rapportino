// PDF della giornata: per cliente (mezze pagine A5) o a foglio unico.
import { LOGO_B64, LOGO_RAPPORTO } from "../../../assets/logo/logo.js";
import { dataIt } from "../../utils/dates.js";
import { totaleImporti, totaleSpese } from "../calculations.js";
import { rigaOrarioCliente, testoMateriale } from "../../modules/report.js";
import { contoOreOperaio } from "../../core/preferenze.js";
import { euro } from "../../utils/formatters.js";
import { datiGiornata } from "../../modules/rapportini.js";
import { aggiungiPiePagina, intestazionePDF, misureFirmaPDF } from "./comune.js";

export function generaPDFPerCliente(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const W = 210, H = 297, META = H / 2;         // meta' pagina = altezza di una "scheda" A5
  const ML = 14, MR = 14, CW = W - ML - MR;
  const MARGINE_EST = 14, MARGINE_INT = 7;        // margine dal bordo pagina / dalla linea di taglio
  const d = datiGiornata();

  let unita = -1;         // indice progressivo di meta-pagina: 0=alto pag.1, 1=basso pag.1, 2=alto pag.2, ...
  let yLimiteCorrente = 0;

  function disegnaLineaTaglio(){
    doc.setDrawColor(190,190,190);
    doc.setLineWidth(0.3);
    if(doc.setLineDashPattern) doc.setLineDashPattern([2,1.5], 0);
    doc.line(6, META, W - 6, META);
    if(doc.setLineDashPattern) doc.setLineDashPattern([], 0);
    doc.setFont("helvetica","normal");
    doc.setFontSize(7);
    doc.setTextColor(170,170,170);
    doc.text("✂  taglia qui", W / 2, META - 1.3, {align:"center"});
    doc.setTextColor(0,0,0);
  }

  // passa alla meta-pagina successiva (crea una nuova pagina A4 solo quando serve una nuova "meta alta")
  function vaiAUnitaSuccessiva(){
    unita++;
    let yBase;
    if(unita % 2 === 0){
      if(unita > 0) doc.addPage("a4", "portrait");
      yBase = MARGINE_EST;
      yLimiteCorrente = META - MARGINE_INT;
    } else {
      disegnaLineaTaglio();
      yBase = META + MARGINE_INT;
      yLimiteCorrente = H - MARGINE_EST;
    }
    return yBase;
  }

  // intestazione compatta + mini piè di pagina fissati ai bordi della meta-pagina corrente
  function intestazioneSlot(yBase, indice, totale){
    const largLogo = 20, altLogo = 20 / LOGO_RAPPORTO;
    try{ doc.addImage(LOGO_B64, "JPEG", ML, yBase, largLogo, altLogo); }catch(e){}
    doc.setTextColor(28,31,35);
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    doc.text("RAPPORTO DI LAVORO", W - MR, yBase + 5, {align:"right"});
    if(totale > 1){
      doc.setFont("helvetica","normal");
      doc.setFontSize(7.5);
      doc.setTextColor(120,125,130);
      doc.text("Cliente " + indice + " di " + totale, W - MR, yBase + 9.5, {align:"right"});
    }
    doc.setTextColor(0,0,0);
    let yy = yBase + Math.max(altLogo, 10.5) + 2;
    doc.setDrawColor(47,161,137);
    doc.setLineWidth(0.8);
    doc.line(ML, yy, W - MR, yy);
    doc.setDrawColor(140,151,196);
    doc.setLineWidth(0.35);
    doc.line(ML, yy + 1.2, W - MR, yy + 1.2);

    doc.setFont("helvetica","normal");
    doc.setFontSize(7);
    doc.setTextColor(170,170,170);
    doc.text("COMP.HAS assistance SRL", ML, yLimiteCorrente + 4.5);
    doc.setTextColor(0,0,0);

    return yy + 6;
  }

  if(d.clienti.length === 0){
    const yBase = vaiAUnitaSuccessiva();
    let y = intestazioneSlot(yBase, 1, 1);
    doc.setFont("helvetica","normal");
    doc.setFontSize(10.5);
    doc.text("Data: " + dataIt(), ML, y);
    y += 7;
    doc.text("Nessun lavoro cliente registrato per questo giorno.", ML, y);
    return doc;
  }

  const orarioTesto = d.operai.length
    ? d.operai.map(op => op.nome + " " + (op.dalle || "—") + "-" + (op.alle || "—") +
                          contoOreOperaio(op, " ")).join("   ·   ")
    : "";

  d.clienti.forEach((c, indiceCliente)=>{
    let yBase = vaiAUnitaSuccessiva();
    let y = intestazioneSlot(yBase, indiceCliente + 1, d.clienti.length);

    function serveNuovoSlot(spazio){
      if(y + spazio > yLimiteCorrente){
        yBase = vaiAUnitaSuccessiva();
        y = intestazioneSlot(yBase, indiceCliente + 1, d.clienti.length);
        // la scheda continua su un'altra meta' pagina: ripeto di quale cliente si tratta
        doc.setFont("helvetica","bold");
        doc.setFontSize(9.5);
        doc.text(c.nome + "  (segue)", ML, y);
        y += 6;
      }
    }

    doc.setFont("helvetica","normal");
    doc.setFontSize(9.5);
    const infoRighe = doc.splitTextToSize(
      "Data: " + dataIt() + (d.tecnici ? "   ·   Tecnici: " + d.tecnici : ""), CW
    );
    doc.text(infoRighe, ML, y);
    y += infoRighe.length * 4.5 + 1;

    // l'orario degli operai compare solo se per questo cliente e' indicata almeno una fascia oraria
    const haOrarioCliente = (c.fasce && c.fasce.some(f=>f.d || f.a)) || c.dalle || c.alle;
    if(orarioTesto && haOrarioCliente){
      doc.setFontSize(8.5);
      doc.setTextColor(90,96,104);
      const orarioRighe = doc.splitTextToSize("Orario: " + orarioTesto, CW);
      serveNuovoSlot(orarioRighe.length * 4.2 + 3);
      doc.text(orarioRighe, ML, y);
      doc.setTextColor(0,0,0);
      y += orarioRighe.length * 4.2 + 3;
    } else {
      y += 2;
    }

    doc.setFont("helvetica","bold");
    doc.setFontSize(11.5);
    let xNome = ML;
    if(c.urgente){
      doc.setFillColor(253,240,239);
      doc.rect(ML - 2, y - 4.5, CW + 4, 7.5, "F");
      doc.setFillColor(179,65,58);
      doc.rect(ML - 2, y - 4.5, 2.5, 7.5, "F");
      doc.setTextColor(179,65,58);
      doc.setFontSize(8.5);
      doc.text("URGENZA", ML + 2, y);
      xNome = ML + 21;
      doc.setTextColor(0,0,0);
      doc.setFontSize(11.5);
    }
    const largNome = CW - (xNome - ML) - (c.stato === "Da ultimare" ? 26 : 0);
    const nomeRighe = doc.splitTextToSize(c.nome + rigaOrarioCliente(c), Math.max(largNome, 30));
    doc.text(nomeRighe, xNome, y);
    if(c.stato === "Da ultimare"){
      doc.setTextColor(179,65,58);
      doc.setFontSize(8.5);
      doc.text("DA ULTIMARE", W - MR, y, {align:"right"});
      doc.setTextColor(0,0,0);
      doc.setFontSize(11.5);
    }
    y += nomeRighe.length * 5.2 + 1.5;

    const meta = [];
    if(c.indirizzo) meta.push(c.indirizzo);
    if(c.tipologia) meta.push("Tipologia: " + c.tipologia);
    if(c.fatturare) meta.push("Fatturare a: " + c.fatturare);
    if(meta.length){
      doc.setFont("helvetica","italic");
      doc.setFontSize(8.5);
      doc.setTextColor(90,96,104);
      const righeMeta = doc.splitTextToSize(meta.join("   ·   "), CW - 2);
      serveNuovoSlot(righeMeta.length * 4.2 + 3);
      doc.text(righeMeta, ML + 2, y);
      doc.setTextColor(0,0,0);
      y += righeMeta.length * 4.2 + 2.5;
    }

    if(c.dettagli){
      doc.setFont("helvetica","normal");
      doc.setFontSize(9.5);
      const righe = doc.splitTextToSize(c.dettagli, CW - 2);
      serveNuovoSlot(righe.length * 4.6 + 3);
      doc.text(righe, ML + 2, y);
      y += righe.length * 4.6 + 3;
    }

    if(c.materiali && c.materiali.length){
      doc.setFont("helvetica","bold");
      doc.setFontSize(9);
      serveNuovoSlot(6 + c.materiali.length * 4.3);
      doc.text("Materiale:", ML + 2, y);
      y += 4.3;
      doc.setFont("helvetica","normal");
      doc.setFontSize(9);
      c.materiali.forEach(m=>{
        const righeM = doc.splitTextToSize("- " + testoMateriale(m), CW - 8);
        serveNuovoSlot(righeM.length * 4.3 + 1);
        doc.text(righeM, ML + 6, y);
        y += righeM.length * 4.3;
      });
      y += 1.5;
    }

    if(c.importo){
      serveNuovoSlot(8);
      doc.setFont("helvetica","bold");
      doc.setFontSize(9.5);
      doc.text("Da fatturare:", ML + 2, y);
      doc.text(euro(c.importo), ML + 32, y);
      doc.setFont("helvetica","normal");
      y += 6.5;
    }

    // altezza minima ancora leggibile di una foto/scontrino quando lo spazio nella scheda e' poco
    const ALTEZZA_MIN_IMG = 32;

    // griglia di immagini (2 per riga, proporzioni reali): usata sia per le foto sia per gli scontrini
    // spazio per la firma: va tenuta nella stessa scheda dell'ultima riga di foto
    const FIRMA_MAX_W = 70, FIRMA_MAX_H = 24;
    const ALTEZZA_FIRMA = c.firma ? FIRMA_MAX_H + (c.firmatario ? 9 : 5) : 0;

    function disegnaGriglia(titolo, immagini, riserva){
      riserva = riserva || 0;
      const perRiga = 2, gapFoto = 4;
      const boxW = (CW - 2 - gapFoto * (perRiga - 1)) / perRiga;
      let boxH = 48;
      // se le immagini stanno su una sola riga ma non c'e' spazio per l'altezza piena,
      // le rimpicciolisco per tenerle nella stessa scheda (fino a un minimo ancora leggibile)
      const spazioLibero = yLimiteCorrente - y - 7 - riserva;  // 7 = titolo + respiro
      if(immagini.length <= perRiga && spazioLibero < boxH && spazioLibero >= ALTEZZA_MIN_IMG){
        boxH = Math.floor(spazioLibero * 10) / 10;
      }
      doc.setFont("helvetica","bold");
      doc.setFontSize(9);
      const righeTot = Math.ceil(immagini.length / perRiga);
      serveNuovoSlot(boxH + 7 + (righeTot === 1 ? riserva : 0));
      doc.text(titolo, ML + 2, y);
      y += 4.3;
      let colonna = 0;
      immagini.forEach((f, k)=>{
        const ultimaRiga = Math.floor(k / perRiga) === righeTot - 1;
        if(colonna === 0) serveNuovoSlot(boxH + 2 + (ultimaRiga ? riserva : 0));
        let dw = boxW, dh = boxH;
        if(f.w && f.h){
          const scala = Math.min(boxW / f.w, boxH / f.h);
          dw = f.w * scala;
          dh = f.h * scala;
        }
        const xBase = ML + 2 + colonna * (boxW + gapFoto);
        const x = xBase + (boxW - dw) / 2;
        const yFoto = y + (boxH - dh) / 2;
        try{ doc.addImage(f.src, "JPEG", x, yFoto, dw, dh); }catch(e){}
        colonna++;
        if(colonna >= perRiga){ colonna = 0; y += boxH + gapFoto; }
      });
      // se l'ultima riga ha una casella libera ne restituisco posizione e misure (ci va la firma)
      const libera = colonna !== 0
        ? {x: ML + 2 + colonna * (boxW + gapFoto), y: y, w: boxW, h: boxH}
        : null;
      if(colonna !== 0) y += boxH + gapFoto;
      y += 1;
      return libera;
    }

    // firma dentro un riquadro: etichetta in alto, firma appoggiata sulla linea, firmatario sotto
    function disegnaFirma(x, yTop, larg, alt){
      const lineaY = yTop + alt - (c.firmatario ? 5 : 1);
      const m = misureFirmaPDF(doc, c.firma, larg, Math.min(lineaY - yTop - 6, 30));
      doc.setFont("helvetica","bold");
      doc.setFontSize(9);
      doc.text("Firma cliente:", x, yTop + 3);
      try{ doc.addImage(c.firma, "PNG", x, lineaY - m.h - 0.5, m.w, m.h); }catch(e){}
      doc.setDrawColor(180,184,189);
      doc.setLineWidth(0.2);
      doc.line(x, lineaY, x + larg, lineaY);
      if(c.firmatario){
        doc.setFont("helvetica","normal");
        doc.setFontSize(7.5);
        doc.text("Firmatario: " + c.firmatario.toUpperCase(), x, lineaY + 4);
      }
    }

    // spese collegate a questo cliente (con eventuali scontrini allegati)
    const speseCliente = d.spese.filter(s => s.clienteId && s.clienteId === c.id);
    if(speseCliente.length){
      const scontrini = speseCliente.filter(s => s.allegato && s.allegato.src).map(s => s.allegato);
      // elenco spese e scontrino devono restare insieme: se non ci stanno (anche con lo scontrino
      // ridotto al minimo leggibile) si passa alla mezza pagina successiva con entrambi
      const altezzaElenco = 6 + speseCliente.length * 4.6 + (speseCliente.length > 1 ? 5 : 0) + 1.5;
      const altezzaScontrini = scontrini.length ? 7 + (scontrini.length <= 2 ? ALTEZZA_MIN_IMG : 48) : 0;
      serveNuovoSlot(altezzaElenco + altezzaScontrini);
      doc.setFont("helvetica","bold");
      doc.setFontSize(9);
      doc.text("Spese:", ML + 2, y);
      y += 4.6;
      doc.setFont("helvetica","normal");
      doc.setFontSize(9);
      speseCliente.forEach(s=>{
        const righeS = doc.splitTextToSize("- " + s.d, CW - 34);
        serveNuovoSlot(righeS.length * 4.4 + 1);
        doc.text(righeS, ML + 6, y);
        doc.text(euro(s.i), W - MR, y, {align:"right"});
        y += righeS.length * 4.4;
      });
      if(speseCliente.length > 1){
        serveNuovoSlot(6);
        doc.setFont("helvetica","bold");
        doc.text("Totale spese", ML + 6, y + 0.5);
        doc.text(euro(totaleSpese(speseCliente)), W - MR, y + 0.5, {align:"right"});
        y += 5;
      }
      y += 1.5;
      if(scontrini.length) disegnaGriglia(scontrini.length > 1 ? "Allegati spese:" : "Allegato spesa:", scontrini);
    }

    // con un numero dispari di foto la firma va nella casella libera accanto all'ultima foto
    const firmaAccanto = !!(c.firma && c.foto && c.foto.length % 2 === 1);
    let casellaLibera = null;
    if(c.foto && c.foto.length) casellaLibera = disegnaGriglia("Foto:", c.foto, firmaAccanto ? 0 : ALTEZZA_FIRMA);

    if(c.firma){
      if(firmaAccanto && casellaLibera){
        disegnaFirma(casellaLibera.x + 4, casellaLibera.y, Math.min(casellaLibera.w - 4, FIRMA_MAX_W), casellaLibera.h);
      } else {
        serveNuovoSlot(ALTEZZA_FIRMA);
        disegnaFirma(ML + 2, y, FIRMA_MAX_W, ALTEZZA_FIRMA);
        y += ALTEZZA_FIRMA;
      }
    }
  });

  return doc;
}
export function generaPDFFoglioUnico(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const ML = 18, MR = 18, W = 210, CW = W - ML - MR;
  const d = datiGiornata();
  let y = intestazionePDF(doc, "RAPPORTO DI LAVORO GIORNALIERO");

  function serveNuovaPagina(spazio){
    if (y + spazio > 275){ doc.addPage(); y = 22; }
  }

  doc.setFontSize(11);
  doc.text("Data: " + dataIt(), ML, y);
  doc.text("Tecnici: " + d.tecnici, ML + 60, y);
  y += 11;

  doc.setFontSize(12);
  doc.text("LAVORI ESEGUITI", ML, y);
  y += 8;
  if(d.clienti.length === 0){
    doc.setFont("helvetica","normal"); doc.setFontSize(11);
    doc.text("-", ML, y); y += 8;
  }
  d.clienti.forEach((c,i)=>{
    serveNuovaPagina(25);
    doc.setFont("helvetica","bold");
    doc.setFontSize(11.5);
    let xNome = ML;
    if(c.urgente){
      doc.setFillColor(253,240,239);
      doc.rect(ML - 2, y - 5, CW + 4, 8.5, "F");
      doc.setFillColor(179,65,58);
      doc.rect(ML - 2, y - 5, 2.5, 8.5, "F");
      doc.setTextColor(179,65,58);
      doc.setFontSize(9);
      doc.text("URGENZA", ML + 2, y);
      xNome = ML + 22;
      doc.setTextColor(0,0,0);
      doc.setFontSize(11.5);
    }
    doc.text((i+1) + ")  " + c.nome + rigaOrarioCliente(c), xNome, y);
    if(c.stato === "Da ultimare"){
      doc.setTextColor(179,65,58);
      doc.setFontSize(9.5);
      doc.text("DA ULTIMARE", W - MR, y, {align:"right"});
      doc.setTextColor(0,0,0);
    }
    y += 6;
    const meta = [];
    if(c.indirizzo) meta.push(c.indirizzo);
    if(c.tipologia) meta.push("Tipologia: " + c.tipologia);
    if(c.fatturare) meta.push("Fatturare a: " + c.fatturare);
    if(meta.length){
      doc.setFont("helvetica","italic");
      doc.setFontSize(9.5);
      doc.setTextColor(90,96,104);
      const righeMeta = doc.splitTextToSize(meta.join("   ·   "), CW - 8);
      serveNuovaPagina(righeMeta.length * 4.5 + 3);
      doc.text(righeMeta, ML + 8, y);
      doc.setTextColor(0,0,0);
      y += righeMeta.length * 4.5 + 2;
    }
    if(c.dettagli){
      doc.setFont("helvetica","normal");
      doc.setFontSize(11);
      const righe = doc.splitTextToSize(c.dettagli, CW - 8);
      serveNuovaPagina(righe.length * 5.5 + 4);
      doc.text(righe, ML + 8, y);
      y += righe.length * 5.5 + 3;
    }
    if(c.materiali && c.materiali.length){
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      serveNuovaPagina(8 + c.materiali.length * 5);
      doc.text("Materiale:", ML + 8, y);
      y += 5;
      doc.setFont("helvetica","normal");
      doc.setFontSize(10.5);
      c.materiali.forEach(m=>{
        const righeM = doc.splitTextToSize("- " + testoMateriale(m), CW - 16);
        serveNuovaPagina(righeM.length * 5 + 2);
        doc.text(righeM, ML + 12, y);
        y += righeM.length * 5;
      });
      y += 2;
    }
    if(c.importo){
      serveNuovaPagina(10);
      doc.setFont("helvetica","bold");
      doc.setFontSize(10.5);
      doc.text("Da fatturare:", ML + 8, y);
      doc.text(euro(c.importo), ML + 40, y);
      doc.setFont("helvetica","normal");
      y += 7;
    }
    if(c.foto && c.foto.length){
      const perRiga = 2, gapFoto = 5;
      const boxW = (CW - 8 - gapFoto * (perRiga - 1)) / perRiga; // larghezza massima disponibile per foto
      const boxH = 68; // altezza massima riservata per riga di foto
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      serveNuovaPagina(boxH + 8);
      doc.text("Foto:", ML + 8, y);
      y += 5;
      let colonna = 0;
      const righeTot = Math.ceil(c.foto.length / perRiga);
      const riservaFirma = c.firma ? 34 : 0;   // la firma resta sulla pagina dell'ultima riga di foto
      c.foto.forEach((f, k)=>{
        if(colonna === 0) serveNuovaPagina(boxH + 4 + (Math.floor(k / perRiga) === righeTot - 1 ? riservaFirma : 0));
        // calcola dimensioni "contain": la foto intera visibile, senza distorsioni, dentro il riquadro
        let dw = boxW, dh = boxH;
        if(f.w && f.h){
          const scala = Math.min(boxW / f.w, boxH / f.h);
          dw = f.w * scala;
          dh = f.h * scala;
        }
        const xBase = ML + 8 + colonna * (boxW + gapFoto);
        const x = xBase + (boxW - dw) / 2;      // centrata orizzontalmente nel riquadro
        const yFoto = y + (boxH - dh) / 2;       // centrata verticalmente nel riquadro
        try{ doc.addImage(f.src, "JPEG", x, yFoto, dw, dh); }catch(e){}
        colonna++;
        if(colonna >= perRiga){ colonna = 0; y += boxH + gapFoto; }
      });
      if(colonna !== 0) y += boxH + gapFoto;
      y += 2;
    }
    if(c.firma){
      serveNuovaPagina(34);
      const xF = ML + 40, lineaY = y + 24;
      const m = misureFirmaPDF(doc, c.firma, 75, 24);
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      doc.text("Firma cliente:", ML + 8, lineaY - 1);
      try{ doc.addImage(c.firma, "PNG", xF, lineaY - m.h - 0.5, m.w, m.h); }catch(e){}
      doc.setDrawColor(180,184,189);
      doc.setLineWidth(0.2);
      doc.line(xF, lineaY, xF + 75, lineaY);
      if(c.firmatario){
        doc.setFont("helvetica","normal");
        doc.setFontSize(9);
        doc.text("Firmatario: " + c.firmatario.toUpperCase(), xF, lineaY + 4.5);
        y = lineaY + 9;
      } else {
        y = lineaY + 5;
      }
    }
    y += 3;
  });
  y += 4;

  serveNuovaPagina(20);
  doc.setFont("helvetica","bold");
  doc.setFontSize(12);
  doc.text("ORARIO" + (d.escludi ? "  (esclusa dal monte ore)" : ""), ML, y);
  y += 7;
  doc.setFont("helvetica","normal");
  doc.setFontSize(11);
  if(d.operai.length === 0){
    doc.text("-", ML, y);
    y += 6;
  } else {
    d.operai.forEach(op=>{
      serveNuovaPagina(6);
      doc.text(op.nome + ":  " + (op.dalle || "—") + " - " + (op.alle || "—") +
                contoOreOperaio(op, "   "), ML, y);
      y += 6;
    });
  }
  y += 5;

  const totImporti = totaleImporti(d.clienti);
  if(totImporti){
    serveNuovaPagina(18);
    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    doc.text("DA FATTURARE", ML, y);
    y += 7;
    doc.setFontSize(11);
    d.clienti.forEach(c=>{
      if(!c.importo) return;
      doc.setFont("helvetica","normal");
      const nomeRighe = doc.splitTextToSize("- " + c.nome, CW - 30);
      serveNuovaPagina(nomeRighe.length * 5.5 + 2);
      doc.text(nomeRighe, ML + 2, y);
      doc.text(euro(c.importo), W - MR, y, {align:"right"});
      y += nomeRighe.length * 5.5;
    });
    doc.setFont("helvetica","bold");
    doc.text("Totale", ML + 2, y + 1);
    doc.text(euro(totImporti), W - MR, y + 1, {align:"right"});
    doc.setFont("helvetica","normal");
    y += 11;
  }

  if(d.spese.length){
    serveNuovaPagina(16 + d.spese.length * 6);
    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    doc.text("SPESE / EXTRA", ML, y);
    y += 7;
    doc.setFont("helvetica","normal");
    doc.setFontSize(10.5);
    d.spese.forEach(s=>{
      // se la spesa e' collegata a un cliente lo indico tra parentesi
      const cli = s.clienteId ? d.clienti.find(c=>c.id === s.clienteId) : null;
      const righeS = doc.splitTextToSize("- " + s.d + (cli ? "  (" + cli.nome + ")" : ""), CW - 30);
      serveNuovaPagina(righeS.length * 5.5);
      doc.text(righeS, ML + 2, y);
      doc.text(euro(s.i), W - MR, y, {align:"right"});
      y += righeS.length * 5.5;
    });
    doc.setFont("helvetica","bold");
    doc.text("Totale spese", ML + 2, y + 1);
    doc.text(euro(totaleSpese(d.spese)), W - MR, y + 1, {align:"right"});
    y += 10;

    // scontrini allegati alle spese
    const scontrini = d.spese.filter(s=>s.allegato && s.allegato.src).map(s=>s.allegato);
    if(scontrini.length){
      const perRiga = 2, gapFoto = 5;
      const boxW = (CW - gapFoto * (perRiga - 1)) / perRiga, boxH = 68;
      doc.setFontSize(10);
      serveNuovaPagina(boxH + 8);
      doc.text(scontrini.length > 1 ? "Allegati spese:" : "Allegato spesa:", ML, y);
      y += 5;
      let colonna = 0;
      scontrini.forEach(f=>{
        if(colonna === 0) serveNuovaPagina(boxH + 4);
        let dw = boxW, dh = boxH;
        if(f.w && f.h){
          const scala = Math.min(boxW / f.w, boxH / f.h);
          dw = f.w * scala;
          dh = f.h * scala;
        }
        const xBase = ML + colonna * (boxW + gapFoto);
        try{ doc.addImage(f.src, "JPEG", xBase + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh); }catch(e){}
        colonna++;
        if(colonna >= perRiga){ colonna = 0; y += boxH + gapFoto; }
      });
      if(colonna !== 0) y += boxH + gapFoto;
    }
  }

  aggiungiPiePagina(doc);
  return doc;
}
// sceglie il formato del PDF giornaliero in base alla casella nella sezione clienti
export function generaPDF(){
  return document.getElementById("pdf-foglio-unico").checked ? generaPDFFoglioUnico() : generaPDFPerCliente();
}
