// PDF "Riepilogo lavori" di un cliente in un periodo (di solito un mese), dai rapportini su Supabase.
// Solo riepilogo: una tabella Data / Lavoro eseguito / Operai / Ore e i totali (niente foto ne' firme).
// A4 verticale, stile COMP.HAS. Le righe lunghe continuano nella pagina dopo, con l'intestazione della
// tabella ripetuta e "(segue)" nella colonna Data.
//
// dati = {
//   cliente, indirizzi: [..], periodo: "Novembre 2026" | "dal gg/mm/aaaa al gg/mm/aaaa",
//   righe: [{ data: "AAAA-MM-GG", indirizzo, tipologia, attivita, materiali: [{a,q}], esito, bozza,
//             operai: [{ nome, dalle, alle, minuti }] }]          (in ordine di data)
// }
import { dataIt } from "../../utils/dates.js";
import { oreTesto } from "../../utils/formatters.js";
import {
  aggiungiPiePagina, COLORI, coloreLinea, coloreRiempimento, filigranaPDF, intestazioneCompatta, intestazionePDF,
  stileTesto, titoloSezione,
} from "./comune.js";

const TITOLO = "RIEPILOGO LAVORI";
const W = 210, ML = 18, MR = 18, CW = W - ML - MR, LIMITE = 276;
// colonne: Data | Lavoro eseguito | Operai | Ore (totale 174 mm)
const COL = [
  { tit: "Data", w: 21 },
  { tit: "Lavoro eseguito", w: 93 },
  { tit: "Operai", w: 44 },
  { tit: "Ore", w: 16, destra: true },
];
const PAD = 1.8;

// righe di testo di una cella: [{ t, dim, peso, colore, h }]
function righeCella(doc, testo, larg, dim, peso, colore, inter){
  if(!testo) return [];
  stileTesto(doc, dim, peso, colore);
  return doc.splitTextToSize(String(testo), larg).map(t=>({ t, dim, peso, colore, h: inter }));
}
function celleRiga(doc, r){
  const l = COL.map(c=>c.w - PAD * 2);
  const data = righeCella(doc, dataIt(r.data), l[0], 9, "bold", COLORI.testo, 4.4);

  const lavoro = [];
  const stati = [r.bozza ? "IN CORSO (BOZZA)" : "", r.esito === "Da ultimare" ? "DA ULTIMARE" : ""].filter(Boolean);
  if(stati.length) lavoro.push(...righeCella(doc, stati.join("  ·  "), l[1], 7.2, "bold", COLORI.rosso, 3.9));
  const sede = [r.indirizzo, r.tipologia].filter(Boolean).join("  ·  ");
  if(sede) lavoro.push(...righeCella(doc, sede, l[1], 8, "normal", COLORI.grigio, 3.8));
  const att = String(r.attivita || "").split("\n").map(s=>s.trim()).filter(Boolean);
  if(att.length) att.forEach(s=>lavoro.push(...righeCella(doc, s, l[1], 9, "normal", COLORI.testo, 4.3)));
  else lavoro.push(...righeCella(doc, "—", l[1], 9, "normal", COLORI.grigio, 4.3));
  const mat = (r.materiali || []).filter(m=>m && m.a).map(m=>m.q ? m.a + " (" + m.q + ")" : m.a);
  if(mat.length) lavoro.push(...righeCella(doc, "Materiale: " + mat.join(", "), l[1], 8, "normal", COLORI.grigio, 3.8));

  const operai = [];
  (r.operai || []).forEach(o=>{
    operai.push(...righeCella(doc, o.nome, l[2], 8.5, "bold", COLORI.testo, 4));
    const orario = [o.dalle, o.alle].filter(Boolean).join(" – ");
    if(orario) operai.push(...righeCella(doc, orario + "  (" + oreTesto(o.minuti) + ")", l[2], 8, "normal", COLORI.grigio, 3.8));
  });
  if(!operai.length) operai.push(...righeCella(doc, "—", l[2], 8.5, "normal", COLORI.grigio, 4));

  const tot = r.operai.reduce((t, o)=>t + (o.minuti || 0), 0);
  const ore = righeCella(doc, tot ? oreTesto(tot) : "—", l[3], 9, "bold", COLORI.blu, 4.4);
  return [data, lavoro, operai, ore];
}

export function generaPDFRiepilogoCliente(d){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const info = { extra: "Periodo: " + d.periodo };
  let y = intestazionePDF(doc, TITOLO, info);

  // ------------------------------------------------------------ cliente
  y = titoloSezione(doc, "Cliente", ML, y, CW);
  stileTesto(doc, 12.5, "bold", COLORI.testo);
  doc.splitTextToSize(d.cliente, CW).forEach(t=>{ doc.text(t, ML, y); y += 5.6; });
  stileTesto(doc, 9.5, "normal", COLORI.grigio);
  (d.indirizzi || []).forEach(ind=>doc.splitTextToSize(ind, CW).forEach(t=>{ doc.text(t, ML, y); y += 4.6; }));
  doc.text("Periodo: " + d.periodo, ML, y + 0.6);
  y += 10;

  // ------------------------------------------------------------ tabella
  y = titoloSezione(doc, "Lavori eseguiti", ML, y, CW);
  const xs = []; COL.reduce((x, c)=>{ xs.push(x); return x + c.w; }, ML);

  function intestazioneTabella(){
    coloreRiempimento(doc, COLORI.sfondo);
    doc.rect(ML, y - 4.2, CW, 6.6, "F");
    stileTesto(doc, 7.2, "bold", COLORI.blu);
    COL.forEach((c, i)=>{
      if(c.destra) doc.text(c.tit.toUpperCase(), xs[i] + c.w - PAD, y, {align:"right", charSpace: 0.3});
      else doc.text(c.tit.toUpperCase(), xs[i] + PAD, y, {charSpace: 0.3});
    });
    y += 6.2;
  }
  function nuovaPagina(){
    doc.addPage();
    filigranaPDF(doc, W / 2, 155, 125);
    y = intestazioneCompatta(doc, TITOLO, info) + 9;
    intestazioneTabella();
  }
  function scriviRiga(cella, x, w, destra, yy){
    stileTesto(doc, cella.dim, cella.peso, cella.colore);
    if(destra) doc.text(cella.t, x + w - PAD, yy, {align:"right"});
    else doc.text(cella.t, x + PAD, yy);
  }

  if(!d.righe.length){
    stileTesto(doc, 10, "normal", COLORI.grigio);
    doc.text("Nessun rapportino per questo cliente nel periodo scelto.", ML, y + 2);
    y += 10;
  } else {
    intestazioneTabella();
    d.righe.forEach(r=>{
      let celle = celleRiga(doc, r);
      const altezza = c=>c.reduce((t, l)=>t + l.h, 0);
      // una riga che sta in una pagina non si spezza: si va a capo pagina prima
      const alta = Math.max(...celle.map(altezza)) + 2.4;
      if(y + alta > LIMITE && alta < LIMITE - 60) nuovaPagina();
      while(celle.some(c=>c.length)){
        const disponibile = LIMITE - y - 1.2;
        let usato = 0;
        const resto = celle.map((c, i)=>{
          let h = 0, k = 0;
          while(k < c.length && h + c[k].h <= disponibile){ h += c[k].h; k++; }
          let yy = y + (c[0] ? c[0].h - 1.2 : 0);
          c.slice(0, k).forEach(l=>{ scriviRiga(l, xs[i], COL[i].w, COL[i].destra, yy); yy += l.h; });
          usato = Math.max(usato, h);
          return c.slice(k);
        });
        y += usato + 1.2;
        celle = resto;
        if(celle.some(c=>c.length)){
          nuovaPagina();
          celle[0] = [{ t: dataIt(r.data), dim: 8, peso: "bold", colore: COLORI.grigio, h: 4 },
                      { t: "(segue)", dim: 7.5, peso: "normal", colore: COLORI.grigio, h: 3.8 }];
        }
      }
      coloreLinea(doc, COLORI.linea);
      doc.setLineWidth(0.25);
      doc.line(ML, y, ML + CW, y);
      y += 4.4;
    });
  }

  // ------------------------------------------------------------ riepilogo
  const perOperaio = {};
  let totale = 0;
  const giorni = new Set();
  d.righe.forEach(r=>{
    giorni.add(r.data);
    r.operai.forEach(o=>{
      const v = perOperaio[o.nome] || (perOperaio[o.nome] = { minuti: 0, n: 0 });
      v.minuti += o.minuti || 0; v.n++;
      totale += o.minuti || 0;
    });
  });
  const nomi = Object.keys(perOperaio).sort((a, b)=>a.localeCompare(b, "it"));
  const bozze = d.righe.filter(r=>r.bozza).length;
  const servono = 20 + 6 * (2 + nomi.length + (bozze ? 1 : 0)) + 14;
  if(y + servono > LIMITE){ doc.addPage(); filigranaPDF(doc, W / 2, 155, 125); y = intestazioneCompatta(doc, TITOLO, info) + 9; }
  y += 5;
  y = titoloSezione(doc, "Riepilogo", ML, y, CW);
  const voce = (et, val, rientro = 0, colore = COLORI.testo)=>{
    stileTesto(doc, 10, "normal", colore);
    doc.text(et, ML + 2 + rientro, y);
    doc.text(val, W - MR - 2, y, {align:"right"});
    y += 6;
  };
  voce("Interventi (rapportini)", String(d.righe.length));
  voce("Giorni con lavori", String(giorni.size));
  nomi.forEach(n=>{
    const v = perOperaio[n];
    voce(n + " (" + v.n + (v.n === 1 ? " intervento" : " interventi") + ")", oreTesto(v.minuti));
  });
  if(bozze) voce("di cui ancora in corso (bozza)", String(bozze), 0, COLORI.rosso);
  y += 1.5;
  coloreRiempimento(doc, COLORI.blu);
  doc.rect(ML, y - 5.5, CW, 9.5, "F");
  stileTesto(doc, 11.5, "bold", [255, 255, 255]);
  doc.text("TOTALE ORE", ML + 3, y + 0.8);
  doc.text(oreTesto(totale), W - MR - 3, y + 0.8, {align:"right"});
  stileTesto(doc, 10);

  const centro = (d.cliente.length > 38 ? d.cliente.slice(0, 37) + "…" : d.cliente) + " · " + d.periodo;
  aggiungiPiePagina(doc, centro);
  return doc;
}
