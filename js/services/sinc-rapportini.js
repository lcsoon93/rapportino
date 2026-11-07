// Sincronizzazione dei rapportini rimasti sul telefono (coda in services/coda-locale.js).
//
// Quando parte: dopo l'accesso / alla riapertura dell'app, al ritorno della rete ("online"), quando si
// torna nell'app (visibilitychange) e, mentre l'app e' aperta e visibile, ogni 60 secondi se in coda
// c'e' qualcosa da inviare. Nessun invio in background ad app chiusa (nessun service worker: su iPhone
// non sarebbe comunque garantito); al ritorno nell'app si riprende da dove si era rimasti.
//
// Ogni invio usa SOLO i meccanismi esistenti: salva_rapportino (id generato dal telefono + controllo di
// versione + "conflitto") e, per le foto, upload nello Storage + registra_allegato (Fase C).
// Un rapportino alla volta (blocco per rapportino, anche tra due schede: Web Locks dove disponibili);
// un errore su un rapportino non blocca gli altri.
//
// Risposta persa: il telefono ricorda l'ultimo contenuto inviato. Al tentativo successivo il server
// risponde "conflitto"; se la versione del server e' uguale a quella del telefono, oppure all'ultimo
// invio del telefono stesso (la sua scrittura, di cui si era persa la risposta), si prosegue con la
// versione del server: nessun doppione e nessuna sovrascrittura di modifiche altrui. Altrimenti il
// rapportino passa in "conflitto" e serve una decisione dell'operaio.
import { SUPABASE_KEY, SUPABASE_URL } from "../core/config.js";
import { client, profilo } from "../core/sessione.js";
import { puo } from "../core/permessi.js";
import { emetti } from "../core/eventi.js";
import { caricaFotoStorage, registraAllegato, rimuoviFotoStorage, salvaRapportino } from "./api-lavori.js";
import { bozzeDi, fotoDelRapportino, importaDaLocalStorage, leggiBozza, metti, salvaBozza, togli, togliBozza, tutteLeFoto } from "./coda-locale.js";

export const MAX_TENTATIVI = 8;                       // poi l'invio automatico si sospende ("Riprova")
const attesaDopo = n=>Math.min(30000 * 2 ** Math.max(0, n - 1), 30 * 60000);   // 30 s, 1, 2, 4… max 30 min
const ORE_INVIATI = 24;
const ora = ()=>new Date().toISOString();

// ---------------------------------------------------------------- confronto dei contenuti
const CAMPI = ["data", "cliente", "indirizzo", "tipologia", "attivita", "note", "esito", "firma", "firmatario"];
export function stessoContenuto(mio, oreMie, srv, oreSrv){
  if(!mio || !srv) return false;
  if(CAMPI.some(c=>String(mio[c] ?? "") !== String(srv[c] ?? ""))) return false;
  if((mio.intervento_id || null) !== (srv.intervento_id || null)) return false;
  if(JSON.stringify(mio.materiali || []) !== JSON.stringify(srv.materiali || [])) return false;
  const norma = l=>JSON.stringify((l || []).map(o=>[o.operaio_id, String(o.dalle || "").slice(0, 5), String(o.alle || "").slice(0, 5)])
    .sort((a, b)=>a[0].localeCompare(b[0])));
  return norma(oreMie) === norma(oreSrv);
}

// ---------------------------------------------------------------- stato della connessione
export const connessione = { stato: "sconosciuto", quando: null };   // online | offline | server | sessione
function imposta(stato){
  connessione.stato = stato; connessione.quando = ora();
  emetti("connessione-cambiata", stato);
  return stato;
}
async function conLimite(url, opz, ms){
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), ms);
  try{ return await fetch(url, { ...opz, signal: ctl.signal }); } finally{ clearTimeout(t); }
}
// navigator.onLine non basta (Wi-Fi senza Internet, Supabase irraggiungibile): si prova davvero
export async function verificaBackend(){
  if(navigator.onLine === false) return imposta("offline");
  try{
    const r = await conLimite(SUPABASE_URL + "/auth/v1/health", { headers: { apikey: SUPABASE_KEY } }, 8000);
    if(r.status >= 500) return imposta("server");
  }catch(e){ return imposta(navigator.onLine === false ? "offline" : "server"); }
  const { data } = await client.auth.getSession();
  if(!data || !data.session) return imposta("sessione");
  const u = await client.auth.getUser().catch(e=>({ error: e }));
  if(u.error) return imposta(/fetch|network|abort|timeout/i.test(String(u.error.message || u.error)) ? "server" : "sessione");
  return imposta("online");
}

// ---------------------------------------------------------------- blocchi
const blocchiLocali = new Map();
async function blocca(nome, fn, attendi){
  if(navigator.locks && navigator.locks.request){
    return navigator.locks.request("rapportino:" + nome, { ifAvailable: !attendi }, async lock=>lock ? fn() : { esito: "occupato" });
  }
  while(blocchiLocali.has(nome)){
    if(!attendi) return { esito: "occupato" };
    await blocchiLocali.get(nome).catch(()=>{});
  }
  const p = (async()=>fn())();
  blocchiLocali.set(nome, p);
  try{ return await p; } finally{ blocchiLocali.delete(nome); }
}

// ---------------------------------------------------------------- errori
export function tipoErrore(msg){
  const m = String(msg || "");
  if(/Sessione scaduta|JWT/i.test(m)) return "sessione";
  if(/connessione|tempo scaduto|Failed to fetch|NetworkError|network|abort|Load failed|Offline/i.test(m)) return "rete";
  if(/non sono ancora attivi|Errore del server|Errore dello Storage|internal|temporane/i.test(m)) return "temporaneo";
  if(/Per completare|obbligatori|Controlla le ore|Tipo di file|troppo grande/i.test(m)) return "dati";
  return "autorizzazione";        // non modificabile, non assegnato, completato, non consentito
}

// ---------------------------------------------------------------- scritture del record
// Il modulo puo' salvare nuove modifiche mentre un invio e' in corso: prima di scrivere si rilegge il
// record e, se il contenuto e' cambiato nel frattempo, si tiene quello nuovo (resta da inviare).
async function aggiornaRecord(rec, campi){
  const attuale = await leggiBozza(rec.id);
  const cambiato = attuale && attuale.modificato !== rec.modificato;
  const base = cambiato ? attuale : rec;
  Object.assign(base, campi);
  if(cambiato){
    // dati del server aggiornati, contenuto quello nuovo del telefono, ancora da inviare
    ["salvato", "versione", "base", "statoServer", "ultimoInvio"].forEach(k=>{ if(k in rec) base[k] = rec[k]; });
    base.testoDaInviare = true;
    if(campi.stato === "inviato" || campi.stato === "allegati_in_attesa") base.stato = "in_attesa";
    delete base.inviato_il;
  }
  await salvaBozza(base);
  Object.assign(rec, base);
  emetti("coda-aggiornata", { id: rec.id });
  return rec;
}
function applicaServer(rec, s){
  rec.salvato = true; rec.versione = s.versione; rec.base = s.aggiornato_il; rec.statoServer = s.stato; rec.rapportinoServer = s;
}

// invio di testata e ore con la logica di conflitto descritta in alto
async function inviaTesto(rec, completa, sovrascrivi){
  const payload = { ...rec.rapportino, id: rec.id, intervento_id: rec.intervento_id || null, versione: rec.salvato ? rec.versione : null };
  const precedente = rec.ultimoInvio || null;
  rec.ultimoInvio = { rapportino: payload, ore: rec.ore };
  await aggiornaRecord(rec, {});                       // ricordato PRIMA di inviare (sopravvive a una chiusura)
  let r = await salvaRapportino(payload, rec.ore, completa);
  if(r.esito !== "conflitto") return { ok: true, rapportino: r.rapportino };
  const srv = r.rapportino;
  const uguale = stessoContenuto(payload, rec.ore, srv, r.ore);
  const mioInvio = !!precedente && stessoContenuto(precedente.rapportino, precedente.ore, srv, r.ore);
  if(uguale && (srv.stato === "completato" || !completa)) return { ok: true, rapportino: srv };   // gia' fatto
  const puoSovrascrivere = srv.stato === "bozza" || puo("rapportini.riapri");
  if((uguale || mioInvio || sovrascrivi) && puoSovrascrivere){
    r = await salvaRapportino({ ...payload, versione: srv.versione }, rec.ore, completa);
    if(r.esito !== "conflitto") return { ok: true, rapportino: r.rapportino };
  }
  return { ok: false, conflitto: { rapportino: r.rapportino, ore: r.ore || [] } };
}

// foto in coda del rapportino: upload (gia' presente = ok) -> metadati -> fuori dalla coda
async function inviaFoto(rec, foto){
  const inviate = [];
  let errore = "", tipo = "";
  for(const v of foto){
    try{
      await caricaFotoStorage(v.percorso, v.blob, v.mime);
      const r = await registraAllegato({ id: v.id, rapportino_id: v.rapportino_id, percorso: v.percorso, nome: v.nome, mime: v.mime,
        dimensione: v.dimensione, larghezza: v.larghezza, altezza: v.altezza, impronta: v.impronta });
      if(r.esito === "duplicato"){ try{ await rimuoviFotoStorage([v.percorso]); }catch(e){} }
      else inviate.push({ id: v.id, allegato: r.allegato });
      await togli(v.id);
    }catch(e){
      errore = e.message; tipo = tipoErrore(e.message);
      const { _src, ...daSalvare } = v;
      await metti({ ...daSalvare, stato: "errore", errore: e.message }).catch(()=>{});
      if(tipo === "rete" || tipo === "sessione") break;
    }
  }
  const rimaste = (await fotoDelRapportino(rec.id)).filter(v=>v.autore === rec.autore).length;
  return { inviate, rimaste, errore, tipo };
}

async function segnaErrore(rec, msg, tipo, extra){
  const campi = { errore: msg, erroreTipo: tipo, ultimoTentativo: ora() };
  if(tipo === "rete") imposta(navigator.onLine === false ? "offline" : "server");
  if(tipo === "sessione") imposta("sessione");
  const inAttesaFoto = extra && extra.rimaste;
  if(tipo === "rete" || tipo === "temporaneo"){
    const n = (rec.tentativi || 0) + 1;
    campi.tentativi = n;
    if(n >= MAX_TENTATIVI){ campi.stato = "errore"; campi.prossimoTentativo = null; campi.errore = msg + " (invio automatico sospeso dopo " + n + " tentativi)"; }
    else { campi.stato = inAttesaFoto ? "allegati_in_attesa" : "in_attesa"; campi.prossimoTentativo = new Date(Date.now() + attesaDopo(n)).toISOString(); }
  }else if(tipo === "sessione"){
    campi.stato = inAttesaFoto ? "allegati_in_attesa" : "in_attesa";
  }else{
    campi.stato = "errore"; campi.prossimoTentativo = null;
  }
  await aggiornaRecord(rec, campi);
  return { esito: tipo === "sessione" ? "sessione" : "errore", tipo, errore: msg, rec, rapportino: rec.rapportinoServer || null, ...(extra || {}) };
}

// ---------------------------------------------------------------- invio di un rapportino
// opz.manuale: chiamato dall'operaio (attende un invio gia' in corso dello stesso rapportino);
// opz.sovrascrivi: scelta esplicita di sostituire la versione del server in conflitto
export async function inviaRapportino(id, opz = {}){
  if(!profilo) return { esito: "saltato" };
  const io = profilo.id;
  return blocca(id, async()=>{
    let rec = await leggiBozza(id);
    const foto = (await fotoDelRapportino(id)).filter(v=>v.autore === io);
    if(!rec){
      if(!foto.length) return { esito: "nulla" };
      // foto rimaste senza bozza (rapportino gia' sul server): solo le foto
      rec = { id, autore: io, rapportino: { cliente: "", data: "" }, ore: [], salvato: true, testoDaInviare: false, completa: false,
        stato: "allegati_in_attesa", tentativi: 0, modificato: ora() };
      await salvaBozza(rec);
    }
    if(rec.autore !== io) return { esito: "saltato" };           // mai i rapportini di un altro utente
    if(rec.stato === "inviato" && !foto.length && !rec.testoDaInviare) return { esito: "inviato", rec };
    if(rec.stato === "conflitto" && !opz.sovrascrivi) return { esito: "conflitto", rec };
    if(rec.testoDaInviare && !(rec.rapportino.cliente && rec.rapportino.data)){
      await aggiornaRecord(rec, { stato: "locale", errore: "Mancano data o cliente: completa il rapportino." });
      return { esito: "locale", rec };
    }
    await aggiornaRecord(rec, { stato: "in_sincronizzazione", ultimoTentativo: ora() });
    const fotoInviate = [];
    try{
      // 1. testo e ore (se c'e' da completare e ci sono foto, prima in bozza: si completa dopo le foto)
      if(rec.testoDaInviare || !rec.salvato){
        const t = await inviaTesto(rec, rec.completa && !foto.length, opz.sovrascrivi);
        if(!t.ok) return segnaConflitto(rec, t.conflitto);
        applicaServer(rec, t.rapportino);
        await aggiornaRecord(rec, { testoDaInviare: false });
        if(rec.testoDaInviare) return { esito: "modificato", rec, rapportino: rec.rapportinoServer, fotoInviate };
      }
      // 2. foto
      if(foto.length){
        const f = await inviaFoto(rec, foto);
        fotoInviate.push(...f.inviate);
        if(f.rimaste) return segnaErrore(rec, f.errore || "Foto non inviate.", f.tipo || "temporaneo", { fotoInviate, rimaste: f.rimaste });
      }
      // 3. completamento richiesto dall'operaio (solo con tutte le foto confermate)
      if(rec.completa && rec.statoServer !== "completato"){
        const t = await inviaTesto(rec, true, opz.sovrascrivi);
        if(!t.ok) return segnaConflitto(rec, t.conflitto, fotoInviate);
        applicaServer(rec, t.rapportino);
      }
      // 4. confermato dal server: resta solo un riepilogo (niente contenuto, firma o foto)
      const srv = rec.rapportinoServer;
      await aggiornaRecord(rec, { stato: "inviato", inviato_il: ora(), errore: null, erroreTipo: null, tentativi: 0, prossimoTentativo: null,
        rapportino: { cliente: rec.rapportino.cliente, data: rec.rapportino.data }, ore: [], ultimoInvio: null, server: null, completa: false, rapportinoServer: null });
      if(rec.stato !== "inviato") return { esito: "modificato", rec, rapportino: srv, fotoInviate };
      return { esito: "inviato", rec, rapportino: srv, fotoInviate };
    }catch(e){
      return segnaErrore(rec, e.message, tipoErrore(e.message), { fotoInviate });
    }
  }, !!opz.manuale);
}
async function segnaConflitto(rec, conflitto, fotoInviate){
  const completato = conflitto.rapportino && conflitto.rapportino.stato === "completato";
  rec.salvato = true;
  await aggiornaRecord(rec, { stato: "conflitto", server: conflitto, erroreTipo: "conflitto", prossimoTentativo: null,
    errore: completato ? "Il rapportino è stato completato da un altro dispositivo." : "Sul server c'è una versione diversa." });
  return { esito: "conflitto", rec, conflitto, fotoInviate: fotoInviate || [] };
}

// ---------------------------------------------------------------- coda
let apertoNelModulo = null, toccatoIl = 0;
// il rapportino aperto nel modulo si invia in automatico solo se non viene modificato da un minuto
export function segnaApertoNelModulo(id){ apertoNelModulo = id; toccatoIl = Date.now(); }
export function segnaModificaNelModulo(){ toccatoIl = Date.now(); }

export async function elencoCoda(){
  if(!profilo) return { voci: [], conteggi: { attesa: 0, inviati: 0, conflitti: 0, falliti: 0 }, connessione };
  const io = profilo.id;
  const bozze = await bozzeDi(io);
  const foto = (await tutteLeFoto()).filter(v=>v.autore === io);
  const perRap = {};
  foto.forEach(v=>{ perRap[v.rapportino_id] = (perRap[v.rapportino_id] || 0) + 1; });
  const limite = Date.now() - ORE_INVIATI * 3600000;
  const voci = [];
  let inviati = 0;
  for(const r of bozze){
    if(r.stato === "inviato" && !perRap[r.id]){ if(Date.parse(r.inviato_il || 0) >= limite) inviati++; continue; }
    voci.push({ ...r, fotoInAttesa: perRap[r.id] || 0 });
  }
  Object.keys(perRap).forEach(id=>{ if(!bozze.some(b=>b.id === id)) voci.push({ id, autore: io, rapportino: { cliente: "", data: "" }, salvato: true, stato: "allegati_in_attesa", fotoInAttesa: perRap[id] }); });
  voci.sort((a, b)=>String(b.modificato || "").localeCompare(String(a.modificato || "")));
  return {
    voci, connessione,
    conteggi: {
      attesa: voci.filter(v=>!["conflitto", "errore"].includes(v.stato)).length,
      inviati, conflitti: voci.filter(v=>v.stato === "conflitto").length, falliti: voci.filter(v=>v.stato === "errore").length,
    },
  };
}
async function pulisciInviati(){
  const limite = Date.now() - ORE_INVIATI * 3600000;
  for(const r of await bozzeDi(profilo.id)){
    if(r.stato === "inviato" && Date.parse(r.inviato_il || 0) < limite && !(await fotoDelRapportino(r.id)).length) await togliBozza(r.id);
  }
}
// rapportini da inviare adesso (rispettando l'attesa tra un tentativo e l'altro)
async function candidati(motivo){
  const { voci } = await elencoCoda();
  const adesso = Date.now();
  return voci.filter(v=>{
    if(["conflitto", "errore", "locale"].includes(v.stato)) return false;
    if(v.id === apertoNelModulo && adesso - toccatoIl < 60000) return false;
    if(!v.prossimoTentativo || Date.parse(v.prossimoTentativo) <= adesso) return true;
    // al ritorno della rete o nell'app si riprova subito cio' che era fallito per la rete
    return ["online", "ritorno", "avvio", "manuale"].includes(motivo) && v.erroreTipo === "rete";
  });
}

let giro = null;
export function sincronizzaCoda(motivo){
  if(!giro) giro = esegui(motivo).catch(e=>{ console.error(e); return { inviati: 0 }; }).finally(()=>{ giro = null; });
  return giro;
}
async function esegui(motivo){
  if(!profilo || !puo("rapportini.compila")) return { inviati: 0 };
  const io = profilo.id;
  const ris = await blocca("coda:" + io, async()=>{
    await pulisciInviati();
    let lista = await candidati(motivo);
    if(!lista.length){ emetti("coda-aggiornata", {}); return { inviati: 0 }; }
    if(await verificaBackend() !== "online"){ emetti("coda-aggiornata", {}); return { inviati: 0 }; }
    let inviati = 0;
    for(const v of lista){
      if(!profilo || profilo.id !== io) break;                 // cambio utente durante il giro
      const r = await inviaRapportino(v.id);
      if(r.esito === "inviato") inviati++;
      if(r.esito === "sessione"){ imposta("sessione"); break; }
      if(r.tipo === "rete" && await verificaBackend() !== "online") break;   // rete persa: si riprende dopo
      emetti("rapportino-sincronizzato", r);
    }
    return { inviati };
  }, false);
  emetti("coda-sincronizzata", ris || {});
  return ris || { inviati: 0 };
}

// riprova manuale di un rapportino (azzera i tentativi; non per i conflitti, che richiedono una scelta)
export async function riprova(id){
  const rec = await leggiBozza(id);
  if(rec && rec.stato !== "conflitto"){
    rec.tentativi = 0; rec.prossimoTentativo = null; rec.errore = null; rec.erroreTipo = null;
    if(rec.stato === "errore") rec.stato = rec.testoDaInviare ? "in_attesa" : "allegati_in_attesa";
    await salvaBozza(rec);
  }
  if(await verificaBackend() !== "online") return { esito: "errore", tipo: "rete", errore: messaggioConnessione() };
  return inviaRapportino(id, { manuale: true });
}
// elimina una bozza MAI inviata (con le sue foto in coda). Un rapportino gia' sul server non si
// elimina da qui (la copia locale non e' il rapportino).
export async function eliminaBozzaMaiInviata(id){
  const rec = await leggiBozza(id);
  if(!rec || rec.autore !== (profilo && profilo.id) || rec.salvato) return false;
  for(const v of await fotoDelRapportino(id)) await togli(v.id);
  await togliBozza(id);
  emetti("coda-aggiornata", { id });
  return true;
}
export function messaggioConnessione(stato){
  return { online: "Online", offline: "Offline: nessuna rete", server: "Server non raggiungibile (rete senza Internet o Supabase non disponibile)",
    sessione: "Sessione scaduta: accedi di nuovo", sconosciuto: "Connessione da verificare" }[stato || connessione.stato];
}

// ---------------------------------------------------------------- avvio e ascoltatori
let ascolto = false, timer = null;
export async function avviaSincronizzazione(){
  if(!ascolto){
    ascolto = true;
    window.addEventListener("online", ()=>{ if(profilo) sincronizzaCoda("online"); });
    window.addEventListener("offline", ()=>{ imposta("offline"); emetti("coda-aggiornata", {}); });
    document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && profilo) sincronizzaCoda("ritorno"); });
  }
  clearInterval(timer);
  timer = setInterval(()=>{ if(!document.hidden && profilo) sincronizzaCoda("periodica"); }, 60000);
  await importaDaLocalStorage();
  return sincronizzaCoda("avvio");
}
export function fermaSincronizzazione(){ clearInterval(timer); timer = null; }
export { leggiBozza, togliBozza };
