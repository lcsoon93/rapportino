// Rapportini di un mese (o di un giorno): raggruppamento per giorno, ore effettive per giorno e per
// operaio, totale, elenco degli esclusi (bozze e copie rimaste sul telefono). Solo calcoli: nessun DOM,
// nessuna rete (usato dal PDF mensile e dai test).
//
// Ore effettive: per ogni operaio e giorno, unione dei suoi intervalli (dalle-alle) di tutti i rapportini
// del giorno: le parti sovrapposte contano una volta, gli intervalli contigui si sommano. Il totale del
// giorno e' la somma degli operai. La fascia oraria della giornata (es. 08:00-17:00) e' un'altra cosa:
// si mostra a parte e non e' mai il totale delle ore lavorate.
import { minutiSulPosto } from "./calculations.js";

const ora = t=>String(t || "").slice(0, 5);
export const nelPeriodo = (iso, dal, al)=>!!iso && iso >= dal && iso <= al;

// "2026-11" -> { dal: "2026-11-01", al: "2026-11-30" } (date locali, nessuna conversione UTC)
export function limitiMese(mese){
  const [a, m] = String(mese).split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  const p = n=>String(n).padStart(2, "0");
  return { dal: a + "-" + p(m) + "-01", al: a + "-" + p(m) + "-" + p(ultimo) };
}

// righe orarie da contare: tutte, oppure solo quelle dell'operaio scelto
const righe = (r, operaio)=>(r.rapportino_operai || []).filter(o=>o && o.operaio_id && (!operaio || o.operaio_id === operaio));

// minuti effettivi per operaio di un insieme di rapportini (stesso giorno): { operaio_id: minuti }
export function minutiPerOperaio(rapportini, operaio){
  const per = {};
  rapportini.forEach(r=>righe(r, operaio).forEach(o=>{ (per[o.operaio_id] = per[o.operaio_id] || []).push({ dalle: ora(o.dalle), alle: ora(o.alle) }); }));
  const out = {};
  Object.entries(per).forEach(([id, iv])=>{ out[id] = minutiSulPosto(iv); });
  return out;
}

// completati: rapportini completati confermati dal server; bozze: rapportini in bozza sul server;
// coda: voci del telefono (sinc-rapportini); dal/al: periodo; operaio: filtro (null = tutti);
// nome(id): nome dell'operaio; fascia(iso): { dalle, alle, minuti, escludi } facoltativo
export function riepilogoRapportini({ completati = [], bozze = [], coda = [], dal, al, operaio = null, nome = id=>id, fascia = null }){
  // operaio scelto: i suoi rapportini e quelli dei colleghi in cui ha segnato le sue ore
  const delPeriodo = completati.filter(r=>r.stato === "completato" && nelPeriodo(r.data, dal, al) &&
    (!operaio || r.autore_id === operaio || righe(r, operaio).length > 0));
  const perGiorno = new Map();
  delPeriodo.forEach(r=>{ if(!perGiorno.has(r.data)) perGiorno.set(r.data, []); perGiorno.get(r.data).push(r); });
  const totOperai = {};
  const giorni = [...perGiorno.keys()].sort().map(iso=>{
    const rap = perGiorno.get(iso);
    const perOp = minutiPerOperaio(rap, operaio);
    Object.entries(perOp).forEach(([id, m])=>{
      const t = totOperai[id] = totOperai[id] || { id, nome: nome(id), giorni: 0, minuti: 0 };
      t.giorni++; t.minuti += m;
    });
    return {
      iso, rapportini: rap,
      operai: Object.entries(perOp).map(([id, minuti])=>({ id, nome: nome(id), minuti })).sort((a, b)=>a.nome.localeCompare(b.nome)),
      minuti: Object.values(perOp).reduce((a, m)=>a + m, 0),
      fascia: fascia ? fascia(iso) : null,
    };
  });
  // esclusi: bozze del server e copie del telefono non confermate (mai tra i completati)
  const visti = new Set(delPeriodo.map(r=>r.id));
  const esclusi = [];
  bozze.filter(r=>r.stato !== "completato" && nelPeriodo(r.data, dal, al) && (!operaio || r.autore_id === operaio) && !visti.has(r.id))
    .forEach(r=>{ visti.add(r.id); esclusi.push({ id: r.id, data: r.data, cliente: r.cliente || "(senza cliente)", operaio: nome(r.autore_id), motivo: "in bozza: non completato" }); });
  coda.filter(v=>v && v.rapportino && v.stato !== "inviato" && v.testoDaInviare !== false && nelPeriodo(v.rapportino.data, dal, al) &&
      (!operaio || !v.autore || v.autore === operaio) && !visti.has(v.id))
    .forEach(v=>{ visti.add(v.id); esclusi.push({ id: v.id, data: v.rapportino.data, cliente: v.rapportino.cliente || "(senza cliente)", operaio: v.autore ? nome(v.autore) : "",
      motivo: v.completa ? "completato sul telefono ma non ancora inviato" : "sul telefono, non ancora inviato" }); });
  esclusi.sort((a, b)=>String(a.data).localeCompare(String(b.data)) || a.cliente.localeCompare(b.cliente));
  const operai = Object.values(totOperai).sort((a, b)=>a.nome.localeCompare(b.nome));
  return { giorni, operai, esclusi, totale: operai.reduce((a, o)=>a + o.minuti, 0), rapportini: delPeriodo.length };
}
