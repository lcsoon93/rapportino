// Pianificazione (ruolo company e admin): giornate, schede cliente, assegnazione e invio agli operai.
// Lavora direttamente sul server (le regole vere sono nel database): le schede gia' compilate dagli
// operai non si toccano e le ore non si scrivono. Il salvataggio controlla che nessuno abbia
// modificato la giornata nel frattempo (campo "aggiornato" come versione).
import { client } from "../core/sessione.js";
import { leggiDB, leggiMappa, leggiTimbri, scriviDB, scriviMappa, scriviTimbri } from "../core/storage.js";
import { registraVista } from "../core/navigation.js";
import { emetti } from "../core/eventi.js";
import { schedaCompilata, statoScheda } from "../services/stato-schede.js";
import { etichettaGiorno, isoDi, oggiIso } from "../utils/dates.js";
import { esc } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";

const $ = id=>document.getElementById(id);
let iso = "";
let riga = null;            // giornata com'e' sul server (null = non esiste ancora)
let schede = [];            // bozza delle schede (copie)
let assegnati = new Set();
let operai = null;          // [{id, username, nome}] assegnabili
let inModifica = null;      // id della scheda nel modulo
let sporco = false;

function messaggio(testo, tipo){
  const el = $("pian-stato");
  el.textContent = testo || "";
  el.className = "msg-info" + (tipo ? " " + tipo : "");
}
function nuovoId(){ return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// aggiorna la copia sul telefono con la versione del server (per PDF e consultazione)
function aggiornaCache(r){
  if(!r) return;
  const db = leggiDB(); db[r.data] = r.dati; scriviDB(db);
  const t = leggiTimbri(); t[r.data] = r.aggiornato; scriviTimbri(t);
  const a = leggiMappa("assegnazioni"); a[r.data] = r.assegnati || []; scriviMappa("assegnazioni", a);
  emetti("archivio-aggiornato", "sincronizzazione");
}

async function leggiRiga(giorno){
  const { data, error } = await client.from("rapporti").select("data, dati, aggiornato, assegnati").eq("data", giorno).maybeSingle();
  if(error) throw error;
  return data;
}

export async function caricaPianificazione(){
  if(sporco && !confirm("Ci sono modifiche non inviate a questa giornata. Abbandonarle?")){
    $("pian-data").value = iso; return;
  }
  iso = $("pian-data").value || oggiIso();
  $("pian-data").value = iso;
  $("pian-etichetta").textContent = etichettaGiorno(iso);
  annullaModulo();
  messaggio("Caricamento…");
  try{
    if(!operai){
      const { data, error } = await client.rpc("operai_assegnabili");
      if(error) throw error;
      operai = data || [];
    }
    riga = await leggiRiga(iso);
  }catch(e){
    console.error(e);
    messaggio("Impossibile leggere dal server. Controlla la connessione.", "err");
    return;
  }
  schede = riga ? JSON.parse(JSON.stringify(riga.dati.clienti || [])) : [];
  assegnati = new Set(riga ? riga.assegnati || [] : []);
  sporco = false;
  if(riga) aggiornaCache(riga);
  messaggio(riga ? (assegnati.size ? "Giornata inviata a " + assegnati.size + (assegnati.size === 1 ? " operaio." : " operai.") : "Giornata senza operai assegnati.") : "Nuova giornata: aggiungi le schede e assegna gli operai.", riga && assegnati.size ? "" : "att");
  disegna();
}
export function spostaPianificazione(delta){
  const d = new Date(($("pian-data").value || oggiIso()) + "T12:00:00");
  d.setDate(d.getDate() + delta);
  $("pian-data").value = isoDi(d);
  caricaPianificazione();
}

function disegna(){
  $("pian-operai").innerHTML = operai.length
    ? operai.map(o=>'<label class="spunta-operaio"><input type="checkbox" value="' + o.id + '"' + (assegnati.has(o.id) ? " checked" : "") +
        ' onchange="spuntaOperaio(this)"><span>' + esc(o.nome || o.username) + ' <small>@' + esc(o.username) + '</small></span></label>').join("")
    : '<div class="nota" style="padding:0">Nessun operaio attivo. L\'amministratore li crea da Gestione utenti.</div>';
  $("pian-num").textContent = schede.length;
  $("pian-schede").innerHTML = schede.length ? schede.map(c=>{
    const stato = statoScheda(c), bloccata = schedaCompilata(c) || !c.id;
    const fascia = (c.fasce || []).find(f=>f.d || f.a);
    return '<div class="pian-scheda">' +
      '<div class="int-cliente">' + esc(c.nome) + '</div>' +
      '<div class="int-meta">' +
        (fascia ? '<span>' + icona("clock", "i-sm") + esc(fascia.d || fascia.a) + '</span>' : '') +
        (c.indirizzo ? '<span>' + icona("pin", "i-sm") + esc(c.indirizzo) + '</span>' : '') +
        (c.tipologia ? '<span>' + esc(c.tipologia) + '</span>' : '') +
      '</div>' +
      (c.richiesta ? '<div class="pian-richiesta">' + esc(c.richiesta) + '</div>' : '') +
      '<div class="int-badge">' +
        (stato === "firmata" ? '<span class="badge ok">' + icona("check") + 'Firmata</span>'
          : stato === "compilata" ? '<span class="badge att">' + icona("clock") + 'Compilata dall\'operaio</span>'
          : '<span class="badge neutro">' + icona("file") + 'Da compilare</span>') +
        (c.urgente ? '<span class="badge err">' + icona("zap") + 'Urgenza</span>' : '') +
      '</div>' +
      (bloccata ? '' : '<div class="int-azioni">' +
        '<button type="button" class="btn btn-secondario" onclick="modificaSchedaPian(\'' + esc(c.id) + '\')">' + icona("pen") + 'Modifica</button>' +
        '<button type="button" class="btn btn-secondario" onclick="rimuoviSchedaPian(\'' + esc(c.id) + '\')">' + icona("trash") + 'Rimuovi</button></div>') +
    '</div>';
  }).join("") : '<div class="nota" style="padding:0">Nessuna scheda per questa giornata.</div>';
}
export function spuntaOperaio(cb){
  if(cb.checked) assegnati.add(cb.value); else assegnati.delete(cb.value);
  sporco = true;
}
function annullaModulo(){
  inModifica = null;
  ["pian-nome", "pian-indirizzo", "pian-ora", "pian-richiesta"].forEach(id=>{ $(id).value = ""; });
  $("pian-tipologia").value = ""; $("pian-urgente").checked = false;
  $("pian-errore").textContent = "";
  $("pian-form-titolo").textContent = "Nuova scheda cliente";
  $("pian-aggiungi").querySelector("span").textContent = "Aggiungi scheda";
  $("pian-annulla-modifica").classList.add("nascosto");
}
export function modificaSchedaPian(id){
  const c = schede.find(x=>x.id && x.id === id);
  if(!c || schedaCompilata(c)) return;
  inModifica = id;
  $("pian-nome").value = c.nome || "";
  $("pian-indirizzo").value = c.indirizzo || "";
  const f = (c.fasce || []).find(x=>x.d || x.a);
  $("pian-ora").value = f ? (f.d || "") : "";
  $("pian-tipologia").value = c.tipologia || "";
  $("pian-richiesta").value = c.richiesta || "";
  $("pian-urgente").checked = !!c.urgente;
  $("pian-form-titolo").textContent = "Modifica scheda";
  $("pian-aggiungi").querySelector("span").textContent = "Aggiorna scheda";
  $("pian-annulla-modifica").classList.remove("nascosto");
  $("pian-form").scrollIntoView({block: "start"});
}
export function rimuoviSchedaPian(id){
  const c = schede.find(x=>x.id && x.id === id);
  if(!c || schedaCompilata(c)) return;
  if(!confirm("Rimuovere la scheda \"" + c.nome + "\"?")) return;
  schede = schede.filter(x=>x.id !== id);
  sporco = true;
  disegna();
}
$("pian-annulla-modifica").addEventListener("click", annullaModulo);
$("pian-form").addEventListener("submit", e=>{
  e.preventDefault();
  const nome = $("pian-nome").value.trim();
  if(!nome){ $("pian-errore").textContent = "Inserisci il cliente o il luogo."; return; }
  const ora = $("pian-ora").value;
  const dati = {
    nome, indirizzo: $("pian-indirizzo").value.trim(),
    fasce: ora ? [{d: ora, a: ""}] : [],
    tipologia: $("pian-tipologia").value, richiesta: $("pian-richiesta").value.trim(),
    urgente: $("pian-urgente").checked,
  };
  if(inModifica){
    const i = schede.findIndex(x=>x.id === inModifica);
    if(i >= 0) schede[i] = Object.assign({}, schede[i], dati);
  } else {
    schede.push(Object.assign({id: nuovoId(), fatturare: "", importo: 0, stato: "Completato", firmatario: "",
      dettagli: "", materiali: [], foto: [], firma: ""}, dati));
  }
  sporco = true;
  annullaModulo();
  disegna();
});

// unisce la bozza con la versione attuale del server: le schede compilate restano quelle del server
// (le schede senza id, create prima che esistesse, non si possono riconoscere: restano come sono)
function unisci(fresca){
  const mie = new Map(schede.filter(c=>c.id).map(c=>[c.id, c]));
  const dalServer = (fresca.dati.clienti || []);
  const idServer = new Set(dalServer.filter(c=>c.id).map(c=>c.id));
  const risultato = [];
  dalServer.forEach(c=>{
    if(!c.id || schedaCompilata(c)) risultato.push(c);   // dell'operaio o storica senza id: intoccabile
    else if(mie.has(c.id)) risultato.push(mie.get(c.id)); // pianificata: vale la bozza
    // altrimenti l'ho rimossa io
  });
  schede.forEach(c=>{ if(c.id && !idServer.has(c.id)) risultato.push(c); });
  return risultato;
}
function nomiAssegnati(){
  return operai.filter(o=>assegnati.has(o.id)).map(o=>o.nome || o.username).join(" / ");
}

export async function inviaPianificazione(){
  const btn = $("pian-invia");
  if(!schede.length && !riga){ messaggio("Aggiungi almeno una scheda cliente.", "att"); return; }
  btn.disabled = true; btn.classList.add("in-corso");
  try{
    const adesso = new Date().toISOString();
    const fresca = await leggiRiga(iso);
    let risultato;
    if(!fresca){
      const { data, error } = await client.from("rapporti").insert({
        data: iso, aggiornato: adesso, assegnati: [...assegnati],
        dati: { tecnici: nomiAssegnati(), escludi: false, operai: [], spese: [], clienti: schede, pianificato: true },
      }).select("data, dati, aggiornato, assegnati");
      if(error) throw error;
      risultato = data[0];
    } else {
      if(riga && fresca.aggiornato !== riga.aggiornato){
        messaggio("La giornata è stata modificata da un operaio nel frattempo: le tue modifiche sono state unite alla versione aggiornata.", "att");
      }
      const dati = Object.assign({}, fresca.dati, { clienti: unisci(fresca), pianificato: true });
      // finche' nessuno ha registrato ore, i tecnici seguono le assegnazioni
      if(!dati.tecnici || (fresca.dati.pianificato && !(fresca.dati.operai || []).length)) dati.tecnici = nomiAssegnati();
      // scrive solo se nessuno ha salvato dopo la lettura (controllo di concorrenza)
      const { data, error } = await client.from("rapporti")
        .update({ dati, assegnati: [...assegnati], aggiornato: adesso })
        .eq("data", iso).eq("aggiornato", fresca.aggiornato)
        .select("data, dati, aggiornato, assegnati");
      if(error) throw error;
      if(!data.length){
        messaggio("Qualcuno ha salvato la giornata proprio adesso. Ricarico: controlla e invia di nuovo.", "att");
        sporco = false;
        await caricaPianificazione();
        return;
      }
      risultato = data[0];
    }
    riga = risultato;
    schede = JSON.parse(JSON.stringify(riga.dati.clienti || []));
    assegnati = new Set(riga.assegnati || []);
    sporco = false;
    aggiornaCache(riga);
    disegna();
    messaggio("Salvato. " + (assegnati.size ? "Inviato a: " + nomiAssegnati() + "." : "Nessun operaio assegnato."), assegnati.size ? "" : "att");
  }catch(e){
    console.error(e);
    messaggio(/42501|company|operaio|permission|policy/i.test((e && (e.message + " " + e.code)) || "")
      ? "Operazione non consentita: " + (e.message || "") : "Salvataggio non riuscito. Controlla la connessione e riprova.", "err");
  }finally{
    btn.disabled = false; btn.classList.remove("in-corso");
  }
}

registraVista("company", ()=>{ if(!$("pian-data").value) $("pian-data").value = oggiIso(); sporco = false; caricaPianificazione(); });
