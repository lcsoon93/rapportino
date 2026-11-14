// Modulo del rapportino (tabelle "rapportini", "rapportino_operai", "allegati").
// Bozza / completato; collegato a un intervento o autonomo. Il salvataggio passa da salva_rapportino
// (una transazione, con controllo di versione). Ogni modifica resta sul telefono (IndexedDB, coda in
// services/coda-locale.js) finche' il server non la conferma; l'invio (anche automatico al ritorno
// della rete) passa da services/sinc-rapportini.js, che gestisce risposte perse e conflitti.
// Foto: file nel bucket privato di Supabase Storage + metadati in "allegati"; restano nella coda del
// telefono finche' non sono confermate; "Completa" avviene solo con tutte le foto inviate.
import { mostraVista, registraVista, vistaCorrente } from "../core/navigation.js";
import { puo } from "../core/permessi.js";
import { profilo } from "../core/sessione.js";
import { su } from "../core/eventi.js";
import {
  elencoAllegati, elencoRapportini, eliminaAllegato, leggiIntervento, leggiRapportino,
  minutiTra, nomeOperaio, operaiAttivi, riapriRapportino, scaricaFoto,
} from "../services/api-lavori.js";
import { aggiornaAnteprimaFirma } from "../services/signature.js";
import { blobInDataUrl, improntaFile, mostraFotoIntera, preparaFoto } from "../services/immagini.js";
import { codaPersistente, fotoDelRapportino, leggiBozza, metti, salvaBozza, togli, togliBozza } from "../services/coda-locale.js";
import { elencoCoda, inviaRapportino, segnaApertoNelModulo, segnaModificaNelModulo } from "../services/sinc-rapportini.js";
import { condividi } from "../services/condivisione.js";
import { generaPDFPerCliente } from "../services/pdf/giornata.js";
import { controllaRapportino, elencoTesto } from "../services/controlli.js";
import { collegaSceltaCliente } from "./scelta-cliente.js";
import { dataIt, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { PRIORITA, STATO_RAPPORTINO, oraBreve } from "./gestione-interventi.js";

const $ = id=>document.getElementById(id);
let corrente = null;         // { id, salvato, versione, intervento_id, intervento, stato, autore_id, aggiornato_il }
let allegati = [];           // foto sul server: metadati + src (data URL dopo il download autenticato) / errore
let inAttesa = [];           // foto in coda sul telefono per il rapportino aperto (+ _src in memoria)
let scaricamenti = null;     // download in corso delle foto del server
let sporco = false;
let vistaDiRitorno = "lavoro";

function messaggio(testo, tipo){ $("rap-msg").textContent = testo || ""; $("rap-msg").className = "msg-info" + (tipo ? " " + tipo : ""); }
// l'id lo genera il telefono: lo stesso rapportino inviato due volte non diventa un doppione
const nuovoId = ()=>crypto.randomUUID();
const modificabile = ()=>!!corrente && corrente.stato === "bozza" && puo("rapportini.compila") &&
  (corrente.autore_id === (profilo && profilo.id) || puo("rapportini.riapri"));

// campo cliente con suggerimenti dall'anagrafica: copia nome/indirizzo/telefono e ricorda l'id della scheda
const sceltaCliente = collegaSceltaCliente({ campo: $("rf-cliente"), indirizzo: $("rf-indirizzo"), telefono: $("rf-telefono"), onCambio: ()=>cambiato() });

// ---------------------------------------------------------------- righe materiale e ore
export function aggiungiMaterialeRapportino(m){
  const r = document.createElement("div");
  r.className = "mat-riga";
  r.innerHTML = '<input type="text" class="m-art" placeholder="Articolo" autocomplete="off" aria-label="Articolo">' +
    '<input type="text" class="m-qta" placeholder="Q.tà" autocomplete="off" aria-label="Quantità">' +
    '<button type="button" class="m-del rf-solo-bozza" aria-label="Rimuovi materiale">&times;</button>';
  r.querySelector(".m-del").onclick = ()=>{ r.remove(); cambiato(); };
  if(m){ r.querySelector(".m-art").value = m.a || ""; r.querySelector(".m-qta").value = m.q || ""; }
  $("rf-materiali").appendChild(r);
  if(!m) r.querySelector(".m-art").focus();
}
let operai = [];
export function aggiungiOreRapportino(o){
  const r = document.createElement("div");
  r.className = "cliente op-riga rf-ore-riga";
  r.innerHTML =
    '<div class="testata"><select class="rf-operaio" aria-label="Operaio">' +
      operai.map(x=>'<option value="' + x.id + '">' + esc(x.nome || x.username) + '</option>').join("") +
    '</select><button type="button" class="togli rf-solo-bozza" aria-label="Rimuovi operaio">&times;</button></div>' +
    '<div class="due">' +
      '<div><label>Dalle</label><div class="oranow"><input type="time" class="rf-dalle"><button type="button" class="btn-ora rf-solo-bozza" onclick="oraAdesso(this)">Ora</button></div></div>' +
      '<div><label>Alle</label><div class="oranow"><input type="time" class="rf-alle"><button type="button" class="btn-ora rf-solo-bozza" onclick="oraAdesso(this)">Ora</button></div></div>' +
    '</div>';
  r.querySelector(".togli").onclick = ()=>{ r.remove(); cambiato(); };
  const scelto = (o && o.operaio_id) || (!$("rf-ore").children.length && profilo ? profilo.id : "");
  if(scelto){
    if(!operai.some(x=>x.id === scelto)){   // operaio non piu' attivo: resta visibile
      r.querySelector(".rf-operaio").insertAdjacentHTML("afterbegin", '<option value="' + scelto + '">' + esc(nomeOperaio(scelto)) + '</option>');
    }
    r.querySelector(".rf-operaio").value = scelto;
  }
  if(o){ r.querySelector(".rf-dalle").value = oraBreve(o.dalle); r.querySelector(".rf-alle").value = oraBreve(o.alle); }
  $("rf-ore").appendChild(r);
  aggiornaTotale();
}
function aggiornaTotale(){
  const min = [...document.querySelectorAll("#rf-ore .rf-ore-riga")].reduce((a, r)=>a + minutiTra(r.querySelector(".rf-dalle").value, r.querySelector(".rf-alle").value), 0);
  $("rf-totale-ore").textContent = oreTesto(min);
}

// ---------------------------------------------------------------- lettura / scrittura del modulo
function leggiModulo(){
  return {
    rapportino: {
      id: corrente.id, versione: corrente.salvato ? corrente.versione : null, intervento_id: corrente.intervento_id || null,
      data: $("rf-data").value, cliente: $("rf-cliente").value.trim(), indirizzo: $("rf-indirizzo").value.trim(),
      telefono: $("rf-telefono").value.trim(), cliente_id: sceltaCliente.id(),
      tipologia: $("rf-tipologia").value, attivita: $("rf-attivita").value.trim(), note: $("rf-note").value.trim(),
      esito: $("rf-esito").value,
      materiali: [...document.querySelectorAll("#rf-materiali .mat-riga")].map(r=>({ a: r.querySelector(".m-art").value.trim(), q: r.querySelector(".m-qta").value.trim() })).filter(m=>m.a),
      firma: $("rf-firma-box").querySelector(".c-firma-dato").value, firmatario: $("rf-firmatario").value.trim(),
    },
    ore: [...document.querySelectorAll("#rf-ore .rf-ore-riga")].map(r=>({
      operaio_id: r.querySelector(".rf-operaio").value, dalle: r.querySelector(".rf-dalle").value, alle: r.querySelector(".rf-alle").value,
    })).filter(o=>o.operaio_id),
  };
}
function riempiModulo(r, ore){
  $("rf-data").value = r.data || oggiIso();
  $("rf-cliente").value = r.cliente || ""; $("rf-indirizzo").value = r.indirizzo || ""; $("rf-telefono").value = r.telefono || "";
  sceltaCliente.imposta(r.cliente_id || null);
  $("rf-tipologia").value = r.tipologia || ""; $("rf-attivita").value = r.attivita || ""; $("rf-note").value = r.note || "";
  $("rf-esito").value = r.esito || "Completato"; $("rf-firmatario").value = r.firmatario || "";
  $("rf-materiali").innerHTML = ""; (r.materiali || []).forEach(m=>aggiungiMaterialeRapportino(m));
  $("rf-ore").innerHTML = "";
  (ore && ore.length ? ore : [{ operaio_id: profilo && profilo.id, dalle: "", alle: "" }]).forEach(o=>aggiungiOreRapportino(o));
  const box = $("rf-firma-box");
  box.querySelector(".c-firma-dato").value = r.firma || "";
  aggiornaAnteprimaFirma(box, r.firma || "");
  aggiornaTotale();
}
function disegnaAllegati(){
  const cont = $("rf-foto");
  cont.innerHTML = "";
  const elimina = async (ev, fn)=>{
    ev.stopPropagation();
    if(!confirm("Rimuovere la foto?")) return;
    try{ await fn(); disegnaAllegati(); }catch(e){ messaggio(e.message, "err"); }
  };
  const tessera = (src, cls, testoStato, statoErr, onDel, dataAttr)=>{
    const item = document.createElement("div");
    item.className = "foto-item" + (cls ? " " + cls : "");
    Object.entries(dataAttr || {}).forEach(([k, v])=>{ item.dataset[k] = v; });
    item.innerHTML = (src ? '<img alt="Foto del rapportino">' : '<span>' + esc(testoStato || "") + '</span>') +
      (src && testoStato ? '<span class="foto-stato' + (statoErr ? " err" : "") + '"></span>' : '') +
      '<button type="button" class="foto-del rf-solo-bozza' + (modificabile() ? "" : " nascosto") + '" aria-label="Rimuovi foto">&times;</button>';
    if(src){
      const img = item.querySelector("img");
      img.src = src;
      img.onclick = ()=>mostraFotoIntera(src);
      if(testoStato){ item.querySelector(".foto-stato").textContent = testoStato; item.title = testoStato; }
    }
    item.querySelector(".foto-del").onclick = ev=>elimina(ev, onDel);
    cont.appendChild(item);
    return item;
  };
  allegati.forEach(a=>{
    const src = a.src || a.contenuto || "";
    const onDel = async()=>{ await eliminaAllegato(a); allegati = allegati.filter(x=>x.id !== a.id); };
    if(src) tessera(src, "", "", false, onDel, { allegato: a.id, stato: "inviata" });
    else if(a.errore){
      const t = tessera("", "manca", a.errore + " Tocca per riprovare.", true, onDel, { allegato: a.id, stato: "errore" });
      t.onclick = ()=>{ a.errore = null; disegnaAllegati(); scaricaFotoServer(); };
    }
    else tessera("", "carica", "Caricamento…", false, onDel, { allegato: a.id, stato: "caricamento" });
  });
  inAttesa.forEach(v=>{
    tessera(v._src, "", v.stato === "errore" ? "Non inviata" : "Da inviare", v.stato === "errore", async()=>{
      await togli(v.id); inAttesa = inAttesa.filter(x=>x.id !== v.id);
    }, { attesa: v.id, stato: v.stato });
  });
  const n = inAttesa.length;
  const err = inAttesa.find(v=>v.errore);
  $("rf-foto-stato").className = "msg-info att" + (n ? "" : " nascosto");
  $("rf-foto-stato").textContent = n ? (n === 1 ? "1 foto" : n + " foto") + " sul telefono, non ancora inviate" +
    (err ? " (ultimo errore: " + err.errore + ")" : "") + ". Restano qui finché non sono confermate dal server." : "";
  $("rf-foto-invia").classList.toggle("nascosto", !n || !modificabile());
}
// scarica (con la sessione dell'utente) le foto del server non ancora in memoria, 3 alla volta
function scaricaFotoServer(){
  const id = corrente && corrente.id;
  const daFare = allegati.filter(a=>a.percorso && !a.src && !a.errore);
  if(!daFare.length) return scaricamenti || Promise.resolve();
  const coda = [...daFare];
  const lavora = async()=>{
    while(coda.length){
      const a = coda.shift();
      try{
        const blob = await scaricaFoto(a.percorso);
        a.src = await blobInDataUrl(blob);
      }catch(e){
        a.errore = /connessione/i.test(e.message) ? "Offline." : /trovata/i.test(e.message) ? "Foto mancante." : "Foto non disponibile.";
      }
      if(corrente && corrente.id === id) disegnaAllegati();
    }
  };
  scaricamenti = Promise.all([lavora(), lavora(), lavora()]).then(()=>{ scaricamenti = null; });
  return scaricamenti;
}
async function caricaCodaLocale(id){
  const voci = (await fotoDelRapportino(id).catch(()=>[])).filter(v=>profilo && v.autore === profilo.id);
  for(const v of voci){ try{ v._src = await blobInDataUrl(v.blob); }catch(e){ v._src = ""; } }
  return voci;
}
function aggiornaStatoUI(){
  const scrivibile = modificabile();
  $("rap-form").classList.toggle("sola-lettura", !scrivibile);
  $("rap-form").querySelectorAll("input, textarea, select").forEach(el=>{ el.disabled = !scrivibile; });
  document.querySelectorAll(".rf-solo-bozza").forEach(el=>el.classList.toggle("nascosto", !scrivibile));
  sceltaCliente.aggiorna();
  $("rf-riapri").classList.toggle("nascosto", !(corrente && corrente.stato === "completato" && puo("rapportini.riapri")));
  $("rf-pdf").classList.toggle("nascosto", !corrente || !corrente.salvato);
  const stato = corrente.salvato ? STATO_RAPPORTINO[corrente.stato] : '<span class="badge neutro">Non ancora inviato</span>';
  $("rap-sottotitolo").innerHTML = stato + (corrente.autore_id && profilo && corrente.autore_id !== profilo.id ? ' <span class="badge pervinca">di ' + esc(nomeOperaio(corrente.autore_id)) + '</span>' : '');
  $("rf-foto-invia").classList.toggle("nascosto", !inAttesa.length || !scrivibile);
  const i = corrente.intervento;
  $("rap-intervento").classList.toggle("nascosto", !i);
  if(i){
    $("rap-intervento").innerHTML = '<div class="gruppo-tit" style="margin:0 0 6px">Intervento assegnato</div>' +
      '<div class="int-cliente">' + esc(i.cliente) + '</div>' +
      (i.descrizione ? '<div class="pian-richiesta">' + esc(i.descrizione) + '</div>' : '') +
      '<div class="int-badge">' + (PRIORITA[i.priorita] || "") + '<span class="badge neutro">' + icona("cal") + esc(dataIt(i.data)) + (i.ora ? " " + esc(oraBreve(i.ora)) : "") + '</span></div>';
  }
}

// ---------------------------------------------------------------- bozza sul telefono (IndexedDB)
// Ogni modifica si scrive nel record della coda (contenuto, ore, firma). Versione del server e stato
// della sincronizzazione restano quelli del record (li aggiorna la sincronizzazione).
let timerLocale = null;
function salvaLocale(){
  if(!corrente || !modificabile()) return;
  clearTimeout(timerLocale);
  timerLocale = setTimeout(()=>{ scriviBozzaLocale().catch(()=>{}); }, 300);
}
async function scriviBozzaLocale(extra){
  clearTimeout(timerLocale); timerLocale = null;
  if(!corrente || !profilo) return null;
  const { rapportino, ore } = leggiModulo();
  const prima = await leggiBozza(corrente.id);
  if(prima && prima.autore !== profilo.id) return null;          // mai sopra i dati di un altro utente
  const inConflitto = prima && prima.stato === "conflitto";
  const rec = Object.assign({ id: corrente.id, autore: profilo.id, salvato: !!corrente.salvato, versione: corrente.versione || null,
    base: corrente.aggiornato_il || null, completa: false }, prima && prima.stato !== "inviato" ? prima : (prima ? { salvato: prima.salvato || !!corrente.salvato, versione: corrente.versione || prima.versione, base: corrente.aggiornato_il || prima.base } : {}), {
    id: corrente.id, autore: profilo.id, intervento_id: corrente.intervento_id || null,
    intervento: corrente.intervento ? corrente.intervento.cliente : "", rapportino, ore, testoDaInviare: true,
    modificato: new Date().toISOString(), inviato_il: null, tentativi: 0, prossimoTentativo: null,
    stato: inConflitto ? "conflitto" : (rapportino.cliente && rapportino.data ? "in_attesa" : "locale"),
    errore: inConflitto ? prima.errore : null, erroreTipo: inConflitto ? "conflitto" : null,
  }, extra || {});
  await salvaBozza(rec);
  return rec;
}
async function leggiLocale(id){
  const l = await leggiBozza(id).catch(()=>null);
  return l && profilo && l.autore === profilo.id && l.stato !== "inviato" && l.testoDaInviare ? l : null;
}
// rapportini rimasti sul telefono (dell'utente collegato): coda della sincronizzazione
export async function bozzeLocali(){
  return (await elencoCoda()).voci;
}
async function recuperaLocale(){
  const l = await leggiLocale(corrente.id);
  if(!l) return false;
  if(l.stato === "conflitto"){
    riempiModulo(l.rapportino, l.ore);
    sporco = true;
    mostraConflitto(l);
    return true;
  }
  // partita dalla stessa versione del server (o mai inviata): si riprende senza chiedere
  if(corrente.aggiornato_il && l.base !== corrente.aggiornato_il &&
     !confirm("Sul telefono ci sono modifiche non inviate fatte su una versione precedente di questo rapportino. Recuperarle?")){
    return false;
  }
  riempiModulo(l.rapportino, l.ore);
  sporco = true;
  messaggio("Recuperate le modifiche non ancora inviate al server. Salva per inviarle (verranno inviate anche in automatico).", "att");
  return true;
}
function cambiato(){
  sporco = true;
  segnaModificaNelModulo();
  aggiornaTotale();
  salvaLocale();
}
$("rap-form").addEventListener("input", cambiato);
$("rap-form").addEventListener("change", cambiato);
su("firma-cambiata", scheda=>{ if(scheda && scheda.id === "rf-firma-box") cambiato(); });

// ---------------------------------------------------------------- conflitto
const ETICHETTE = { data: "Data", cliente: "Cliente", indirizzo: "Indirizzo", telefono: "Telefono", tipologia: "Tipologia", attivita: "Attività svolte",
  note: "Note", esito: "Esito", firmatario: "Firmatario" };
function oreBreve(ore){
  return (ore || []).map(o=>nomeOperaio(o.operaio_id) + " " + String(o.dalle || "").slice(0, 5) + "–" + String(o.alle || "").slice(0, 5)).join(", ") || "—";
}
// confronto campo per campo tra la copia del telefono e quella del server, con la scelta esplicita
function mostraConflitto(l){
  const srv = (l.server && l.server.rapportino) || {};
  const mio = l.rapportino || {};
  const righe = [];
  Object.keys(ETICHETTE).forEach(k=>{
    if(String(mio[k] ?? "") !== String(srv[k] ?? "")) righe.push([ETICHETTE[k], mio[k], srv[k]]);
  });
  if(JSON.stringify(mio.materiali || []) !== JSON.stringify(srv.materiali || [])){
    const m = x=>(x || []).map(r=>r.a + (r.q ? " × " + r.q : "")).join(", ") || "—";
    righe.push(["Materiale", m(mio.materiali), m(srv.materiali)]);
  }
  if(String(mio.firma || "") !== String(srv.firma || "")) righe.push(["Firma", mio.firma ? "presente" : "assente", srv.firma ? (mio.firma ? "diversa" : "presente") : "assente"]);
  if(oreBreve(l.ore) !== oreBreve(l.server && l.server.ore)) righe.push(["Ore", oreBreve(l.ore), oreBreve(l.server && l.server.ore)]);
  const completato = srv.stato === "completato";
  const puoMia = !completato || puo("rapportini.riapri");
  $("rap-conflitto").innerHTML = '<div class="gruppo-tit" style="margin:0 0 6px">Conflitto con la versione sul server</div>' +
    '<p class="nota" style="padding:0 0 8px">' + esc(completato ? "Il rapportino è stato completato da un altro dispositivo." : "Sul server c'è una versione diversa da quella del telefono.") +
    ' Le tue modifiche sono conservate qui finché non scegli.</p>' +
    (righe.length ? '<div class="conf-tab">' + '<div class="conf-riga conf-testa"><span>Campo</span><span>Sul telefono</span><span>Sul server</span></div>' +
      righe.map(r=>'<div class="conf-riga"><span>' + esc(r[0]) + '</span><span>' + esc(String(r[1] ?? "—") || "—") + '</span><span>' + esc(String(r[2] ?? "—") || "—") + '</span></div>').join("") + '</div>'
      : '<p class="nota" style="padding:0">Il contenuto è uguale; cambia solo la versione.</p>') +
    '<div class="due" style="margin-top:10px">' +
      (puoMia ? '<div><button type="button" class="btn btn-primario btn-blocco" id="conf-mia" onclick="risolviConflitto(\'mia\')">Invia la mia versione</button></div>' : '') +
      '<div><button type="button" class="btn btn-secondario btn-blocco" id="conf-server" onclick="risolviConflitto(\'server\')">Usa la versione del server</button></div>' +
    '</div>';
  $("rap-conflitto").classList.remove("nascosto");
  messaggio(completato && !puo("rapportini.riapri")
    ? "Nel frattempo il rapportino è stato completato da un altro dispositivo: non è più modificabile. Le tue modifiche restano su questo telefono."
    : "Nel frattempo questo rapportino è stato salvato da un altro dispositivo. Le tue modifiche sono ancora qui: premi di nuovo Salva (o \"Invia la mia versione\") per sostituire quella versione con la tua, oppure \"Usa la versione del server\".", "att");
}
function nascondiConflitto(){ $("rap-conflitto").classList.add("nascosto"); $("rap-conflitto").innerHTML = ""; }
export async function risolviConflitto(scelta){
  if(!corrente) return;
  if(scelta === "server"){
    if(!confirm("Le modifiche fatte su questo telefono andranno perse e si userà la versione del server. Continuare?")) return;
    await togliBozza(corrente.id);
    sporco = false;
    return apriRapportino(corrente.id);
  }
  corrente.sovrascrivi = true;
  const l = await leggiBozza(corrente.id);
  return invia(!!(l && l.completa));
}

// ---------------------------------------------------------------- apertura
async function prepara(){
  vistaDiRitorno = vistaCorrente === "rapportino" ? vistaDiRitorno : vistaCorrente;
  try{ operai = await operaiAttivi(); }catch(e){ operai = []; }
  mostraVista("rapportino");
  messaggio("");
  allegati = []; inAttesa = []; scaricamenti = null;
  nascondiConflitto();
  $("rf-foto").innerHTML = ""; $("rf-foto-stato").className = "msg-info nascosto"; $("rf-foto-invia").classList.add("nascosto");
}
export async function apriRapportino(id){
  await prepara();
  messaggio("Caricamento…");
  try{
    let r;
    try{ r = await leggiRapportino(id); }
    catch(e){
      // senza rete: si riprende la copia del telefono, se c'e'
      if(!/connessione/i.test(e.message) || !(await leggiLocale(id))) throw e;
      r = null;
      messaggio("Senza rete: si riprende la copia salvata sul telefono.", "att");
    }
    if(!r){
      const l = await leggiLocale(id);
      if(l && profilo && l.autore === profilo.id){
        // mai arrivato al server: si riprende dal telefono
        corrente = { id, salvato: false, versione: null, intervento_id: l.intervento_id, intervento: null, stato: "bozza", autore_id: profilo.id };
        if(l.intervento_id) corrente.intervento = await leggiIntervento(l.intervento_id).catch(()=>null);
        if(l.salvato) corrente.salvato = true;     // esiste gia' sul server (aperto senza rete)
        if(l.versione) corrente.versione = l.versione;
        riempiModulo(l.rapportino, l.ore);
        sporco = true;
        if(!/Senza rete/.test($("rap-msg").textContent)) messaggio("Rapportino non ancora inviato: verrà inviato quando c'è rete (o premi Salva).", "att");
        if(l.stato === "conflitto") mostraConflitto(l);
        inAttesa = await caricaCodaLocale(id);
        segnaApertoNelModulo(id);
        aggiornaStatoUI();
        disegnaAllegati();
        return;
      }
      messaggio("Rapportino non trovato o non autorizzato.", "err"); return;
    }
    corrente = { id: r.id, salvato: true, versione: r.versione, intervento_id: r.intervento_id, intervento: r.interventi, stato: r.stato,
      autore_id: r.autore_id, aggiornato_il: r.aggiornato_il };
    riempiModulo(r, r.rapportino_operai);
    sporco = false;
    messaggio("");
    if(r.stato === "bozza") await recuperaLocale();
    else { const l = await leggiLocale(r.id); if(l && l.stato === "conflitto"){ riempiModulo(l.rapportino, l.ore); sporco = true; mostraConflitto(l); } }
    segnaApertoNelModulo(r.id);
    aggiornaStatoUI();
    inAttesa = await caricaCodaLocale(r.id);
    allegati = await elencoAllegati(r.id);
    disegnaAllegati();
    aggiornaStatoUI();
    scaricaFotoServer();
  }catch(e){ messaggio(e.message, "err"); }
}
// dall'intervento: riapre la propria bozza se c'e', altrimenti ne prepara una nuova
export async function rapportinoPerIntervento(interventoId){
  try{
    const miei = await elencoRapportini({ intervento: interventoId, autore: profilo.id });
    const bozza = miei.find(r=>r.stato === "bozza") || miei[0];
    if(bozza) return apriRapportino(bozza.id);
    const locale = (await bozzeLocali()).find(b=>b.intervento_id === interventoId && b.stato !== "inviato");
    if(locale) return apriRapportino(locale.id);
    const i = await leggiIntervento(interventoId);
    await prepara();
    corrente = { id: nuovoId(), salvato: false, versione: null, intervento_id: interventoId, intervento: i, stato: "bozza", autore_id: profilo.id };
    segnaApertoNelModulo(corrente.id);
    // dati del cliente copiati dall'intervento (snapshot): il rapportino resta collegato alla stessa scheda
    riempiModulo({ data: i.data > oggiIso() ? i.data : oggiIso(), cliente: i.cliente, indirizzo: i.indirizzo, telefono: i.telefono || "",
      cliente_id: i.cliente_id || null, tipologia: i.tipologia }, null);
    sporco = false;
    aggiornaStatoUI();
  }catch(e){ alert(e.message); }
}
// cliente (facoltativo): dati della scheda scelta dall'anagrafica { cliente_id, cliente, indirizzo, telefono }
export async function nuovoRapportinoAutonomo(cliente){
  await prepara();
  corrente = { id: nuovoId(), salvato: false, versione: null, intervento_id: null, intervento: null, stato: "bozza", autore_id: profilo.id };
  segnaApertoNelModulo(corrente.id);
  riempiModulo({ data: oggiIso(), ...(cliente && cliente.cliente ? cliente : {}) }, null);
  sporco = false;
  aggiornaStatoUI();
  if(!(cliente && cliente.cliente)) $("rf-cliente").focus({ preventScroll: true });
}
export function chiudiRapportino(){
  if(sporco && modificabile() && !confirm("Ci sono modifiche non ancora inviate al server: restano sul telefono e verranno inviate in automatico. Uscire?")) return;
  if(timerLocale) scriviBozzaLocale().catch(()=>{});
  sporco = false;
  segnaApertoNelModulo(null);
  mostraVista(vistaDiRitorno || "lavoro");
}

// ---------------------------------------------------------------- assistente AI e controllo automatico
// Stato del rapportino aperto (per il controllo e per l'assistente AI): solo lettura del modulo.
function contaFoto(){
  return { totali: allegati.length + inAttesa.length, nonInviate: inAttesa.length, nonDisponibili: allegati.filter(a=>a.errore).length };
}
export function statoRapportinoAperto(){
  if(!corrente || vistaCorrente !== "rapportino") return null;
  const { rapportino, ore } = leggiModulo();
  return {
    id: corrente.id, rapportino, modificabile: modificabile(),
    ore: ore.map(o=>({ ...o, nome: nomeOperaio(o.operaio_id) })),
    foto: contaFoto(),
    sorgentiFoto: [...allegati.map(a=>a.src || a.contenuto), ...inAttesa.map(v=>v._src)].filter(Boolean),
    intervento: corrente.intervento ? String(corrente.intervento.descrizione || "") : "",
  };
}
export function controlloRapportinoAperto(){
  const st = statoRapportinoAperto();
  return st ? controllaRapportino({ rapportino: st.rapportino, ore: st.ore, foto: st.foto, oggi: oggiIso() }) : [];
}
// Applica una proposta GIA' CONFERMATA dall'utente: cambia solo i campi del modulo; il salvataggio
// segue il percorso normale (bozza sul telefono subito, invio con Salva o in automatico).
export function applicaAlRapportino({ attivita, aggiungiAttivita, materiali } = {}){
  if(!corrente || !modificabile()) return false;
  const campo = $("rf-attivita");
  if(typeof attivita === "string") campo.value = attivita;
  if(aggiungiAttivita) campo.value = (campo.value.trim() ? campo.value.replace(/\s+$/, "") + "\n" : "") + aggiungiAttivita;
  (materiali || []).forEach(m=>{ if(m && m.a) aggiungiMaterialeRapportino({ a: m.a, q: m.q || "" }); });
  cambiato();
  return true;
}

// ---------------------------------------------------------------- salvataggio
// Salva / Completa: il contenuto va prima nella coda del telefono, poi lo invia la sincronizzazione
// (stesso percorso dell'invio automatico: un solo invio alla volta per rapportino, risposte perse e
// conflitti gestiti allo stesso modo). Il messaggio dice sempre cosa ha confermato il server.
async function salva(completa){
  const { rapportino, ore } = leggiModulo();
  if(!rapportino.data || !rapportino.cliente){ messaggio("Data e cliente sono obbligatori.", "err"); return false; }
  if(completa){
    if(!rapportino.attivita){ messaggio("Per completare descrivi le attività svolte.", "err"); $("rf-attivita").focus(); return false; }
    if(!ore.some(o=>o.dalle && o.alle)){ messaggio("Per completare indica le ore lavorate (dalle / alle).", "err"); return false; }
    if(ore.some(o=>o.dalle && o.alle && o.alle <= o.dalle)){ messaggio("Controlla le ore: \"alle\" deve essere dopo \"dalle\".", "err"); return false; }
    // controllo automatico (senza rete): le possibili dimenticanze compaiono nella conferma
    const avvisi = elencoTesto(controlloRapportinoAperto(), ["attenzione"]);
    if(!confirm((avvisi ? "Prima di completare controlla:\n" + avvisi + "\n\n" : "") + "Completare il rapportino? Dopo non potrai più modificarlo.")) return false;
  }
  return invia(completa);
}
async function invia(completa){
  const pulsanti = [$("rf-salva"), $("rf-completa")];
  pulsanti.forEach(b=>{ b.disabled = true; b.classList.add("in-corso"); });
  try{
    const sovrascrivi = !!corrente.sovrascrivi;
    corrente.sovrascrivi = false;
    const rec = await scriviBozzaLocale(Object.assign(completa ? { completa: true } : {}, sovrascrivi ? { stato: "in_attesa" } : {}));
    if(!rec){ messaggio("Rapportino non modificabile da questo account.", "err"); return false; }
    const res = await inviaRapportino(corrente.id, { manuale: true, sovrascrivi });
    return mostraEsito(res, completa);
  }catch(e){
    messaggio(e.message, "err");
    return false;
  }finally{
    pulsanti.forEach(b=>{ b.disabled = false; b.classList.remove("in-corso"); });
  }
}
// foto confermate dal server: dalla coda all'elenco delle foto del rapportino
async function riconciliaFoto(fotoInviate){
  (fotoInviate || []).forEach(({ id, allegato })=>{
    const v = inAttesa.find(x=>x.id === id);
    if(allegato && !allegati.some(a=>a.id === allegato.id)) allegati.push({ ...allegato, src: v ? v._src : "" });
  });
  const vecchie = new Map(inAttesa.map(v=>[v.id, v._src]));
  const ora = (await fotoDelRapportino(corrente.id).catch(()=>[])).filter(v=>profilo && v.autore === profilo.id);
  for(const v of ora) v._src = vecchie.get(v.id) || await blobInDataUrl(v.blob).catch(()=>"");
  inAttesa = ora;
  disegnaAllegati();
  if(allegati.some(a=>a.percorso && !a.src && !a.errore)) scaricaFotoServer();
}
function applicaServer(s){
  if(!s) return;
  corrente = Object.assign(corrente, { id: s.id, salvato: true, versione: s.versione, stato: s.stato, autore_id: s.autore_id, aggiornato_il: s.aggiornato_il });
}
async function mostraEsito(res, completa){
  const nFoto = n=>n === 1 ? "1 foto" : n + " foto";
  await riconciliaFoto(res.fotoInviate);
  if(res.esito === "inviato"){
    applicaServer(res.rapportino);
    sporco = false;
    nascondiConflitto();
    aggiornaStatoUI();
    messaggio(corrente.stato === "completato" ? "Rapportino completato e inviato." : (res.fotoInviate && res.fotoInviate.length ? "Bozza salvata con le foto." : "Bozza salvata."));
    return true;
  }
  if(res.esito === "conflitto"){
    applicaServer(Object.assign({}, res.conflitto ? res.conflitto.rapportino : {}, { stato: corrente.stato }));
    corrente.salvato = true;
    aggiornaStatoUI();
    const l = await leggiBozza(corrente.id);
    if(l) mostraConflitto(l);
    corrente.sovrascrivi = !!(res.conflitto && (res.conflitto.rapportino.stato === "bozza" || puo("rapportini.riapri")));
    return false;
  }
  if(res.rapportino) applicaServer(res.rapportino);
  aggiornaStatoUI();
  if(res.esito === "modificato"){ messaggio("Inviato; nel frattempo ci sono nuove modifiche: verranno inviate a breve (o premi Salva).", "att"); return false; }
  if(res.esito === "locale"){ messaggio("Data e cliente sono obbligatori.", "err"); return false; }
  if(res.esito === "sessione"){ messaggio("Sessione scaduta: accedi di nuovo. Le modifiche restano sul telefono e verranno inviate dopo l'accesso.", "err"); return false; }
  const rete = res.tipo === "rete" || res.tipo === "temporaneo";
  if(res.rimaste){
    messaggio(completa
      ? "Rapportino NON completato: " + nFoto(res.rimaste) + " non ancora inviate (" + res.errore + "). È salvato in bozza: verrà completato automaticamente quando le foto saranno inviate."
      : "Bozza salvata, ma " + nFoto(res.rimaste) + " non ancora inviate (" + res.errore + "): restano sul telefono e verranno inviate automaticamente; puoi anche usare \"Invia foto\".", completa ? "err" : "att");
    return false;
  }
  messaggio(res.errore + (rete
    ? " Le modifiche restano sul telefono e verranno inviate automaticamente quando la connessione torna" + (completa ? " (il completamento verrà fatto all'invio)." : ".")
    : ""), "err");
  return false;
}
export function salvaBozzaRapportino(){ return salva(false); }
export function completaRapportino(){ return salva(true); }
export async function riapriRapportinoAperto(){
  if(!corrente || !corrente.salvato || !confirm("Riaprire il rapportino? Tornerà in bozza e l'autore potrà modificarlo.")) return;
  try{ await riapriRapportino(corrente.id); await apriRapportino(corrente.id); messaggio("Rapportino riaperto."); }catch(e){ messaggio(e.message, "err"); }
}

// ---------------------------------------------------------------- foto
const nomeSicuro = n=>String(n || "foto").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
// nuove foto: controllo (tipo, dimensione, immagine valida), compressione e coda sul telefono;
// poi invio se il rapportino puo' gia' essere salvato sul server
export async function aggiungiFotoRapportino(input){
  const files = [...(input.files || [])];
  input.value = "";
  if(!files.length || !corrente || !modificabile()) return;
  const scartate = [];
  let aggiunte = 0;
  for(const f of files){
    try{
      const impronta = await improntaFile(f);
      if(allegati.some(a=>a.impronta === impronta) || inAttesa.some(v=>v.impronta === impronta)){
        scartate.push(nomeSicuro(f.name) + ": già presente"); continue;
      }
      const p = await preparaFoto(f);
      const id = nuovoId();
      const voce = { id, rapportino_id: corrente.id, autore: profilo.id, percorso: corrente.id + "/" + id + ".jpg", blob: p.blob,
        nome: nomeSicuro(f.name), mime: p.mime, dimensione: p.blob.size, larghezza: p.w, altezza: p.h, impronta,
        stato: "in_attesa", errore: null, creato: new Date().toISOString() };
      await metti(voce);
      voce._src = await blobInDataUrl(p.blob);
      inAttesa.push(voce);
      aggiunte++;
    }catch(e){ scartate.push(nomeSicuro(f.name) + ": " + e.message); }
  }
  disegnaAllegati();
  const avviso = scartate.length ? "Foto non aggiunte — " + scartate.join("; ") + "." : "";
  if(avviso) messaggio(avviso, "err");
  if(aggiunte && !(await codaPersistente())) messaggio("Attenzione: questo browser non conserva le foto se chiudi l'app prima dell'invio.", "att");
  if(aggiunte){
    await inviaFotoOra();
    if(avviso) messaggio(avviso + " " + $("rap-msg").textContent, "err");
  }
}
// "Invia foto": stesso percorso di Salva (testo se serve, poi foto)
export async function inviaFotoOra(){
  if(!corrente || !inAttesa.length || !modificabile()) return;
  $("rf-foto-invia").disabled = true;
  try{
    if(sporco || !corrente.salvato || !(await leggiBozza(corrente.id))) await scriviBozzaLocale(sporco || !corrente.salvato ? {} : { testoDaInviare: false, stato: "allegati_in_attesa" });
    const res = await inviaRapportino(corrente.id, { manuale: true });
    await mostraEsito(res, false);
    if(res.esito === "inviato") messaggio(res.fotoInviate && res.fotoInviate.length ? "Foto inviate." : "Bozza salvata.");
  }finally{ $("rf-foto-invia").disabled = false; }
}
// la sincronizzazione automatica ha lavorato sul rapportino aperto: si aggiorna il modulo
su("rapportino-sincronizzato", async res=>{
  if(!corrente || !res || !res.rec || res.rec.id !== corrente.id || vistaCorrente !== "rapportino") return;
  if(res.rapportino) applicaServer(res.rapportino);
  await riconciliaFoto(res.fotoInviate);
  if(res.esito === "inviato" && !timerLocale){ sporco = false; messaggio(corrente.stato === "completato" ? "Rapportino completato e inviato (in automatico)." : "Inviato in automatico."); }
  if(res.esito === "conflitto"){ const l = await leggiBozza(corrente.id); if(l) mostraConflitto(l); }
  aggiornaStatoUI();
});

// PDF: stessa impaginazione delle schede del foglio giornaliero
// Foto: quelle del server (scaricate con la sessione dell'utente), le vecchie in base64 e quelle ancora
// sul telefono. Le foto non disponibili vengono saltate e segnalate (nessun URL nel PDF).
export async function pdfRapportino(btn){
  if(!corrente || !corrente.salvato) return;
  if(allegati.some(a=>a.errore)){ allegati.forEach(a=>{ a.errore = null; }); scaricaFotoServer(); }
  if(scaricamenti) await scaricamenti;
  const foto = [];
  let mancanti = 0;
  allegati.forEach(a=>{ const src = a.src || a.contenuto; if(src) foto.push({ src, w: a.larghezza, h: a.altezza }); else mancanti++; });
  inAttesa.forEach(v=>{ if(v._src) foto.push({ src: v._src, w: v.larghezza, h: v.altezza }); });
  const { rapportino: r, ore } = leggiModulo();
  const dati = {
    tecnici: ore.map(o=>nomeOperaio(o.operaio_id)).join(" / "),
    operai: ore.map(o=>({ nome: nomeOperaio(o.operaio_id), dalle: o.dalle, alle: o.alle })),
    spese: [],
    mostraOrario: true,                    // le ore di ogni tecnico del rapportino compaiono nel PDF
    // riferimento leggibile del rapportino: data + prime 4 cifre del suo identificativo (nessun numero progressivo nei dati)
    riferimento: "RAP-" + String(r.data || "").replace(/-/g, "") + "-" + String(corrente.id || "").replace(/-/g, "").slice(0, 4).toUpperCase(),
    clienti: [{ id: corrente.id, nome: r.cliente, indirizzo: r.indirizzo, fasce: [], fatturare: "", importo: 0, tipologia: r.tipologia,
      stato: r.esito, firmatario: r.firmatario, dettagli: r.attivita, note: r.note || "", materiali: r.materiali,
      foto, firma: r.firma, urgente: false }],
  };
  if(mancanti) messaggio("PDF creato senza " + (mancanti === 1 ? "1 foto non disponibile" : mancanti + " foto non disponibili") + " (rete o autorizzazione).", "att");
  condividi(btn, ()=>generaPDFPerCliente(dati, r.data), "Rapportino_" + r.data + "_" + r.cliente.replace(/[^\w]+/g, "_").slice(0, 40) + ".pdf");
}

// la vista si apre solo dalle funzioni qui sopra (apriRapportino, nuovo…), che preparano il modulo
registraVista("rapportino", ()=>{});
