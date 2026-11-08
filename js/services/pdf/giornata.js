// PDF della giornata: per cliente (mezze pagine A5) o a foglio unico.
import { LOGO_B64, LOGO_RAPPORTO } from "../../../assets/logo/logo.js";
import { dataIt } from "../../utils/dates.js";
import { totaleImporti, totaleSpese } from "../calculations.js";
import { rigaOrarioCliente, testoMateriale } from "../../modules/report.js";
import { contoOreOperaio } from "../../core/preferenze.js";
import { euro } from "../../utils/formatters.js";
import { datiGiornata } from "../../modules/rapportini.js";
import { aggiungiPiePagina, intestazionePDF, misureFirmaPDF } from "./comune.js";

// dati/iso facoltativi: senza argomenti usa il foglio giornaliero aperto (come sempre);
// con argomenti stampa una giornata "virtuale", es. un rapportino
export function generaPDFPerCliente(dati, iso){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const W = 210, H = 297, META = H / 2;         // meta' pagina = altezza di una "scheda" A5
  const ML = 14, MR = 14, CW = W - ML - MR;
  const MARGINE_EST = 14, MARGINE_INT = 7;        // margine dal bordo pagina / dalla linea di taglio
  const d = dati || datiGiornata();

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
    doc.text("Data: " + dataIt(iso), ML, y);
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
        const font = doc.getFont(), dim = doc.getFontSize(), colore = doc.getTextColor();
        yBase = vaiAUnitaSuccessiva();
        y = intestazioneSlot(yBase, indiceCliente + 1, d.clienti.length);
        // la scheda continua su un'altra meta' pagina: ripeto di quale cliente si tratta
        doc.setFont("helvetica","bold");
        doc.setFontSize(9.5);
        doc.text(doc.splitTextToSize(c.nome + "  (segue)", CW)[0], ML, y);
        y += 6;
        // il testo riprende con lo stesso stile di prima
        doc.setFont(font.fontName, font.fontStyle);
        doc.setFontSize(dim);
        doc.setTextColor(colore);
      }
    }
    // righe di testo stampate una alla volta: un testo lungo continua nella meta' pagina successiva
    // invece di uscire dalla scheda (oltre la linea di taglio o il fondo del foglio)
    function scriviRighe(righe, x, interlinea, minimoInsieme){
      serveNuovoSlot(Math.min(righe.length, minimoInsieme || 3) * interlinea);
      righe.forEach(r=>{ serveNuovoSlot(interlinea); doc.text(r, x, y); y += interlinea; });
    }

    doc.setFont("helvetica","normal");
    doc.setFontSize(9.5);
    const infoRighe = doc.splitTextToSize(
      "Data: " + dataIt(iso) + (d.tecnici ? "   ·   Tecnici: " + d.tecnici : ""), CW
    );
    doc.text(infoRighe, ML, y);
    y += infoRighe.length * 4.5 + 1;

    // l'orario degli operai compare se per questo cliente e' indicata almeno una fascia oraria, oppure
    // sempre per il PDF di un rapportino (mostraOrario: le ore di ogni tecnico sono del rapportino)
    const haOrarioCliente = d.mostraOrario || (c.fasce && c.fasce.some(f=>f.d || f.a)) || c.dalle || c.alle;
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
      scriviRighe(righeMeta, ML + 2, 4.2);
      doc.setTextColor(0,0,0);
      y += 2.5;
    }

    if(c.dettagli){
      doc.setFont("helvetica","normal");
      doc.setFontSize(9.5);
      const righe = doc.splitTextToSize(c.dettagli, CW - 2);
      scriviRighe(righe, ML + 2, 4.6);
      y += 3;
    }

    if(c.materiali && c.materiali.length){
      doc.setFont("helvetica","bold");
      doc.setFontSize(9);
      serveNuovoSlot(6 + Math.min(2, c.materiali.length) * 4.3);   // titolo con almeno due voci
      doc.text("Materiale:", ML + 2, y);
      y += 4.3;
      doc.setFont("helvetica","normal");
      doc.setFontSize(9);
      c.materiali.forEach(m=>{
        const righeM = doc.splitTextToSize("- " + testoMateriale(m), CW - 8);
        scriviRighe(righeM, ML + 6, 4.3, 4);
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
// PDF a foglio unico ("RAPPORTO DI LAVORO GIORNALIERO"): tutti i lavori della giornata numerati, con
// intestazione e piede (data, numerazione) su ogni pagina.
// dati/iso facoltativi: senza argomenti usa il foglio giornaliero aperto.
// Impaginazione: i testi vanno a capo e si spezzano riga per riga tra le pagine (niente testo fuori
// pagina, niente pagine lasciate vuote per spostare un blocco intero); l'intestazione di un lavoro non
// resta mai da sola in fondo alla pagina e, se il lavoro continua, la pagina dopo lo ricorda ("segue");
// le foto mantengono le proporzioni e l'altezza della riga e' quella della foto piu' alta; la firma
// resta sulla pagina dell'ultima riga di foto del suo lavoro.
export function generaPDFFoglioUnico(dati, iso){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const ML = 18, MR = 18, W = 210, CW = W - ML - MR;
  const LIMITE = 276;                       // fondo dell'area dei contenuti (il piede sta sotto)
  const RIENTRO = ML + 8, CWR = CW - 8;     // contenuto di un lavoro, rientrato sotto il numero
  const d = dati || datiGiornata();
  const data = dataIt(iso);
  let lavoroCorrente = null;                // { numero, nome } finche' si scrive un lavoro
  const ALTEZZA_FIRMA = 31;
  let y = intestazionePDF(doc, "RAPPORTO DI LAVORO GIORNALIERO");

  function stile(dim, peso, colore){
    doc.setFont("helvetica", peso || "normal");
    doc.setFontSize(dim);
    const c = colore || [0,0,0];
    doc.setTextColor(c[0], c[1], c[2]);
  }
  // intestazione compatta delle pagine successive alla prima
  function intestazioneSeguito(){
    const largLogo = 26, altLogo = 26 / LOGO_RAPPORTO;
    try{ doc.addImage(LOGO_B64, "JPEG", ML, 9, largLogo, altLogo); }catch(e){}
    stile(10, "bold", [28,31,35]);
    doc.text("RAPPORTO DI LAVORO GIORNALIERO", W - MR, 14, {align:"right"});
    stile(8.5, "normal", [110,116,122]);
    doc.text("Data: " + data + "  (segue)", W - MR, 18.5, {align:"right"});
    const yl = Math.max(9 + altLogo, 20) + 2;
    doc.setDrawColor(47,161,137); doc.setLineWidth(0.7); doc.line(ML, yl, W - MR, yl);
    doc.setDrawColor(140,151,196); doc.setLineWidth(0.3); doc.line(ML, yl + 1, W - MR, yl + 1);
    stile(10);
    return yl + 8;
  }
  // pagina nuova: intestazione compatta, richiamo del lavoro in corso, stesso stile del testo di prima
  function nuovaPagina(){
    const font = doc.getFont(), dim = doc.getFontSize(), colore = doc.getTextColor();
    doc.addPage();
    y = intestazioneSeguito();
    if(lavoroCorrente){
      stile(9, "italic", [110,116,122]);
      const r = doc.splitTextToSize(lavoroCorrente.numero + ")  " + lavoroCorrente.nome + "  (segue)", CW);
      doc.text(r[0], ML, y);
      y += 6;
    }
    doc.setFont(font.fontName, font.fontStyle);
    doc.setFontSize(dim);
    doc.setTextColor(colore);
  }
  // garantisce "spazio" mm prima di LIMITE, altrimenti pagina nuova
  function spazio(h){ if(y + h > LIMITE){ nuovaPagina(); return true; } return false; }
  // testo a capo e spezzato riga per riga tra le pagine
  function paragrafo(testo, x, larg, dim, interlinea, peso, colore){
    stile(dim, peso, colore);
    doc.splitTextToSize(String(testo), larg).forEach(r=>{
      if(spazio(interlinea)) stile(dim, peso, colore);
      doc.text(r, x, y);
      y += interlinea;
    });
  }
  // elenco puntato (materiali, spese): rientro sospeso, una voce non si spezza tra due pagine se corta
  function voce(testo, x, larg, dim, interlinea, aDestra){
    stile(dim);
    const righe = doc.splitTextToSize(String(testo), larg - 5);
    if(righe.length <= 4) spazio(righe.length * interlinea);
    righe.forEach((r, k)=>{
      if(spazio(interlinea)) stile(dim);
      if(k === 0){ doc.text("–", x, y); if(aDestra) doc.text(aDestra, W - MR, y, {align:"right"}); }
      doc.text(r, x + 4, y);
      y += interlinea;
    });
  }
  // altezza di un testo a capo (per decidere cosa tenere insieme)
  function altezza(testo, larg, dim, interlinea){
    doc.setFontSize(dim);
    return doc.splitTextToSize(String(testo), larg).length * interlinea;
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
        stile(10, "bold");
        doc.text(r === 0 ? titolo : titolo.replace(":", " (segue):"), x0, y);
        y += 2.5;
      }
      for(let k = a; k <= b; k++){
        const cx = x0 + (k - a) * (colW + gap);
        const m = misure[k];
        try{ doc.addImage(immagini[k].src, "JPEG", sola ? cx : cx + (colW - m.w) / 2, y, m.w, m.h); }catch(e){}
      }
      if(casella) libera = { x: x0 + colW + gap, y, w: colW, h: rowH };
      y += rowH + gap;
    });
    return libera;
  }
  // firma: etichetta, firma appoggiata sulla linea, firmatario sotto
  function firma(c, x, yTop, larg){
    const lineaY = yTop + 24;
    const m = misureFirmaPDF(doc, c.firma, Math.min(larg - 32, 75), 21);
    stile(10, "bold");
    doc.text("Firma cliente:", x, lineaY - 1);
    try{ doc.addImage(c.firma, "PNG", x + 32, lineaY - m.h - 0.5, m.w, m.h); }catch(e){}
    doc.setDrawColor(180,184,189); doc.setLineWidth(0.2);
    doc.line(x + 32, lineaY, x + 32 + Math.min(larg - 32, 75), lineaY);
    if(c.firmatario){
      stile(8.5);
      doc.text("Firmatario: " + c.firmatario.toUpperCase(), x + 32, lineaY + 4.2);
    }
    stile(10);
  }

  // ---------------------------------------------------------------- data, tecnici, orario
  stile(11, "bold");
  doc.text("Data:", ML, y);
  stile(11);
  doc.text(data, ML + 12, y);
  if(d.tecnici){
    stile(11, "bold");
    doc.text("Tecnici:", ML + 45, y);
    stile(11);
    const t = doc.splitTextToSize(d.tecnici, CW - 45 - 18);
    t.forEach((r, k)=>doc.text(r, ML + 63, y + k * 5));
    y += (t.length - 1) * 5;
  }
  y += 7;
  if(d.operai.length){
    stile(10, "bold");
    doc.text("Orario" + (d.escludi ? "  (giornata esclusa dal monte ore)" : ""), ML, y);
    y += 5;
    d.operai.forEach(op=>{
      stile(10);
      const nome = doc.splitTextToSize(op.nome, 68);
      spazio(nome.length * 4.6);
      doc.text(nome, ML + 2, y);
      doc.text((op.dalle || "—") + "  –  " + (op.alle || "—"), ML + 74, y);
      const ore = contoOreOperaio(op, "").trim();
      if(ore) doc.text(ore.replace(/^\(|\)$/g, ""), ML + 110, y);
      y += nome.length * 4.6;
    });
    y += 2;
  }
  doc.setDrawColor(220,223,227); doc.setLineWidth(0.3);
  doc.line(ML, y, W - MR, y);
  y += 8;

  // ---------------------------------------------------------------- lavori eseguiti
  stile(12, "bold");
  doc.text("LAVORI ESEGUITI", ML, y);
  y += 8;
  if(d.clienti.length === 0){
    stile(11);
    doc.text("-", ML, y); y += 8;
  }
  d.clienti.forEach((c, i)=>{
    const numero = i + 1;
    // titolo del lavoro: numero, nome (a capo), etichette a destra
    const etichette = [c.urgente ? "URGENZA" : "", c.stato === "Da ultimare" ? "DA ULTIMARE" : ""].filter(Boolean).join("  ·  ");
    stile(8.5, "bold");
    const largEtichette = etichette ? doc.getTextWidth(etichette) + 4 : 0;
    stile(11.5, "bold");
    const nomeRighe = doc.splitTextToSize(c.nome + rigaOrarioCliente(c), CWR - largEtichette);
    const meta = [c.indirizzo, c.tipologia ? "Tipologia: " + c.tipologia : "", c.fatturare ? "Fatturare a: " + c.fatturare : ""].filter(Boolean).join("   ·   ");
    const altMeta = meta ? altezza(meta, CWR, 9.5, 4.4) + 1.5 : 0;
    // il titolo resta con il suo inizio: righe del nome, dati del cliente e almeno ~3 righe di contenuto
    spazio(nomeRighe.length * 5.2 + altMeta + 16);
    if(c.urgente){
      doc.setFillColor(253,240,239);
      doc.rect(ML - 2, y - 5, CW + 4, nomeRighe.length * 5.2 + 2.6, "F");
      doc.setFillColor(179,65,58);
      doc.rect(ML - 2, y - 5, 1.6, nomeRighe.length * 5.2 + 2.6, "F");
    }
    stile(11.5, "bold");
    doc.text(numero + ")", ML, y);
    doc.text(nomeRighe, RIENTRO, y);
    if(etichette){
      stile(8.5, "bold", [179,65,58]);
      doc.text(etichette, W - MR, y, {align:"right"});
    }
    y += nomeRighe.length * 5.2 + 0.8;
    lavoroCorrente = { numero, nome: c.nome };
    if(meta){ paragrafo(meta, RIENTRO, CWR, 9.5, 4.4, "italic", [90,96,104]); y += 1.5; }
    if(c.dettagli){ y += 1; paragrafo(c.dettagli, RIENTRO, CWR, 10.5, 5); y += 2; }
    if(c.materiali && c.materiali.length){
      spazio(5 + Math.min(2, c.materiali.length) * 4.8);          // titolo con almeno due voci
      stile(10, "bold");
      doc.text("Materiale:", RIENTRO, y);
      y += 5;
      c.materiali.forEach(m=>voce(testoMateriale(m), RIENTRO + 2, CWR - 2, 10, 4.8));
      y += 2;
    }
    if(c.importo){
      spazio(7);
      stile(10.5, "bold");
      doc.text("Da fatturare:", RIENTRO, y);
      doc.text(euro(c.importo), RIENTRO + 32, y);
      y += 7;
    }
    let libera = null;
    if(c.foto && c.foto.length){
      // con un numero dispari di foto (piu' di una) la firma va nella casella libera accanto all'ultima
      const accanto = !!(c.firma && c.foto.length > 1 && c.foto.length % 2 === 1);
      libera = griglia("Foto:", c.foto, RIENTRO, CWR, c.firma ? (accanto ? "accanto" : "sotto") : null);
      if(libera) firma(c, libera.x, libera.y + libera.h - ALTEZZA_FIRMA, libera.w);
    }
    if(c.firma && !libera){
      spazio(ALTEZZA_FIRMA);
      firma(c, RIENTRO, y, CWR);
      y += ALTEZZA_FIRMA;
    }
    lavoroCorrente = null;
    // separatore tra un lavoro e il successivo
    if(i < d.clienti.length - 1 && y + 4 < LIMITE){
      y += 1;
      doc.setDrawColor(226,229,232); doc.setLineWidth(0.25);
      doc.line(ML, y, W - MR, y);
      y += 7;
    } else y += 4;
  });

  // ---------------------------------------------------------------- da fatturare
  const totImporti = totaleImporti(d.clienti);
  if(totImporti){
    const conImporto = d.clienti.filter(c=>c.importo);
    spazio(Math.min(12 + conImporto.length * 5.5 + 7, 40));
    stile(12, "bold");
    doc.text("DA FATTURARE", ML, y);
    y += 7;
    conImporto.forEach(c=>voce(c.nome, ML + 2, CW - 32, 10.5, 5.2, euro(c.importo)));
    spazio(7);
    stile(10.5, "bold");
    doc.text("Totale", ML + 6, y + 1);
    doc.text(euro(totImporti), W - MR, y + 1, {align:"right"});
    y += 11;
  }

  // ---------------------------------------------------------------- spese
  if(d.spese.length){
    spazio(Math.min(12 + d.spese.length * 5.2 + 7, 40));
    stile(12, "bold");
    doc.text("SPESE / EXTRA", ML, y);
    y += 7;
    d.spese.forEach(s=>{
      // se la spesa e' collegata a un cliente lo indico tra parentesi
      const cli = s.clienteId ? d.clienti.find(c=>c.id === s.clienteId) : null;
      voce(s.d + (cli ? "  (" + cli.nome + ")" : ""), ML + 2, CW - 32, 10.5, 5.2, euro(s.i));
    });
    spazio(7);
    stile(10.5, "bold");
    doc.text("Totale spese", ML + 6, y + 1);
    doc.text(euro(totaleSpese(d.spese)), W - MR, y + 1, {align:"right"});
    y += 9;
    const scontrini = d.spese.filter(s=>s.allegato && s.allegato.src).map(s=>s.allegato);
    if(scontrini.length) griglia(scontrini.length > 1 ? "Allegati spese:" : "Allegato spesa:", scontrini, ML, CW, 0);
  }

  aggiungiPiePagina(doc, "Rapporto del " + data);
  return doc;
}
// sceglie il formato del PDF giornaliero in base alla casella nella sezione clienti
export function generaPDF(){
  return document.getElementById("pdf-foglio-unico").checked ? generaPDFFoglioUnico() : generaPDFPerCliente();
}
