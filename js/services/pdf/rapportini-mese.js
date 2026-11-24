// PDF "Rapportini del mese": un solo PDF con i rapportini COMPLETATI di un mese (tutti gli operai o uno),
// A4 verticale con lo stesso impaginatore e le stesse schede del PDF della giornata (dati generali con
// orari e durata di ogni operaio, attività, materiali, foto, note, firma).
// Prima pagina: riepilogo ore per giorno (fascia oraria della giornata e ore effettivamente lavorate,
// distinte), ore per operaio, totale del mese e, a parte, bozze e rapportini non ancora inviati
// (elencati, mai tra i completati). Poi i rapportini, organizzati per giorno.
//
// dati = { periodo: "Novembre 2026", mese: "2026-11", operaio: "Tutti" | nome,
//          riepilogo: riepilogoRapportini(...) con giorni[i].schede = [scheda PDF] }
import { dataIt, dataLunga } from "../../utils/dates.js";
import { oreTesto } from "../../utils/formatters.js";
import { COLORI, aggiungiPiePagina, coloreLinea, coloreRiempimento, stileTesto, titoloSezione } from "./comune.js";
import { documentoPagina } from "./giornata.js";

const TITOLO = "RAPPORTINI DEL MESE";
const W = 210;

// tabella a più colonne con intestazione ripetuta dopo un cambio pagina
function tabella(doc, im, x0, colonne, righe){
  const larg = colonne.reduce((a, c)=>a + c.w, 0);
  const intestazione = ()=>{
    coloreRiempimento(doc, COLORI.sfondo);
    doc.rect(x0, im.y - 3.6, larg, 5.3, "F");
    stileTesto(doc, 7.2, "bold", COLORI.grigio);
    let x = x0;
    colonne.forEach(c=>{ doc.text(c.tit.toUpperCase(), c.destra ? x + c.w - 2 : x + 2, im.y, { align: c.destra ? "right" : "left", charSpace: 0.2 }); x += c.w; });
    im.y += 5.6;
  };
  im.spazio(6 + Math.min(2, righe.length) * 5.6);
  intestazione();
  righe.forEach((r, i)=>{
    stileTesto(doc, 9.5, r.grassetto ? "bold" : "normal");
    const celle = r.celle.map((t, k)=>doc.splitTextToSize(String(t ?? ""), colonne[k].w - 4));
    const h = Math.max(...celle.map(c=>c.length)) * 4.4 + 1.4;
    if(im.spazio(h + 1)) intestazione();
    stileTesto(doc, 9.5, r.grassetto ? "bold" : "normal");
    let x = x0;
    celle.forEach((c, k)=>{ const col = colonne[k]; doc.text(c, col.destra ? x + col.w - 2 : x + 2, im.y, { align: col.destra ? "right" : "left" }); x += col.w; });
    im.y += h;
    if(i < righe.length - 1){ coloreLinea(doc, [230,233,236]); doc.setLineWidth(0.2); doc.line(x0, im.y - 3.4, x0 + larg, im.y - 3.4); }
  });
  im.y += 3;
}

export function generaPDFRapportiniMese(dati){
  const { periodo, operaio, riepilogo: rp } = dati;
  const rif = "MESE-" + String(dati.mese).replace("-", "");
  const { doc, im, ML, MR } = documentoPagina(TITOLO, { riferimento: rif, data: periodo });
  const XR = W - MR, CW = XR - ML;

  stileTesto(doc, 10.5);
  doc.text("Periodo: " + periodo + "    ·    Operaio: " + operaio + "    ·    Rapportini completati: " + rp.rapportini, ML, im.y);
  im.y += 9;

  if(!rp.giorni.length){
    stileTesto(doc, 10.5, "normal", COLORI.grigio);
    doc.text("Nessun rapportino completato in questo mese.", ML, im.y);
    im.y += 9;
  } else {
    im.y = titoloSezione(doc, "Ore per giorno", ML, im.y, CW);
    tabella(doc, im, ML, [
      { tit: "Data", w: 24 }, { tit: "Rapportini", w: 22, destra: true }, { tit: "Fascia della giornata", w: 46 },
      { tit: "Operai (ore effettive)", w: 58 }, { tit: "Ore lavorate", w: CW - 150, destra: true },
    ], rp.giorni.map(g=>({ celle: [
      dataIt(g.iso), g.rapportini.length,
      g.fascia ? g.fascia.dalle + "–" + g.fascia.alle + " (" + oreTesto(g.fascia.minuti) + ")" : "—",
      g.operai.map(o=>o.nome + " " + oreTesto(o.minuti)).join(", ") || "—",
      oreTesto(g.minuti),
    ] })));

    im.y = titoloSezione(doc, "Ore per operaio", ML, im.y + 2, CW);
    tabella(doc, im, ML, [{ tit: "Operaio", w: 90 }, { tit: "Giorni", w: 30, destra: true }, { tit: "Ore lavorate", w: CW - 120, destra: true }],
      rp.operai.map(o=>({ celle: [o.nome, o.giorni, oreTesto(o.minuti)] })).concat([{ grassetto: true, celle: ["Totale del mese", "", oreTesto(rp.totale)] }]));

    im.spazio(14);
    stileTesto(doc, 8.2, "normal", COLORI.grigio);
    const nota = doc.splitTextToSize("Ore lavorate: calcolate dagli orari dei rapportini (dalle–alle) di ciascun operaio, senza contare due volte " +
      "gli intervalli sovrapposti. La fascia della giornata è l'orario di riferimento del giorno e non è il totale delle ore lavorate.", CW);
    doc.text(nota, ML, im.y);
    im.y += nota.length * 3.8 + 5;
  }

  if(rp.esclusi.length){
    im.y = titoloSezione(doc, "Non inclusi (bozze e non inviati)", ML, im.y + 2, CW);
    tabella(doc, im, ML, [{ tit: "Data", w: 24 }, { tit: "Cliente", w: 62 }, { tit: "Operaio", w: 36 }, { tit: "Motivo", w: CW - 122 }],
      rp.esclusi.map(e=>({ celle: [dataIt(e.data), e.cliente, e.operaio || "—", e.motivo] })));
  }

  // rapportini, per giorno
  let n = 0;
  rp.giorni.forEach(g=>{
    im.spazio(10000);                 // ogni giorno da una pagina nuova (intestazione compatta e filigrana)
    im.y = titoloSezione(doc, dataLunga(g.iso) + " — " + g.rapportini.length + (g.rapportini.length === 1 ? " rapportino" : " rapportini") +
      " — ore lavorate " + oreTesto(g.minuti), ML, im.y, CW);
    (g.schede || []).forEach((c, i)=>{
      n++;
      im.segue = "";
      if(i > 0){ im.spazio(60); coloreLinea(doc, COLORI.linea); doc.setLineWidth(0.3); doc.line(ML, im.y, XR, im.y); im.y += 8; }
      else im.spazio(60);
      if(c.intervento){ stileTesto(doc, 9, "normal", COLORI.grigio); doc.text(doc.splitTextToSize("Intervento: " + c.intervento, CW), ML, im.y); im.y += 6; }
      im.datiGenerali({ data: dataIt(g.iso), riferimento: c.rif || "", tecnici: c.tecnici, operai: c.operai, orari: true, senzaOre: true });
      im.cliente(c, { numero: n, spese: [] });
      im.y += 4;
    });
  });

  aggiungiPiePagina(doc, "Rapportini del mese " + periodo + (operaio !== "Tutti" ? " — " + operaio : ""));
  return doc;
}
