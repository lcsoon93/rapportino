// Scheda cliente: storico dei lavori, filtri, ore, materiali, impianti. Solo calcoli (niente DOM ne'
// rete), provati in tests/unit/scheda-cliente.test.mjs.
//
// Un documento appartiene al cliente se e' collegato alla sua scheda (cliente_id) oppure, se non e'
// collegato a nessuna scheda (documenti nati prima dell'anagrafica, vecchia app), se ha lo stesso nome:
// questi ultimi sono segnati "per nome" perche' con gli omonimi potrebbero essere di un altro cliente.
import { minutiPerOperaio } from "./rapportini-mese-logica.js";

export const norma = t=>String(t || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const ora = t=>String(t || "").slice(0, 5);

// il documento (rapportino o intervento) e' di questo cliente? "scheda" | "nome" | ""
export function collegamento(doc, cliente){
  if(!doc || !cliente) return "";
  if(doc.cliente_id) return doc.cliente_id === cliente.id ? "scheda" : "";
  return norma(doc.cliente) && norma(doc.cliente) === norma(cliente.nome) ? "nome" : "";
}

// minuti lavorati in un rapportino: per ogni operaio l'unione dei suoi intervalli, poi la somma
export function minutiRapportino(r){
  return Object.values(minutiPerOperaio([r])).reduce((a, m)=>a + m, 0);
}
const materialiPuliti = m=>(Array.isArray(m) ? m : []).filter(x=>x && String(x.a || "").trim()).map(x=>({ a: String(x.a).trim(), q: String(x.q ?? "").trim() }));
const SENZA_ATTIVITA = "Attività non indicata nella vecchia app.";

// Stato leggibile di una voce: chiave per i filtri + testo
//   rapportino: bozza | da_ultimare | completato;  intervento: pianificato | in_corso | completato | annullato
export const STATI_STORICO = [["", "Tutti gli stati"], ["completato", "Completati"], ["da_ultimare", "Da ultimare"], ["bozza", "Bozze"],
  ["pianificato", "Programmati"], ["in_corso", "In corso"], ["annullato", "Annullati"]];

// Voci dello storico (piu' recenti prima):
//   rapportini del cliente; interventi del cliente SENZA rapportini (programmati, in corso, annullati);
//   schede della vecchia app con lo stesso nome (vecchi: [{ iso, c, tecnici }]).
// nome(id) = nome dell'operaio.
export function vociStorico({ cliente, rapportini = [], interventi = [], vecchi = [], nome = id=>id }){
  const voci = [];
  const visti = new Set();
  rapportini.forEach(r=>{
    const link = collegamento(r, cliente);
    if(!link || visti.has(r.id)) return;
    visti.add(r.id);
    const ore = r.rapportino_operai || [];
    const tecnici = [...new Set((ore.length ? ore.map(o=>o.operaio_id) : [r.autore_id]).filter(Boolean).map(nome))];
    const attivita = String(r.attivita || "").trim();
    voci.push({
      tipo: "rapportino", id: r.id, data: r.data, link, interventoId: r.intervento_id || null,
      stato: r.stato !== "completato" ? "bozza" : r.esito === "Da ultimare" ? "da_ultimare" : "completato",
      descrizione: attivita === SENZA_ATTIVITA ? "" : attivita,
      richiesta: r.interventi && r.interventi.descrizione || "",
      tipologia: String(r.tipologia || "").trim(), indirizzo: r.indirizzo || "", note: r.note || "",
      tecnici, minuti: minutiRapportino(r),
      orari: ore.filter(o=>o.dalle && o.alle).map(o=>({ nome: nome(o.operaio_id), dalle: ora(o.dalle), alle: ora(o.alle) })),
      materiali: materialiPuliti(r.materiali), importato: !!r.origine, foto: (r.allegati && r.allegati[0] && r.allegati[0].count) || 0,
    });
  });
  interventi.forEach(i=>{
    const link = collegamento(i, cliente);
    if(!link) return;
    if((i.rapportini || []).length) return;             // il lavoro e' gia' nei suoi rapportini
    voci.push({
      tipo: "intervento", id: i.id, data: i.data, ora: ora(i.ora), link, stato: i.stato || "pianificato",
      descrizione: String(i.descrizione || "").trim(), tipologia: String(i.tipologia || "").trim(), indirizzo: i.indirizzo || "",
      tecnici: [...new Set((i.intervento_operai || []).filter(o=>!o.rimosso_il).map(o=>nome(o.operaio_id)))],
      minuti: 0, materiali: [],
    });
  });
  vecchi.forEach(({ iso, c, tecnici }, k)=>{
    if(norma(c && c.nome) !== norma(cliente && cliente.nome)) return;
    voci.push({
      tipo: "vecchio", id: iso + ":" + k, data: iso, link: "nome", stato: c.stato === "Da ultimare" ? "da_ultimare" : "completato",
      descrizione: String(c.dettagli || "").trim(), tipologia: String(c.tipologia || "").trim(), indirizzo: c.indirizzo || "",
      tecnici: tecnici || [], minuti: 0, materiali: materialiPuliti(c.materiali),
    });
  });
  return voci.sort((a, b)=>String(b.data).localeCompare(String(a.data)) || (a.tipo === "intervento") - (b.tipo === "intervento"));
}

// periodo: "12m" (ultimi 12 mesi), "tutto", oppure un anno "AAAA"; oggi = "AAAA-MM-GG"
export function nelPeriodoStorico(iso, periodo, oggi){
  if(!periodo || periodo === "tutto") return true;
  if(/^\d{4}$/.test(periodo)) return String(iso).startsWith(periodo + "-");
  const [a, m, g] = oggi.split("-").map(Number);
  const da = new Date(a - 1, m - 1, g);
  const p = n=>String(n).padStart(2, "0");
  return String(iso) >= da.getFullYear() + "-" + p(da.getMonth() + 1) + "-" + p(da.getDate());
}
export function filtraStorico(voci, { periodo = "tutto", stato = "", tipologia = "", oggi } = {}){
  return voci.filter(v=>nelPeriodoStorico(v.data, periodo, oggi) && (!stato || v.stato === stato) &&
    (!tipologia || norma(v.tipologia) === norma(tipologia)));
}
// tipologie e anni presenti (per i filtri)
export function opzioniStorico(voci){
  const tip = new Map();
  voci.forEach(v=>{ if(v.tipologia && !tip.has(norma(v.tipologia))) tip.set(norma(v.tipologia), v.tipologia); });
  return {
    tipologie: [...tip.values()].sort((a, b)=>a.localeCompare(b, "it")),
    anni: [...new Set(voci.map(v=>String(v.data).slice(0, 4)).filter(a=>/^\d{4}$/.test(a)))].sort().reverse(),
  };
}
// riepilogo delle voci mostrate
export function riepilogoStorico(voci){
  const lavori = voci.filter(v=>v.tipo !== "intervento");
  const ultimo = lavori.find(v=>v.stato !== "bozza");
  const prossimo = voci.filter(v=>v.tipo === "intervento" && (v.stato === "pianificato" || v.stato === "in_corso"))
    .sort((a, b)=>String(a.data).localeCompare(String(b.data)))[0];
  return { lavori: lavori.length, minuti: lavori.reduce((a, v)=>a + (v.minuti || 0), 0), ultimo: ultimo ? ultimo.data : "",
    prossimo: prossimo ? prossimo.data : "", perNome: voci.filter(v=>v.link === "nome").length };
}

// ---------------------------------------------------------------- impianti
export const CAMPI_IMPIANTO = ["nome", "marca", "modello", "matricola", "installato_il", "garanzia_fino", "posizione", "note", "dismesso"];
const LIMITI_IMPIANTO = { nome: 200, marca: 100, modello: 100, matricola: 100, posizione: 200, note: 2000 };
const dataValida = d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? String(d) : null;
export function pulisciImpianto(d){
  const x = {};
  for(const k of CAMPI_IMPIANTO){
    if(k === "dismesso") x.dismesso = !!(d && d.dismesso);
    else if(k === "installato_il" || k === "garanzia_fino") x[k] = dataValida(d && d[k]);
    else x[k] = String((d && d[k]) ?? "").trim().slice(0, LIMITI_IMPIANTO[k]);
  }
  x.nome = x.nome.replace(/\s+/g, " ");
  return x;
}
export function erroriImpianto(d){
  const x = pulisciImpianto(d), e = [];
  if(!x.nome) e.push("Indica che impianto è (es. Caldaia murale).");
  if(x.installato_il && x.garanzia_fino && x.garanzia_fino < x.installato_il) e.push("La garanzia non può finire prima dell'installazione.");
  return e;
}
// garanzia: { stato: "nessuna" | "attiva" | "in_scadenza" | "scaduta", giorni }
export function statoGaranzia(fino, oggi){
  if(!dataValida(fino)) return { stato: "nessuna", giorni: null };
  const g = Math.round((Date.UTC(...fino.split("-").map((n, i)=>+n - (i === 1 ? 1 : 0))) - Date.UTC(...oggi.split("-").map((n, i)=>+n - (i === 1 ? 1 : 0)))) / 86400000);
  return { stato: g < 0 ? "scaduta" : g <= 60 ? "in_scadenza" : "attiva", giorni: g };
}
// manutenzioni di un impianto: lavori del cliente il cui testo cita la matricola (almeno 3 caratteri)
// oppure marca e modello insieme. Nessun collegamento inventato: e' una ricerca nel testo.
export function manutenzioniImpianto(impianto, voci){
  const mat = norma(impianto && impianto.matricola);
  const mm = [norma(impianto && impianto.marca), norma(impianto && impianto.modello)];
  return voci.filter(v=>{
    if(v.tipo === "intervento") return false;
    const t = norma([v.descrizione, v.note, v.richiesta, ...(v.materiali || []).map(m=>m.a)].join(" "));
    if(mat.length >= 3 && t.includes(mat)) return true;
    return mm[0] && mm[1] && t.includes(mm[0]) && t.includes(mm[1]);
  });
}

// ---------------------------------------------------------------- collegamenti rapidi
export const linkTelefono = t=>{ const n = String(t || "").replace(/[^\d+]/g, ""); return n.length >= 3 ? "tel:" + n : ""; };
export const linkEmail = e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim()) ? "mailto:" + String(e).trim() : "";
export const linkMappe = ind=>String(ind || "").trim() ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(String(ind).trim()) : "";

// documenti: nome del file nel bucket e tipo ammesso
export const TIPI_DOCUMENTO = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_DOCUMENTO = 10 * 1024 * 1024;
export function controllaDocumento(file){
  if(!file) return "Nessun file scelto.";
  if(!TIPI_DOCUMENTO[file.type]) return "Formato non ammesso: carica un PDF o un'immagine (JPG, PNG, WEBP).";
  if(file.size > MAX_DOCUMENTO) return "File troppo grande: massimo 10 MB.";
  if(!file.size) return "Il file è vuoto.";
  return "";
}
export const percorsoDocumento = (clienteId, id, mime)=>clienteId + "/" + id + "." + TIPI_DOCUMENTO[mime];
export function dimensioneTesto(b){
  if(b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}
