// Report: aggregazione di settimana e mese, monte ore, testi per mail.
import { dataIt, GIORNI, giorniLavorativiMese, giorniMese, giorniSettimana } from "../utils/dates.js";
import { eccedenza, minutiCliente, minutiOperaio, minutiSulPosto, ORARIO_ORDINARIO, totaleImporti, totaleSpese } from "../services/calculations.js";
import { contoOreOperaio, orePerCliente } from "../core/preferenze.js";
import { euro, oreTesto, saldoTesto } from "../utils/formatters.js";
import { leggiDB } from "../core/storage.js";
import { datiGiornata } from "./rapportini.js";

// saldo con segno: +1h 30m oppure -45m
// "30 ore (di cui straordinario 3 ore)" - totale lavorato, straordinario = quanto supera le 9 ore di ogni giorno
export function oreMeseTesto(info){
  return oreTesto(info.minuti) + (info.extra ? " (di cui straordinario " + oreTesto(info.extra) + ")" : "");
}
export function monteOreMese(){
  const iso = document.getElementById("mesedata").value;
  const giorni = giorniLavorativiMese(iso);
  return {giorni, minuti: giorni * ORARIO_ORDINARIO};
}
// spunta: nel riepilogo finale del report mensile (PDF e testo) niente ore per operaio
export function oreMeseNascoste(){ return document.getElementById("nascondi-ore-mese").checked; }
export function confrontoAttivo(){ return document.getElementById("confronta-200").checked; }
export function descrizioneMonte(){
  const mo = monteOreMese();
  return "Monte ore del mese: " + mo.giorni + " giorni lavorativi x 9 ore = " + oreTesto(mo.minuti);
}
export function confrontoTesto(min){
  const mo = monteOreMese();
  const d = min - mo.minuti;
  return "Confronto con monte ore (" + oreTesto(mo.minuti) + "): " + oreTesto(min) + " lavorate  " + (d === 0 ? "(pari)" : saldoTesto(d));
}
export function testoMateriale(m){
  return m.q ? m.a + " (" + m.q + ")" : m.a;
}
export function rigaOrarioCliente(c){
  const fasce = c.fasce && c.fasce.length ? c.fasce
              : ((c.dalle || c.alle) ? [{d: c.dalle, a: c.alle}] : []);
  const testi = fasce.map(f=>{
    if(f.d && f.a) return f.d + " - " + f.a;
    if(f.d) return "dalle " + f.d;
    if(f.a) return "fino alle " + f.a;
    return "";
  }).filter(Boolean);
  return testi.length ? " (" + testi.join(" / ") + ")" : "";
}
// Spunta "solo ore per cliente": per ogni giornata i nomi dei tecnici, il tempo sul posto della squadra
// (dal primo arrivo all'ultima uscita) e le ore presso ciascun cliente quando si conoscono.
export function perCliente(d){
  return {
    tecnici: (d.operai || []).map(o=>o.nome).filter(Boolean),
    sulPosto: minutiSulPosto(d.operai),
    clientiOre: (d.clienti || []).filter(c=>c.nome).map(c=>({ nome: c.nome, minuti: minutiCliente(c, d) })),
  };
}
// "Snav (3 ore), Rossi" - clienti della giornata con le ore quando note
export function clientiConOre(r){
  return (r.clientiOre || []).map(c=>c.nome + (c.minuti ? " (" + oreTesto(c.minuti) + ")" : "")).join(", ");
}
export function testoRapporto(){
  const d = datiGiornata();
  const soloCliente = orePerCliente();
  const righe = [];
  righe.push("RAPPORTO DI LAVORO - " + dataIt());
  righe.push("Tecnici: " + (d.tecnici || (soloCliente ? d.operai.map(o=>o.nome).filter(Boolean).join(" / ") : "")));
  righe.push("");
  righe.push("LAVORI ESEGUITI:");
  if(d.clienti.length === 0) righe.push("-");
  d.clienti.forEach((c,i)=>{
    righe.push("");
    righe.push((i+1) + ") " + (c.urgente ? "[URGENZA] " : "") + c.nome + rigaOrarioCliente(c) +
               (c.stato === "Da ultimare" ? "  [DA ULTIMARE]" : ""));
    if(c.indirizzo) righe.push("   " + c.indirizzo);
    if(c.tipologia) righe.push("   Tipologia: " + c.tipologia);
    if(c.fatturare) righe.push("   Fatturare a: " + c.fatturare);
    if(c.dettagli) righe.push("   " + c.dettagli.replaceAll("\n","\n   "));
    if(c.materiali && c.materiali.length){
      righe.push("   Materiale:");
      c.materiali.forEach(m=>righe.push("   - " + testoMateriale(m)));
    }
    if(soloCliente){ const m = minutiCliente(c, d); if(m) righe.push("   Ore di lavoro: " + oreTesto(m)); }
    if(c.importo) righe.push("   Da fatturare: " + euro(c.importo));
    if(c.foto && c.foto.length) righe.push("   Foto allegate: " + c.foto.length + " (vedi PDF)");
    if(c.firma) righe.push("   Firmato dal cliente" + (c.firmatario ? ": " + c.firmatario : "") + " (vedi PDF)");
  });
  if(!soloCliente){
    righe.push("");
    righe.push("ORARIO:");
    if(d.operai.length === 0) righe.push("-");
    d.operai.forEach(op=>{
      righe.push("- " + op.nome + ": " + (op.dalle || "—") + " - " + (op.alle || "—") + contoOreOperaio(op, "  "));
    });
    if(d.escludi) righe.push("(giornata esclusa dal monte ore)");
  }

  const totImp = totaleImporti(d.clienti);
  if(totImp){
    righe.push("");
    righe.push("TOTALE DA FATTURARE: " + euro(totImp));
  }
  if(d.spese.length){
    righe.push("");
    righe.push("SPESE / EXTRA:");
    d.spese.forEach(s=>righe.push("- " + s.d + ": " + euro(s.i) + (s.allegato ? "  [con allegato]" : "")));
    righe.push("Totale spese: " + euro(totaleSpese(d.spese)));
  }
  return righe.join("\n");
}
export function datiSettimana(){
  const iso = document.getElementById("settdata").value;
  const db = leggiDB();
  const giorni = giorniSettimana(iso);
  const operaiTotali = {}; // nome -> {minuti, giorni}
  let totGenerale = 0, giorniConteggiati = 0, totSulPosto = 0;
  const righe = giorni.map((g,i)=>{
    const d = db[g];
    if(!d) return {iso: g, nome: GIORNI[i], dati: null};
    const operai = (d.operai || []).map(op=>({nome: op.nome || "(senza nome)", minuti: minutiOperaio(op)}));
    const totGiorno = operai.reduce((a,o)=>a+o.minuti, 0);
    if(!d.escludi){
      giorniConteggiati++;
      operai.forEach(o=>{
        if(!operaiTotali[o.nome]) operaiTotali[o.nome] = {minuti: 0, giorni: 0, extra: 0};
        operaiTotali[o.nome].minuti += o.minuti;
        operaiTotali[o.nome].giorni += 1;
        operaiTotali[o.nome].extra += eccedenza(o.minuti);
        totGenerale += o.minuti;
      });
    }
    if(!d.escludi) totSulPosto += minutiSulPosto(d.operai);
    return {
      iso: g, nome: GIORNI[i], dati: d, operai, totGiorno,
      escluso: !!d.escludi,
      clienti: d.clienti.map(c=>c.nome).join(", "),
      ...perCliente(d)
    };
  });
  return {
    righe, operaiTotali, totGenerale, totSulPosto,
    giorniLavorati: righe.filter(r=>r.dati).length,
    giorniConteggiati,
    dal: dataIt(giorni[0]), al: dataIt(giorni[6])
  };
}
export function testoSettimana(){
  const s = datiSettimana();
  const extra = document.getElementById("stampa-extra-sett").checked;
  const righe = [];
  righe.push("REPORT SETTIMANALE " + s.dal + " - " + s.al);
  righe.push("");
  if(orePerCliente()){
    s.righe.forEach(r=>{
      righe.push(r.nome + " " + dataIt(r.iso) + (r.dati ? (r.escluso ? " [ESCLUSA DAL MONTE ORE]" : "") +
        "  —  " + (r.tecnici.join(" / ") || "—") + (r.clientiOre.length ? "  —  " + clientiConOre(r) : "") +
        (r.sulPosto ? "  —  " + oreTesto(r.sulPosto) : "") : "  —  -"));
    });
    righe.push("");
    righe.push("GIORNI LAVORATI: " + s.giorniLavorati);
    righe.push("TOTALE ORE: " + oreTesto(s.totSulPosto));
    return righe.join("\n");
  }
  s.righe.forEach(r=>{
    if(r.dati){
      const opTesto = r.operai.map(o=>o.nome + ": " + oreTesto(o.minuti)).join(" · ");
      righe.push(r.nome + " " + dataIt(r.iso) + (r.escluso ? " [ESCLUSA DAL MONTE ORE]" : "") +
                 "  —  " + opTesto + (r.clienti ? "  —  " + r.clienti : ""));
    } else {
      righe.push(r.nome + " " + dataIt(r.iso) + "  —  -");
    }
  });
  righe.push("");
  righe.push("GIORNI LAVORATI: " + s.giorniLavorati);
  Object.keys(s.operaiTotali).sort().forEach(n=>{
    const info = s.operaiTotali[n];
    const saldo = info.minuti - (info.giorni * ORARIO_ORDINARIO);
    righe.push(n.toUpperCase() + " (" + info.giorni + " g.): " + oreTesto(info.minuti) + (extra && saldo ? "  " + saldoTesto(saldo) : ""));
  });
  righe.push("TOTALE: " + oreTesto(s.totGenerale));
  return righe.join("\n");
}
export function datiMese(){
  const iso = document.getElementById("mesedata").value;
  const db = leggiDB();
  const giorni = giorniMese(iso);
  const operaiTotali = {};
  let totGenerale = 0, giorniConteggiati = 0, totSpese = 0, totSulPosto = 0;
  const righe = giorni.map(g=>{
    const d = db[g];
    if(!d) return null;
    const operai = (d.operai || []).map(op=>({nome: op.nome || "(senza nome)", minuti: minutiOperaio(op)}));
    const totGiorno = operai.reduce((a,o)=>a+o.minuti, 0);
    totSpese += totaleSpese(d.spese || []);
    if(!d.escludi){
      giorniConteggiati++;
      operai.forEach(o=>{
        if(!operaiTotali[o.nome]) operaiTotali[o.nome] = {minuti: 0, giorni: 0, extra: 0};
        operaiTotali[o.nome].minuti += o.minuti;
        operaiTotali[o.nome].giorni += 1;
        operaiTotali[o.nome].extra += eccedenza(o.minuti);
        totGenerale += o.minuti;
      });
    }
    if(!d.escludi) totSulPosto += minutiSulPosto(d.operai);
    const data = new Date(g + "T12:00:00");
    return {
      iso: g,
      nome: GIORNI[(data.getDay() + 6) % 7],
      operai, totGiorno,
      escluso: !!d.escludi,
      clienti: d.clienti.map(c=>c.nome).join(", "),
      ...perCliente(d)
    };
  }).filter(Boolean);
  const [aa, mm] = iso.split("-");
  const nomiMesi = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
                    "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  return {
    righe, operaiTotali, totGenerale, totSpese, totSulPosto,
    giorniLavorati: righe.length,
    giorniConteggiati,
    etichetta: nomiMesi[+mm - 1] + " " + aa
  };
}
export function testoMese(){
  const s = datiMese();
  const extra = document.getElementById("stampa-extra-mese").checked;
  const righe = [];
  righe.push("REPORT MENSILE - " + s.etichetta.toUpperCase());
  righe.push("");
  if(orePerCliente()){
    s.righe.forEach(r=>{
      righe.push(r.nome + " " + dataIt(r.iso) + (r.escluso ? " [ESCLUSA DAL MONTE ORE]" : "") +
        "  —  " + (r.tecnici.join(" / ") || "—") + (r.clientiOre.length ? "  —  " + clientiConOre(r) : "") +
        (r.sulPosto ? "  —  " + oreTesto(r.sulPosto) : ""));
    });
    righe.push("");
    righe.push("GIORNI LAVORATI: " + s.giorniLavorati);
    if(!oreMeseNascoste()) righe.push("TOTALE ORE: " + oreTesto(s.totSulPosto));
    if(s.totSpese) righe.push("SPESE ANTICIPATE: " + euro(s.totSpese));
    return righe.join("\n");
  }
  s.righe.forEach(r=>{
    const opTesto = r.operai.map(o=>o.nome + ": " + oreTesto(o.minuti)).join(" · ");
    righe.push(r.nome + " " + dataIt(r.iso) + (r.escluso ? " [ESCLUSA DAL MONTE ORE]" : "") +
               "  —  " + opTesto + (r.clienti ? "  —  " + r.clienti : ""));
  });
  righe.push("");
  righe.push("GIORNI LAVORATI: " + s.giorniLavorati);
  if(!oreMeseNascoste()){
    if(confrontoAttivo()) righe.push(descrizioneMonte().toUpperCase());
    Object.keys(s.operaiTotali).sort().forEach(n=>{
      const info = s.operaiTotali[n];
      righe.push(n.toUpperCase() + " (" + info.giorni + " g.): " + oreMeseTesto(info));
      if(confrontoAttivo()) righe.push("   " + confrontoTesto(info.minuti));
    });
  }
  if(s.totSpese) righe.push("SPESE ANTICIPATE: " + euro(s.totSpese));
  return righe.join("\n");
}
