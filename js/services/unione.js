// Unione delle modifiche concorrenti su una giornata (unione "a tre vie").
// Si confrontano: la versione di partenza (base, salvata come impronte), la mia e quella del server.
// Per ogni scheda cliente (riconosciuta dall'id) e per ogni campo della giornata (operai, spese, tecnici…):
//   cambiata solo da me -> la mia; solo sul server -> quella del server; da entrambi -> la mia,
//   ma una firma presente sul server non si perde mai. Schede nuove da entrambe le parti: restano tutte.
// Una scheda tolta da una parte e non toccata dall'altra viene tolta; se l'altra l'ha modificata, resta.

// testo stabile (chiavi ordinate): il server restituisce gli oggetti con le chiavi in altro ordine
function canonico(x){
  if(Array.isArray(x)) return "[" + x.map(canonico).join(",") + "]";
  if(x && typeof x === "object") return "{" + Object.keys(x).sort().map(k=>JSON.stringify(k) + ":" + canonico(x[k])).join(",") + "}";
  return JSON.stringify(x === undefined ? null : x);
}
// impronta breve (due hash a 32 bit): basta a capire se qualcosa e' cambiato
export function impronta(x){
  const s = canonico(x);
  let a = 0x811c9dc5, b = 5381;
  for(let i = 0; i < s.length; i++){
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}
// Forma normalizzata, uguale a quella che produce il modulo (elencoClienti/elencoOperai/elencoSpese):
// cosi' una scheda letta dal server e la stessa riletta dallo schermo risultano identiche
// (campi mancanti, ordine delle chiavi, foto con o senza misure, vecchi formati).
const testo = v=>String(v == null ? "" : v).trim();
const src = f=>typeof f === "string" ? f : (f && f.src) || "";
function normScheda(c){
  c = c || {};
  const fasce = (Array.isArray(c.fasce) && c.fasce.length ? c.fasce : ((c.dalle || c.alle) ? [{d: c.dalle, a: c.alle}] : []))
    .filter(f=>f && (f.d || f.a)).map(f=>({d: f.d || "", a: f.a || ""}));
  const materiali = (Array.isArray(c.materiali) && c.materiali.length ? c.materiali : (c.materiale ? [{a: c.materiale, q: ""}] : []))
    .filter(m=>m && testo(m.a)).map(m=>({a: testo(m.a), q: testo(m.q)}));
  return {
    id: c.id || "", nome: testo(c.nome) || "(senza nome)", indirizzo: testo(c.indirizzo), fasce,
    fatturare: testo(c.fatturare), importo: parseFloat(c.importo) || 0, tipologia: c.tipologia || "",
    stato: c.stato || "Completato", firmatario: testo(c.firmatario), dettagli: testo(c.dettagli), materiali,
    foto: (Array.isArray(c.foto) ? c.foto : []).map(src).filter(Boolean), firma: c.firma || "", urgente: !!c.urgente,
    richiesta: c.richiesta || "",
  };
}
function normCampo(k, v){
  if(k === "operai") return (Array.isArray(v) ? v : []).map(o=>({nome: testo(o.nome) || "(senza nome)", dalle: o.dalle || "", alle: o.alle || ""}));
  if(k === "spese") return (Array.isArray(v) ? v : []).map(s=>({d: testo(s.d) || "(senza descrizione)", i: parseFloat(s.i) || 0,
    allegato: s.allegato ? src(s.allegato) : "", clienteId: s.clienteId || ""}));
  if(k === "tecnici") return testo(v);
  if(k === "escludi") return !!v;
  return v;
}
const improntaScheda = c=>impronta(normScheda(c));
const improntaCampo = (k, v)=>impronta(normCampo(k, v));
const chiaveScheda = c=>c && c.id ? "id:" + c.id : "h:" + improntaScheda(c);

// impronte di una giornata (cio' che si conserva come "base"): per ogni scheda l'impronta totale e
// quella di ogni campo, cosi' si capisce anche quale campo e' stato cambiato
export function impronte(dati){
  const campi = {}, schede = {};
  Object.keys(dati || {}).forEach(k=>{ if(k !== "clienti") campi[k] = improntaCampo(k, dati[k]); });
  ((dati && dati.clienti) || []).forEach(c=>{
    const n = normScheda(c), f = {};
    Object.keys(n).forEach(k=>{ f[k] = impronta(n[k]); });
    schede[chiaveScheda(c)] = { t: impronta(n), f };
  });
  return { campi, schede };
}
// due versioni della giornata sono "uguali" se lo sono in forma normalizzata
export function stessaGiornata(a, b){
  a = a || {}; b = b || {};
  const k = new Set([...Object.keys(a), ...Object.keys(b)]);
  for(const x of k) if(x !== "clienti" && improntaCampo(x, a[x]) !== improntaCampo(x, b[x])) return false;
  const sa = (a.clienti || []).map(c=>chiaveScheda(c) + "=" + improntaScheda(c));
  const sb = (b.clienti || []).map(c=>chiaveScheda(c) + "=" + improntaScheda(c));
  return sa.join("|") === sb.join("|");
}
const vuoto = v=>v === "" || v === 0 || v === false || v == null || (Array.isArray(v) && !v.length);

// stessa scheda cambiata da entrambe le parti: si decide campo per campo
function unisciScheda(baseScheda, m, s){
  const nm = normScheda(m), ns = normScheda(s);
  const risultato = Object.assign({}, s, m);         // campi non gestiti: prevalgono i miei
  Object.keys(nm).forEach(k=>{
    const hm = impronta(nm[k]), hs = impronta(ns[k]);
    if(hm === hs) return;
    const hb = baseScheda ? baseScheda.f[k] : undefined;
    let dalServer;
    if(hb !== undefined) dalServer = hm === hb;       // l'ho lasciato com'era: vale il server
    else dalServer = vuoto(nm[k]) && !vuoto(ns[k]);    // senza base: il pieno vince sul vuoto
    if(k === "firma" && !nm.firma && ns.firma) dalServer = true;   // una firma non si perde mai
    if(dalServer){
      if(k === "id") return;
      risultato[k] = s[k] !== undefined ? s[k] : ns[k];
    }
  });
  return risultato;
}

export function unisciGiornata(base, mio, server){
  base = base || { campi: {}, schede: {} };
  const risultato = {};
  const chiavi = new Set([...Object.keys(mio || {}), ...Object.keys(server || {})]);
  chiavi.delete("clienti");
  chiavi.forEach(k=>{
    const hm = improntaCampo(k, mio[k]), hs = improntaCampo(k, server[k]), hb = base.campi[k];
    let v;
    if(hm === hs) v = mio[k];
    else if(hb !== undefined) v = hm === hb ? server[k] : mio[k];
    else v = (vuoto(normCampo(k, mio[k])) && !vuoto(normCampo(k, server[k]))) ? server[k] : mio[k];
    if(v !== undefined) risultato[k] = v;
  });
  const mie = new Map((mio.clienti || []).map(c=>[chiaveScheda(c), c]));
  const delServer = new Map((server.clienti || []).map(c=>[chiaveScheda(c), c]));
  const schede = [];
  (server.clienti || []).forEach(s=>{
    const k = chiaveScheda(s), b = base.schede[k];
    if(mie.has(k)){
      const m = mie.get(k), hm = improntaScheda(m), hs = improntaScheda(s);
      if(hm === hs || (b && hs === b.t)) schede.push(m);           // uguali o cambiata solo da me
      else if(b && hm === b.t) schede.push(s);                      // cambiata solo sul server
      else schede.push(unisciScheda(b, m, s));                      // cambiata da entrambi
    } else if(b && improntaScheda(s) === b.t){
      // l'ho tolta io e sul server nessuno l'ha toccata: resta tolta
    } else {
      schede.push(s);                                               // nuova o modificata da altri
    }
  });
  (mio.clienti || []).forEach(m=>{
    const k = chiaveScheda(m);
    if(delServer.has(k)) return;
    const b = base.schede[k];
    if(b && improntaScheda(m) === b.t) return;                     // tolta da altri, io non l'ho toccata
    schede.push(m);                                                 // nuova mia (o modificata mentre altri la toglievano)
  });
  risultato.clienti = schede;
  return risultato;
}
