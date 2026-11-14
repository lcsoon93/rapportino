// Ricerca per il computer (search.html): logica pura, senza DOM ne' rete (provata in tests/unit).
// Unisce in "voci" omogenee i rapportini nuovi (tabella rapportini) e le schede cliente del vecchio
// foglio giornaliero (tabella rapporti), poi filtra, calcola il riepilogo del mese ed esporta in CSV.

export const norma = t=>String(t == null ? "" : t).toLocaleLowerCase("it-IT").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const ora = o=>o ? String(o).slice(0, 5) : "";
export function minutiIntervallo(dalle, alle){
  const a = ora(dalle), b = ora(alle);
  if(!/^\d\d:\d\d$/.test(a) || !/^\d\d:\d\d$/.test(b)) return 0;
  const m = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3));
  return m > 0 ? m : 0;
}
const materialiValidi = m=>(Array.isArray(m) ? m : []).filter(x=>x && String(x.a || "").trim())
  .map(x=>({ a: String(x.a).trim(), q: String(x.q == null ? "" : x.q).trim() }));

// rapportino (tabella "rapportini") -> voce. nome(id) restituisce il nome leggibile di un utente.
export function voceDaRapportino(r, nome = id=>id){
  const operai = (r.rapportino_operai || []).map(o=>({ id: o.operaio_id, nome: nome(o.operaio_id),
    dalle: ora(o.dalle), alle: ora(o.alle), minuti: minutiIntervallo(o.dalle, o.alle) }));
  const intervento = r.interventi || null;
  return {
    chiave: "r:" + r.id, fonte: "rapportino", id: r.id, data: r.data,
    cliente: r.cliente || "", indirizzo: r.indirizzo || "", telefono: r.telefono || "", tipologia: r.tipologia || "",
    lavoro: r.attivita || "", note: r.note || "", esito: r.esito || "", firmatario: r.firmatario || "",
    stato: r.stato || "bozza", materiali: materialiValidi(r.materiali), operai,
    minuti: operai.reduce((t, o)=>t + o.minuti, 0), autore: r.autore_id ? nome(r.autore_id) : "",
    urgente: !!(intervento && intervento.priorita === "urgente"), importo: 0,
    descrizioneIntervento: intervento ? intervento.descrizione || "" : "",
  };
}
// giornata del vecchio foglio (tabella "rapporti": { data, dati }) -> una voce per scheda cliente con nome
export function vociDaGiornata(g){
  const d = (g && g.dati) || {};
  const nomi = (d.operai || []).map(o=>String((o && o.nome) || "").trim()).filter(Boolean);
  const tecnici = nomi.length ? nomi : String(d.tecnici || "").split(/\s*[\/,]\s*/).map(t=>t.trim()).filter(Boolean);
  return (d.clienti || []).map((c, i)=>({ c, i })).filter(({ c })=>c && String(c.nome || "").trim() && c.nome !== "(senza nome)")
    .map(({ c, i })=>({
      chiave: "g:" + g.data + ":" + i, fonte: "foglio", id: null, data: g.data,
      cliente: String(c.nome).trim(), indirizzo: c.indirizzo || "", telefono: c.telefono || "", tipologia: c.tipologia || "",
      lavoro: c.dettagli || "", note: c.note || "", esito: c.stato || "", firmatario: c.firmatario || "",
      stato: "foglio", materiali: materialiValidi(c.materiali),
      operai: tecnici.map(t=>({ id: null, nome: t, dalle: "", alle: "", minuti: 0 })),
      minuti: 0, autore: "", urgente: !!c.urgente, importo: +c.importo || 0, descrizioneIntervento: "",
    }));
}
// tutte le voci, dalla piu' recente
export function unisciVoci(rapportini, giornate, nome){
  const voci = (rapportini || []).map(r=>voceDaRapportino(r, nome)).concat((giornate || []).flatMap(vociDaGiornata));
  return voci.sort((a, b)=>String(b.data).localeCompare(String(a.data)) || a.cliente.localeCompare(b.cliente, "it"));
}

// filtri: { testo, dal, al, operaio (id o nome), stato ("completato" | "bozza" | "foglio" | ""), }
export function filtraVoci(voci, f = {}){
  const q = norma(f.testo), op = norma(f.operaioNome);
  return voci.filter(v=>{
    if(f.dal && v.data < f.dal) return false;
    if(f.al && v.data > f.al) return false;
    if(f.stato && v.stato !== f.stato) return false;
    if(f.operaio || op){
      // rapportini: per identificativo; foglio (nomi liberi, senza id): per nome
      const ok = v.operai.some(o=>o.id ? o.id === f.operaio : stessoNome(o.nome, op));
      if(!ok) return false;
    }
    if(q.length >= 2){
      const testo = norma([v.cliente, v.indirizzo, v.telefono, v.tipologia, v.lavoro, v.note, v.descrizioneIntervento,
        v.firmatario, v.materiali.map(m=>m.a).join(" "), v.operai.map(o=>o.nome).join(" ")].join(" | "));
      if(!q.split(" ").every(p=>testo.includes(p))) return false;
    }
    return true;
  });
}
// nome libero del foglio (es. "Luca") e nome dell'utente (es. "Luca Bianchi"): uguali o stesso primo nome
function stessoNome(nome, cercato){
  const n = norma(nome);
  if(!n || !cercato) return false;
  return n === cercato || n.split(" ")[0] === cercato.split(" ")[0];
}

// riepilogo: voci (gia' del periodo) e giornate del foglio (per le spese anticipate)
export function riepilogo(voci, giornate = []){
  const r = { completati: 0, bozze: 0, schedeFoglio: 0, minuti: 0, spese: 0, righeMateriali: 0, clienti: 0 };
  const clienti = new Set();
  voci.forEach(v=>{
    if(v.stato === "completato"){ r.completati++; r.minuti += v.minuti; }
    else if(v.stato === "bozza") r.bozze++;
    else r.schedeFoglio++;
    r.righeMateriali += v.materiali.length;
    clienti.add(norma(v.cliente));
  });
  giornate.forEach(g=>((g.dati && g.dati.spese) || []).forEach(s=>{ r.spese += +s.i || 0; }));
  r.clienti = clienti.size;
  return r;
}

// CSV per Excel (separatore ";", BOM per le lettere accentate). Una riga per materiale; senza materiali
// una riga "Nessun materiale". Celle che iniziano con = + - @ protette (Excel non le esegue come formule).
export function cella(v){
  let s = String(v == null ? "" : v).replace(/\r?\n/g, " ");
  if(/^[=+\-@\t]/.test(s)) s = "'" + s;
  return /[";]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const dataItaliana = iso=>{ const p = String(iso || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; };
export function intervalliTesto(v){
  return v.operai.map(o=>o.dalle && o.alle ? o.nome + " " + o.dalle + "-" + o.alle : o.nome).join(", ");
}
export function csvMateriali(voci){
  const righe = [["Data", "Origine", "Cliente", "Indirizzo", "Operai", "Materiale", "Quantità"]];
  voci.forEach(v=>{
    const base = [dataItaliana(v.data), v.fonte === "foglio" ? "Foglio giornaliero" : "Rapportino", v.cliente, v.indirizzo, intervalliTesto(v)];
    if(v.materiali.length) v.materiali.forEach(m=>righe.push(base.concat([m.a, m.q])));
    else righe.push(base.concat(["Nessun materiale", ""]));
  });
  return "\uFEFF" + righe.map(r=>r.map(cella).join(";")).join("\r\n") + "\r\n";
}
