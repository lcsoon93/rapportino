// Giornate: logica pura (senza DOM ne' rete, provata in tests/unit) che unisce in UNA giornata tutto cio'
// che riguarda un giorno, qualunque sia la fonte:
//   - rapportini (tabella "rapportini"): i clienti del giorno e gli orari passati da ciascuno;
//   - foglio giornaliero della vecchia app (tabella "rapporti"): schede e orari storici;
//   - orario della giornata inserito dall'amministratore (impostazioni "giornata:AAAA-MM-GG").
// Regola delle ore della giornata, uguale per tutti gli operai del giorno:
//   orario inserito  >  orario del vecchio foglio (solo dati storici)  >  08:00-17:00 (9 ore).
// "Escludi dal monte ore": la giornata resta nell'elenco ma non entra nei totali.

export const ORARIO_PREDEFINITO = { dalle: "08:00", alle: "17:00" };
export const chiaveGiornata = iso=>"giornata:" + iso;

const hm = t=>String(t || "").slice(0, 5);
const valida = t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(hm(t));
const min = t=>+hm(t).slice(0, 2) * 60 + +hm(t).slice(3);
export function minutiTraOre(dalle, alle){
  if(!valida(dalle) || !valida(alle)) return 0;
  let m = min(alle) - min(dalle);
  if(m < 0) m += 24 * 60;                    // oltre la mezzanotte
  return m;
}
const norma = t=>String(t == null ? "" : t).toLocaleLowerCase("it-IT").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// valore salvato nelle impostazioni -> { dalle, alle, escludi } pulito, oppure null se non c'e'
export function leggiOrarioInserito(valore){
  if(!valore || typeof valore !== "object") return null;
  const o = { escludi: valore.escludi === true };
  if(valida(valore.dalle) && valida(valore.alle)){ o.dalle = hm(valore.dalle); o.alle = hm(valore.alle); }
  return o.dalle || o.escludi ? o : null;
}
// orario del vecchio foglio: quello degli operai se e' uguale per tutti quelli che l'hanno segnato
function orarioFoglio(foglio){
  const op = ((foglio && foglio.operai) || []).filter(o=>o && valida(o.dalle) && valida(o.alle));
  if(!op.length) return null;
  const uguali = op.every(o=>hm(o.dalle) === hm(op[0].dalle) && hm(o.alle) === hm(op[0].alle));
  return uguali ? { dalle: hm(op[0].dalle), alle: hm(op[0].alle) } : null;
}
// Orario effettivo di un giorno: { dalle, alle, minuti, escludi, origine }
// origine: "inserito" | "foglio" (vecchia app) | "predefinito"
export function orarioGiornata(inserito, foglio){
  const ins = leggiOrarioInserito(inserito);
  const f = orarioFoglio(foglio);
  const base = ins && ins.dalle ? { dalle: ins.dalle, alle: ins.alle, origine: "inserito" }
    : f ? { ...f, origine: "foglio" } : { ...ORARIO_PREDEFINITO, origine: "predefinito" };
  const escludi = ins ? ins.escludi : !!(foglio && foglio.escludi);
  return { ...base, minuti: minutiTraOre(base.dalle, base.alle), escludi };
}

// nome libero del vecchio foglio ("Luca") -> nome dell'utente ("Luca Bianchi") quando coincide o ha lo
// stesso primo nome di UN solo utente; altrimenti resta com'e'
export function nomeCanonico(nome, utenti = []){
  const n = norma(nome);
  if(!n) return "";
  const esatto = utenti.find(u=>norma(u) === n);
  if(esatto) return esatto;
  const stessoPrimo = utenti.filter(u=>norma(u).split(" ")[0] === n.split(" ")[0]);
  return stessoPrimo.length === 1 ? stessoPrimo[0] : String(nome).trim();
}

// Giornata unita (stessa forma del vecchio foglio, cosi' report e PDF esistenti la leggono):
//   { operai: [{ nome, dalle, alle }], clienti: [{ nome, fasce: [{ d, a }], sintesi, materiali: [{ a, q }] }], escludi, spese, orario }
// rapportini: righe con cliente e rapportino_operai; nome(id) = nome leggibile; utenti = nomi noti.
// Restituisce null se quel giorno non c'e' lavoro: nessun rapportino e, nel vecchio foglio, nessuna scheda
// con il nome del cliente ne' spese (un foglio con i soli operai proposti in automatico non conta).
// sintesi dell'intervento (attivita' svolta) e materiale usato, per il report del mese
const SENZA_ATTIVITA = "Attività non indicata nella vecchia app.";
export const sintesiLavoro = t=>{ const x = String(t || "").replace(/\s+/g, " ").trim(); return x === SENZA_ATTIVITA ? "" : x; };
export const materialiPuliti = m=>(Array.isArray(m) ? m : []).filter(x=>x && String(x.a || "").trim())
  .map(x=>({ a: String(x.a).trim(), q: String(x.q == null ? "" : x.q).trim() }));
const schedeConNome = foglio=>((foglio && foglio.clienti) || []).filter(c=>c && String(c.nome || "").trim() && c.nome !== "(senza nome)");
export function giornataUnita({ foglio, rapportini = [], inserito, nome = id=>id, utenti = [] }){
  const lavoroNelFoglio = schedeConNome(foglio).length > 0 || ((foglio && foglio.spese) || []).length > 0;
  if(!lavoroNelFoglio && !rapportini.length) return null;
  const orario = orarioGiornata(inserito, foglio);
  const fissato = orario.origine === "inserito";
  const operai = [];                                   // un operaio una volta sola, in ordine di comparsa
  const aggiungi = (n, o)=>{
    if(!n) return;
    const gia = operai.find(x=>norma(x.nome) === norma(n));
    if(gia){ if(o && !gia.suoi) Object.assign(gia, o, { suoi: true }); }
    else operai.push({ nome: n, ...(o || {}), suoi: !!o });
  };
  // vecchio foglio: gli orari di ciascun operaio valgono finche' non si inserisce l'orario della giornata
  ((foglio && foglio.operai) || []).forEach(o=>{
    const n = nomeCanonico(o && o.nome, utenti);
    aggiungi(n, !fissato && o && valida(o.dalle) && valida(o.alle) ? { dalle: hm(o.dalle), alle: hm(o.alle) } : null);
  });
  rapportini.forEach(r=>{
    const righe = r.rapportino_operai || [];
    (righe.length ? righe.map(o=>o.operaio_id) : [r.autore_id]).filter(Boolean).forEach(id=>aggiungi(nome(id), null));
  });
  const clienti = schedeConNome(foglio)
    .map(c=>({ nome: String(c.nome).trim(), fasce: (c.fasce && c.fasce.length ? c.fasce : [{ d: c.dalle, a: c.alle }]).filter(f=>f && f.d && f.a),
      sintesi: sintesiLavoro(c.dettagli), materiali: materialiPuliti(c.materiali) }))
    .concat(rapportini.filter(r=>String(r.cliente || "").trim()).map(r=>({ nome: String(r.cliente).trim(), bozza: r.stato !== "completato",
      fasce: (r.rapportino_operai || []).filter(o=>valida(o.dalle) && valida(o.alle)).map(o=>({ d: hm(o.dalle), a: hm(o.alle) })),
      sintesi: sintesiLavoro(r.attivita), materiali: materialiPuliti(r.materiali) })));
  return {
    orario, escludi: orario.escludi, spese: (foglio && foglio.spese) || [], clienti,
    operai: operai.map(o=>({ nome: o.nome, dalle: o.suoi ? o.dalle : orario.dalle, alle: o.suoi ? o.alle : orario.alle })),
  };
}

// tutte le giornate di un elenco di giorni: { iso: giornata }
export function giornateUnite(giorni, { fogli = {}, rapportini = [], inseriti = {}, nome, utenti }){
  const perGiorno = {};
  rapportini.forEach(r=>{ (perGiorno[r.data] = perGiorno[r.data] || []).push(r); });
  const out = {};
  giorni.forEach(g=>{
    const u = giornataUnita({ foglio: fogli[g], rapportini: perGiorno[g] || [], inserito: inseriti[g], nome, utenti });
    if(u) out[g] = u;
  });
  return out;
}
