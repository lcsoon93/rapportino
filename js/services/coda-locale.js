// Archivio locale dei rapportini non ancora confermati dal server (IndexedDB "rapportino-foto").
// Due tabelle:
//   bozze  un record per rapportino: contenuto (con ore e firma), stato della sincronizzazione,
//          versione del server conosciuta, tentativi, ultimo invio (per riconoscere una risposta persa)
//   foto   foto in attesa di invio (file compresso + metadati), una voce per foto
// Sopravvive a cambio schermata, refresh, chiusura e riapertura dell'app. Nessun token o credenziale:
// solo dati del rapportino. Su iPhone Safari puo' cancellare i dati di un sito non usato per 7 giorni
// (salvo app aggiunta alla schermata Home): si chiede la persistenza dove il browser la consente.
//
// Record "bozze": { id, autore, intervento_id, intervento (etichetta), rapportino {data, cliente, ...,
//   firma, firmatario}, ore [], completa (l'operaio ha chiesto di completarlo), salvato (esiste sul
//   server), versione, base (aggiornato_il del server), testoDaInviare, stato, tentativi,
//   prossimoTentativo, ultimoTentativo, errore, erroreTipo, server (copia del server in conflitto),
//   ultimoInvio (contenuto dell'ultimo invio), modificato, inviato_il }
// Stati: locale (dati incompleti), in_attesa, in_sincronizzazione, allegati_in_attesa, conflitto,
//        errore, inviato (confermato dal server; resta solo come riepilogo per 24 ore)
const DB_NOME = "rapportino-foto", FOTO = "foto", BOZZE = "bozze";
let dbPromessa = null;
const memoria = { [FOTO]: new Map(), [BOZZE]: new Map() };   // ripiego se IndexedDB non e' disponibile

function apri(){
  if(!dbPromessa){
    dbPromessa = new Promise(ok=>{
      try{
        const r = indexedDB.open(DB_NOME, 2);
        r.onupgradeneeded = e=>{
          const db = r.result;
          if(e.oldVersion < 1){
            const st = db.createObjectStore(FOTO, { keyPath: "id" });
            st.createIndex("rapportino", "rapportino_id");
          }
          if(e.oldVersion < 2){
            const st = db.createObjectStore(BOZZE, { keyPath: "id" });
            st.createIndex("autore", "autore");
          }
        };
        r.onsuccess = ()=>ok(r.result);
        r.onerror = ()=>ok(null);
        r.onblocked = ()=>ok(null);
      }catch(e){ ok(null); }
    });
  }
  return dbPromessa;
}
function richiesta(db, store, modo, fn){
  return new Promise((ok, ko)=>{
    const tx = db.transaction(store, modo);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = ()=>ok(r && r.result);
    tx.onerror = tx.onabort = ()=>ko(tx.error || new Error("Archivio del telefono non disponibile"));
  });
}
// true se i dati sopravvivono alla chiusura dell'app
export async function codaPersistente(){ return !!(await apri()); }
// chiede al browser di non cancellare automaticamente i dati locali (dove supportato)
let persistenzaChiesta = false;
function chiediPersistenza(){
  if(persistenzaChiesta) return;
  persistenzaChiesta = true;
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{}); }catch(e){}
}

// ---------------------------------------------------------------- foto in attesa
export async function metti(voce){
  chiediPersistenza();
  const db = await apri();
  if(db) await richiesta(db, FOTO, "readwrite", st=>st.put(voce)); else memoria[FOTO].set(voce.id, voce);
}
export async function togli(id){
  const db = await apri();
  if(db) await richiesta(db, FOTO, "readwrite", st=>st.delete(id)); else memoria[FOTO].delete(id);
}
export async function fotoDelRapportino(rapportinoId){
  const db = await apri();
  const tutte = db ? await richiesta(db, FOTO, "readonly", st=>st.index("rapportino").getAll(rapportinoId)) || []
    : [...memoria[FOTO].values()].filter(v=>v.rapportino_id === rapportinoId);
  return tutte.sort((a, b)=>a.creato.localeCompare(b.creato));
}
export async function tutteLeFoto(){
  const db = await apri();
  return db ? await richiesta(db, FOTO, "readonly", st=>st.getAll()) || [] : [...memoria[FOTO].values()];
}

// ---------------------------------------------------------------- bozze
export async function salvaBozza(rec){
  chiediPersistenza();
  const db = await apri();
  if(db) await richiesta(db, BOZZE, "readwrite", st=>st.put(rec)); else memoria[BOZZE].set(rec.id, rec);
}
export async function leggiBozza(id){
  const db = await apri();
  return (db ? await richiesta(db, BOZZE, "readonly", st=>st.get(id)) : memoria[BOZZE].get(id)) || null;
}
export async function togliBozza(id){
  const db = await apri();
  if(db) await richiesta(db, BOZZE, "readwrite", st=>st.delete(id)); else memoria[BOZZE].delete(id);
}
export async function bozzeDi(autore){
  const db = await apri();
  const tutte = db ? await richiesta(db, BOZZE, "readonly", st=>st.index("autore").getAll(autore)) || []
    : [...memoria[BOZZE].values()].filter(r=>r.autore === autore);
  return tutte;
}

// bozze della versione precedente (localStorage) e indice foto: spostate in IndexedDB una volta sola
export async function importaDaLocalStorage(){
  const PREF = "bozzaRapportino:", IDX = "fotoRapportino:";
  const chiavi = [];
  try{ for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k && (k.startsWith(PREF) || k.startsWith(IDX))) chiavi.push(k); } }catch(e){ return; }
  for(const k of chiavi){
    try{
      if(k.startsWith(PREF)){
        const l = JSON.parse(localStorage.getItem(k) || "null");
        const id = k.slice(PREF.length);
        if(l && l.rapportino && !(await leggiBozza(id))){
          await salvaBozza({ id, autore: l.autore, intervento_id: l.intervento_id || null, intervento: "", rapportino: l.rapportino, ore: l.ore || [],
            completa: false, salvato: !!l.salvato, versione: l.versione || null, base: l.base || null, testoDaInviare: true,
            stato: l.rapportino.cliente && l.rapportino.data ? "in_attesa" : "locale", tentativi: 0, modificato: l.quando || new Date().toISOString() });
        }
      }
      localStorage.removeItem(k);
    }catch(e){}
  }
}
