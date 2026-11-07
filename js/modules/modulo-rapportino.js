// Modulo del rapportino (tabelle "rapportini", "rapportino_operai", "allegati").
// Bozza / completato; collegato a un intervento o autonomo. Il salvataggio passa da salva_rapportino
// (una transazione, con controllo di versione). Finche' non e' salvato sul server, il contenuto
// resta anche sul telefono (localStorage) per non perderlo senza rete.
// Foto: file nel bucket privato di Supabase Storage + metadati in "allegati". Una foto nuova va
// prima nella coda del telefono (IndexedDB, services/coda-foto.js) e ne esce solo quando file e
// metadati sono confermati dal server; "Completa" e' possibile solo con tutte le foto inviate.
import { mostraVista, registraVista, vistaCorrente } from "../core/navigation.js";
import { puo } from "../core/permessi.js";
import { profilo } from "../core/sessione.js";
import { su } from "../core/eventi.js";
import {
  caricaFotoStorage, elencoAllegati, elencoRapportini, eliminaAllegato, leggiIntervento, leggiRapportino,
  minutiTra, nomeOperaio, operaiAttivi, registraAllegato, riapriRapportino, rimuoviFotoStorage, salvaRapportino, scaricaFoto,
} from "../services/api-lavori.js";
import { aggiornaAnteprimaFirma } from "../services/signature.js";
import { blobInDataUrl, improntaFile, mostraFotoIntera, preparaFoto } from "../services/immagini.js";
import { aggiornaIndice, codaPersistente, fotoDelRapportino, leggiIndice, metti, togli } from "../services/coda-foto.js";
import { condividi } from "../services/condivisione.js";
import { generaPDFPerCliente } from "../services/pdf/giornata.js";
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
const PREFISSO = "bozzaRapportino:";
const chiaveLocale = ()=>PREFISSO + corrente.id;
const nuovoId = ()=>crypto.randomUUID();
const modificabile = ()=>!!corrente && corrente.stato === "bozza" && puo("rapportini.compila") &&
  (corrente.autore_id === (profilo && profilo.id) || puo("rapportini.riapri"));

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
  $("rf-cliente").value = r.cliente || ""; $("rf-indirizzo").value = r.indirizzo || "";
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
      await togli(v.id); inAttesa = inAttesa.filter(x=>x.id !== v.id); aggiornaIndiceFoto();
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
function aggiornaIndiceFoto(){
  if(!corrente || !profilo) return;
  aggiornaIndice(corrente.id, { autore: profilo.id, cliente: $("rf-cliente").value.trim(), data: $("rf-data").value }, inAttesa.length);
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

// ---------------------------------------------------------------- bozza sul telefono
function salvaLocale(){
  if(!corrente || !modificabile()) return;
  try{
    localStorage.setItem(chiaveLocale(), JSON.stringify({
      quando: new Date().toISOString(), base: corrente.aggiornato_il || null, salvato: !!corrente.salvato, versione: corrente.versione || null,
      autore: profilo && profilo.id, intervento_id: corrente.intervento_id || null, ...leggiModulo(),
    }));
  }catch(e){}
}
function cancellaLocale(chiave){ try{ localStorage.removeItem(chiave || chiaveLocale()); }catch(e){} }
function leggiLocale(id){
  try{ return JSON.parse(localStorage.getItem(PREFISSO + id) || "null"); }catch(e){ return null; }
}
// rapportini con modifiche rimaste solo sul telefono (dell'utente collegato)
export function bozzeLocali(){
  const out = [];
  try{
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(!k || !k.startsWith(PREFISSO)) continue;
      const l = JSON.parse(localStorage.getItem(k) || "null");
      if(l && profilo && l.autore === profilo.id) out.push({ id: k.slice(PREFISSO.length), quando: l.quando, salvato: l.salvato,
        cliente: l.rapportino.cliente, data: l.rapportino.data, intervento_id: l.intervento_id });
    }
  }catch(e){}
  // rapportini gia' salvati ma con foto ancora sul telefono
  leggiIndice().filter(f=>profilo && f.autore === profilo.id).forEach(f=>{
    const b = out.find(x=>x.id === f.id);
    if(b) b.foto = f.numero;
    else out.push({ id: f.id, quando: f.quando, salvato: true, cliente: f.cliente, data: f.data, foto: f.numero, soloFoto: true });
  });
  return out.sort((a, b)=>b.quando.localeCompare(a.quando));
}
function recuperaLocale(){
  const l = leggiLocale(corrente.id);
  if(!l) return false;
  // partita dalla stessa versione del server (o mai inviata): si riprende senza chiedere
  if(corrente.aggiornato_il && l.base !== corrente.aggiornato_il &&
     !confirm("Sul telefono ci sono modifiche non inviate fatte su una versione precedente di questo rapportino. Recuperarle?")){
    return false;
  }
  riempiModulo(l.rapportino, l.ore);
  sporco = true;
  messaggio("Recuperate le modifiche non ancora salvate sul server. Salva per inviarle.", "att");
  return true;
}
function cambiato(){
  sporco = true;
  aggiornaTotale();
  salvaLocale();
}
$("rap-form").addEventListener("input", cambiato);
$("rap-form").addEventListener("change", cambiato);
su("firma-cambiata", scheda=>{ if(scheda && scheda.id === "rf-firma-box") cambiato(); });

// ---------------------------------------------------------------- apertura
async function prepara(){
  vistaDiRitorno = vistaCorrente === "rapportino" ? vistaDiRitorno : vistaCorrente;
  try{ operai = await operaiAttivi(); }catch(e){ operai = []; }
  mostraVista("rapportino");
  messaggio("");
  allegati = []; inAttesa = []; scaricamenti = null;
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
      if(!/connessione/i.test(e.message) || !leggiLocale(id)) throw e;
      r = null;
      messaggio("Senza rete: si riprende la copia salvata sul telefono.", "att");
    }
    if(!r){
      const l = leggiLocale(id);
      if(l && profilo && l.autore === profilo.id){
        // mai arrivato al server: si riprende dal telefono
        corrente = { id, salvato: false, versione: null, intervento_id: l.intervento_id, intervento: null, stato: "bozza", autore_id: profilo.id };
        if(l.intervento_id) corrente.intervento = await leggiIntervento(l.intervento_id).catch(()=>null);
        if(l.salvato) corrente.salvato = true;     // esiste gia' sul server (aperto senza rete)
        if(l.versione) corrente.versione = l.versione;
        riempiModulo(l.rapportino, l.ore);
        sporco = true;
        if(!/Senza rete/.test($("rap-msg").textContent)) messaggio("Rapportino non ancora inviato: salva quando c'è rete.", "att");
        inAttesa = await caricaCodaLocale(id);
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
    if(r.stato === "bozza") recuperaLocale();
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
    const locale = bozzeLocali().find(b=>b.intervento_id === interventoId);
    if(locale) return apriRapportino(locale.id);
    const i = await leggiIntervento(interventoId);
    await prepara();
    corrente = { id: nuovoId(), salvato: false, versione: null, intervento_id: interventoId, intervento: i, stato: "bozza", autore_id: profilo.id };
    riempiModulo({ data: i.data > oggiIso() ? i.data : oggiIso(), cliente: i.cliente, indirizzo: i.indirizzo, tipologia: i.tipologia }, null);
    sporco = false;
    aggiornaStatoUI();
  }catch(e){ alert(e.message); }
}
export async function nuovoRapportinoAutonomo(){
  await prepara();
  corrente = { id: nuovoId(), salvato: false, versione: null, intervento_id: null, intervento: null, stato: "bozza", autore_id: profilo.id };
  riempiModulo({ data: oggiIso() }, null);
  sporco = false;
  aggiornaStatoUI();
  $("rf-cliente").focus({ preventScroll: true });
}
export function chiudiRapportino(){
  if(sporco && modificabile() && !confirm("Ci sono modifiche non salvate sul server (restano sul telefono). Uscire?")) return;
  sporco = false;
  mostraVista(vistaDiRitorno || "lavoro");
}

// ---------------------------------------------------------------- salvataggio
// il rapportino sul server e' uguale a quello che si sta inviando? (testata e ore)
function stessoContenuto(mio, oreMie, srv, oreSrv){
  if(!srv) return false;
  const campi = ["data", "cliente", "indirizzo", "tipologia", "attivita", "note", "esito", "firma", "firmatario"];
  if(campi.some(c=>String(mio[c] ?? "") !== String(srv[c] ?? ""))) return false;
  if((mio.intervento_id || null) !== (srv.intervento_id || null)) return false;
  if(JSON.stringify(mio.materiali || []) !== JSON.stringify(srv.materiali || [])) return false;
  const norma = l=>JSON.stringify((l || []).map(o=>[o.operaio_id, String(o.dalle || "").slice(0, 5), String(o.alle || "").slice(0, 5)])
    .sort((a, b)=>a[0].localeCompare(b[0])));
  return norma(oreMie) === norma(oreSrv);
}
async function salva(completa){
  let { rapportino, ore } = leggiModulo();
  if(!rapportino.data || !rapportino.cliente){ messaggio("Data e cliente sono obbligatori.", "err"); return false; }
  if(completa){
    if(!rapportino.attivita){ messaggio("Per completare descrivi le attività svolte.", "err"); $("rf-attivita").focus(); return false; }
    if(!ore.some(o=>o.dalle && o.alle)){ messaggio("Per completare indica le ore lavorate (dalle / alle).", "err"); return false; }
    if(ore.some(o=>o.dalle && o.alle && o.alle <= o.dalle)){ messaggio("Controlla le ore: \"alle\" deve essere dopo \"dalle\".", "err"); return false; }
    if(!confirm("Completare il rapportino? Dopo non potrai più modificarlo.")) return false;
  }
  // completare con foto ancora sul telefono: prima si salva la bozza e si inviano le foto; si completa
  // solo se TUTTE sono confermate dal server (dopo il completamento non si possono piu' aggiungere)
  if(completa && inAttesa.length){
    if(!(await salvaTesto(rapportino, ore, false))) return false;
    ({ rapportino, ore } = leggiModulo());      // ora con la versione appena salvata
    const f = await inviaFotoInAttesa();
    if(f.rimaste){
      messaggio("Rapportino NON completato: " + f.rimaste + " foto non ancora inviate" + (f.errore ? " (" + f.errore + ")" : "") +
        ". È salvato in bozza e le foto restano sul telefono: riprova quando c'è rete.", "err");
      return false;
    }
  }
  const ok = await salvaTesto(rapportino, ore, completa);
  if(ok && !completa && inAttesa.length){
    const f = await inviaFotoInAttesa();
    messaggio(f.rimaste
      ? "Bozza salvata, ma " + f.rimaste + " foto non ancora inviate" + (f.errore ? " (" + f.errore + ")" : "") + ": restano sul telefono. Riprova con \"Invia foto\"."
      : "Bozza salvata con le foto.", f.rimaste ? "att" : "");
  }
  return ok;
}
// salvataggio di testata e ore (salva_rapportino, controllo di versione e conflitti: invariato)
async function salvaTesto(rapportino, ore, completa){
  const chiavePrima = chiaveLocale();
  const pulsanti = [$("rf-salva"), $("rf-completa")];
  pulsanti.forEach(b=>{ b.disabled = true; b.classList.add("in-corso"); });
  try{
    let r = await salvaRapportino(rapportino, ore, completa);
    // conflitto con un contenuto identico al nostro (es. secondo invio dopo una risposta persa):
    // non c'e' nulla da perdere, si reinvia indicando la versione del server
    if(r.esito === "conflitto" && stessoContenuto(rapportino, ore, r.rapportino, r.ore)){
      if((r.rapportino.stato === "completato") === !!completa) r = { esito: "ok", rapportino: r.rapportino };   // gia' fatto
      else if(r.rapportino.stato === "bozza") r = await salvaRapportino(Object.assign({}, rapportino, { versione: r.rapportino.versione }), ore, completa);
    }
    if(r.esito === "conflitto"){
      const srv = r.rapportino;
      corrente = Object.assign(corrente, { salvato: true, versione: srv.versione, aggiornato_il: srv.aggiornato_il });   // esiste sul server
      salvaLocale();
      messaggio(srv.stato === "completato" && !puo("rapportini.riapri")
        ? "Nel frattempo il rapportino è stato completato da un altro dispositivo: non è più modificabile. Le tue modifiche restano su questo telefono."
        : "Nel frattempo questo rapportino è stato salvato da un altro dispositivo. Le tue modifiche sono ancora qui: premi di nuovo Salva per sostituire quella versione con la tua, oppure torna indietro e riaprilo per vedere quella salvata.", "att");
      return false;
    }
    const s = r.rapportino;
    corrente = Object.assign(corrente, { id: s.id, salvato: true, versione: s.versione, stato: s.stato, autore_id: s.autore_id, aggiornato_il: s.aggiornato_il });
    cancellaLocale(chiavePrima);
    sporco = false;
    aggiornaStatoUI();
    messaggio(s.stato === "completato" ? "Rapportino completato e inviato." : "Bozza salvata.");
    return true;
  }catch(e){
    salvaLocale();
    messaggio(e.message + (/connessione/i.test(e.message) ? " Le modifiche restano sul telefono." : ""), "err");
    return false;
  }finally{
    pulsanti.forEach(b=>{ b.disabled = false; b.classList.remove("in-corso"); });
  }
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
  aggiornaIndiceFoto();
  salvaLocale();
  disegnaAllegati();
  if(scartate.length) messaggio("Foto non aggiunte — " + scartate.join("; ") + ".", "err");
  if(aggiunte && !(await codaPersistente())) messaggio("Attenzione: questo browser non conserva le foto se chiudi l'app prima dell'invio.", "att");
  if(aggiunte) await inviaFotoOra(!!scartate.length);
}
// "Invia foto": serve il rapportino sul server (si salva la bozza se necessario)
export async function inviaFotoOra(silenzioso){
  if(!corrente || !inAttesa.length || !modificabile()) return;
  if(!corrente.salvato || sporco){ await salva(false); return; }
  $("rf-foto-invia").disabled = true;
  try{
    const f = await inviaFotoInAttesa();
    if(!silenzioso || f.rimaste) messaggio(f.rimaste
      ? f.rimaste + " foto non ancora inviate" + (f.errore ? " (" + f.errore + ")" : "") + ": restano sul telefono, riprova più tardi."
      : "Foto inviate.", f.rimaste ? "att" : "");
  }finally{ $("rf-foto-invia").disabled = false; }
}
// invio della coda: 1) file nello Storage (gia' presente = ok), 2) metadati (il database verifica il
// file), 3) solo allora la foto esce dalla coda. Stesso id a ogni tentativo: nessun doppione.
async function inviaFotoInAttesa(){
  if(!corrente || !corrente.salvato) return { inviate: 0, rimaste: inAttesa.length };
  let inviate = 0, errore = "";
  for(const v of [...inAttesa]){
    try{
      await caricaFotoStorage(v.percorso, v.blob, v.mime);
      const r = await registraAllegato({ id: v.id, rapportino_id: v.rapportino_id, percorso: v.percorso, nome: v.nome, mime: v.mime,
        dimensione: v.dimensione, larghezza: v.larghezza, altezza: v.altezza, impronta: v.impronta });
      if(r.esito === "duplicato"){ try{ await rimuoviFotoStorage([v.percorso]); }catch(e){} }
      else if(!allegati.some(a=>a.id === r.allegato.id)) allegati.push({ ...r.allegato, src: v._src });
      await togli(v.id);
      inAttesa = inAttesa.filter(x=>x.id !== v.id);
      inviate++;
    }catch(e){
      errore = e.message;
      v.stato = "errore"; v.errore = e.message;
      const { _src, ...daSalvare } = v;
      await metti(daSalvare).catch(()=>{});
      if(/connessione/i.test(e.message)) break;     // senza rete inutile provare le altre
    }
  }
  aggiornaIndiceFoto();
  disegnaAllegati();
  return { inviate, rimaste: inAttesa.length, errore };
}

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
    clienti: [{ id: corrente.id, nome: r.cliente, indirizzo: r.indirizzo, fasce: [], fatturare: "", importo: 0, tipologia: r.tipologia,
      stato: r.esito, firmatario: r.firmatario, dettagli: r.attivita + (r.note ? "\n\nNote: " + r.note : ""), materiali: r.materiali,
      foto, firma: r.firma, urgente: false }],
  };
  if(mancanti) messaggio("PDF creato senza " + (mancanti === 1 ? "1 foto non disponibile" : mancanti + " foto non disponibili") + " (rete o autorizzazione).", "att");
  condividi(btn, ()=>generaPDFPerCliente(dati, r.data), "Rapportino_" + r.data + "_" + r.cliente.replace(/[^\w]+/g, "_").slice(0, 40) + ".pdf");
}

// la vista si apre solo dalle funzioni qui sopra (apriRapportino, nuovo…), che preparano il modulo
registraVista("rapportino", ()=>{});
