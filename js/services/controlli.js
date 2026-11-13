// Controllo automatico del rapportino: regole fisse, senza rete e senza AI (funziona anche offline).
// Restituisce un elenco di segnalazioni { livello: "errore" | "attenzione" | "info", campo, messaggio }.
// "errore" = il server rifiuterebbe il completamento (stesse regole di salva/completa);
// "attenzione" = probabile dimenticanza; "info" = suggerimento. Nessun dato viene modificato.

const LIVELLI = { errore: 0, attenzione: 1, info: 2 };
const minuti = hhmm=>{ const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || "")); return m ? +m[1] * 60 + +m[2] : null; };
const giorni = (a, b)=>Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
// tipologie per cui le foto sono di solito necessarie
const TIPOLOGIE_CON_FOTO = ["Guasto / straordinaria", "Nuovo impianto"];

// dati: { rapportino: { data, cliente, indirizzo, tipologia, attivita, note, esito, materiali: [{a, q}], firma, firmatario },
//         ore: [{ operaio_id, nome, dalle, alle }], foto: { totali, nonInviate, nonDisponibili }, oggi: "AAAA-MM-GG" }
export function controllaRapportino(dati){
  const r = (dati && dati.rapportino) || {};
  const ore = (dati && dati.ore) || [];
  const foto = (dati && dati.foto) || {};
  const oggi = (dati && dati.oggi) || new Date().toISOString().slice(0, 10);
  const s = [];
  const add = (livello, campo, messaggio)=>s.push({ livello, campo, messaggio });

  // dati obbligatori
  if(!r.data) add("errore", "data", "Manca la data.");
  if(!String(r.cliente || "").trim()) add("errore", "cliente", "Manca il cliente.");
  const att = String(r.attivita || "").trim();
  if(!att) add("errore", "attivita", "Mancano le attività svolte (servono per completare).");
  else if(att.length < 15) add("attenzione", "attivita", "Descrizione delle attività molto breve: aggiungi cosa è stato fatto e l'esito.");
  if(!String(r.indirizzo || "").trim()) add("attenzione", "indirizzo", "Manca l'indirizzo.");
  if(!r.tipologia) add("attenzione", "tipologia", "Tipologia non indicata.");

  // date
  if(r.data && oggi){
    if(r.data > oggi) add("attenzione", "data", "La data è nel futuro.");
    else if(giorni(r.data, oggi) > 30) add("info", "data", "Rapportino di più di 30 giorni fa: controlla la data.");
  }

  // ore
  const complete = ore.filter(o=>o.dalle && o.alle);
  if(!complete.length) add("errore", "ore", "Mancano le ore lavorate (dalle / alle).");
  ore.forEach(o=>{
    const nome = o.nome || "operaio";
    if((o.dalle && !o.alle) || (!o.dalle && o.alle)) add("attenzione", "ore", "Orario incompleto per " + nome + ".");
    const a = minuti(o.dalle), b = minuti(o.alle);
    if(a === null || b === null) return;
    if(b <= a) add("errore", "ore", "Per " + nome + " l'orario di fine (" + o.alle + ") non è dopo l'inizio (" + o.dalle + ").");
    else if(b - a > 12 * 60) add("attenzione", "ore", "Per " + nome + " più di 12 ore in un rapportino: controlla gli orari.");
    if(a < 5 * 60 || b > 22 * 60) add("info", "ore", "Orario notturno per " + nome + " (" + o.dalle + "–" + o.alle + ").");
  });
  // stesso operaio su due righe con orari sovrapposti
  const perOperaio = {};
  complete.forEach(o=>{ (perOperaio[o.operaio_id || o.nome] = perOperaio[o.operaio_id || o.nome] || []).push(o); });
  Object.values(perOperaio).forEach(righe=>{
    const ord = righe.map(o=>[minuti(o.dalle), minuti(o.alle), o]).filter(x=>x[0] !== null && x[1] !== null && x[1] > x[0]).sort((x, y)=>x[0] - y[0]);
    for(let i = 1; i < ord.length; i++){
      if(ord[i][0] < ord[i - 1][1]){ add("errore", "ore", "Orari sovrapposti per " + (ord[i][2].nome || "lo stesso operaio") + "."); break; }
    }
  });

  // materiali
  (r.materiali || []).forEach(m=>{
    const art = String(m.a || "").trim(), q = String(m.q || "").trim();
    if(!art) return;
    if(!q) add("attenzione", "materiali", "Quantità mancante per \"" + art + "\".");
    else{
      const n = Number(q.replace(",", ".").replace(/\s*(pz|pezzi|m|mt|metri|kg|l|lt|nr|n\.?)$/i, ""));
      if(isNaN(n)) add("info", "materiali", "Quantità non numerica per \"" + art + "\" (" + q + ").");
      else if(n <= 0) add("attenzione", "materiali", "Quantità non valida per \"" + art + "\" (" + q + ").");
    }
  });

  // esito e note
  if(r.esito === "Da ultimare" && !String(r.note || "").trim()) add("attenzione", "note", "Esito \"Da ultimare\": scrivi nelle note cosa resta da fare.");

  // firma
  const firma = !!r.firma, firmatario = !!String(r.firmatario || "").trim();
  if(!firma && !firmatario) add("attenzione", "firma", "Manca la firma del cliente.");
  else if(firma && !firmatario) add("attenzione", "firmatario", "Firma presente ma manca il nome del firmatario.");
  else if(!firma && firmatario) add("attenzione", "firma", "Nome del firmatario presente ma manca la firma.");

  // foto
  const totali = Number(foto.totali) || 0;
  if(Number(foto.nonInviate) > 0) add("attenzione", "foto", foto.nonInviate + (foto.nonInviate === 1 ? " foto non ancora inviata" : " foto non ancora inviate") + ": il completamento le aspetta.");
  if(Number(foto.nonDisponibili) > 0) add("info", "foto", foto.nonDisponibili + " foto non scaricate (rete): controllale prima del PDF.");
  if(!totali){
    if(TIPOLOGIE_CON_FOTO.includes(r.tipologia)) add("attenzione", "foto", "Nessuna foto: per \"" + r.tipologia + "\" è consigliata almeno una foto.");
    else add("info", "foto", "Nessuna foto allegata.");
  }

  return s.sort((x, y)=>LIVELLI[x.livello] - LIVELLI[y.livello]);
}

// testo breve da mostrare (es. nella conferma di "Completa")
export function elencoTesto(segnalazioni, livelli = ["attenzione"]){
  return segnalazioni.filter(x=>livelli.includes(x.livello)).map(x=>"• " + x.messaggio).join("\n");
}
