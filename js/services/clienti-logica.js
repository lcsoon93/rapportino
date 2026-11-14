// Regole dell'anagrafica clienti, senza rete ne' DOM (provate con Node in tests/unit/).
// Il NOME NON E' UNA CHIAVE: ogni cliente si riconosce solo dal suo id (uuid). Piu' clienti possono
// avere lo stesso nome e anche lo stesso indirizzo; qui non si unisce mai nulla per nome.

export const CAMPI_CLIENTE = ["nome", "indirizzo", "telefono", "email", "partita_iva", "note", "archiviato"];
export const LIMITI_CLIENTE = { nome: 200, indirizzo: 300, telefono: 60, email: 200, partita_iva: 30, note: 2000 };

export const norma = t=>String(t || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\p{L}\p{N}@.+]+/gu, " ").replace(/\s+/g, " ").trim();
const soloCifre = t=>String(t || "").replace(/\D+/g, "");

// scheda ripulita (testi senza spazi superflui, campi mancanti vuoti)
export function pulisciCliente(d){
  const c = {};
  for(const k of CAMPI_CLIENTE){
    if(k === "archiviato") c.archiviato = !!(d && d.archiviato);
    else c[k] = String((d && d[k]) ?? "").replace(/\s+$/g, "").replace(/^\s+/g, "").slice(0, LIMITI_CLIENTE[k]);
  }
  c.nome = c.nome.replace(/\s+/g, " ");
  return c;
}
// errori bloccanti (il nome e' l'unico campo obbligatorio; nessun controllo di unicita')
export function erroriCliente(d){
  const e = [];
  const c = pulisciCliente(d);
  if(!c.nome) e.push("Il nome o la ragione sociale è obbligatorio.");
  if(c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) e.push("L'email non è valida.");
  if(c.telefono && !/^[+\d][\d\s./()-]{3,}$/.test(c.telefono)) e.push("Il telefono non è valido.");
  return e;
}

// etichetta che distingue gli omonimi: sempre nome + indirizzo (o "indirizzo non indicato")
export function etichettaCliente(c){
  return (c.nome || "") + " — " + (c.indirizzo || "indirizzo non indicato");
}

// ricerca: nome, indirizzo, telefono (anche solo cifre), email, partita IVA, note.
// Ordine: nome che inizia con il testo, poi nome che lo contiene, poi altri campi; a parita' nome e
// indirizzo. Gli archiviati solo se richiesti. Tutte le corrispondenze, nessuna scelta automatica.
export function cercaClienti(elenco, testo, { archiviati = false, massimo = 0 } = {}){
  const q = norma(testo), parole = q.split(" ").filter(Boolean), cifre = soloCifre(testo);
  const visibili = (elenco || []).filter(c=>archiviati || !c.archiviato);
  const punteggio = c=>{
    if(!parole.length) return 3;
    const nome = norma(c.nome);
    const tutto = [nome, norma(c.indirizzo), norma(c.email), norma(c.partita_iva), norma(c.note)].join(" ");
    const tel = soloCifre(c.telefono);
    if(nome.startsWith(q)) return 0;
    if(parole.every(p=>nome.includes(p))) return 1;
    if(parole.every(p=>tutto.includes(p))) return 2;
    if(cifre.length >= 3 && (tel.includes(cifre) || soloCifre(c.partita_iva).includes(cifre))) return 2;
    return -1;
  };
  const out = visibili.map(c=>[punteggio(c), c]).filter(x=>x[0] >= 0)
    .sort((a, b)=>a[0] - b[0] || norma(a[1].nome).localeCompare(norma(b[1].nome)) || norma(a[1].indirizzo).localeCompare(norma(b[1].indirizzo)))
    .map(x=>x[1]);
  return massimo ? out.slice(0, massimo) : out;
}
// schede con esattamente questo nome (per avvisare che ci sono omonimi)
export function omonimi(elenco, nome, { archiviati = false } = {}){
  const n = norma(nome);
  return n ? (elenco || []).filter(c=>(archiviati || !c.archiviato) && norma(c.nome) === n)
    .sort((a, b)=>norma(a.indirizzo).localeCompare(norma(b.indirizzo))) : [];
}
// il testo scritto nel campo "cliente" corrisponde ancora al cliente scelto?
export const stessoNome = (a, b)=>norma(a) === norma(b);

// Unione a tre vie di una modifica fatta offline con la versione del server.
// base = scheda da cui e' partita la modifica; mia = modifica; server = versione attuale.
// Campo cambiato solo da me -> mio; solo dal server -> server; da entrambi in modo diverso -> conflitto
// (si tiene il server e il campo viene segnalato: decide l'utente, niente si perde).
export function unisciModifiche(base, mia, server){
  const risultato = {}, conflitti = [];
  for(const k of CAMPI_CLIENTE){
    const b = base ? base[k] : undefined, m = mia[k], s = server[k];
    const uguali = (x, y)=>String(x ?? "") === String(y ?? "");
    if(uguali(m, s)) risultato[k] = s;
    else if(uguali(m, b)) risultato[k] = s;          // non l'ho toccato io
    else if(uguali(s, b)) risultato[k] = m;          // non l'ha toccato il server
    else { risultato[k] = s; conflitti.push(k); }
  }
  return { risultato, conflitti };
}

// i dati del cliente che si copiano nel documento (snapshot)
export function datiPerDocumento(c){
  return { cliente_id: c.id, cliente: c.nome || "", indirizzo: c.indirizzo || "", telefono: c.telefono || "" };
}
// differenze tra i dati del documento e la scheda (per "Aggiorna l'anagrafica")
export function differenzeDocumento(c, doc){
  const d = [];
  if(String(doc.indirizzo || "").trim() !== String(c.indirizzo || "").trim()) d.push("indirizzo");
  if(String(doc.telefono || "").trim() !== String(c.telefono || "").trim()) d.push("telefono");
  return d;
}

// Candidati per l'importazione dallo storico: coppie nome + indirizzo dei documenti che non hanno gia'
// una scheda con lo STESSO nome e lo STESSO indirizzo. Nessuna scheda viene unita o creata da sola.
export function candidatiImportazione(documenti, elenco){
  const esistenti = new Set((elenco || []).map(c=>norma(c.nome) + "|" + norma(c.indirizzo)));
  const visti = new Map();
  for(const d of documenti || []){
    const nome = String(d.cliente || "").trim();
    if(!nome || nome === "(senza nome)") continue;
    const k = norma(nome) + "|" + norma(d.indirizzo);
    if(esistenti.has(k)) continue;
    const v = visti.get(k) || { nome, indirizzo: String(d.indirizzo || "").trim(), telefono: "", volte: 0, ultimo: "" };
    v.volte++;
    if(d.telefono && !v.telefono) v.telefono = String(d.telefono).trim();
    if(String(d.data || "") > v.ultimo) v.ultimo = String(d.data || "");
    visti.set(k, v);
  }
  return [...visti.values()].sort((a, b)=>norma(a.nome).localeCompare(norma(b.nome)) || norma(a.indirizzo).localeCompare(norma(b.indirizzo)));
}
