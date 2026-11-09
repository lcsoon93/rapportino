// PDF dei rapportini e della giornata (stile COMP.HAS: bianco, blu scuro, grigi chiari).
// Un solo motore di impaginazione (impaginatore) scrive i contenuti di un cliente; cambia solo la
// "cornice" in cui scrive:
//   - pagina A4 intera:  rapportino singolo (generaPDFPerCliente con un cliente) e foglio unico della
//                        giornata (generaPDFFoglioUnico, tutti i lavori numerati);
//   - colonna A5:        stampa multi-cliente su A4 orizzontale, due rapportini A5 verticali affiancati
//                        (148,5 x 210 mm), linea tratteggiata verticale "TAGLIA QUI"; ogni cliente parte
//                        da una colonna nuova e non sconfina mai nell'altra.
// Se un contenuto non entra nell'area continua nella successiva (pagina o colonna) con il richiamo
// del cliente "(segue)". Testi e tabelle si spezzano riga per riga; un titolo non resta mai da solo
// in fondo; foto con proporzioni reali (ridotte se non entrano per poco); firma con l'ultima foto.
import { dataIt } from "../../utils/dates.js";
import { minutiCliente, totaleImporti, totaleSpese } from "../calculations.js";
import { rigaOrarioCliente } from "../../modules/report.js";
import { contoOreOperaio, orePerCliente } from "../../core/preferenze.js";
import { euro, oreTesto } from "../../utils/formatters.js";
import { datiGiornata } from "../../modules/rapportini.js";
import {
  aggiungiPiePagina, COLORI, coloreLinea, coloreRiempimento, etichetteStato, filigranaPDF, intestazioneCompatta,
  intestazionePDF, misureFirmaPDF, riferimentoGiornata, righeConSeparatori, sottotitolo, stileTesto, titoloSezione,
} from "./comune.js";

const TITOLO_RAPPORTINO = "RAPPORTINO DI INTERVENTO";
const TITOLO_GIORNATA = "RAPPORTO DI LAVORO GIORNALIERO";
const W = 210;
const statiCliente = c=>[c.urgente ? "URGENZA" : "", c.stato === "Da ultimare" ? "DA ULTIMARE" : ""].filter(Boolean);
const datiSede = c=>[c.indirizzo, c.tipologia ? "Tipologia: " + c.tipologia : "", c.fatturare ? "Fatturare a: " + c.fatturare : "",
  c.oreLavoro ? "Ore di lavoro: " + oreTesto(c.oreLavoro) : ""].filter(Boolean);
// spunta "solo ore per cliente": niente orario dei tecnici; per ogni cliente le ore di lavoro (tempo sul posto)
const conOrePerCliente = d=>!orePerCliente() ? d
  : { ...d, soloOreCliente: true, tecnici: d.tecnici || (d.operai || []).map(o=>o.nome).filter(Boolean).join(" / "),
      clienti: d.clienti.map(c=>({ ...c, oreLavoro: minutiCliente(c, d) })) };
const oreOperaio = op=>contoOreOperaio(op, "").trim().replace(/^\(|\)$/g, "");
const nuovoDoc = ()=>{ const { jsPDF } = window.jspdf; return new jsPDF({unit:"mm", format:"a4"}); };

// misure e corpi del testo per i due formati (nella colonna il testo resta leggibile: minimo 8,5 pt)
const STILI = {
  pagina: { testo: 10.5, inter: 5, sotto: 7.8, nome: 12, sede: 9.5, interSede: 4.5, tab: 10, interTab: 4.8, tabTit: 7.2,
            fotoMaxH: 70, fotoSolaW: 120, fotoSolaH: 90, fotoMin: 40, fotoSolaMin: 50, gap: 5,
            firmaH: 33, firmaW: 80, firmaImgH: 19, rientro: 11 },
  // colonna A5 verticale della stampa multi-cliente (larghezza utile ~128 mm)
  colonna: { testo: 9.5, inter: 4.5, sotto: 7.2, nome: 11.5, sede: 8.5, interSede: 4.1, tab: 9, interTab: 4.3, tabTit: 6.8,
            fotoMaxH: 56, fotoSolaW: 96, fotoSolaH: 72, fotoMin: 34, fotoSolaMin: 40, gap: 4,
            firmaH: 26, firmaW: 70, firmaImgH: 14, rientro: 0 },
};

// =====================================================================================================
// Motore di impaginazione. cornice = { x0, x1, limite: ()=>mm, nuovaArea: ()=>y } (la cornice disegna
// intestazioni, filigrana e piede della nuova area). Restituisce le funzioni di scrittura.
function impaginatore(doc, s, cornice, yIniziale){
  // x dell'area corrente: si rileggono a ogni area nuova (nelle colonne affiancate cambiano); le funzioni
  // di scrittura spostano cio' che resta da scrivere della differenza (dx) tra l'area di partenza e quella attuale
  let X0, X1, CW;
  const leggiCornice = ()=>{ X0 = cornice.x0; X1 = cornice.x1; CW = X1 - X0; };
  leggiCornice();
  const im = { y: yIniziale, segue: "" };     // segue: richiamo del cliente nelle aree successive
  im.leggiCornice = ()=>leggiCornice();
  let cima = -1;                               // quota del primo contenuto dell'area corrente
  let riprendi = null;                         // ridisegna l'intestazione di una tabella in un'area nuova

  // area nuova: intestazione (dalla cornice), richiamo del cliente, stesso stile del testo di prima
  function nuova(){
    const font = doc.getFont(), dim = doc.getFontSize(), colore = doc.getTextColor();
    im.y = cornice.nuovaArea();
    leggiCornice();
    if(im.segue){
      stileTesto(doc, s === STILI.pagina ? 8.5 : 8.2, "italic", COLORI.grigio);
      doc.text(doc.splitTextToSize(im.segue + "  (segue)", CW)[0], X0, im.y);
      im.y += 5.5;
    }
    if(riprendi) riprendi();
    doc.setFont(font.fontName, font.fontStyle);
    doc.setFontSize(dim);
    doc.setTextColor(colore);
    cima = im.y;
  }
  // garantisce h mm prima del fondo dell'area, altrimenti area nuova
  im.spazio = h=>{ if(im.y + h > cornice.limite()){ nuova(); return true; } return false; };
  // testo (o righe gia' spezzate) scritto riga per riga; una riga vuota in cima a un'area si salta
  im.paragrafo = (testo, x, larg, dim, inter, peso, colore)=>{
    const base = X0;
    stileTesto(doc, dim, peso, colore);
    (Array.isArray(testo) ? testo : doc.splitTextToSize(String(testo), larg)).forEach(r=>{
      if(im.spazio(inter)) stileTesto(doc, dim, peso, colore);
      if(!String(r).trim() && im.y === cima) return;
      doc.text(r, x + X0 - base, im.y);
      im.y += inter;
    });
  };
  // sottotitolo tenuto con almeno "dopo" mm del suo contenuto
  im.sezione = (testo, x, dopo)=>{
    const base = X0;
    im.spazio(5.5 + (dopo || 10));
    sottotitolo(doc, testo, x + X0 - base, im.y, s.sotto);
    im.y += s === STILI.pagina ? 5 : 4.4;
  };
  // tabella a due colonne (descrizione | valore a destra) senza bordi pesanti: intestazione su fondo
  // grigio chiaro ripetuta se la tabella continua; riservaFinale tiene l'ultima riga con cio' che segue
  im.tabella = (x0, larg, titoli, righe, riservaFinale)=>{
    const base = X0;
    let x = x0;
    const intestazione = ()=>{
      x = x0 + X0 - base;
      coloreRiempimento(doc, COLORI.sfondo);
      doc.rect(x, im.y - 3.6, larg, 5.3, "F");
      stileTesto(doc, s.tabTit, "bold", COLORI.grigio);
      doc.text(titoli[0].toUpperCase(), x + 2, im.y, {charSpace: 0.2});
      doc.text(titoli[1].toUpperCase(), x + larg - 2, im.y, {align:"right"});
      im.y += 5.6;
    };
    im.spazio(6 + Math.min(2, righe.length) * (s.interTab + 0.8));
    intestazione();
    riprendi = intestazione;
    righe.forEach(([testo, valore], n)=>{
      stileTesto(doc, s.tab);
      const r = doc.splitTextToSize(String(testo), larg - 28);
      const fine = n === righe.length - 1 ? (riservaFinale || 0) : 0;
      if(r.length <= 4) im.spazio(r.length * s.interTab + 1 + fine);
      r.forEach((t, k)=>{
        if(im.spazio(s.interTab)) stileTesto(doc, s.tab);
        x = x0 + X0 - base;
        doc.text(t, x + 2, im.y);
        if(k === 0 && valore) doc.text(String(valore), x + larg - 2, im.y, {align:"right"});
        im.y += s.interTab;
      });
      coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.2);
      doc.line(x, im.y - s.interTab + 1.5, x + larg, im.y - s.interTab + 1.5);
      im.y += 0.9;
    });
    riprendi = null;
  };
  // griglia di immagini con proporzioni reali e filo sottile: una sola immagine piu' grande, altrimenti
  // due per riga, riga alta quanto l'immagine piu' alta. firma: "sotto" = tiene lo spazio della firma con
  // l'ultima riga; "accanto" = la firma va nella casella libera accanto all'ultima immagine (se la riga e'
  // troppo bassa va sotto, sempre nella stessa area). Restituisce la casella libera.
  im.griglia = (titolo, immagini, xPartenza, larg, firma)=>{
    const base = X0;
    let x0 = xPartenza;
    const sola = immagini.length === 1, gap = s.gap;
    const colW = sola ? Math.min(larg, s.fotoSolaW) : (larg - gap) / 2, maxH = sola ? s.fotoSolaH : s.fotoMaxH;
    const misure = immagini.map(f=>{
      if(!(f.w && f.h)) return { w: colW, h: maxH };
      const k = Math.min(colW / f.w, maxH / f.h);
      return { w: f.w * k, h: f.h * k };
    });
    const righe = [];
    for(let k = 0; k < immagini.length; k += sola ? 1 : 2) righe.push([k, sola ? k : Math.min(k + 1, immagini.length - 1)]);
    let libera = null;
    righe.forEach(([a, b], r)=>{
      let rowH = Math.max(misure[a].h, misure[b].h);
      const ultima = r === righe.length - 1;
      const casella = ultima && firma === "accanto" && a === b && rowH >= s.firmaH - 2;
      const riserva = ultima && firma && !casella ? s.firmaH + gap : 0;
      const titoloH = r === 0 ? 5 : 0;
      // riga che non entra per poco: ridotta in proporzione (non sotto il 60% e un minimo leggibile)
      const libero = cornice.limite() - im.y - titoloH - riserva;
      const minimo = Math.max(rowH * 0.6, sola ? s.fotoSolaMin : s.fotoMin, casella ? s.firmaH : 0);
      if(rowH > libero && libero >= minimo){
        const f = libero / rowH;
        for(let k = a; k <= b; k++){ misure[k] = { w: misure[k].w * f, h: misure[k].h * f }; }
        rowH = libero;
      }
      const nuovaArea = im.spazio(titoloH + rowH + riserva);
      x0 = xPartenza + X0 - base;
      if(r === 0 || nuovaArea){
        sottotitolo(doc, r === 0 ? titolo : titolo + " (segue)", x0, im.y, s.sotto);
        im.y += 2.5;
      }
      for(let k = a; k <= b; k++){
        const cx = x0 + (k - a) * (colW + gap), m = misure[k];
        const xi = sola ? cx : cx + (colW - m.w) / 2;
        try{ doc.addImage(immagini[k].src, "JPEG", xi, im.y, m.w, m.h); }catch(e){}
        coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.2);
        doc.rect(xi, im.y, m.w, m.h);
      }
      if(casella) libera = { x: x0 + colW + gap, y: im.y, w: colW, h: rowH };
      im.y += rowH + gap;
    });
    return libera;
  };
  // firma: titolo, firma appoggiata sulla linea, firmatario sotto (alta s.firmaH)
  im.firma = (c, x, yTop, larg)=>{
    const lineaY = yTop + s.firmaH - 8;
    const lw = Math.min(larg, s.firmaW);
    // la firma sta tra il titoletto (che finisce a ~yTop+4) e la linea: mai sovrapposta al titoletto
    const m = misureFirmaPDF(doc, c.firma, lw, Math.min(s.firmaImgH, lineaY - yTop - 5));
    sottotitolo(doc, "Firma del cliente", x, yTop + 3, s.sotto);
    try{ doc.addImage(c.firma, "PNG", x, lineaY - m.h - 0.5, m.w, m.h); }catch(e){}
    coloreLinea(doc, [190,196,202]); doc.setLineWidth(0.2);
    doc.line(x, lineaY, x + lw, lineaY);
    if(c.firmatario){
      stileTesto(doc, s === STILI.pagina ? 8.5 : 7.8, "normal", COLORI.grigio);
      doc.text("Firmatario: " + c.firmatario.toUpperCase(), x, lineaY + 4);
    }
    stileTesto(doc, s.testo);
  };

  // riquadro dei dati: data, riferimento, tecnici e orario di ciascun tecnico
  // (pagina: griglia con tabella degli orari; colonna: due righe compatte)
  im.datiGenerali = ({ data, riferimento, tecnici, operai, escludi, orari })=>{
    const y0 = im.y;
    if(s === STILI.pagina){
      stileTesto(doc, 10.5);
      const tec = tecnici ? doc.splitTextToSize(tecnici, CW - 92) : ["—"];
      stileTesto(doc, 9.5);
      const righeOrario = orari ? operai.map(op=>({ nome: doc.splitTextToSize(op.nome, 66), op })) : [];
      const yEt = y0 + 1, yVal = yEt + 5, yDopo = yVal + (tec.length - 1) * 5 + 3;
      let yFine = yVal + (tec.length - 1) * 5 + 4.5;
      if(righeOrario.length){ let yr = yDopo + 12; righeOrario.forEach(r=>{ yFine = yr + (r.nome.length - 1) * 4.6 + 4; yr += r.nome.length * 4.6 + 1.2; }); }
      coloreRiempimento(doc, COLORI.sfondo);
      doc.roundedRect(X0, yEt - 6, CW, yFine - (yEt - 6), 1.5, 1.5, "F");
      stileTesto(doc, 7.2, "bold", COLORI.grigio);
      doc.text("DATA", X0 + 5, yEt, {charSpace: 0.2});
      doc.text("RIFERIMENTO", X0 + 42, yEt, {charSpace: 0.2});
      doc.text("TECNICI", X0 + 87, yEt, {charSpace: 0.2});
      stileTesto(doc, 10.5, "bold");
      doc.text(data, X0 + 5, yVal);
      stileTesto(doc, 10.5);
      doc.text(riferimento, X0 + 42, yVal);
      tec.forEach((t, k)=>doc.text(t, X0 + 87, yVal + k * 5));
      if(righeOrario.length){
        let y = yDopo;
        coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.3);
        doc.line(X0 + 5, y, X1 - 5, y);
        y += 6;
        stileTesto(doc, 7.2, "bold", COLORI.grigio);
        doc.text("ORARIO DEI TECNICI" + (escludi ? "  (GIORNATA ESCLUSA DAL MONTE ORE)" : ""), X0 + 5, y, {charSpace: 0.2});
        doc.text("DALLE", X0 + 82, y, {charSpace: 0.2});
        doc.text("ALLE", X0 + 106, y, {charSpace: 0.2});
        doc.text("ORE", X1 - 5, y, {align:"right"});
        y += 6;
        righeOrario.forEach(({ nome, op }, k)=>{
          stileTesto(doc, 9.5);
          doc.text(nome, X0 + 5, y);
          doc.text(op.dalle || "—", X0 + 82, y);
          doc.text(op.alle || "—", X0 + 106, y);
          const ore = oreOperaio(op);
          if(ore){ stileTesto(doc, 9.5, "bold"); doc.text(ore, X1 - 5, y, {align:"right"}); }
          y += nome.length * 4.6 + 1.2;
          if(k < righeOrario.length - 1){ coloreLinea(doc, [230,233,236]); doc.setLineWidth(0.2); doc.line(X0 + 5, y - 3.6, X1 - 5, y - 3.6); }
        });
      }
      im.y = yFine + 10;
    } else {
      stileTesto(doc, 9);
      const tec = tecnici ? doc.splitTextToSize(tecnici, CW - 60) : ["—"];
      const or = orari && operai.length
        ? doc.splitTextToSize(operai.map(op=>op.nome + "  " + (op.dalle || "—") + "–" + (op.alle || "—") +
            (oreOperaio(op) ? " (" + oreOperaio(op) + ")" : "")).join("     "), CW - 22) : [];
      const alt = 3 + tec.length * 4.3 + (or.length ? or.length * 4.1 + 1 : 0) + 1.5;
      coloreRiempimento(doc, COLORI.sfondo);
      doc.roundedRect(X0, y0 - 4, CW, alt, 1.2, 1.2, "F");
      stileTesto(doc, 6.8, "bold", COLORI.grigio);
      doc.text("DATA", X0 + 3, y0);
      doc.text("TECNICI", X0 + 40, y0);
      stileTesto(doc, 9);
      doc.text(data, X0 + 12, y0);
      tec.forEach((t, k)=>doc.text(t, X0 + 54, y0 + k * 4.3));
      let y = y0 + tec.length * 4.3;
      if(or.length){
        stileTesto(doc, 6.8, "bold", COLORI.grigio);
        doc.text("ORARIO", X0 + 3, y + 0.6);
        stileTesto(doc, 8.6);
        or.forEach((o, k)=>doc.text(o, X0 + 19, y + 0.6 + k * 4.1));
        y += or.length * 4.1 + 1;
      }
      im.y = y + 6;
    }
  };

  // tutto cio' che riguarda un cliente: nome (con numero facoltativo) e stati, sede, attivita' svolte,
  // materiali, importo, spese (con scontrini), fotografie, note, firma
  im.cliente = (c, { numero, spese } = {})=>{
    // posizioni relative all'area corrente (si rileggono dopo ogni possibile cambio di area/colonna)
    const R = ()=>X0 + s.rientro, CWR = ()=>X1 - R();
    const stati = statiCliente(c);
    stileTesto(doc, 7.2, "bold");
    const largStati = stati.reduce((t, st)=>t + doc.getTextWidth(st) + 5.5, 0);
    stileTesto(doc, s.nome, "bold");
    const nomeRel = numero ? s.rientro : 0, nomeL = X1 - X0 - nomeRel - largStati - 2;
    const nomeRighe = doc.splitTextToSize(c.nome + rigaOrarioCliente(c), Math.max(nomeL, 40));
    stileTesto(doc, s.sede);
    const righeSede = righeConSeparatori(doc, datiSede(c), "   ·   ", X1 - X0 - nomeRel);
    const interNome = s.nome * 0.45;
    // il nome resta con la sede e almeno ~3 righe di contenuto
    im.spazio(nomeRighe.length * interNome + righeSede.length * s.interSede + 18);
    if(numero){
      coloreRiempimento(doc, COLORI.blu);
      doc.roundedRect(X0, im.y - 4.6, 7.5, 6.2, 1.2, 1.2, "F");
      stileTesto(doc, 9.5, "bold", [255,255,255]);
      doc.text(String(numero), X0 + 3.75, im.y, {align:"center"});
    }
    stileTesto(doc, s.nome, "bold");
    doc.text(nomeRighe, X0 + nomeRel, im.y);
    if(stati.length) etichetteStato(doc, stati, X1, im.y - 0.6);
    im.y += nomeRighe.length * interNome + 0.6;
    im.segue = (numero ? numero + ")  " : "") + c.nome;
    if(righeSede.length) im.paragrafo(righeSede, X0 + nomeRel, X1 - X0 - nomeRel, s.sede, s.interSede, "normal", COLORI.grigio);
    im.y += 3;

    if(c.dettagli){
      im.sezione("Attività svolte", R());
      im.paragrafo(c.dettagli, R(), CWR(), s.testo, s.inter);
      im.y += 2.5;
    }
    if(c.materiali && c.materiali.length){
      im.sezione("Materiali utilizzati", R(), 16);
      im.tabella(R(), CWR(), ["Descrizione", "Q.tà"], c.materiali.map(m=>[m.a || "", m.q || ""]));
      im.y += 2.5;
    }
    if(c.importo){
      im.spazio(7.5);
      stileTesto(doc, s.sotto, "bold", COLORI.grigio);
      doc.text("IMPORTO DA FATTURARE", R(), im.y, {charSpace: 0.2});
      stileTesto(doc, s.testo, "bold");
      doc.text(euro(c.importo), X1, im.y, {align:"right"});
      im.y += 7.5;
    }
    if(spese && spese.length){
      im.sezione("Spese", R(), 12);
      im.tabella(R(), CWR(), ["Descrizione", "Importo"], spese.map(sp=>[sp.d, euro(sp.i)]), spese.length > 1 ? 6 : 0);
      if(spese.length > 1){
        stileTesto(doc, s.tab, "bold");
        doc.text("Totale spese", R() + 2, im.y + 0.8);
        doc.text(euro(totaleSpese(spese)), X1 - 2, im.y + 0.8, {align:"right"});
        im.y += 6;
      }
      im.y += 2;
      const scontrini = spese.filter(sp=>sp.allegato && sp.allegato.src).map(sp=>sp.allegato);
      if(scontrini.length) im.griglia(scontrini.length > 1 ? "Allegati spese" : "Allegato spesa", scontrini, R(), CWR(), null);
    }
    let libera = null;
    if(c.foto && c.foto.length){
      // con un numero dispari di foto (piu' di una) la firma va accanto all'ultima, se non ci sono note
      const accanto = !!(c.firma && !c.note && c.foto.length > 1 && c.foto.length % 2 === 1);
      libera = im.griglia("Fotografie", c.foto, R(), CWR(), c.firma && !c.note ? (accanto ? "accanto" : "sotto") : null);
      if(libera) im.firma(c, libera.x, libera.y + libera.h - s.firmaH, libera.w);
    }
    if(c.note){
      im.sezione("Note", R());
      im.paragrafo(c.note, R(), CWR(), s.testo, s.inter);
      im.y += 2.5;
    }
    if(c.firma && !libera){
      im.spazio(s.firmaH);
      im.firma(c, R(), im.y, CWR());
      im.y += s.firmaH;
    }
    im.segue = "";
  };
  return im;
}

// =====================================================================================================
// Cornice "pagina A4": prima pagina con intestazione completa, le altre con intestazione compatta e
// filigrana. Usata dal rapportino singolo e dal foglio unico della giornata.
function documentoPagina(titolo, info){
  const doc = nuovoDoc();
  const ML = 18, MR = 18;
  const y0 = intestazionePDF(doc, titolo, info);
  const im = impaginatore(doc, STILI.pagina, {
    x0: ML, x1: W - MR, limite: ()=>276,
    nuovaArea: ()=>{ doc.addPage(); filigranaPDF(doc, W / 2, 155, 125); return intestazioneCompatta(doc, titolo, info) + 7; },
  }, y0);
  return { doc, im, ML, MR };
}

// rapportino di un solo cliente (layout normale, A4)
function rapportinoSingolo(d, iso){
  const data = dataIt(iso);
  const rif = d.riferimento || riferimentoGiornata(data);
  const { doc, im } = documentoPagina(TITOLO_RAPPORTINO, { riferimento: rif, data });
  im.datiGenerali({ data, riferimento: rif, tecnici: d.tecnici, operai: d.operai, escludi: d.escludi, orari: !d.soloOreCliente });
  const c = d.clienti[0];
  if(c) im.cliente(c, { spese: d.spese.filter(sp=>sp.clienteId && sp.clienteId === c.id) });
  else { stileTesto(doc, 10.5, "normal", COLORI.grigio); doc.text("Nessun lavoro cliente registrato per questo giorno.", 18, im.y); }
  aggiungiPiePagina(doc, "Rapportino N. " + rif + " del " + data);
  return doc;
}

// =====================================================================================================
// Stampa multi-cliente: foglio A4 orizzontale (297 x 210 mm) con due rapportini A5 verticali affiancati
// (148,5 x 210 mm): cliente 1 a sinistra, cliente 2 a destra, poi altri fogli. Rispetto al foglio tenuto in
// verticale ogni rapportino e' ruotato di 90 gradi: dopo il taglio verticale (linea tratteggiata "TAGLIA
// QUI") ciascuna meta' e' un A5 verticale che si legge normalmente. Ogni cliente parte da una colonna
// nuova e non sconfina nell'altra; se non basta continua nella colonna successiva con il richiamo del
// cliente. Un cliente rimasto da solo occupa una sola meta' (nessuna linea di taglio, nessun duplicato).
function multiCliente(d, iso){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4", orientation:"landscape"});
  const LW = 297, LH = 210, MEZZO = LW / 2;
  const MARGINE_EST = 12, MARGINE_INT = 8, ALTO = 10, BASSO = 15;   // dal bordo del foglio / dalla linea di taglio
  const data = dataIt(iso);
  const base = riferimentoGiornata(data);
  const piedi = [];                                // { pagina, x0, x1, y }: numerazione scritta alla fine
  let colonna = -1, cliente = null;                // colonna: 0 = sinistra pag.1, 1 = destra pag.1, 2 = sinistra pag.2…
  const cornice = { x0: MARGINE_EST, x1: MEZZO - MARGINE_INT, limite: ()=>LH - BASSO, nuovaArea: ()=>nuovaColonna() };

  // linea di taglio verticale al centro, con la scritta lungo la linea (non invade le colonne)
  function lineaTaglio(){
    coloreLinea(doc, [170,176,182]); doc.setLineWidth(0.3);
    if(doc.setLineDashPattern) doc.setLineDashPattern([2.2, 1.6], 0);
    doc.line(MEZZO, 5, MEZZO, LH - 5);
    if(doc.setLineDashPattern) doc.setLineDashPattern([], 0);
    stileTesto(doc, 7, "bold", [140,147,154]);
    const t = "TAGLIA QUI", spaziatura = 0.4;
    const larg = doc.getTextWidth(t) + spaziatura * (t.length - 1);
    coloreRiempimento(doc, [255,255,255]);
    doc.rect(MEZZO - 2.2, LH / 2 - larg / 2 - 3, 4.4, larg + 6, "F");
    doc.text(t, MEZZO + 1.1, LH / 2 + larg / 2, {angle: 90, charSpace: spaziatura});
  }
  // nuova colonna: intestazione compatta (logo, titolo, N. e data, "Cliente i di n"), piede e, dalla
  // seconda pagina, filigrana. Restituisce la quota da cui scrivere.
  function nuovaColonna(){
    colonna++;
    const destra = colonna % 2 === 1;
    if(!destra && colonna > 0) doc.addPage("a4", "landscape");
    if(destra) lineaTaglio();
    cornice.x0 = destra ? MEZZO + MARGINE_INT : MARGINE_EST;
    cornice.x1 = destra ? LW - MARGINE_EST : MEZZO - MARGINE_INT;
    if(colonna >= 2) filigranaPDF(doc, (cornice.x0 + cornice.x1) / 2, LH / 2 + 6, 95);
    const yl = intestazioneCompatta(doc, TITOLO_RAPPORTINO,
      { riferimento: cliente.rif, data, extra: "Cliente " + cliente.n + " di " + d.clienti.length }, cornice.x0, cornice.x1, ALTO);
    const yp = LH - BASSO + 6;
    stileTesto(doc, 7, "normal", COLORI.grigio);
    doc.text("COMP.HAS assistance SRL", cornice.x0, yp);
    doc.text("Rapportino N. " + cliente.rif + " del " + data, (cornice.x0 + cornice.x1) / 2, yp, {align:"center"});
    piedi.push({ pagina: doc.getNumberOfPages(), x1: cornice.x1, y: yp });
    return yl + 6;
  }
  const im = impaginatore(doc, STILI.colonna, cornice, 0);

  d.clienti.forEach((c, i)=>{
    cliente = { n: i + 1, rif: base + "-" + (i + 1) };
    im.segue = "";
    im.y = nuovaColonna();
    im.leggiCornice();
    // i dati generali in ogni colonna: dopo il taglio ogni rapportino e' completo
    const haOrario = !d.soloOreCliente && (d.mostraOrario || (c.fasce && c.fasce.some(f=>f.d || f.a)) || c.dalle || c.alle);
    im.datiGenerali({ data, riferimento: cliente.rif, tecnici: d.tecnici, operai: d.operai, orari: haOrario });
    im.cliente(c, { spese: d.spese.filter(sp=>sp.clienteId && sp.clienteId === c.id) });
  });
  // numerazione delle pagine nel piede di ogni colonna
  const n = doc.getNumberOfPages();
  piedi.forEach(p=>{
    doc.setPage(p.pagina);
    stileTesto(doc, 7, "normal", COLORI.grigio);
    doc.text("Pagina " + p.pagina + " di " + n, p.x1, p.y, {align:"right"});
  });
  return doc;
}

// =====================================================================================================
// PDF "per cliente": un cliente = rapportino singolo (layout normale); piu' clienti = due per foglio.
// dati/iso facoltativi: senza argomenti usa il foglio giornaliero aperto; con argomenti stampa una
// giornata "virtuale", es. un rapportino (dati.riferimento, dati.mostraOrario, cliente.note)
export function generaPDFPerCliente(dati, iso){
  const d = conOrePerCliente(dati || datiGiornata());
  return d.clienti.length > 1 ? multiCliente(d, iso) : rapportinoSingolo(d, iso);
}

// Foglio unico ("RAPPORTO DI LAVORO GIORNALIERO"): tutti i lavori della giornata numerati e riepiloghi.
export function generaPDFFoglioUnico(dati, iso){
  const d = conOrePerCliente(dati || datiGiornata());
  const data = dataIt(iso);
  const rif = d.riferimento || riferimentoGiornata(data);
  const { doc, im, ML, MR } = documentoPagina(TITOLO_GIORNATA, { riferimento: rif, data });
  const XR = W - MR, CW = XR - ML;
  im.datiGenerali({ data, riferimento: rif, tecnici: d.tecnici, operai: d.operai, escludi: d.escludi, orari: !d.soloOreCliente });

  im.y = titoloSezione(doc, "Lavori eseguiti", ML, im.y, CW);
  if(d.clienti.length === 0){
    stileTesto(doc, 10.5, "normal", COLORI.grigio);
    doc.text("Nessun lavoro registrato per questa giornata.", ML, im.y); im.y += 8;
  }
  d.clienti.forEach((c, i)=>{
    im.cliente(c, { numero: i + 1 });
    // separatore tra un lavoro e il successivo
    if(i < d.clienti.length - 1 && im.y + 4 < 276){
      coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.3);
      doc.line(ML, im.y, XR, im.y);
      im.y += 9;
    } else im.y += 5;
  });

  // riepiloghi: titolo, intestazione, fino a due righe e (se le righe sono al massimo due) il totale
  // restano insieme; l'ultima riga resta sempre con il totale
  const ingombro = n=>10 + 6 + Math.min(n, 2) * 5.8 + (n <= 2 ? 8 : 0);
  const riepilogo = (titolo, colonne, righe, etTotale, totale)=>{
    im.spazio(ingombro(righe.length));
    im.y = titoloSezione(doc, titolo, ML, im.y + 2, CW);
    im.tabella(ML, CW, colonne, righe, 7);
    stileTesto(doc, 10.5, "bold");
    doc.text(etTotale, ML + 2, im.y + 1);
    doc.text(totale, XR - 2, im.y + 1, {align:"right"});
    im.y += 10;
  };
  const totImporti = totaleImporti(d.clienti);
  if(totImporti){
    riepilogo("Da fatturare", ["Cliente", "Importo"], d.clienti.filter(c=>c.importo).map(c=>[c.nome, euro(c.importo)]), "Totale", euro(totImporti));
  }
  if(d.spese.length){
    riepilogo("Spese / extra", ["Descrizione", "Importo"], d.spese.map(sp=>{
      // se la spesa e' collegata a un cliente lo indico tra parentesi
      const cli = sp.clienteId ? d.clienti.find(c=>c.id === sp.clienteId) : null;
      return [sp.d + (cli ? "  (" + cli.nome + ")" : ""), euro(sp.i)];
    }), "Totale spese", euro(totaleSpese(d.spese)));
    const scontrini = d.spese.filter(sp=>sp.allegato && sp.allegato.src).map(sp=>sp.allegato);
    if(scontrini.length) im.griglia(scontrini.length > 1 ? "Allegati spese" : "Allegato spesa", scontrini, ML, CW, null);
  }

  aggiungiPiePagina(doc, "Rapporto N. " + rif + " del " + data);
  return doc;
}
// sceglie il formato del PDF giornaliero in base alla casella nella sezione clienti
export function generaPDF(){
  return document.getElementById("pdf-foglio-unico").checked ? generaPDFFoglioUnico() : generaPDFPerCliente();
}
