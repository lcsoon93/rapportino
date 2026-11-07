// Sincronizzazione con Supabase (tabella "rapporti") con la sessione dell'utente: vince la modifica piu' recente.
import { SINC_ATTIVA, SUPABASE_KEY, SUPABASE_URL } from "../core/config.js";
import { leggiDB, leggiMappa, leggiTimbri, scriviDB, scriviMappa, scriviTimbri } from "../core/storage.js";
import { caricaProfilo, client, esci, profilo, tokenAccesso } from "../core/sessione.js";
import { emetti } from "../core/eventi.js";
import { impronte, stessaGiornata, unisciGiornata } from "./unione.js";

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
// versioni confermate dal server: il telefono ha esattamente quella versione della giornata
// (le modifiche fatte e non ancora confermate, anche dalla vecchia app, non risultano confermate)
export function confermaVersione(iso, aggiornato){
  const c = leggiMappa("confermati"); c[iso] = aggiornato; scriviMappa("confermati", c);
}
export function versioneConfermata(iso, aggiornato){
  return !!aggiornato && leggiMappa("confermati")[iso] === aggiornato && !leggiMappa("inSospeso")[iso];
}
// versione di partenza di ogni giornata (ultima vista sul server), per unire modifiche concorrenti
export function registraBase(iso, dati, aggiornato){
  const basi = leggiMappa("basi");
  basi[iso] = { v: aggiornato, h: impronte(dati) };
  scriviMappa("basi", basi);
}
// manda al server un singolo giorno. Il server accetta solo se la giornata e' ancora alla versione
// da cui si e' partiti; altrimenti si uniscono le modifiche (unione.js) e si riprova.
// Resta "in sospeso" finche' il server non conferma. Restituisce la versione salvata.
export async function inviaGiorno(iso, dati){
  if(!SINC_ATTIVA()) return;
  const sospesi = leggiMappa("inSospeso");
  sospesi[iso] = true; scriviMappa("inSospeso", sospesi);
  let mio = dati;
  let base = leggiMappa("basi")[iso] || null;
  for(let tentativo = 0; tentativo < 5; tentativo++){
    const risposta = await chiamaSupabase("rpc/salva_giornata", {
      method: "POST",
      body: JSON.stringify({ p_data: iso, p_dati: mio, p_base: base ? base.v : null }),
    });
    const r = await risposta.json();
    if(r.esito === "ok"){
      const unita = !stessaGiornata(mio, dati);
      // la versione di partenza avanza solo se cio' che e' sul server coincide con cio' che si ha davanti;
      // dopo un'unione resta quella vecchia (antenata comune), cosi' il prossimo salvataggio fatto dal
      // modulo ancora da aggiornare viene unito di nuovo invece di cancellare le modifiche altrui
      if(!unita) registraBase(iso, mio, r.aggiornato);
      const timbri = leggiTimbri(); timbri[iso] = r.aggiornato; scriviTimbri(timbri);
      confermaVersione(iso, r.aggiornato);
      const ancora = leggiMappa("inSospeso"); delete ancora[iso]; scriviMappa("inSospeso", ancora);
      if(unita){
        // il risultato dell'unione diventa la versione sul telefono
        const db = leggiDB(); db[iso] = mio; scriviDB(db);
        emetti("giornata-unita", iso);
      }
      return { aggiornato: r.aggiornato, dati: mio };
    }
    // conflitto: qualcuno ha salvato nel frattempo
    mio = unisciGiornata(base ? base.h : null, mio, r.dati);
    base = { v: r.aggiornato, h: impronte(r.dati) };
  }
  const e = new Error("Conflitto non risolto"); e.stato = 409; throw e;
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

    const sospesi = leggiMappa("inSospeso");
    const basi = leggiMappa("basi");
    const confermati = leggiMappa("confermati");
    // dal server verso il telefono
    remoti.forEach(r=>{
      assegnazioni[r.data] = r.assegnati || [];
      const locale = timbri[r.data];
      if(!locale || locale < r.aggiornato){
        if(sospesi[r.data] && db[r.data]){
          // modifiche non ancora inviate: si uniscono a quelle arrivate (poi si inviano sotto)
          db[r.data] = unisciGiornata(basi[r.data] ? basi[r.data].h : null, db[r.data], r.dati);
        } else {
          db[r.data] = r.dati;
          timbri[r.data] = r.aggiornato;
          confermati[r.data] = r.aggiornato;
        }
        basi[r.data] = { v: r.aggiornato, h: impronte(r.dati) };
        cambiati++;
      } else if(locale === r.aggiornato && !sospesi[r.data]){
        if(!basi[r.data]) basi[r.data] = { v: r.aggiornato, h: impronte(r.dati) };
        confermati[r.data] = r.aggiornato;
      }
    });
    scriviMappa("confermati", confermati);
    scriviMappa("assegnazioni", assegnazioni);
    scriviMappa("basi", basi);

    // dal telefono verso il server: giorni non ancora inviati o piu' recenti
    const mappaRemota = {};
    remoti.forEach(r=>{ mappaRemota[r.data] = r.aggiornato; });
    for(const iso of Object.keys(db)){
      const mio = timbri[iso];
      if(!mappaRemota[iso] || (mio && mio > mappaRemota[iso]) || sospesi[iso]){
        // gia' rifiutato e non piu' modificato: non si ritenta
        if(rifiutati[iso] && rifiutati[iso] === (mio || "-")){ nonAutorizzati++; continue; }
        const quando = mio || new Date().toISOString();
        try{
          const salvata = await inviaGiorno(iso, db[iso]);
          timbri[iso] = salvata ? salvata.aggiornato : quando;
          if(salvata && salvata.dati !== db[iso]){ db[iso] = salvata.dati; cambiati++; }
          delete rifiutati[iso];
        }catch(e){
          // 409: la giornata esiste ma questo utente non la vede (non assegnata)
          if(e.stato === 401 || e.stato === 403 || e.stato === 409){ rifiutati[iso] = mio || "-"; nonAutorizzati++; }
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
