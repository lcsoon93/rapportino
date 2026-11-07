// Accesso ai dati di interventi e rapportini (tabelle nuove su Supabase).
// Solo letture/scritture con la sessione dell'utente: cosa si vede e cosa si puo' fare lo decidono
// le policy RLS e i trigger del database (autore, creatore e assegnatore li impone il server).
import { client, profilo } from "../core/sessione.js";

function controlla({ data, error }){
  if(error){
    const e = new Error(traduci(error));
    e.codice = error.code;
    throw e;
  }
  return data;
}
// messaggi del database in forma leggibile
function traduci(error){
  const m = (error && (error.message || error.details)) || "";
  if(/attivit/i.test(m)) return "Per completare descrivi le attività svolte.";
  if(/ore lavorate/i.test(m)) return "Per completare indica le ore lavorate di almeno un operaio.";
  if(/completato/i.test(m)) return "Il rapportino è completato: può riaprirlo solo l'amministratore.";
  if(/assegnato/i.test(m)) return "Non sei assegnato a questo intervento.";
  if(/foreign key|violates foreign/i.test(m)) return "Operazione non possibile: ci sono dati collegati (es. rapportini).";
  if(/non modificabile|duplicate key|23505/i.test(m + error.code)) return "Questo rapportino non è modificabile da te.";
  // frontend pubblicato prima della migrazione: le tabelle nuove non esistono ancora
  if(/PGRST205|42P01|PGRST202|does not exist|Could not find the (table|function)/i.test(m + error.code)) return "Interventi e rapportini non sono ancora attivi sul server.";
  if(/permission|policy|42501|row-level/i.test(m + error.code)) return "Operazione non consentita.";
  if(/Failed to fetch|NetworkError|network/i.test(m)) return "Nessuna connessione. Riprova quando c'è rete.";
  return m || "Errore del server.";
}

// ---------------------------------------------------------------- operai
let cacheOperai = null;
export async function operaiAttivi(){
  if(!cacheOperai) cacheOperai = controlla(await client.rpc("operai_attivi")) || [];
  return cacheOperai;
}
export function dimenticaOperai(){ cacheOperai = null; }
// nome leggibile di un operaio (dopo operaiAttivi())
export function nomeOperaio(id){
  const o = (cacheOperai || []).find(x=>x.id === id);
  return o ? (o.nome || o.username) : "—";
}

// ---------------------------------------------------------------- interventi
const CAMPI_INTERVENTO = "id, data, ora, cliente, indirizzo, descrizione, priorita, tipologia, stato, creato_il, " +
  "intervento_operai(operaio_id), rapportini(id, autore_id, stato, data)";
export async function elencoInterventi({ dal, al, soloMiei } = {}){
  let q = client.from("interventi").select(soloMiei
    ? CAMPI_INTERVENTO.replace("intervento_operai(operaio_id)", "intervento_operai!inner(operaio_id)")
    : CAMPI_INTERVENTO);
  if(dal) q = q.gte("data", dal);
  if(al) q = q.lte("data", al);
  if(soloMiei && profilo) q = q.eq("intervento_operai.operaio_id", profilo.id);
  return controlla(await q.order("data").order("ora", { nullsFirst: true }));
}
export async function leggiIntervento(id){
  return controlla(await client.from("interventi").select(CAMPI_INTERVENTO).eq("id", id).maybeSingle());
}
// crea o aggiorna e allinea le assegnazioni
export async function salvaIntervento(dati, operai){
  const campi = { data: dati.data, ora: dati.ora || null, cliente: dati.cliente, indirizzo: dati.indirizzo || "",
    descrizione: dati.descrizione || "", priorita: dati.priorita || "normale", tipologia: dati.tipologia || "" };
  let intervento;
  if(dati.id){
    intervento = controlla(await client.from("interventi").update(campi).eq("id", dati.id).select("id").single());
  } else {
    intervento = controlla(await client.from("interventi").insert(campi).select("id").single());
  }
  const attuali = controlla(await client.from("intervento_operai").select("operaio_id").eq("intervento_id", intervento.id)).map(x=>x.operaio_id);
  const daTogliere = attuali.filter(x=>!operai.includes(x));
  const daAggiungere = operai.filter(x=>!attuali.includes(x));
  if(daTogliere.length) controlla(await client.from("intervento_operai").delete().eq("intervento_id", intervento.id).in("operaio_id", daTogliere));
  if(daAggiungere.length) controlla(await client.from("intervento_operai").insert(daAggiungere.map(o=>({ intervento_id: intervento.id, operaio_id: o }))));
  return intervento.id;
}
export async function annullaIntervento(id, annullato){
  controlla(await client.from("interventi").update({ stato: annullato ? "annullato" : "pianificato" }).eq("id", id));
}
export async function eliminaIntervento(id){
  controlla(await client.from("interventi").delete().eq("id", id));
}

// ---------------------------------------------------------------- rapportini
const CAMPI_RAPPORTINO = "id, intervento_id, autore_id, data, cliente, indirizzo, tipologia, attivita, materiali, note, esito, " +
  "firma, firmatario, stato, completato_il, versione, creato_il, aggiornato_il, rapportino_operai(operaio_id, dalle, alle), " +
  "interventi(id, cliente, descrizione, priorita, data, ora)";
export async function elencoRapportini({ dal, al, stato, autore, intervento } = {}){
  let q = client.from("rapportini").select(CAMPI_RAPPORTINO.replace("firma, ", ""));
  if(dal) q = q.gte("data", dal);
  if(al) q = q.lte("data", al);
  if(stato) q = q.eq("stato", stato);
  if(autore) q = q.eq("autore_id", autore);
  if(intervento) q = q.eq("intervento_id", intervento);
  return controlla(await q.order("data", { ascending: false }).order("aggiornato_il", { ascending: false }));
}
export async function leggiRapportino(id){
  return controlla(await client.from("rapportini").select(CAMPI_RAPPORTINO).eq("id", id).maybeSingle());
}
// salvataggio atomico (testata + ore); risultato { esito: "ok" | "conflitto", rapportino }
export async function salvaRapportino(rapportino, ore, completa){
  return controlla(await client.rpc("salva_rapportino", { p_rapportino: rapportino, p_ore: ore, p_completa: !!completa }));
}
export async function riapriRapportino(id){
  controlla(await client.from("rapportini").update({ stato: "bozza" }).eq("id", id));
}
export async function eliminaRapportino(id){
  controlla(await client.from("rapportini").delete().eq("id", id));
}

// ---------------------------------------------------------------- allegati
export async function elencoAllegati(rapportinoId){
  return controlla(await client.from("allegati").select("id, tipo, nome, contenuto, larghezza, altezza").eq("rapportino_id", rapportinoId).order("creato_il"));
}
export async function aggiungiAllegato(rapportinoId, foto){
  return controlla(await client.from("allegati").insert({ rapportino_id: rapportinoId, tipo: "foto", contenuto: foto.src,
    larghezza: foto.w || null, altezza: foto.h || null }).select("id").single());
}
export async function eliminaAllegato(id){
  controlla(await client.from("allegati").delete().eq("id", id));
}

// minuti tra due orari "HH:MM"
export function minutiTra(dalle, alle){
  if(!dalle || !alle) return 0;
  const [a, b] = [dalle, alle].map(t=>{ const p = t.split(":"); return +p[0] * 60 + +p[1]; });
  return Math.max(0, b - a);
}
