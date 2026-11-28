// Scheda cliente: letture e scritture con la sessione dell'utente (cosa si vede lo decide RLS).
//   - storico: rapportini e interventi collegati alla scheda (cliente_id) o, se non collegati a nessuna
//     scheda, con lo stesso nome; schede della vecchia app dall'archivio sul telefono (anche offline);
//   - impianti (tabella impianti_cliente) e documenti (tabella documenti_cliente + bucket privato
//     "documenti-clienti"): solo con la rete. Senza la migrazione 20261128090000 restano non disponibili.
import { client } from "../core/sessione.js";
import { archivioVisibile, caricaImportate } from "./importati.js";
import { operaiAttivi } from "./api-lavori.js";
import { erroriImpianto, percorsoDocumento, pulisciImpianto, controllaDocumento } from "./scheda-cliente-logica.js";

const BUCKET = "documenti-clienti";
const MAX_RIGHE = 1000;
const CAMPI_RAPPORTINO = "id, intervento_id, autore_id, data, cliente, cliente_id, indirizzo, tipologia, attivita, materiali, note, esito, stato, " +
  "completato_il, origine, rapportino_operai(operaio_id, dalle, alle), allegati(count), interventi(descrizione)";
const CAMPI_INTERVENTO = "id, data, ora, cliente, cliente_id, indirizzo, descrizione, tipologia, stato, intervento_operai(operaio_id, rimosso_il), rapportini(id)";

const testoErrore = e=>String((e && (e.code || "")) + " " + ((e && (e.message || e.error || "")) || ""));
export const nonAttivo = e=>/PGRST20[25]|42P01|does not exist|Could not find the table|Bucket not found/i.test(testoErrore(e));
const colonnaMancante = e=>/42703|PGRST204|column .* does not exist/i.test(testoErrore(e));
const senzaRete = e=>/Failed to fetch|NetworkError|network|Load failed|abort|timed? ?out/i.test(testoErrore(e));
function errore(e, cosa){
  if(navigator.onLine === false || senzaRete(e)) return new Error("Serve la connessione per " + cosa + ".");
  if(nonAttivo(e)) { const x = new Error("Funzione non ancora attiva sul server (aggiornamento del database da applicare)."); x.nonAttivo = true; return x; }
  if(/42501|permission|policy|row-level|403|Unauthorized/i.test(testoErrore(e))) return new Error("Operazione non consentita.");
  if(/foreign key|23503/i.test(testoErrore(e))) return new Error("Operazione non possibile: ci sono dati collegati.");
  return new Error((e && e.message) || "Errore del server.");
}
const escLike = t=>String(t).replace(/[\\%_]/g, m=>"\\" + m);

// schede della vecchia app con i tecnici della giornata (stessa lettura dello Storico)
function vecchiDelCliente(){
  const db = archivioVisibile(), out = [];
  Object.keys(db).forEach(iso=>{
    const g = db[iso];
    if(!g || !Array.isArray(g.clienti)) return;
    const tecnici = (g.operai || []).map(o=>String(o && o.nome || "").trim()).filter(Boolean);
    g.clienti.forEach(c=>{ if(c && String(c.nome || "").trim()) out.push({ iso, c, tecnici }); });
  });
  return out;
}

// { rapportini, interventi, vecchi, errore } — l'archivio vecchio c'e' sempre, i dati del server se c'e' rete
export async function storicoCliente(c){
  await caricaImportate().catch(()=>{});
  const vecchi = vecchiDelCliente();
  if(navigator.onLine === false) return { rapportini: [], interventi: [], vecchi, errore: "Senza rete: si vedono solo i lavori della vecchia app salvati sul telefono." };
  try{
    await operaiAttivi().catch(()=>[]);           // nomi dei tecnici
    const perNome = q=>q.is("cliente_id", null).ilike("cliente", escLike(String(c.nome).trim()));
    const leggi = async (tabella, campi, ordine)=>{
      const prendi = async sel=>Promise.all([
        client.from(tabella).select(sel).eq("cliente_id", c.id).order(ordine, { ascending: false }).limit(MAX_RIGHE),
        perNome(client.from(tabella).select(sel)).order(ordine, { ascending: false }).limit(MAX_RIGHE),
      ]);
      let [a, b] = await prendi(campi);
      // database senza la colonna "origine" (migrazione 20261125090000): stessi dati senza quel campo
      if((a.error && colonnaMancante(a.error)) || (b.error && colonnaMancante(b.error))) [a, b] = await prendi(campi.replace("origine, ", ""));
      if(a.error) throw a.error;
      if(b.error) throw b.error;
      return [...(a.data || []), ...(b.data || [])];
    };
    const [rapportini, interventi] = await Promise.all([leggi("rapportini", CAMPI_RAPPORTINO, "data"), leggi("interventi", CAMPI_INTERVENTO, "data")]);
    return { rapportini, interventi, vecchi, errore: "", troncato: rapportini.length >= MAX_RIGHE };
  }catch(e){
    return { rapportini: [], interventi: [], vecchi, errore: errore(e, "lo storico dei lavori").message };
  }
}

// ---------------------------------------------------------------- impianti
const inLinea = cosa=>{ if(navigator.onLine === false) throw new Error("Serve la connessione per " + cosa + "."); };
export async function elencoImpianti(clienteId){
  inLinea("gli impianti");
  const { data, error } = await client.from("impianti_cliente").select("*").eq("cliente_id", clienteId).order("dismesso").order("nome");
  if(error) throw errore(error, "gli impianti");
  return data || [];
}
// base = impianto letto (modifica) o null (nuovo). Una modifica su una versione superata non sovrascrive.
export async function salvaImpianto(clienteId, dati, base){
  inLinea("salvare l'impianto");
  const e = erroriImpianto(dati);
  if(e.length) throw new Error(e.join(" "));
  const x = pulisciImpianto(dati);
  if(!base){
    const { data, error } = await client.from("impianti_cliente").insert({ id: crypto.randomUUID(), cliente_id: clienteId, ...x }).select().single();
    if(error) throw errore(error, "salvare l'impianto");
    return data;
  }
  const { data, error } = await client.from("impianti_cliente").update(x).eq("id", base.id).eq("versione", base.versione).select();
  if(error) throw errore(error, "salvare l'impianto");
  if(!data || !data.length){
    const { data: ora } = await client.from("impianti_cliente").select("id, versione").eq("id", base.id).maybeSingle();
    throw new Error(ora ? "L'impianto è stato modificato da un altro utente: riapri la scheda e ripeti la modifica." : "Non hai il permesso di modificare questo impianto.");
  }
  return data[0];
}
export async function eliminaImpianto(id){
  inLinea("eliminare l'impianto");
  const { data, error } = await client.from("impianti_cliente").delete().eq("id", id).select("id");
  if(error) throw errore(error, "eliminare l'impianto");
  if(!data || !data.length) throw new Error("Solo l'amministratore può eliminare un impianto.");
}

// ---------------------------------------------------------------- documenti
export async function elencoDocumenti(clienteId){
  inLinea("i documenti");
  const { data, error } = await client.from("documenti_cliente").select("*").eq("cliente_id", clienteId).order("creato_il", { ascending: false });
  if(error) throw errore(error, "i documenti");
  return data || [];
}
// 1. file nello Storage (percorso con l'id del documento: un nuovo tentativo non crea doppioni)
// 2. metadati (il database controlla che il file ci sia e abbia la stessa dimensione)
// Se il punto 2 fallisce si toglie il file appena caricato.
export async function caricaDocumento(clienteId, file, nome){
  const problema = controllaDocumento(file);
  if(problema) throw new Error(problema);
  inLinea("caricare il documento");
  const id = crypto.randomUUID();
  const percorso = percorsoDocumento(clienteId, id, file.type);
  let up;
  try{ up = await client.storage.from(BUCKET).upload(percorso, file, { contentType: file.type, upsert: false }); }
  catch(e){ throw errore(e, "caricare il documento"); }
  if(up.error) throw errore(up.error, "caricare il documento");
  const { data, error } = await client.from("documenti_cliente").insert({ id, cliente_id: clienteId, nome: String(nome || file.name || "Documento").trim().slice(0, 200) || "Documento",
    percorso, mime: file.type, dimensione: file.size }).select().single();
  if(error){
    await client.storage.from(BUCKET).remove([percorso]).catch(()=>{});
    throw errore(error, "registrare il documento");
  }
  return data;
}
export async function scaricaDocumento(d){
  inLinea("aprire il documento");
  let res;
  try{ res = await client.storage.from(BUCKET).download(d.percorso); }
  catch(e){ throw errore(e, "aprire il documento"); }
  if(res.error) throw errore(res.error, "aprire il documento");
  return res.data;
}
// prima i metadati (la scheda non punta mai a un file mancante), poi il file
export async function eliminaDocumento(d){
  inLinea("eliminare il documento");
  const { data, error } = await client.from("documenti_cliente").delete().eq("id", d.id).select("id");
  if(error) throw errore(error, "eliminare il documento");
  if(!data || !data.length) throw new Error("Puoi eliminare solo i documenti caricati da te.");
  await client.storage.from(BUCKET).remove([d.percorso]).catch(()=>{});
}
