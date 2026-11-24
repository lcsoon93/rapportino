// "La mia giornata": unione dei dati del server e della coda del telefono, stati e conteggi.
// Solo calcoli (nessun DOM, nessuna rete): usato da giornata.js.
import { avanzamento } from "../services/avanzamento.js";

export function minutiTra(dalle, alle){
  if(!dalle || !alle) return 0;
  const m = t=>{ const p = String(t).split(":"); return +p[0] * 60 + +p[1]; };
  return Math.max(0, m(alle) - m(dalle));
}

// minuti coperti da una serie di intervalli {dalle, alle}: le parti sovrapposte (stesso tempo
// segnato su due rapportini) contano una volta sola
export function minutiUnione(intervalli){
  const m = t=>{ const p = String(t).split(":"); return +p[0] * 60 + +p[1]; };
  const iv = (intervalli || []).filter(o=>o && o.dalle && o.alle).map(o=>[m(o.dalle), m(o.alle)])
    .filter(([a, b])=>Number.isFinite(a) && Number.isFinite(b) && b > a).sort((x, y)=>x[0] - y[0]);
  let tot = 0, ini = -1, fin = -1;
  for(const [a, b] of iv){
    if(a > fin){ if(fin > ini) tot += fin - ini; ini = a; fin = b; }
    else if(b > fin) fin = b;
  }
  if(fin > ini) tot += fin - ini;
  return tot;
}

// copia del telefono con modifiche non ancora confermate dal server (solo foto in attesa: no)
export const localeAttivo = v=>!!v && v.stato !== "inviato" && v.testoDaInviare !== false;

// Un elenco per id: la versione del server, sostituita nei contenuti dalla copia del telefono se questa
// ha modifiche da inviare. Completato solo se lo dice il server.
export function unisciRapportini(server, locali){
  const perId = new Map();
  (server || []).forEach(r=>perId.set(r.id, {
    id: r.id, intervento_id: r.intervento_id || null, data: r.data, cliente: r.cliente, esito: r.esito || "",
    stato: r.stato, ore: r.rapportino_operai || [], sulServer: true, daInviare: false, conflitto: false, completaInAttesa: false,
  }));
  (locali || []).filter(localeAttivo).forEach(v=>{
    const c = v.rapportino || {};
    const s = perId.get(v.id);
    perId.set(v.id, {
      id: v.id, intervento_id: v.intervento_id || c.intervento_id || (s && s.intervento_id) || null,
      data: c.data || (s && s.data) || "", cliente: c.cliente || (s && s.cliente) || "", esito: c.esito || (s && s.esito) || "",
      stato: s && s.stato === "completato" && v.stato !== "conflitto" ? "completato" : (s ? s.stato : "bozza"),
      ore: v.ore || (s && s.ore) || [], sulServer: !!s || !!v.salvato, daInviare: true,
      conflitto: v.stato === "conflitto", completaInAttesa: !!v.completa,
    });
  });
  return [...perId.values()];
}

// Orario da mostrare a sinistra della scheda di un intervento (solo visualizzazione, nessun dato modificato):
// - "programmato": l'ora dell'intervento (campo facoltativo: può mancare, anche nei dati vecchi);
// - "effettivo": senza ora programmata, l'inizio del lavoro segnato nel rapportino (righe dell'utente,
//   altrimenti di tutti), solo se l'orario è valido;
// - "nessuno": nessun orario attendibile (rappresentazione neutra, mai un orologio "in attesa").
// lavoro: intervallo effettivo "HH:MM–HH:MM" dal rapportino, se completo; lo stato non c'entra.
const hhmm = t=>{ const v = String(t || "").slice(0, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : ""; };
export function orarioScheda(i, st, io){
  const programmato = hhmm(i && i.ora);
  const ore = (st && st.rapportino && st.rapportino.ore) || [];
  const mie = ore.filter(o=>o && o.operaio_id === io && hhmm(o.dalle));
  const righe = mie.length ? mie : ore.filter(o=>o && hhmm(o.dalle));
  const inizi = righe.map(o=>hhmm(o.dalle)).sort(), fini = righe.map(o=>hhmm(o.alle)).filter(Boolean).sort();
  const lavoro = inizi.length && fini.length && righe.every(o=>hhmm(o.alle)) ? inizi[0] + "–" + fini[fini.length - 1] : "";
  if(programmato) return { tipo: "programmato", ora: programmato, lavoro };
  if(inizi.length) return { tipo: "effettivo", ora: inizi[0], lavoro };
  return { tipo: "nessuno", ora: "", lavoro: "" };
}

// stato visto da chi apre la giornata (io), con i propri rapportini già uniti (miei: per intervento_id)
export function statoIntervento(i, io, miei){
  if(i.stato === "annullato") return { codice: "annullato", label: "Annullato", classe: "neutro" };
  const mio = (miei && miei.get(i.id)) || null;
  if(mio){
    if(mio.stato === "completato" && !mio.daInviare) return mio.esito === "Da ultimare"
      ? { codice: "completato", label: "Da ultimare", classe: "att", daUltimare: true, rapportino: mio }
      : { codice: "completato", label: "Completato", classe: "ok", rapportino: mio };
    if(mio.completaInAttesa) return { codice: "da_completare", label: "Completamento da inviare", classe: "att", rapportino: mio };
    return { codice: "da_completare", label: mio.conflitto ? "Conflitto da risolvere" : "Bozza da completare", classe: "att", rapportino: mio };
  }
  const av = avanzamento(i);
  const rapp = i.rapportini || [];
  // proprio rapportino con data diversa da oggi: arriva solo dentro l'intervento
  const annidato = rapp.find(r=>r.autore_id === io && r.stato === "bozza") || rapp.find(r=>r.autore_id === io);
  if(annidato) return annidato.stato === "completato"
    ? { codice: "completato", label: "Completato", classe: "ok", rapportino: { id: annidato.id, stato: "completato" } }
    : { codice: "da_completare", label: "Bozza da completare", classe: "att", rapportino: { id: annidato.id, stato: "bozza" } };
  if(!av.attivi.includes(io)){
    // intervento di altri (vista admin/company): avanzamento complessivo
    if(i.stato === "completato" || (av.attivi.length && !av.mancanti.length)) return { codice: "completato", label: "Completato", classe: "ok" };
    if(i.stato === "in_corso" || rapp.length) return { codice: "in_corso", label: "In corso", classe: "pervinca" };
    return { codice: "da_iniziare", label: "Da iniziare", classe: "neutro" };
  }
  if(i.stato === "completato") return { codice: "completato", label: "Completato", classe: "ok" };
  if(i.stato === "in_corso" || av.completati.length) return { codice: "in_corso", label: "In corso", classe: "pervinca" };
  return { codice: "da_iniziare", label: "Da iniziare", classe: "neutro" };
}

export function statoImprevisto(r){
  if(r.stato === "completato" && !r.daInviare) return r.esito === "Da ultimare"
    ? { codice: "completato", label: "Da ultimare", classe: "att", daUltimare: true }
    : { codice: "completato", label: "Completato", classe: "ok" };
  if(r.completaInAttesa) return { codice: "da_completare", label: "Completamento da inviare", classe: "att" };
  return { codice: "da_completare", label: r.conflitto ? "Conflitto da risolvere" : "Bozza da completare", classe: "att" };
}

// Tutto il calcolo della giornata: interventi (di oggi), rapportini miei (server: oggi + bozze di ogni
// giorno), coda del telefono. Ritorna liste già filtrate e conteggi coerenti tra loro.
export function calcolaGiornata({ oggi, io, interventi, rapportiniServer, coda }){
  const miei = unisciRapportini(rapportiniServer, (coda || []).filter(v=>!v.autore || v.autore === io));
  const perIntervento = new Map();
  miei.filter(r=>r.intervento_id).forEach(r=>{
    const prima = perIntervento.get(r.intervento_id);
    // più rapportini sullo stesso intervento: conta quello ancora aperto
    if(!prima || (prima.stato === "completato" && r.stato !== "completato")) perIntervento.set(r.intervento_id, r);
  });
  const attivi = (interventi || []).filter(i=>i.stato !== "annullato");
  const schede = attivi.map(i=>({ intervento: i, stato: statoIntervento(i, io, perIntervento) }));
  const idInterventiOggi = new Set(attivi.map(i=>i.id));
  const imprevisti = miei.filter(r=>!r.intervento_id && r.data === oggi).map(r=>({ rapportino: r, stato: statoImprevisto(r) }));
  // bozze di ogni giorno non già mostrate tra gli interventi e gli imprevisti di oggi
  const mostrati = new Set([...imprevisti.map(x=>x.rapportino.id),
    ...schede.map(s=>s.stato.rapportino && s.stato.rapportino.id).filter(Boolean)]);
  const bozze = miei.filter(r=>!mostrati.has(r.id) && !(r.stato === "completato" && !r.daInviare) &&
      !(r.intervento_id && idInterventiOggi.has(r.intervento_id)))
    .sort((a, b)=>String(b.data || "").localeCompare(String(a.data || "")));
  const tutti = [...schede.map(s=>s.stato), ...imprevisti.map(x=>x.stato)];
  const conta = c=>tutti.filter(s=>s.codice === c).length;
  const minuti = minutiUnione(miei.filter(r=>r.data === oggi).flatMap(r=>(r.ore || []).filter(o=>o.operaio_id === io)));
  return {
    schede, imprevisti, bozze,
    conteggi: {
      totale: tutti.length, completati: conta("completato"), inCorso: conta("in_corso") + conta("da_completare"),
      daIniziare: conta("da_iniziare"), daUltimare: tutti.filter(s=>s.daUltimare).length, minuti,
    },
  };
}
