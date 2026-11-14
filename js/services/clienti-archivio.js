// Anagrafica clienti: copia locale (IndexedDB) + coda delle modifiche + sincronizzazione con Supabase.
//
// - Lettura: dal server (tabella "clienti", RLS) quando c'e' rete; la copia resta sul telefono e si usa
//   offline. Ogni utente ha la sua copia: se entra un altro utente la copia si svuota.
// - Scrittura: ogni creazione/modifica va prima nella coda del telefono (subito visibile), poi parte
//   con salva_cliente. L'id lo genera il telefono: un invio ripetuto (risposta persa) non crea doppioni.
// - Modifiche: inviate con la versione da cui partono; se nel frattempo la scheda e' cambiata, unione
//   campo per campo (clienti-logica.js); se lo stesso campo e' cambiato da entrambi la modifica resta
//   in "conflitto" sul telefono finche' l'utente sceglie (niente si perde).
// - Il nome non identifica mai un cliente: tutto passa dall'id.
import { client, profilo } from "../core/sessione.js";
import { emetti } from "../core/eventi.js";
import { CAMPI_CLIENTE, erroriCliente, pulisciCliente, unisciModifiche } from "./clienti-logica.js";

const DB_NOME = "rapportino-clienti", CLIENTI = "clienti", CODA = "coda", META = "meta";
let dbPromessa = null;
const memoria = { [CLIENTI]: new Map(), [CODA]: new Map(), [META]: new Map() };   // senza IndexedDB

function apri(){
  if(!dbPromessa){
    dbPromessa = new Promise(ok=>{
      try{
        const r = indexedDB.open(DB_NOME, 1);
        r.onupgradeneeded = ()=>{
          const db = r.result;
          if(!db.objectStoreNames.contains(CLIENTI)) db.createObjectStore(CLIENTI, { keyPath: "id" });
          if(!db.objectStoreNames.contains(CODA)) db.createObjectStore(CODA, { keyPath: "id" });
          if(!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "k" });
        };
        r.onsuccess = ()=>ok(r.result);
        r.onerror = ()=>ok(null);
        r.onblocked = ()=>ok(null);
      }catch(e){ ok(null); }
    });
  }
  return dbPromessa;
}
async function op(store, modo, fn){
  const db = await apri();
  if(!db) return fn(null, memoria[store]);
  return new Promise((ok, ko)=>{
    const tx = db.transaction(store, modo);
    let risultato;
    const r = fn(tx.objectStore(store), null);
    if(r && "onsuccess" in r) r.onsuccess = ()=>{ risultato = r.result; };
    tx.oncomplete = ()=>ok(risultato);
    tx.onerror = ()=>ko(tx.error);
    tx.onabort = ()=>ko(tx.error);
  });
}
const tutti = store=>op(store, "readonly", (st, mem)=>mem ? [...mem.values()] : st.getAll()).then(x=>x || []);
const metti = (store, v)=>op(store, "readwrite", (st, mem)=>mem ? mem.set(v.id || v.k, v) : st.put(v));
const togli = (store, k)=>op(store, "readwrite", (st, mem)=>mem ? mem.delete(k) : st.delete(k));
const svuota = store=>op(store, "readwrite", (st, mem)=>mem ? mem.clear() : st.clear());
const leggi = (store, k)=>op(store, "readonly", (st, mem)=>mem ? mem.get(k) : st.get(k));

// ---------------------------------------------------------------- stato
export const statoAnagrafica = { attiva: true, aggiornata: null, errore: "" };   // attiva=false: tabella non ancora creata
const erroreRete = e=>/fetch|network|abort|timeout|Load failed|connessione/i.test(String((e && (e.message || e)) || ""));
const tabellaMancante = e=>/PGRST20[25]|42P01|42883|does not exist|Could not find the (table|function)/i.test(String((e && (e.code || "")) + " " + ((e && e.message) || "")));

// la copia sul telefono appartiene a un utente: se entra un altro si riparte da zero (la coda di un
// altro utente resta ma non viene mai inviata con l'account sbagliato: ogni voce ha il suo autore)
async function controllaProprietario(){
  if(!profilo) return;
  const m = await leggi(META, "proprietario").catch(()=>null);
  if(m && m.v !== profilo.id) await svuota(CLIENTI).catch(()=>{});
  if(!m || m.v !== profilo.id) await metti(META, { k: "proprietario", v: profilo.id }).catch(()=>{});
}

// ---------------------------------------------------------------- lettura
// elenco per l'interfaccia: schede del server con sopra le modifiche ancora in coda (di questo utente)
export async function elencoClienti(){
  await controllaProprietario();
  const [salvati, coda] = await Promise.all([tutti(CLIENTI), tutti(CODA)]);
  const mappa = new Map(salvati.map(c=>[c.id, { ...c, _stato: "" }]));
  for(const v of coda){
    if(!profilo || v.autore !== profilo.id) continue;
    const prima = mappa.get(v.id) || {};
    mappa.set(v.id, { ...prima, ...v.dati, id: v.id, versione: prima.versione || null, _stato: v.stato, _errore: v.errore || "", _server: v.server || null });
  }
  return [...mappa.values()];
}
export async function leggiCliente(id){
  return (await elencoClienti()).find(c=>c.id === id) || null;
}
// rilegge l'anagrafica dal server (se c'e' rete). Restituisce l'elenco aggiornato (o quello locale).
let inLettura = null;
export function aggiornaClienti(){
  if(inLettura) return inLettura;
  inLettura = (async()=>{
    await controllaProprietario();
    if(navigator.onLine === false) return elencoClienti();
    try{
      const { data, error } = await client.from("clienti").select("id, nome, indirizzo, telefono, email, partita_iva, note, archiviato, versione, creato_da, creato_il, aggiornato_il").order("nome");
      if(error) throw error;
      await svuota(CLIENTI);
      for(const c of data || []) await metti(CLIENTI, c);
      statoAnagrafica.attiva = true; statoAnagrafica.aggiornata = new Date().toISOString(); statoAnagrafica.errore = "";
      emetti("clienti-aggiornati");
    }catch(e){
      if(tabellaMancante(e)){ statoAnagrafica.attiva = false; statoAnagrafica.errore = "L'anagrafica clienti non è ancora attiva sul server."; }
      else statoAnagrafica.errore = erroreRete(e) ? "Senza rete: anagrafica salvata sul telefono." : "Anagrafica non aggiornata: " + (e.message || e);
    }
    return elencoClienti();
  })().finally(()=>{ inLettura = null; });
  return inLettura;
}

// ---------------------------------------------------------------- scrittura (coda)
// dati: campi della scheda; base: scheda di partenza (per una modifica) o null (nuovo cliente).
// Restituisce la scheda come appare subito sul telefono; l'invio parte in automatico.
export async function salvaCliente(dati, base){
  if(!profilo) throw new Error("Accedi per salvare.");
  const errori = erroriCliente(dati);
  if(errori.length) throw new Error(errori.join(" "));
  const id = (base && base.id) || dati.id || crypto.randomUUID();
  const pulito = pulisciCliente(dati);
  const prima = await leggi(CODA, id).catch(()=>null);
  let voce;
  if(prima && prima.autore === profilo.id && prima.stato !== "conflitto"){
    // ancora da inviare: si aggiorna la stessa voce (una nuova scheda resta "creazione")
    voce = { ...prima, dati: pulito, stato: "in_attesa", errore: "", modificato: new Date().toISOString() };
  } else {
    const nuovo = !base || !base.versione;
    voce = { id, autore: profilo.id, tipo: nuovo ? "crea" : "modifica", dati: pulito,
      base: nuovo ? null : Object.fromEntries(CAMPI_CLIENTE.concat("versione").map(k=>[k, base[k]])),
      stato: "in_attesa", errore: "", tentativi: 0, modificato: new Date().toISOString() };
  }
  await metti(CODA, voce);
  emetti("clienti-aggiornati");
  sincronizzaClienti().catch(()=>{});
  return { ...pulito, id, versione: base && base.versione || null, _stato: "in_attesa" };
}
export async function archiviaCliente(c, archiviato){
  return salvaCliente({ ...c, archiviato: !!archiviato }, c);
}
// eliminazione: solo online, solo admin (RLS) e solo senza documenti collegati (il database lo impedisce)
export async function eliminaCliente(id){
  const { error } = await client.from("clienti").delete().eq("id", id);
  if(error){
    if(/23503|foreign key/i.test((error.code || "") + error.message)) throw new Error("Il cliente ha interventi o rapportini collegati: archivialo invece di eliminarlo.");
    if(/42501|permission|policy/i.test((error.code || "") + error.message)) throw new Error("Operazione non consentita.");
    throw new Error(erroreRete(error) ? "Serve la connessione per eliminare un cliente." : error.message);
  }
  await togli(CLIENTI, id).catch(()=>{});
  await togli(CODA, id).catch(()=>{});
  emetti("clienti-aggiornati");
}
export async function scartaModifica(id){
  await togli(CODA, id);
  emetti("clienti-aggiornati");
}
// conflitto: "mia" = si rimanda la mia versione sopra quella del server; "server" = si scarta la mia
export async function risolviConflittoCliente(id, scelta){
  const v = await leggi(CODA, id);
  if(!v || v.stato !== "conflitto") return;
  if(scelta === "server"){
    if(v.server) await metti(CLIENTI, v.server);
    await togli(CODA, id);
  } else {
    await metti(CODA, { ...v, tipo: "modifica", base: v.server, stato: "in_attesa", errore: "", server: null, forza: true });
  }
  emetti("clienti-aggiornati");
  return sincronizzaClienti();
}

// ---------------------------------------------------------------- invio
let inInvio = null;
export function sincronizzaClienti(){
  if(inInvio) return inInvio;
  inInvio = invia().finally(()=>{ inInvio = null; });
  return inInvio;
}
async function invia(){
  if(!profilo || navigator.onLine === false) return { inviate: 0 };
  const coda = (await tutti(CODA)).filter(v=>v.autore === profilo.id && v.stato !== "conflitto" && v.stato !== "errore")
    .sort((a, b)=>String(a.modificato).localeCompare(String(b.modificato)));
  let inviate = 0;
  for(const voce of coda){
    let v = voce;
    for(let giro = 0; giro < 3; giro++){
      const versione = v.tipo === "crea" ? null : (v.base && v.base.versione) || null;
      let res;
      try{
        const r = await client.rpc("salva_cliente", { p_cliente: { id: v.id, ...v.dati }, p_versione: versione });
        if(r.error){ r.error.stato = r.status; throw r.error; }
        res = r.data;
      }catch(e){
        // rete assente, server momentaneamente in errore (5xx: la richiesta puo' essere arrivata, si
        // riprova con lo stesso id senza doppioni) o tabella non ancora creata: si riprova piu' tardi
        if(erroreRete(e) || tabellaMancante(e) || !e.stato || e.stato >= 500){
          if(tabellaMancante(e)) statoAnagrafica.attiva = false;
          return { inviate, interrotto: true };            // si riprova con la rete / dopo la migrazione
        }
        const permesso = /42501|permission|policy|non modificabile|Solo amministratore/i.test((e.code || "") + " " + (e.message || ""));
        await metti(CODA, { ...v, stato: "errore", errore: permesso ? "Non hai il permesso di salvare questa modifica." : (e.message || "Errore del server."),
          tentativi: (v.tentativi || 0) + 1 });
        break;
      }
      const srv = res && res.cliente;
      if(res && res.esito === "ok"){
        await metti(CLIENTI, srv); await togli(CODA, v.id); inviate++; break;
      }
      // conflitto: creazione gia' arrivata (risposta persa) o versione superata
      if(!srv){ await metti(CODA, { ...v, stato: "errore", errore: "Risposta del server non valida." }); break; }
      const mia = pulisciCliente(v.dati);
      const uguale = CAMPI_CLIENTE.every(k=>String(mia[k] ?? "") === String(srv[k] ?? ""));
      if(uguale){ await metti(CLIENTI, srv); await togli(CODA, v.id); inviate++; break; }
      if(v.tipo === "crea"){
        // la creazione era arrivata: le modifiche successive partono da quella versione
        if(srv.creato_da && srv.creato_da !== profilo.id){ await metti(CODA, { ...v, stato: "conflitto", server: srv }); break; }
        v = { ...v, tipo: "modifica", base: srv, stato: "in_attesa" };
        await metti(CODA, v); continue;
      }
      if(v.forza){ v = { ...v, base: srv, forza: false }; await metti(CODA, v); continue; }
      const { risultato, conflitti } = unisciModifiche(v.base, mia, srv);
      if(conflitti.length){ await metti(CODA, { ...v, stato: "conflitto", server: srv, conflitti }); break; }
      v = { ...v, dati: risultato, base: srv };
      await metti(CODA, v);
    }
  }
  emetti("clienti-aggiornati");
  return { inviate };
}

// all'accesso, al ritorno della rete e quando si torna sull'app
export async function avviaAnagrafica(){
  await controllaProprietario();
  await sincronizzaClienti().catch(()=>{});
  return aggiornaClienti();
}
if(typeof window !== "undefined"){
  window.addEventListener("online", ()=>{ if(profilo) avviaAnagrafica().catch(()=>{}); });
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && profilo) sincronizzaClienti().catch(()=>{}); });
}
