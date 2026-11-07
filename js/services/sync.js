// Sincronizzazione con Supabase (tabella "rapporti") con la sessione dell'utente: vince la modifica piu' recente.
import { SINC_ATTIVA, SUPABASE_KEY, SUPABASE_URL } from "../core/config.js";
import { leggiDB, leggiMappa, leggiTimbri, scriviDB, scriviMappa, scriviTimbri } from "../core/storage.js";
import { caricaProfilo, client, esci, profilo, tokenAccesso } from "../core/sessione.js";
import { emetti } from "../core/eventi.js";

export let inSincronia = false;
export function statoSinc(testo, colore){
  const el = document.getElementById("statosinc");
  if(!el) return;
  el.textContent = testo;
  el.style.color = colore || "#5A6068";
}
// chiamata REST con la sessione dell'utente: le policy RLS decidono cosa puo' leggere e scrivere
export async function chiamaSupabase(percorso, opzioni, riprova = true){
  const token = await tokenAccesso();
  if(!token){ const e = new Error("Non autenticato"); e.stato = 401; throw e; }
  const risposta = await fetch(SUPABASE_URL + "/rest/v1/" + percorso, Object.assign({
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    }
  }, opzioni || {}));
  if(risposta.status === 401 && riprova){
    // token scaduto: si rinnova una volta e si riprova
    const { error } = await client.auth.refreshSession();
    if(!error) return chiamaSupabase(percorso, opzioni, false);
  }
  if(!risposta.ok){ const e = new Error("Supabase " + risposta.status); e.stato = risposta.status; throw e; }
  return risposta;
}
// manda al server un singolo giorno (resta "in sospeso" finche' il server non conferma)
export async function inviaGiorno(iso, dati){
  if(!SINC_ATTIVA()) return;
  const sospesi = leggiMappa("inSospeso");
  sospesi[iso] = true; scriviMappa("inSospeso", sospesi);
  await chiamaSupabase("rapporti", {
    method: "POST",
    body: JSON.stringify({
      data: iso,
      dati: dati,
      aggiornato: new Date().toISOString()
    })
  });
  const ancora = leggiMappa("inSospeso");
  delete ancora[iso]; scriviMappa("inSospeso", ancora);
}
// cancella un giorno anche sul server
export async function cancellaGiornoRemoto(iso){
  if(!SINC_ATTIVA()) return;
  try{
    await chiamaSupabase("rapporti?data=eq." + iso, {method: "DELETE"});
  }catch(e){ console.error(e); }
}
// scarica cio' che l'utente puo' vedere e fonde con l'archivio locale (vince la versione piu' recente)
export async function sincronizza(silenzioso){
  if(!SINC_ATTIVA() || inSincronia || !profilo) return;
  inSincronia = true;
  if(!silenzioso) statoSinc("Sincronizzo…");
  try{
    // account disattivato nel frattempo: si esce
    if(!(await caricaProfilo())){ await esci(); return; }
    const risposta = await chiamaSupabase("rapporti?select=data,dati,aggiornato,assegnati");
    const remoti = await risposta.json();
    const db = leggiDB();
    const timbri = leggiTimbri();
    const rifiutati = leggiMappa("rifiutati");
    const assegnazioni = {};
    let cambiati = 0, nonAutorizzati = 0;

    // dal server verso il telefono
    remoti.forEach(r=>{
      assegnazioni[r.data] = r.assegnati || [];
      const locale = timbri[r.data];
      if(!locale || locale < r.aggiornato){
        db[r.data] = r.dati;
        timbri[r.data] = r.aggiornato;
        cambiati++;
      }
    });
    scriviMappa("assegnazioni", assegnazioni);

    // dal telefono verso il server: giorni non ancora inviati o piu' recenti
    const mappaRemota = {};
    remoti.forEach(r=>{ mappaRemota[r.data] = r.aggiornato; });
    for(const iso of Object.keys(db)){
      const mio = timbri[iso];
      if(!mappaRemota[iso] || (mio && mio > mappaRemota[iso])){
        // gia' rifiutato e non piu' modificato: non si ritenta
        if(rifiutati[iso] && rifiutati[iso] === (mio || "-")){ nonAutorizzati++; continue; }
        const quando = mio || new Date().toISOString();
        try{
          await inviaGiorno(iso, db[iso]);
          timbri[iso] = quando;
          delete rifiutati[iso];
        }catch(e){
          if(e.stato === 401 || e.stato === 403){ rifiutati[iso] = mio || "-"; nonAutorizzati++; }
          else throw e;
        }
      }
    }
    scriviMappa("rifiutati", rifiutati);

    scriviDB(db);
    scriviTimbri(timbri);
    statoSinc(nonAutorizzati ? "Sincronizzato (" + nonAutorizzati + (nonAutorizzati === 1 ? " giornata resta" : " giornate restano") + " solo su questo telefono)" : "Sincronizzato", "#2FA189");
    setTimeout(()=>statoSinc(""), nonAutorizzati ? 6000 : 2500);
    if(cambiati) emetti("archivio-aggiornato", "sincronizzazione");
    emetti("sincronizzato");
  }catch(e){
    console.error(e);
    statoSinc("Non sincronizzato (offline?)", "#B3413A");
  }finally{
    inSincronia = false;
  }
}
