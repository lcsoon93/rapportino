// Regole dell'anagrafica clienti, senza rete ne' DOM (provate con Node in tests/unit/).
// Il NOME NON E' UNA CHIAVE: ogni cliente si riconosce solo dal suo id (uuid). Piu' clienti possono
// avere lo stesso nome e anche lo stesso indirizzo; qui non si unisce mai nulla per nome.

// campi della scheda; quelli dopo "archiviato" arrivano con la migrazione 20261128090000 (facoltativi)
export const CAMPI_CLIENTE = ["nome", "indirizzo", "telefono", "email", "partita_iva", "note", "archiviato",
  "tipologia", "referente", "codice_fiscale", "codice_sdi", "pec", "stato", "sedi"];
export const CAMPI_SCHEDA_ESTESA = ["tipologia", "referente", "codice_fiscale", "codice_sdi", "pec", "stato", "sedi"];
export const LIMITI_CLIENTE = { nome: 200, indirizzo: 300, telefono: 60, email: 200, partita_iva: 30, note: 2000,
  referente: 200, codice_fiscale: 20, codice_sdi: 10, pec: 200 };
export const TIPOLOGIE_CLIENTE = [["", "Non indicata"], ["privato", "Privato"], ["azienda", "Azienda"], ["amministratore", "Amministratore"], ["condominio", "Condominio"]];
export const STATI_CLIENTE = [["attivo", "Attivo"], ["potenziale", "Potenziale"], ["inattivo", "Inattivo"]];
export const MAX_SEDI = 20;

export const norma = t=>String(t || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\p{L}\p{N}@.+]+/gu, " ").replace(/\s+/g, " ").trim();
const soloCifre = t=>String(t || "").replace(/\D+/g, "");
const testo = (v, max)=>String(v ?? "").replace(/\s+$/g, "").replace(/^\s+/g, "").slice(0, max);

// sedi operative / indirizzi aggiuntivi: [{ nome, indirizzo }] senza righe vuote
export function pulisciSedi(sedi){
  return (Array.isArray(sedi) ? sedi : []).map(x=>({ nome: testo(x && x.nome, 100), indirizzo: testo(x && x.indirizzo, 300) }))
    .filter(x=>x.nome || x.indirizzo).slice(0, MAX_SEDI);
}
// scheda ripulita (testi senza spazi superflui, campi mancanti vuoti, valori ammessi)
export function pulisciCliente(d){
  const c = {};
  for(const k of CAMPI_CLIENTE){
    if(k === "archiviato") c.archiviato = !!(d && d.archiviato);
    else if(k === "sedi") c.sedi = pulisciSedi(d && d.sedi);
    else if(k === "tipologia") c.tipologia = TIPOLOGIE_CLIENTE.some(t=>t[0] === (d && d.tipologia)) ? d.tipologia : "";
    else if(k === "stato") c.stato = STATI_CLIENTE.some(t=>t[0] === (d && d.stato)) ? d.stato : "attivo";
    else c[k] = testo(d && d[k], LIMITI_CLIENTE[k]);
  }
  c.nome = c.nome.replace(/\s+/g, " ");
  c.codice_fiscale = c.codice_fiscale.toUpperCase();
  c.codice_sdi = c.codice_sdi.toUpperCase();
  return c;
}
// confronto di un campo (le sedi sono un elenco)
export const valoreCampo = v=>v && typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
export const stessoCampo = (a, b)=>valoreCampo(a) === valoreCampo(b);
// campi da confrontare con la copia del server: un server senza la migrazione nuova non li ha
export const campiConfrontabili = srv=>CAMPI_CLIENTE.filter(k=>!CAMPI_SCHEDA_ESTESA.includes(k) || (srv && k in srv));

// errori bloccanti (il nome e' l'unico campo obbligatorio; nessun controllo di unicita')
export function erroriCliente(d){
  const e = [];
  const c = pulisciCliente(d);
  if(!c.nome) e.push("Il nome o la ragione sociale è obbligatorio.");
  if(c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) e.push("L'email non è valida.");
  if(c.telefono && !/^[+\d][\d\s./()-]{3,}$/.test(c.telefono)) e.push("Il telefono non è valido.");
  if(c.pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.pec)) e.push("La PEC non è valida.");
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
    const tutto = [nome, norma(c.indirizzo), norma(c.email), norma(c.partita_iva), norma(c.note), norma(c.referente), norma(c.codice_fiscale),
      ...(Array.isArray(c.sedi) ? c.sedi.map(x=>norma(x.nome) + " " + norma(x.indirizzo)) : [])].join(" ");
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
  for(const k of campiConfrontabili(server)){
    const b = base ? base[k] : undefined, m = mia[k], s = server[k];
    const uguali = stessoCampo;
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
