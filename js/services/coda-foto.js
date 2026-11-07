// Foto dei rapportini in attesa di invio, conservate sul telefono (IndexedDB) finche' il file non e'
// stato caricato nello Storage E i suoi metadati registrati nel database. Sopravvivono alla chiusura
// dell'app e all'assenza di rete; si tolgono solo dopo la conferma del server.
//
// Ogni voce: { id (uuid = id dell'allegato), rapportino_id, autore, percorso, blob, nome, mime,
//              dimensione, larghezza, altezza, impronta, stato: "in_attesa" | "errore", errore, creato }
// In localStorage resta un piccolo indice per rapportino (numero di foto, cliente, data) cosi'
// l'elenco "Da inviare" si costruisce senza aprire IndexedDB.
const DB_NOME = "rapportino-foto", STORE = "foto";
export const PREFISSO_INDICE = "fotoRapportino:";
let dbPromessa = null;
const memoria = new Map();      // ripiego se IndexedDB non e' disponibile (es. navigazione privata)

function apri(){
  if(!dbPromessa){
    dbPromessa = new Promise(ok=>{
      try{
        const r = indexedDB.open(DB_NOME, 1);
        r.onupgradeneeded = ()=>{
          const st = r.result.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("rapportino", "rapportino_id");
        };
        r.onsuccess = ()=>ok(r.result);
        r.onerror = ()=>ok(null);
        r.onblocked = ()=>ok(null);
      }catch(e){ ok(null); }
    });
  }
  return dbPromessa;
}
function richiesta(db, modo, fn){
  return new Promise((ok, ko)=>{
    const tx = db.transaction(STORE, modo);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = ()=>ok(r && r.result);
    tx.onerror = tx.onabort = ()=>ko(tx.error || new Error("Archivio delle foto del telefono non disponibile"));
  });
}
// true se le foto in attesa sopravvivono alla chiusura dell'app
export async function codaPersistente(){ return !!(await apri()); }

export async function metti(voce){
  const db = await apri();
  if(db) await richiesta(db, "readwrite", st=>st.put(voce)); else memoria.set(voce.id, voce);
}
export async function togli(id){
  const db = await apri();
  if(db) await richiesta(db, "readwrite", st=>st.delete(id)); else memoria.delete(id);
}
export async function fotoDelRapportino(rapportinoId){
  const db = await apri();
  const tutte = db ? await richiesta(db, "readonly", st=>st.index("rapportino").getAll(rapportinoId)) || []
    : [...memoria.values()].filter(v=>v.rapportino_id === rapportinoId);
  return tutte.sort((a, b)=>a.creato.localeCompare(b.creato));
}

// indice leggero (localStorage) per "Da inviare"
export function aggiornaIndice(rapportinoId, info, numero){
  try{
    if(numero > 0) localStorage.setItem(PREFISSO_INDICE + rapportinoId, JSON.stringify({ ...info, numero, quando: new Date().toISOString() }));
    else localStorage.removeItem(PREFISSO_INDICE + rapportinoId);
  }catch(e){}
}
export function leggiIndice(){
  const out = [];
  try{
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(!k || !k.startsWith(PREFISSO_INDICE)) continue;
      const v = JSON.parse(localStorage.getItem(k) || "null");
      if(v) out.push({ id: k.slice(PREFISSO_INDICE.length), ...v });
    }
  }catch(e){}
  return out;
}
