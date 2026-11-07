// Modulo del rapportino (tabelle "rapportini", "rapportino_operai", "allegati").
// Bozza / completato; collegato a un intervento o autonomo. Il salvataggio passa da salva_rapportino
// (una transazione, con controllo di versione). Finche' non e' salvato sul server, il contenuto
// resta anche sul telefono (localStorage) per non perderlo senza rete.
import { mostraVista, registraVista, vistaCorrente } from "../core/navigation.js";
import { puo } from "../core/permessi.js";
import { profilo } from "../core/sessione.js";
import { su } from "../core/eventi.js";
import {
  aggiungiAllegato, elencoAllegati, elencoRapportini, eliminaAllegato, leggiIntervento, leggiRapportino,
  minutiTra, nomeOperaio, operaiAttivi, riapriRapportino, salvaRapportino,
} from "../services/api-lavori.js";
import { aggiornaAnteprimaFirma } from "../services/signature.js";
import { comprimiImmagine, mostraFotoIntera } from "../services/immagini.js";
import { condividi } from "../services/condivisione.js";
import { generaPDFPerCliente } from "../services/pdf/giornata.js";
import { dataIt, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { PRIORITA, STATO_RAPPORTINO, oraBreve } from "./gestione-interventi.js";

const $ = id=>document.getElementById(id);
let corrente = null;         // { id, salvato, versione, intervento_id, intervento, stato, autore_id, aggiornato_il }
let allegati = [];
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
  $("rf-foto").innerHTML = "";
  allegati.forEach(a=>{
    const item = document.createElement("div");
    item.className = "foto-item";
    item.innerHTML = '<img alt="Foto del rapportino"><button type="button" class="foto-del rf-solo-bozza" aria-label="Rimuovi foto">&times;</button>';
    item.querySelector("img").src = a.contenuto;
    item.querySelector("img").onclick = ()=>mostraFotoIntera(a.contenuto);
    item.querySelector(".foto-del").onclick = async ev=>{
      ev.stopPropagation();
      if(!confirm("Rimuovere la foto?")) return;
      try{ await eliminaAllegato(a.id); allegati = allegati.filter(x=>x.id !== a.id); disegnaAllegati(); }catch(e){ messaggio(e.message, "err"); }
    };
    $("rf-foto").appendChild(item);
  });
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
      quando: new Date().toISOString(), base: corrente.aggiornato_il || null, salvato: !!corrente.salvato,
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
  allegati = []; disegnaAllegati();
}
export async function apriRapportino(id){
  await prepara();
  messaggio("Caricamento…");
  try{
    const r = await leggiRapportino(id);
    if(!r){
      const l = leggiLocale(id);
      if(l && profilo && l.autore === profilo.id){
        // mai arrivato al server: si riprende dal telefono
        corrente = { id, salvato: false, versione: null, intervento_id: l.intervento_id, intervento: null, stato: "bozza", autore_id: profilo.id };
        if(l.intervento_id) corrente.intervento = await leggiIntervento(l.intervento_id).catch(()=>null);
        riempiModulo(l.rapportino, l.ore);
        sporco = true;
        messaggio("Rapportino non ancora inviato: salva quando c'è rete.", "att");
        aggiornaStatoUI();
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
    allegati = await elencoAllegati(r.id);
    disegnaAllegati();
    aggiornaStatoUI();
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
  const { rapportino, ore } = leggiModulo();
  if(!rapportino.data || !rapportino.cliente){ messaggio("Data e cliente sono obbligatori.", "err"); return false; }
  if(completa){
    if(!rapportino.attivita){ messaggio("Per completare descrivi le attività svolte.", "err"); $("rf-attivita").focus(); return false; }
    if(!ore.some(o=>o.dalle && o.alle)){ messaggio("Per completare indica le ore lavorate (dalle / alle).", "err"); return false; }
    if(ore.some(o=>o.dalle && o.alle && o.alle <= o.dalle)){ messaggio("Controlla le ore: \"alle\" deve essere dopo \"dalle\".", "err"); return false; }
    if(!confirm("Completare il rapportino? Dopo non potrai più modificarlo.")) return false;
  }
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

// foto: servono un rapportino gia' salvato (si salva la bozza se serve)
export async function aggiungiFotoRapportino(input){
  const files = [...(input.files || [])];
  input.value = "";
  if(!files.length) return;
  if(!corrente.salvato && !(await salva(false))) return;
  for(const f of files){
    try{
      const foto = await comprimiImmagine(f);
      const a = await aggiungiAllegato(corrente.id, foto);
      allegati.push({ id: a.id, contenuto: foto.src, larghezza: foto.w, altezza: foto.h });
    }catch(e){ messaggio("Foto non caricata: " + e.message, "err"); }
  }
  disegnaAllegati();
  aggiornaStatoUI();
}

// PDF: stessa impaginazione delle schede del foglio giornaliero
export function pdfRapportino(btn){
  if(!corrente || !corrente.salvato) return;
  const { rapportino: r, ore } = leggiModulo();
  const dati = {
    tecnici: ore.map(o=>nomeOperaio(o.operaio_id)).join(" / "),
    operai: ore.map(o=>({ nome: nomeOperaio(o.operaio_id), dalle: o.dalle, alle: o.alle })),
    spese: [],
    clienti: [{ id: corrente.id, nome: r.cliente, indirizzo: r.indirizzo, fasce: [], fatturare: "", importo: 0, tipologia: r.tipologia,
      stato: r.esito, firmatario: r.firmatario, dettagli: r.attivita + (r.note ? "\n\nNote: " + r.note : ""), materiali: r.materiali,
      foto: allegati.map(a=>({ src: a.contenuto, w: a.larghezza, h: a.altezza })), firma: r.firma, urgente: false }],
  };
  condividi(btn, ()=>generaPDFPerCliente(dati, r.data), "Rapportino_" + r.data + "_" + r.cliente.replace(/[^\w]+/g, "_").slice(0, 40) + ".pdf");
}

// la vista si apre solo dalle funzioni qui sopra (apriRapportino, nuovo…), che preparano il modulo
registraVista("rapportino", ()=>{});
