// Sincronizzazione con Supabase (tabella "rapporti"): vince la modifica piu' recente.
import { SINC_ATTIVA, SUPABASE_KEY, SUPABASE_URL } from "../core/config.js";
import { leggiDB, leggiTimbri, scriviDB, scriviTimbri } from "../core/storage.js";
import { emetti } from "../core/eventi.js";

export let inSincronia = false;
export function statoSinc(testo, colore){
  const el = document.getElementById("statosinc");
  if(!el) return;
  el.textContent = testo;
  el.style.color = colore || "#5A6068";
}
export async function chiamaSupabase(percorso, opzioni){
  const risposta = await fetch(SUPABASE_URL + "/rest/v1/" + percorso, Object.assign({
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    }
  }, opzioni || {}));
  if(!risposta.ok) throw new Error("Supabase " + risposta.status);
  return risposta;
}
// manda al server un singolo giorno
export async function inviaGiorno(iso, dati){
  if(!SINC_ATTIVA()) return;
  await chiamaSupabase("rapporti", {
    method: "POST",
    body: JSON.stringify({
      data: iso,
      dati: dati,
      aggiornato: new Date().toISOString()
    })
  });
}
// cancella un giorno anche sul server
export async function cancellaGiornoRemoto(iso){
  if(!SINC_ATTIVA()) return;
  try{
    await chiamaSupabase("rapporti?data=eq." + iso, {method: "DELETE"});
  }catch(e){ console.error(e); }
}
// scarica tutto e fonde con l'archivio locale (vince la versione piu' recente)
export async function sincronizza(silenzioso){
  if(!SINC_ATTIVA() || inSincronia) return;
  inSincronia = true;
  if(!silenzioso) statoSinc("Sincronizzo…");
  try{
    const risposta = await chiamaSupabase("rapporti?select=data,dati,aggiornato");
    const remoti = await risposta.json();
    const db = leggiDB();
    const timbri = leggiTimbri();
    let cambiati = 0;

    // dal server verso il telefono
    remoti.forEach(r=>{
      const locale = timbri[r.data];
      if(!locale || locale < r.aggiornato){
        db[r.data] = r.dati;
        timbri[r.data] = r.aggiornato;
        cambiati++;
      }
    });

    // dal telefono verso il server: giorni non ancora inviati o piu' recenti
    const mappaRemota = {};
    remoti.forEach(r=>{ mappaRemota[r.data] = r.aggiornato; });
    for(const iso of Object.keys(db)){
      const mio = timbri[iso];
      if(!mappaRemota[iso] || (mio && mio > mappaRemota[iso])){
        const quando = mio || new Date().toISOString();
        await inviaGiorno(iso, db[iso]);
        timbri[iso] = quando;
      }
    }

    scriviDB(db);
    scriviTimbri(timbri);
    statoSinc("Sincronizzato", "#2FA189");
    setTimeout(()=>statoSinc(""), 2500);
    if(cambiati) emetti("archivio-aggiornato");
  }catch(e){
    console.error(e);
    statoSinc("Non sincronizzato (offline?)", "#B3413A");
  }finally{
    inSincronia = false;
  }
}
