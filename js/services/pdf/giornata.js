// PDF della giornata e del rapportino (stile COMP.HAS: bianco, blu scuro, grigi chiari).
// - generaPDFPerCliente: una scheda "RAPPORTINO DI INTERVENTO" per cliente su mezze pagine A5
//   (anche il PDF di un rapportino dell'app);
// - generaPDFFoglioUnico: "RAPPORTO DI LAVORO GIORNALIERO" con tutti i lavori numerati.
// Ordine dei contenuti: intestazione; dati (data, riferimento, tecnici, orari); cliente e sede;
// attivita' svolte; materiali; fotografie; note e firma. Testi e tabelle si spezzano riga per riga tra
// le pagine; un titolo non resta mai da solo in fondo; foto con proporzioni reali (ridotte se non entrano
// per poco); firma sulla pagina dell'ultima foto del suo lavoro. Filigrana tenue dalla seconda pagina.
import { dataIt } from "../../utils/dates.js";
import { totaleImporti, totaleSpese } from "../calculations.js";
import { rigaOrarioCliente } from "../../modules/report.js";
import { contoOreOperaio } from "../../core/preferenze.js";
import { euro } from "../../utils/formatters.js";
import { datiGiornata } from "../../modules/rapportini.js";
import {
  aggiungiPiePagina, COLORI, coloreLinea, coloreRiempimento, etichetteStato, filigranaPDF, intestazioneCompatta,
  intestazionePDF, misureFirmaPDF, riferimentoGiornata, righeConSeparatori, sottotitolo, stileTesto, titoloSezione,
} from "./comune.js";

const TITOLO_SCHEDA = "RAPPORTINO DI INTERVENTO";
const TITOLO_GIORNATA = "RAPPORTO DI LAVORO GIORNALIERO";
const statiCliente = c=>[c.urgente ? "URGENZA" : "", c.stato === "Da ultimare" ? "DA ULTIMARE" : ""].filter(Boolean);
const datiSede = c=>[c.indirizzo, c.tipologia ? "Tipologia: " + c.tipologia : "", c.fatturare ? "Fatturare a: " + c.fatturare : ""].filter(Boolean);
const oreOperaio = op=>contoOreOperaio(op, "").trim().replace(/^\(|\)$/g, "");

// =====================================================================================================
// Schede per cliente (mezze pagine A5) — anche il PDF del rapportino
// dati/iso facoltativi: senza argomenti usa il foglio giornaliero aperto; con argomenti stampa una
// giornata "virtuale", es. un rapportino (dati.riferimento, dati.mostraOrario, cliente.note)
export function generaPDFPerCliente(dati, iso){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const W = 210, H = 297, META = H / 2;         // meta' pagina = altezza di una "scheda" A5
  const ML = 14, MR = 14, CW = W - ML - MR, XR = W - MR;
  const MARGINE_EST = 14, MARGINE_INT = 7;        // margine dal bordo pagina / dalla linea di taglio
  const d = dati || datiGiornata();
  const data = dataIt(iso);
  const base = riferimentoGiornata(data);
  const piedi = [];                               // { pagina, y }: numerazione scritta alla fine

  let unita = -1;         // indice progressivo di meta-pagina: 0=alto pag.1, 1=basso pag.1, 2=alto pag.2, ...
  let yLimiteCorrente = 0;

  function disegnaLineaTaglio(){
    doc.setDrawColor(200,204,208);
    doc.setLineWidth(0.25);
    if(doc.setLineDashPattern) doc.setLineDashPattern([2,1.5], 0);
    doc.line(6, META, W - 6, META);
    if(doc.setLineDashPattern) doc.setLineDashPattern([], 0);
    // a sinistra, sotto la linea: il centro e' occupato dal piede della scheda di sopra
    stileTesto(doc, 6.5, "normal", [170,175,180]);
    doc.text("taglia qui", ML, META + 3);
  }
  // passa alla meta-pagina successiva (crea una nuova pagina A4 solo quando serve una nuova "meta alta");
  // dalla seconda pagina ogni mezza pagina ha la filigrana al centro
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
    if(unita >= 2) filigranaPDF(doc, W / 2, (yBase + yLimiteCorrente) / 2 + 4, 92);
    return yBase;
  }
  // intestazione compatta e piede della mezza pagina corrente
  function intestazioneSlot(yBase, indice, totale, rif){
    const yl = intestazioneCompatta(doc, TITOLO_SCHEDA,
      { riferimento: rif, data, extra: totale > 1 ? "Cliente " + indice + " di " + totale : "" }, ML, XR, yBase);
    const yp = yLimiteCorrente + 4.5;
    stileTesto(doc, 7, "normal", COLORI.grigio);
    doc.text("COMP.HAS assistance SRL", ML, yp);
    doc.text("Rapportino N. " + rif + " del " + data, W / 2, yp, {align:"center"});
    piedi.push({ pagina: doc.getNumberOfPages(), y: yp });
    stileTesto(doc, 9.5);
    return yl + 6;
  }
  function numeraPagine(){
    const n = doc.getNumberOfPages();
    piedi.forEach(p=>{
      doc.setPage(p.pagina);
      stileTesto(doc, 7, "normal", COLORI.grigio);
      doc.text("Pagina " + p.pagina + " di " + n, XR, p.y, {align:"right"});
    });
  }

  if(d.clienti.length === 0){
    const yBase = vaiAUnitaSuccessiva();
    let y = intestazioneSlot(yBase, 1, 1, base);
    stileTesto(doc, 10.5);
    doc.text("Data: " + data, ML, y);
    y += 7;
    doc.text("Nessun lavoro cliente registrato per questo giorno.", ML, y);
    numeraPagine();
    return doc;
  }

  d.clienti.forEach((c, indiceCliente)=>{
    const rif = d.riferimento || (d.clienti.length > 1 ? base + "-" + (indiceCliente + 1) : base);
    let yBase = vaiAUnitaSuccessiva();
    let y = intestazioneSlot(yBase, indiceCliente + 1, d.clienti.length, rif);

    function serveNuovoSlot(spazio){
      if(y + spazio > yLimiteCorrente){
        const font = doc.getFont(), dim = doc.getFontSize(), colore = doc.getTextColor();
        yBase = vaiAUnitaSuccessiva();
        y = intestazioneSlot(yBase, indiceCliente + 1, d.clienti.length, rif);
        // la scheda continua su un'altra meta' pagina: ripeto di quale cliente si tratta
        stileTesto(doc, 8.5, "italic", COLORI.grigio);
        doc.text(doc.splitTextToSize(c.nome + "  (segue)", CW)[0], ML, y);
        y += 5.5;
        // il testo riprende con lo stesso stile di prima
        doc.setFont(font.fontName, font.fontStyle);
        doc.setFontSize(dim);
        doc.setTextColor(colore);
        return true;
      }
      return false;
    }
    // righe di testo stampate una alla volta: un testo lungo continua nella meta' pagina successiva
    // invece di uscire dalla scheda (oltre la linea di taglio o il fondo del foglio)
    function scriviRighe(righe, x, interlinea, minimoInsieme){
      serveNuovoSlot(Math.min(righe.length, minimoInsieme || 3) * interlinea);
      righe.forEach(r=>{ serveNuovoSlot(interlinea); doc.text(r, x, y); y += interlinea; });
    }
    // sottotitolo tenuto con almeno "dopo" mm del suo contenuto
    function sezione(testo, dopo){
      serveNuovoSlot(5 + (dopo || 9));
      sottotitolo(doc, testo, ML, y, 7.2);
      y += 4.4;
    }

    // ---------------------------------------------------------------- dati: data, tecnici, orario
    // l'orario degli operai compare se per questo cliente e' indicata almeno una fascia oraria, oppure
    // sempre per il PDF di un rapportino (mostraOrario: le ore di ogni tecnico sono del rapportino)
    const haOrarioCliente = d.mostraOrario || (c.fasce && c.fasce.some(f=>f.d || f.a)) || c.dalle || c.alle;
    stileTesto(doc, 9);
    const tecnici = d.tecnici ? doc.splitTextToSize(d.tecnici, CW - 60) : [];
    const orari = haOrarioCliente && d.operai.length
      ? doc.splitTextToSize(d.operai.map(op=>op.nome + "  " + (op.dalle || "—") + "–" + (op.alle || "—") +
          (oreOperaio(op) ? " (" + oreOperaio(op) + ")" : "")).join("     "), CW - 22) : [];
    const altInfo = 3 + Math.max(1, tecnici.length) * 4.3 + (orari.length ? orari.length * 4.1 + 1 : 0) + 1.5;
    coloreRiempimento(doc, COLORI.sfondo);
    doc.roundedRect(ML, y - 4, CW, altInfo, 1.2, 1.2, "F");
    stileTesto(doc, 6.8, "bold", COLORI.grigio);
    doc.text("DATA", ML + 3, y);
    doc.text("TECNICI", ML + 40, y);
    stileTesto(doc, 9);
    doc.text(data, ML + 12, y);
    tecnici.forEach((t, k)=>doc.text(t, ML + 54, y + k * 4.3));
    y += Math.max(1, tecnici.length) * 4.3;
    if(orari.length){
      stileTesto(doc, 6.8, "bold", COLORI.grigio);
      doc.text("ORARIO", ML + 3, y + 0.6);
      stileTesto(doc, 8.6, "normal", COLORI.testo);
      orari.forEach((o, k)=>doc.text(o, ML + 19, y + 0.6 + k * 4.1));
      y += orari.length * 4.1 + 1;
    }
    y += 6;

    // ---------------------------------------------------------------- cliente e sede
    const stati = statiCliente(c);
    stileTesto(doc, 7.2, "bold");
    const largStati = stati.reduce((t, s)=>t + doc.getTextWidth(s) + 5.5, 0);
    stileTesto(doc, 11.5, "bold");
    const nomeRighe = doc.splitTextToSize(c.nome + rigaOrarioCliente(c), Math.max(CW - largStati - 2, 40));
    doc.text(nomeRighe, ML, y);
    if(stati.length) etichetteStato(doc, stati, XR, y - 0.4);
    y += nomeRighe.length * 5 + 0.5;
    const sede = datiSede(c);
    if(sede.length){
      stileTesto(doc, 8.5, "normal", COLORI.grigio);
      scriviRighe(righeConSeparatori(doc, sede, "   ·   ", CW), ML, 4.1);
      y += 1.5;
    }
    y += 2;

    // ---------------------------------------------------------------- attivita' svolte
    if(c.dettagli){
      sezione("Attività svolte");
      stileTesto(doc, 9.5);
      scriviRighe(doc.splitTextToSize(c.dettagli, CW), ML, 4.5);
      y += 2.5;
    }
    // ---------------------------------------------------------------- materiali (tabella)
    if(c.materiali && c.materiali.length){
      const intestazione = ()=>{
        coloreRiempimento(doc, COLORI.sfondo);
        doc.rect(ML, y - 3.4, CW, 5, "F");
        stileTesto(doc, 6.8, "bold", COLORI.grigio);
        doc.text("DESCRIZIONE", ML + 2, y);
        doc.text("Q.TÀ", XR - 2, y, {align:"right"});
        y += 5;
      };
      sezione("Materiali utilizzati", 14);
      intestazione();
      c.materiali.forEach(m=>{
        stileTesto(doc, 9);
        const righe = doc.splitTextToSize(String(m.a || ""), CW - 24);
        if(serveNuovoSlot(Math.min(righe.length, 4) * 4.2 + 1)) intestazione();
        stileTesto(doc, 9);
        righe.forEach((r, k)=>{
          if(k && serveNuovoSlot(4.2)) { intestazione(); stileTesto(doc, 9); }
          doc.text(r, ML + 2, y);
          if(k === 0 && m.q) doc.text(String(m.q), XR - 2, y, {align:"right"});
          y += 4.2;
        });
        coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.2);
        doc.line(ML, y - 2.9, XR, y - 2.9);
        y += 0.8;
      });
      y += 2;
    }
    // ---------------------------------------------------------------- importo
    if(c.importo){
      serveNuovoSlot(7);
      stileTesto(doc, 7.2, "bold", COLORI.grigio);
      doc.text("IMPORTO DA FATTURARE", ML, y);
      stileTesto(doc, 10, "bold");
      doc.text(euro(c.importo), XR, y, {align:"right"});
      y += 6.5;
    }

    // altezza minima ancora leggibile di una foto/scontrino quando lo spazio nella scheda e' poco
    const ALTEZZA_MIN_IMG = 32;
    // spazio per la firma: va tenuta nella stessa scheda dell'ultima riga di foto
    const FIRMA_MAX_W = 70, FIRMA_MAX_H = 20;
    const ALTEZZA_FIRMA = c.firma ? FIRMA_MAX_H + 6 + (c.firmatario ? 5 : 1) : 0;

    // griglia di immagini (2 per riga, proporzioni reali, filo sottile intorno): foto e scontrini
    function disegnaGriglia(titolo, immagini, riserva){
      riserva = riserva || 0;
      const perRiga = 2, gapFoto = 4;
      const boxW = (CW - gapFoto * (perRiga - 1)) / perRiga;
      const BOX_H = 48;
      const righeTot = Math.ceil(immagini.length / perRiga);
      // ogni riga che non entra per poco nella scheda viene rimpicciolita (proporzioni invariate, fino a
      // un minimo ancora leggibile) invece di passare alla mezza pagina successiva lasciando spazio vuoto
      const altezzaRiga = ultima=>{
        const libero = yLimiteCorrente - y - 2 - (ultima ? riserva : 0);
        return libero < BOX_H && libero >= ALTEZZA_MIN_IMG ? Math.floor(libero * 10) / 10 : BOX_H;
      };
      // il titolo resta con la prima riga (anche rimpicciolita)
      serveNuovoSlot(ALTEZZA_MIN_IMG + 7 + (righeTot === 1 ? riserva : 0));
      sottotitolo(doc, titolo, ML, y, 7.2);
      y += 3;
      let colonna = 0, boxH = BOX_H;
      immagini.forEach((f, k)=>{
        const ultimaRiga = Math.floor(k / perRiga) === righeTot - 1;
        if(colonna === 0){
          boxH = altezzaRiga(ultimaRiga);
          serveNuovoSlot(boxH + 2 + (ultimaRiga ? riserva : 0));
        }
        let dw = boxW, dh = boxH;
        if(f.w && f.h){
          const scala = Math.min(boxW / f.w, boxH / f.h);
          dw = f.w * scala;
          dh = f.h * scala;
        }
        const xBase = ML + colonna * (boxW + gapFoto);
        const x = xBase + (boxW - dw) / 2;
        const yFoto = y + (boxH - dh) / 2;
        try{ doc.addImage(f.src, "JPEG", x, yFoto, dw, dh); }catch(e){}
        coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.2);
        doc.rect(x, yFoto, dw, dh);
        colonna++;
        if(colonna >= perRiga){ colonna = 0; y += boxH + gapFoto; }
      });
      // se l'ultima riga ha una casella libera ne restituisco posizione e misure (ci va la firma)
      const libera = colonna !== 0
        ? {x: ML + colonna * (boxW + gapFoto), y: y, w: boxW, h: boxH}
        : null;
      if(colonna !== 0) y += boxH + gapFoto;
      y += 1;
      return libera;
    }
    // firma: titolo, firma appoggiata sulla linea, firmatario sotto
    function disegnaFirma(x, yTop, larg, alt){
      const lineaY = yTop + alt - (c.firmatario ? 5 : 1);
      const m = misureFirmaPDF(doc, c.firma, larg, Math.min(lineaY - yTop - 5.5, FIRMA_MAX_H + 6));
      sottotitolo(doc, "Firma del cliente", x, yTop + 3, 7.2);
      try{ doc.addImage(c.firma, "PNG", x, lineaY - m.h - 0.5, m.w, m.h); }catch(e){}
      coloreLinea(doc, [190,196,202]); doc.setLineWidth(0.2);
      doc.line(x, lineaY, x + larg, lineaY);
      if(c.firmatario){
        stileTesto(doc, 7.5, "normal", COLORI.grigio);
        doc.text("Firmatario: " + c.firmatario.toUpperCase(), x, lineaY + 3.8);
      }
      stileTesto(doc, 9.5);
    }

    // ---------------------------------------------------------------- spese del cliente (+ scontrini)
    const speseCliente = d.spese.filter(s => s.clienteId && s.clienteId === c.id);
    if(speseCliente.length){
      const scontrini = speseCliente.filter(s => s.allegato && s.allegato.src).map(s => s.allegato);
      // elenco spese e scontrino devono restare insieme: se non ci stanno (anche con lo scontrino
      // ridotto al minimo leggibile) si passa alla mezza pagina successiva con entrambi
      const altezzaElenco = 6 + speseCliente.length * 4.6 + (speseCliente.length > 1 ? 5 : 0) + 1.5;
      const altezzaScontrini = scontrini.length ? 7 + (scontrini.length <= 2 ? ALTEZZA_MIN_IMG : 48) : 0;
      serveNuovoSlot(altezzaElenco + altezzaScontrini);
      sottotitolo(doc, "Spese", ML, y, 7.2);
      y += 4.6;
      speseCliente.forEach(s=>{
        stileTesto(doc, 9);
        const righeS = doc.splitTextToSize(s.d, CW - 30);
        serveNuovoSlot(righeS.length * 4.4 + 1);
        stileTesto(doc, 9);
        doc.text(righeS, ML, y);
        doc.text(euro(s.i), XR, y, {align:"right"});
        y += righeS.length * 4.4;
      });
      if(speseCliente.length > 1){
        serveNuovoSlot(6);
        coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.2);
        doc.line(ML, y - 2.8, XR, y - 2.8);
        stileTesto(doc, 9, "bold");
        doc.text("Totale spese", ML, y + 0.8);
        doc.text(euro(totaleSpese(speseCliente)), XR, y + 0.8, {align:"right"});
        y += 5;
      }
      y += 1.5;
      if(scontrini.length) disegnaGriglia(scontrini.length > 1 ? "Allegati spese" : "Allegato spesa", scontrini);
    }

    // ---------------------------------------------------------------- fotografie, note, firma
    // con un numero dispari di foto la firma va nella casella libera accanto all'ultima foto (se non ci
    // sono note, che vanno prima della firma)
    const firmaAccanto = !!(c.firma && !c.note && c.foto && c.foto.length % 2 === 1);
    let casellaLibera = null;
    if(c.foto && c.foto.length) casellaLibera = disegnaGriglia("Fotografie", c.foto, firmaAccanto ? 0 : (c.note ? 12 : ALTEZZA_FIRMA));
    if(c.note){
      sezione("Note");
      stileTesto(doc, 9.5);
      scriviRighe(doc.splitTextToSize(c.note, CW), ML, 4.5);
      y += 2.5;
    }
    if(c.firma){
      if(firmaAccanto && casellaLibera){
        disegnaFirma(casellaLibera.x + 4, casellaLibera.y, Math.min(casellaLibera.w - 4, FIRMA_MAX_W), casellaLibera.h);
      } else {
        serveNuovoSlot(ALTEZZA_FIRMA);
        disegnaFirma(ML, y, FIRMA_MAX_W, ALTEZZA_FIRMA);
        y += ALTEZZA_FIRMA;
      }
    }
  });

  numeraPagine();
  return doc;
}

// =====================================================================================================
// Foglio unico ("RAPPORTO DI LAVORO GIORNALIERO"): tutti i lavori della giornata numerati.
// dati/iso facoltativi: senza argomenti usa il foglio giornaliero aperto.
export function generaPDFFoglioUnico(dati, iso){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const ML = 18, MR = 18, W = 210, CW = W - ML - MR, XR = W - MR;
  const LIMITE = 276;                       // fondo dell'area dei contenuti (il piede sta sotto)
  const RIENTRO = ML + 11, CWR = XR - RIENTRO;   // contenuto di un lavoro, rientrato sotto il numero
  const d = dati || datiGiornata();
  const data = dataIt(iso);
  const rif = d.riferimento || riferimentoGiornata(data);
  const info = { riferimento: rif, data };
  let lavoroCorrente = null;                // { numero, nome } finche' si scrive un lavoro
  let cimaPagina = -1;                      // quota del primo contenuto della pagina corrente
  let riprendi = null;                      // ridisegna l'intestazione di una tabella dopo un cambio pagina
  const ALTEZZA_FIRMA = 33;
  let y = intestazionePDF(doc, TITOLO_GIORNATA, info);

  // pagina nuova: filigrana, intestazione compatta, richiamo del lavoro in corso, stesso stile di prima
  function nuovaPagina(){
    const font = doc.getFont(), dim = doc.getFontSize(), colore = doc.getTextColor();
    doc.addPage();
    filigranaPDF(doc, W / 2, 155, 125);
    y = intestazioneCompatta(doc, TITOLO_GIORNATA, info) + 7;
    if(lavoroCorrente){
      stileTesto(doc, 8.5, "italic", COLORI.grigio);
      doc.text(doc.splitTextToSize(lavoroCorrente.numero + ")  " + lavoroCorrente.nome + "  (segue)", CW)[0], ML, y);
      y += 6;
    }
    if(riprendi) riprendi();
    doc.setFont(font.fontName, font.fontStyle);
    doc.setFontSize(dim);
    doc.setTextColor(colore);
    cimaPagina = y;
  }
  // garantisce "h" mm prima di LIMITE, altrimenti pagina nuova
  function spazio(h){ if(y + h > LIMITE){ nuovaPagina(); return true; } return false; }
  // testo a capo e spezzato riga per riga tra le pagine (stringa o righe gia' spezzate);
  // una riga vuota capitata in cima a una pagina si salta
  function paragrafo(testo, x, larg, dim, interlinea, peso, colore){
    stileTesto(doc, dim, peso, colore);
    (Array.isArray(testo) ? testo : doc.splitTextToSize(String(testo), larg)).forEach(r=>{
      if(spazio(interlinea)) stileTesto(doc, dim, peso, colore);
      if(!String(r).trim() && y === cimaPagina) return;
      doc.text(r, x, y);
      y += interlinea;
    });
  }
  // sottotitolo di un lavoro, tenuto con almeno "dopo" mm del suo contenuto
  function sezione(testo, dopo){
    spazio(5.5 + (dopo || 10));
    sottotitolo(doc, testo, RIENTRO, y);
    y += 5;
  }
  // tabella a due colonne (descrizione | valore a destra) senza bordi pesanti: intestazione su fondo
  // grigio chiaro (ripetuta se la tabella continua in un'altra pagina), filo sottile tra le righe
  // riservaFinale: spazio da tenere sulla pagina dell'ultima riga (es. il totale sotto la tabella)
  function tabella(x, larg, titoli, righe, dim, riservaFinale){
    const intestazione = ()=>{
      coloreRiempimento(doc, COLORI.sfondo);
      doc.rect(x, y - 3.8, larg, 5.6, "F");
      stileTesto(doc, 7.2, "bold", COLORI.grigio);
      doc.text(titoli[0].toUpperCase(), x + 2, y, {charSpace: 0.2});
      doc.text(titoli[1].toUpperCase(), x + larg - 2, y, {align:"right"});
      y += 6;
    };
    spazio(6 + Math.min(2, righe.length) * 5);
    intestazione();
    riprendi = intestazione;
    righe.forEach(([testo, valore], n)=>{
      stileTesto(doc, dim);
      const r = doc.splitTextToSize(String(testo), larg - 30);
      const fine = n === righe.length - 1 ? (riservaFinale || 0) : 0;
      if(r.length <= 4) spazio(r.length * 4.8 + 1 + fine);
      r.forEach((t, k)=>{
        if(spazio(4.8)) stileTesto(doc, dim);
        doc.text(t, x + 2, y);
        if(k === 0 && valore) doc.text(String(valore), x + larg - 2, y, {align:"right"});
        y += 4.8;
      });
      coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.2);
      doc.line(x, y - 3.3, x + larg, y - 3.3);
      y += 1;
    });
    riprendi = null;
  }
  // griglia di immagini con proporzioni reali: una sola immagine piu' grande, altrimenti due per riga;
  // ogni riga e' alta quanto la sua immagine piu' alta. firma: "sotto" = tiene lo spazio della firma
  // sulla pagina dell'ultima riga; "accanto" = la firma va nella casella libera accanto all'ultima
  // immagine (se la riga e' troppo bassa va sotto, sempre sulla stessa pagina). Restituisce la casella.
  function griglia(titolo, immagini, x0, larg, firma){
    const sola = immagini.length === 1;
    const gap = 5, colW = sola ? Math.min(larg, 120) : (larg - gap) / 2, maxH = sola ? 90 : 70;
    const misure = immagini.map(f=>{
      if(!(f.w && f.h)) return { w: colW, h: maxH };
      const s = Math.min(colW / f.w, maxH / f.h);
      return { w: f.w * s, h: f.h * s };
    });
    const righe = [];
    for(let k = 0; k < immagini.length; k += sola ? 1 : 2) righe.push([k, sola ? k : Math.min(k + 1, immagini.length - 1)]);
    let libera = null;
    righe.forEach(([a, b], r)=>{
      let rowH = Math.max(misure[a].h, misure[b].h);
      const ultima = r === righe.length - 1;
      const casella = ultima && firma === "accanto" && a === b && rowH >= ALTEZZA_FIRMA - 2;
      const riserva = ultima && firma && !casella ? ALTEZZA_FIRMA + gap : 0;   // firma sotto, dopo lo spazio tra righe
      const titoloH = r === 0 ? 5.5 : 0;
      // se la riga non entra per poco, la si riduce in proporzione (non sotto il 60% e un minimo
      // leggibile) invece di lasciare spazio vuoto e passare alla pagina dopo
      const libero = LIMITE - y - titoloH - riserva;
      const minimo = Math.max(rowH * 0.6, sola ? 50 : 40, casella ? ALTEZZA_FIRMA : 0);
      if(rowH > libero && libero >= minimo){
        const f = libero / rowH;
        for(let k = a; k <= b; k++){ misure[k] = { w: misure[k].w * f, h: misure[k].h * f }; }
        rowH = libero;
      }
      const nuova = spazio(titoloH + rowH + riserva);
      if(r === 0 || nuova){
        sottotitolo(doc, r === 0 ? titolo : titolo + " (segue)", x0, y);
        y += 2.5;
      }
      for(let k = a; k <= b; k++){
        const cx = x0 + (k - a) * (colW + gap);
        const m = misure[k];
        const xi = sola ? cx : cx + (colW - m.w) / 2;
        try{ doc.addImage(immagini[k].src, "JPEG", xi, y, m.w, m.h); }catch(e){}
        coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.2);
        doc.rect(xi, y, m.w, m.h);
      }
      if(casella) libera = { x: x0 + colW + gap, y, w: colW, h: rowH };
      y += rowH + gap;
    });
    return libera;
  }
  // firma: titolo, firma appoggiata sulla linea, firmatario sotto
  function firma(c, x, yTop, larg){
    const lineaY = yTop + 25;
    const lw = Math.min(larg, 80);
    const m = misureFirmaPDF(doc, c.firma, lw, 19);
    sottotitolo(doc, "Firma del cliente", x, yTop + 3);
    try{ doc.addImage(c.firma, "PNG", x, lineaY - m.h - 0.5, m.w, m.h); }catch(e){}
    coloreLinea(doc, [190,196,202]); doc.setLineWidth(0.2);
    doc.line(x, lineaY, x + lw, lineaY);
    if(c.firmatario){
      stileTesto(doc, 8.5, "normal", COLORI.grigio);
      doc.text("Firmatario: " + c.firmatario.toUpperCase(), x, lineaY + 4.2);
    }
    stileTesto(doc, 10);
  }

  // ---------------------------------------------------------------- dati: data, riferimento, tecnici, orario
  stileTesto(doc, 10.5);
  const tecnici = d.tecnici ? doc.splitTextToSize(d.tecnici, CW - 92) : ["—"];
  stileTesto(doc, 9.5);
  const righeOrario = d.operai.map(op=>({ nome: doc.splitTextToSize(op.nome, 66), op }));
  // quote del riquadro calcolate prima di disegnarlo (lo sfondo va sotto il testo)
  const yEtichette = y + 1, yValori = yEtichette + 5, yDopoValori = yValori + (tecnici.length - 1) * 5 + 3;
  let yFine = yValori + (tecnici.length - 1) * 5 + 4.5;
  if(d.operai.length){
    let yr = yDopoValori + 12;
    righeOrario.forEach(r=>{ yFine = yr + (r.nome.length - 1) * 4.6 + 4; yr += r.nome.length * 4.6 + 1.2; });
  }
  coloreRiempimento(doc, COLORI.sfondo);
  doc.roundedRect(ML, yEtichette - 6, CW, yFine - (yEtichette - 6), 1.5, 1.5, "F");
  y += 1;
  stileTesto(doc, 7.2, "bold", COLORI.grigio);
  doc.text("DATA", ML + 5, y, {charSpace: 0.2});
  doc.text("RIFERIMENTO", ML + 42, y, {charSpace: 0.2});
  doc.text("TECNICI", ML + 87, y, {charSpace: 0.2});
  y += 5;
  stileTesto(doc, 10.5, "bold");
  doc.text(data, ML + 5, y);
  stileTesto(doc, 10.5);
  doc.text(rif, ML + 42, y);
  tecnici.forEach((t, k)=>doc.text(t, ML + 87, y + k * 5));
  y += (tecnici.length - 1) * 5 + 3;
  if(d.operai.length){
    coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.3);
    doc.line(ML + 5, y, XR - 5, y);
    y += 6;
    stileTesto(doc, 7.2, "bold", COLORI.grigio);
    doc.text("ORARIO DEI TECNICI" + (d.escludi ? "  (GIORNATA ESCLUSA DAL MONTE ORE)" : ""), ML + 5, y, {charSpace: 0.2});
    doc.text("DALLE", ML + 82, y, {charSpace: 0.2});
    doc.text("ALLE", ML + 106, y, {charSpace: 0.2});
    doc.text("ORE", XR - 5, y, {align:"right"});
    y += 6;
    righeOrario.forEach(({ nome, op }, k)=>{
      stileTesto(doc, 9.5);
      doc.text(nome, ML + 5, y);
      doc.text(op.dalle || "—", ML + 82, y);
      doc.text(op.alle || "—", ML + 106, y);
      const ore = oreOperaio(op);
      if(ore){ stileTesto(doc, 9.5, "bold"); doc.text(ore, XR - 5, y, {align:"right"}); }
      y += nome.length * 4.6 + 1.2;
      if(k < righeOrario.length - 1){
        coloreLinea(doc, [230,233,236]); doc.setLineWidth(0.2);
        doc.line(ML + 5, y - 3.6, XR - 5, y - 3.6);
      }
    });
  }
  y = yFine + 10;

  // ---------------------------------------------------------------- lavori eseguiti
  y = titoloSezione(doc, "Lavori eseguiti", ML, y, CW);
  if(d.clienti.length === 0){
    stileTesto(doc, 10.5, "normal", COLORI.grigio);
    doc.text("Nessun lavoro registrato per questa giornata.", ML, y); y += 8;
  }
  d.clienti.forEach((c, i)=>{
    const numero = i + 1;
    // titolo del lavoro: numero, nome (a capo), stati a destra; poi sede e tipologia
    const stati = statiCliente(c);
    stileTesto(doc, 7.2, "bold");
    const largStati = stati.reduce((t, s)=>t + doc.getTextWidth(s) + 5.5, 0);
    stileTesto(doc, 12, "bold");
    const nomeRighe = doc.splitTextToSize(c.nome + rigaOrarioCliente(c), CWR - largStati - 2);
    stileTesto(doc, 9.5);
    const righeSede = righeConSeparatori(doc, datiSede(c), "   ·   ", CWR);
    // il titolo resta con il suo inizio: nome, sede e almeno ~3 righe di contenuto
    spazio(nomeRighe.length * 5.4 + righeSede.length * 4.5 + 18);
    coloreRiempimento(doc, COLORI.blu);
    doc.roundedRect(ML, y - 4.6, 7.5, 6.2, 1.2, 1.2, "F");
    stileTesto(doc, 9.5, "bold", [255,255,255]);
    doc.text(String(numero), ML + 3.75, y, {align:"center"});
    stileTesto(doc, 12, "bold");
    doc.text(nomeRighe, RIENTRO, y);
    if(stati.length) etichetteStato(doc, stati, XR, y - 0.6);
    y += nomeRighe.length * 5.4 + 0.6;
    lavoroCorrente = { numero, nome: c.nome };
    if(righeSede.length){ paragrafo(righeSede, RIENTRO, CWR, 9.5, 4.5, "normal", COLORI.grigio); }
    y += 3.5;

    if(c.dettagli){
      sezione("Attività svolte");
      paragrafo(c.dettagli, RIENTRO, CWR, 10.5, 5);
      y += 3;
    }
    if(c.materiali && c.materiali.length){
      sezione("Materiali utilizzati", 18);
      tabella(RIENTRO, CWR, ["Descrizione", "Q.tà"], c.materiali.map(m=>[m.a || "", m.q || ""]), 10);
      y += 3;
    }
    if(c.importo){
      spazio(8);
      stileTesto(doc, 7.8, "bold", COLORI.grigio);
      doc.text("IMPORTO DA FATTURARE", RIENTRO, y, {charSpace: 0.2});
      stileTesto(doc, 10.5, "bold");
      doc.text(euro(c.importo), XR, y, {align:"right"});
      y += 8;
    }
    let libera = null;
    if(c.foto && c.foto.length){
      // con un numero dispari di foto (piu' di una) la firma va nella casella libera accanto all'ultima,
      // se non ci sono note (le note vanno prima della firma)
      const accanto = !!(c.firma && !c.note && c.foto.length > 1 && c.foto.length % 2 === 1);
      libera = griglia("Fotografie", c.foto, RIENTRO, CWR, c.firma && !c.note ? (accanto ? "accanto" : "sotto") : null);
      if(libera) firma(c, libera.x, libera.y + libera.h - ALTEZZA_FIRMA, libera.w);
    }
    if(c.note){
      sezione("Note");
      paragrafo(c.note, RIENTRO, CWR, 10.5, 5);
      y += 3;
    }
    if(c.firma && !libera){
      spazio(ALTEZZA_FIRMA);
      firma(c, RIENTRO, y, CWR);
      y += ALTEZZA_FIRMA;
    }
    lavoroCorrente = null;
    // separatore tra un lavoro e il successivo
    if(i < d.clienti.length - 1 && y + 4 < LIMITE){
      coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.3);
      doc.line(ML, y, XR, y);
      y += 9;
    } else y += 5;
  });

  // ---------------------------------------------------------------- riepiloghi
  // spazio da tenere insieme: titolo (10), intestazione della tabella (6), fino a due righe (5,8 l'una)
  // e, se le righe sono al massimo due, anche il totale (7 + 1, come la riserva della tabella): il
  // riepilogo non resta con il solo titolo o la sola intestazione
  const ingombroRiepilogo = n=>10 + 6 + Math.min(n, 2) * 5.8 + (n <= 2 ? 8 : 0);
  const totImporti = totaleImporti(d.clienti);
  if(totImporti){
    const conImporto = d.clienti.filter(c=>c.importo);
    spazio(ingombroRiepilogo(conImporto.length));
    y = titoloSezione(doc, "Da fatturare", ML, y + 2, CW);
    tabella(ML, CW, ["Cliente", "Importo"], conImporto.map(c=>[c.nome, euro(c.importo)]), 10, 7);
    spazio(7);
    stileTesto(doc, 10.5, "bold");
    doc.text("Totale", ML + 2, y + 1);
    doc.text(euro(totImporti), XR - 2, y + 1, {align:"right"});
    y += 11;
  }
  if(d.spese.length){
    spazio(ingombroRiepilogo(d.spese.length));
    y = titoloSezione(doc, "Spese / extra", ML, y + 2, CW);
    tabella(ML, CW, ["Descrizione", "Importo"], d.spese.map(s=>{
      // se la spesa e' collegata a un cliente lo indico tra parentesi
      const cli = s.clienteId ? d.clienti.find(c=>c.id === s.clienteId) : null;
      return [s.d + (cli ? "  (" + cli.nome + ")" : ""), euro(s.i)];
    }), 10, 7);
    spazio(7);
    stileTesto(doc, 10.5, "bold");
    doc.text("Totale spese", ML + 2, y + 1);
    doc.text(euro(totaleSpese(d.spese)), XR - 2, y + 1, {align:"right"});
    y += 10;
    const scontrini = d.spese.filter(s=>s.allegato && s.allegato.src).map(s=>s.allegato);
    if(scontrini.length) griglia(scontrini.length > 1 ? "Allegati spese" : "Allegato spesa", scontrini, ML, CW, null);
  }

  aggiungiPiePagina(doc, "Rapporto N. " + rif + " del " + data);
  return doc;
}
// sceglie il formato del PDF giornaliero in base alla casella nella sezione clienti
export function generaPDF(){
  return document.getElementById("pdf-foglio-unico").checked ? generaPDFFoglioUnico() : generaPDFPerCliente();
}
