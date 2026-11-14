// Clienti: anagrafica permanente (schede con id), ricerca, scheda, importazione; storico della vecchia app;
// suggerimenti nome/indirizzo del foglio giornaliero della vecchia app.
import { dataIt } from "../utils/dates.js";
import { esc, euro, evidenzia, iniziali } from "../utils/formatters.js";
import { leggiDB } from "../core/storage.js";
import { registraVista } from "../core/navigation.js";
import { icona } from "../utils/dom.js";
import { nuovoRapportino } from "./dashboard.js";
import { su } from "../core/eventi.js";
import { mostraVista } from "../core/navigation.js";
import { puo } from "../core/permessi.js";
import { aggiornaClienti, archiviaCliente, elencoClienti, eliminaCliente, leggiCliente, risolviConflittoCliente, salvaCliente, scartaModifica, statoAnagrafica } from "../services/clienti-archivio.js";
import { CAMPI_CLIENTE, candidatiImportazione, cercaClienti, datiPerDocumento, erroriCliente, etichettaCliente, omonimi } from "../services/clienti-logica.js";
import { elencoInterventi, elencoRapportini } from "../services/api-lavori.js";
import { registraSchedaCliente } from "./scelta-cliente.js";
import { nuovoRapportinoAutonomo } from "./modulo-rapportino.js";
import { apriModuloIntervento } from "./gestione-interventi.js";

export function aggiornaClientiNoti(){
  const db = leggiDB();
  const nomi = new Set();
  Object.values(db).forEach(d=>{
    (d.clienti || []).forEach(c=>{
      if(c.nome && c.nome !== "(senza nome)") nomi.add(c.nome);
    });
  });
  nomiNoti = [...nomi].sort();
  const indirizzi = new Set();
  Object.values(db).forEach(d=>{
    (d.clienti || []).forEach(c=>{ if(c.indirizzo) indirizzi.add(c.indirizzo); });
  });
  indirizziNoti = [...indirizzi].sort();
}
// Suggerimenti fatti a mano al posto del <datalist>: quello di Safari si apre a ogni lettera
// e si finiva per toccarlo per sbaglio. Questi compaiono solo dopo una pausa nella scrittura,
// spariscono appena si riprende a scrivere e ignorano i tocchi arrivati subito dopo la comparsa.
export let nomiNoti = [], indirizziNoti = [];
export const SUGG_MIN_LETTERE = 3;     // lettere da scrivere prima di vedere suggerimenti
export const SUGG_PAUSA = 900;         // ms di pausa nella scrittura prima di mostrarli
export const SUGG_MAX = 4;             // quanti al massimo
export const SUGG_BLOCCO_TOCCO = 400;  // ms dopo la comparsa in cui un tocco viene ignorato
export let suggTimer = null, suggCampo = null, suggMostratiAlle = 0;
export function chiudiSuggerimenti(){
  clearTimeout(suggTimer);
  const box = document.getElementById("suggerimenti");
  box.classList.add("nascosto");
  box.innerHTML = "";
  suggCampo = null;
}
export function programmaSuggerimenti(campo){
  chiudiSuggerimenti();
  suggTimer = setTimeout(()=>mostraSuggerimenti(campo), SUGG_PAUSA);
}
export function mostraSuggerimenti(campo){
  if(document.activeElement !== campo) return;
  const testo = campo.value.trim().toLowerCase();
  if(testo.length < SUGG_MIN_LETTERE) return;
  const elenco = campo.classList.contains("c-nome") ? nomiNoti : indirizziNoti;
  // prima quelli che iniziano con il testo, poi quelli che lo contengono; esclusa la corrispondenza esatta
  const trovati = elenco.filter(v=>v.toLowerCase() !== testo && v.toLowerCase().includes(testo))
    .sort((a,b)=>(b.toLowerCase().startsWith(testo) - a.toLowerCase().startsWith(testo)) || a.localeCompare(b))
    .slice(0, SUGG_MAX);
  if(!trovati.length) return;
  const box = document.getElementById("suggerimenti");
  box.innerHTML = "";
  trovati.forEach(v=>{
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sugg-voce";
    b.textContent = v;
    b.addEventListener("mousedown", e=>e.preventDefault());   // il campo non perde il fuoco
    b.addEventListener("click", ()=>{
      if(Date.now() - suggMostratiAlle < SUGG_BLOCCO_TOCCO) return;   // tocco troppo ravvicinato: era per la tastiera
      campo.value = v;
      chiudiSuggerimenti();
      campo.dispatchEvent(new Event("input", {bubbles:true}));
      chiudiSuggerimenti();                                        // l'evento input li riprogrammerebbe
    });
    box.appendChild(b);
  });
  const chiudi = document.createElement("button");
  chiudi.type = "button";
  chiudi.className = "sugg-chiudi";
  chiudi.textContent = "Chiudi suggerimenti";
  chiudi.addEventListener("mousedown", e=>e.preventDefault());
  chiudi.addEventListener("click", chiudiSuggerimenti);
  box.appendChild(chiudi);
  // larghezza della scheda cliente (il campo nome e' stretto), subito sotto il campo
  const r = campo.getBoundingClientRect();
  const rs = (campo.closest(".cliente") || campo).getBoundingClientRect();
  box.style.left = (rs.left + window.scrollX) + "px";
  box.style.top = (r.bottom + window.scrollY + 4) + "px";
  box.style.width = rs.width + "px";
  box.classList.remove("nascosto");
  suggCampo = campo;
  suggMostratiAlle = Date.now();
  // se finisce sotto la tastiera o la barra in basso, faccio scorrere la pagina
  const altezzaVisibile = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const barra = document.querySelector(".barra:not(.nascosto)");
  const nav = document.querySelector(".navbar");
  const fondo = barra ? barra.getBoundingClientRect().top : (nav ? nav.getBoundingClientRect().top : window.innerHeight);
  const limite = Math.min(altezzaVisibile, fondo);
  const sporgenza = box.getBoundingClientRect().bottom - limite + 8;
  if(sporgenza > 0) window.scrollBy(0, Math.min(sporgenza, r.top - 70));   // il campo resta visibile
}
document.addEventListener("input", e=>{
  const t = e.target;
  if(t.classList && (t.classList.contains("c-nome") || t.classList.contains("c-indirizzo"))) programmaSuggerimenti(t);
});
document.addEventListener("focusout", e=>{
  if(e.target === suggCampo || (e.target.classList && (e.target.classList.contains("c-nome") || e.target.classList.contains("c-indirizzo")))){
    setTimeout(()=>{ if(!suggCampo || document.activeElement !== suggCampo) chiudiSuggerimenti(); }, 150);
  }
});
window.addEventListener("resize", ()=>{ if(suggCampo) chiudiSuggerimenti(); });
// =====================================================================
// ANAGRAFICA CLIENTI (tabella "clienti", copia sul telefono: services/clienti-archivio.js)
// Ogni cliente e' una scheda con il suo id: il nome non e' univoco (omonimi ammessi, anche con lo
// stesso indirizzo). Elenco e ricerca mostrano sempre nome + indirizzo.
// =====================================================================
const $ = id=>document.getElementById(id);
let elencoAnagrafica = [];

function badgeStato(c){
  if(c._stato === "conflitto") return '<span class="badge err">Conflitto</span>';
  if(c._stato === "errore") return '<span class="badge err">Non inviato</span>';
  if(c._stato) return '<span class="badge neutro">Da inviare</span>';
  return "";
}
export function rigaClienteHtml(c){
  return '<button type="button" class="cli-riga" data-cliente="' + esc(c.id) + '">' +
    '<span class="avatar" aria-hidden="true">' + esc(iniziali(c.nome)) + '</span>' +
    '<span class="cli-testi">' +
      '<span class="cli-nome" style="display:block">' + esc(c.nome) + '</span>' +
      '<span class="cli-ind cli-ind-anag" style="display:block">' + icona("pin", "i-sm") + esc(c.indirizzo || "indirizzo non indicato") + '</span>' +
      (c.telefono ? '<span class="cli-info" style="display:block">' + icona("phone", "i-sm") + esc(c.telefono) + '</span>' : '') +
      ((c.archiviato || c._stato) ? '<span class="int-badge">' + (c.archiviato ? '<span class="badge neutro">Archiviato</span>' : '') + badgeStato(c) + '</span>' : '') +
    '</span>' + icona("chev-r", "chev") + '</button>';
}
function disegnaAnagrafica(query){
  const box = $("anag-elenco");
  const archiviati = $("anag-archiviati").checked;
  const trovati = cercaClienti(elencoAnagrafica, query, { archiviati });
  const attivi = elencoAnagrafica.filter(c=>!c.archiviato).length;
  const msg = statoAnagrafica.attiva ? statoAnagrafica.errore : "L'anagrafica clienti non è ancora attiva sul server (migrazione 20261116090000).";
  $("anag-msg").textContent = msg || "";
  $("anag-msg").className = "msg-info" + (msg ? " att" : "");
  if(!elencoAnagrafica.length){
    box.innerHTML = '<div class="card vuoto"><div class="v-icona">' + icona("users", "i-lg") + '</div><h3>Anagrafica vuota</h3>' +
      '<p>Aggiungi i clienti con «Nuovo cliente»' + (puo("clienti.gestisci") ? ' oppure importali dai lavori già registrati' : '') + '.</p></div>';
    return;
  }
  const stessi = query ? omonimi(elencoAnagrafica, query, { archiviati }) : [];
  box.innerHTML = '<div class="elenco-nota">' + (query ? trovati.length + (trovati.length === 1 ? " cliente trovato" : " clienti trovati") : attivi + (attivi === 1 ? " cliente" : " clienti")) +
    (stessi.length > 1 ? ' · ' + stessi.length + ' con lo stesso nome: controlla l\'indirizzo' : '') + '</div>' +
    (trovati.length ? '<div class="card cli-elenco">' + trovati.map(rigaClienteHtml).join("") + '</div>' : '<div class="ris-niente">Nessun cliente in anagrafica per "' + esc(query) + '"</div>');
}
export async function aggiornaVistaClienti(){
  elencoAnagrafica = await elencoClienti();
  disegnaAnagrafica($("cerca-input").value.trim());
}
export function eseguiRicerca(){
  const query = ($("cerca-input").value || "").trim();
  disegnaAnagrafica(query);
  const cont = $("cerca-risultati");
  cont.innerHTML = "";
  if(query.length >= 2 && Object.keys(leggiDB()).length) storicoVecchio(query.toLowerCase(), cont);
}
document.getElementById("anag-elenco").addEventListener("click", e=>{
  const b = e.target.closest("[data-cliente]");
  if(b) apriSchedaCliente({ id: b.dataset.cliente });
});

// ---------------------------------------------------------------- scheda (foglio)
let schedaAperta = null;     // { id, onSalvato }
let focusPrima = null;
function msgScheda(t, tipo){ $("cli-msg").textContent = t || ""; $("cli-msg").className = "msg-info" + (tipo ? " " + tipo : ""); }
function apriFoglio(titolo){
  if($("cli-foglio").classList.contains("nascosto")) focusPrima = document.activeElement;
  $("cli-titolo").textContent = titolo;
  msgScheda("");
  $("cli-foglio").classList.remove("nascosto");
  document.body.classList.add("foglio-aperto");
  $("cli-chiudi").focus({ preventScroll: true });
}
export function chiudiSchedaCliente(){
  $("cli-foglio").classList.add("nascosto");
  document.body.classList.remove("foglio-aperto");
  schedaAperta = null;
  if(focusPrima && document.contains(focusPrima)) focusPrima.focus({ preventScroll: true });
  focusPrima = null;
}
const CAMPI_SCHEDA = [["nome", "Nome e cognome / ragione sociale"], ["indirizzo", "Indirizzo"], ["telefono", "Telefono"], ["email", "Email"], ["partita_iva", "Partita IVA"], ["note", "Note"]];

// apertura: { id } = consulta una scheda; { nuovo: {nome, indirizzo, telefono}, onSalvato } = nuova scheda
export async function apriSchedaCliente({ id, nuovo, onSalvato } = {}){
  schedaAperta = { id: id || null, onSalvato: onSalvato || null };
  if(!id) return moduloScheda(null, nuovo || {});
  const c = await leggiCliente(id);
  if(!c){ apriFoglio("Cliente"); $("cli-corpo").innerHTML = '<p class="nota">Scheda non disponibile.</p>'; $("cli-azioni").innerHTML = ""; return; }
  apriFoglio(c.nome);
  const riga = (ic, testo, link)=>testo ? '<div class="idt-riga">' + icona(ic) + (link ? '<a href="' + esc(link) + '">' + esc(testo) + '</a>' : '<span>' + esc(testo) + '</span>') + '</div>' : '';
  $("cli-corpo").innerHTML =
    (c.archiviato ? '<p class="msg-info att">Cliente archiviato: non compare nei suggerimenti.</p>' : '') +
    riga("pin", c.indirizzo || "Indirizzo non indicato") +
    riga("phone", c.telefono, c.telefono ? "tel:" + c.telefono.replace(/[^\d+]/g, "") : "") +
    riga("mail", c.email, c.email ? "mailto:" + c.email : "") +
    (c.partita_iva ? '<div class="idt-riga">' + icona("file") + '<span>P. IVA ' + esc(c.partita_iva) + '</span></div>' : '') +
    (c.note ? '<div class="idt-desc"></div>' : '') +
    '<p class="nota cli-id">ID scheda: ' + esc(c.id) + '</p>' +
    (c._stato === "conflitto" ? conflittoHtml(c) : '') +
    (c._stato === "errore" ? '<p class="msg-info err">Modifica non inviata: ' + esc(c._errore) + '</p>' : '') +
    (c._stato && c._stato !== "conflitto" && c._stato !== "errore" ? '<p class="msg-info att">Salvato sul telefono: verrà inviato appena c\'è rete.</p>' : '');
  if(c.note) $("cli-corpo").querySelector(".idt-desc").textContent = c.note;
  const az = [];
  if(puo("rapportini.compila")) az.push('<button type="button" class="btn btn-primario btn-blocco" data-az="rapportino">' + icona("plus") + 'Nuovo rapportino per questo cliente</button>');
  if(puo("interventi.gestisci")) az.push('<button type="button" class="btn btn-secondario btn-blocco" data-az="intervento">' + icona("cal") + 'Nuovo intervento per questo cliente</button>');
  if(puo("clienti.gestisci")){
    az.push('<button type="button" class="btn btn-secondario btn-blocco" data-az="modifica">' + icona("pen") + 'Modifica</button>');
    az.push('<button type="button" class="btn btn-secondario btn-blocco" data-az="archivia">' + (c.archiviato ? "Ripristina" : "Archivia") + '</button>');
  }
  if(c._stato === "errore") az.push('<button type="button" class="btn btn-secondario btn-blocco" data-az="scarta">Scarta la modifica non inviata</button>');
  if(puo("clienti.elimina") && c.versione) az.push('<button type="button" class="btn btn-secondario btn-blocco" data-az="elimina">' + icona("trash") + 'Elimina</button>');
  $("cli-azioni").innerHTML = az.join("");
  $("cli-azioni").onclick = async e=>{
    const b = e.target.closest("[data-az]");
    if(!b) return;
    const a = b.dataset.az;
    if(a === "modifica") return moduloScheda(c, c);
    if(a === "rapportino"){ chiudiSchedaCliente(); return nuovoRapportinoPerCliente(c); }
    if(a === "intervento"){ chiudiSchedaCliente(); return nuovoInterventoPerCliente(c); }
    try{
      if(a === "archivia"){
        if(!c.archiviato && !confirm("Archiviare " + etichettaCliente(c) + "? Non comparirà nei suggerimenti; i documenti restano collegati.")) return;
        await archiviaCliente(c, !c.archiviato);
      }
      if(a === "scarta"){ if(!confirm("Scartare la modifica non inviata?")) return; await scartaModifica(c.id); }
      if(a === "elimina"){
        if(!confirm("Eliminare definitivamente " + etichettaCliente(c) + "?\nSe ha interventi o rapportini collegati non si può: va archiviato.")) return;
        await eliminaCliente(c.id); chiudiSchedaCliente(); return;
      }
      await apriSchedaCliente({ id: c.id });
    }catch(err){ msgScheda(err.message, "err"); }
  };
}
const ETICHETTE = Object.fromEntries(CAMPI_SCHEDA.concat([["archiviato", "Archiviato"]]));
function conflittoHtml(c){
  const s = c._server || {};
  const righe = CAMPI_CLIENTE.filter(k=>String(c[k] ?? "") !== String(s[k] ?? ""))
    .map(k=>'<div class="conf-riga"><span>' + esc(ETICHETTE[k]) + '</span><span>' + esc(String(c[k] ?? "—")) + '</span><span>' + esc(String(s[k] ?? "—")) + '</span></div>').join("");
  return '<div class="card conf-box"><div class="gruppo-tit" style="margin:0 0 6px">Modificata da un altro utente nel frattempo</div>' +
    '<div class="conf-tab"><div class="conf-riga conf-testa"><span>Campo</span><span>Tua modifica</span><span>Sul server</span></div>' + righe + '</div>' +
    '<div class="due" style="margin-top:10px"><div><button type="button" class="btn btn-primario btn-blocco" data-conf="mia">Tieni la mia</button></div>' +
    '<div><button type="button" class="btn btn-secondario btn-blocco" data-conf="server">Tieni quella del server</button></div></div></div>';
}
document.getElementById("cli-corpo").addEventListener("click", async e=>{
  const b = e.target.closest("[data-conf]");
  if(!b || !schedaAperta || !schedaAperta.id) return;
  try{ await risolviConflittoCliente(schedaAperta.id, b.dataset.conf); await apriSchedaCliente({ id: schedaAperta.id }); }
  catch(err){ msgScheda(err.message, "err"); }
});

// modulo di creazione / modifica (nessun controllo di unicita' sul nome: gli omonimi sono ammessi)
function moduloScheda(base, valori){
  apriFoglio(base ? "Modifica cliente" : "Nuovo cliente");
  $("cli-corpo").innerHTML = '<form id="cli-form" novalidate>' + CAMPI_SCHEDA.map(([k, et])=>
    '<div class="campo"><label for="cli-' + k + '">' + esc(et) + (k === "nome" ? " *" : "") + '</label>' +
    (k === "note" ? '<textarea id="cli-note" rows="3" maxlength="2000"></textarea>'
      : '<input id="cli-' + k + '" type="' + (k === "telefono" ? "tel" : k === "email" ? "email" : "text") + '" autocomplete="off"' +
        (k === "telefono" ? ' inputmode="tel"' : '') + ' maxlength="' + ({ nome: 200, indirizzo: 300, telefono: 60, email: 200, partita_iva: 30 })[k] + '">') + '</div>').join("") +
    '<div class="msg-info att nascosto" id="cli-omonimi"></div></form>';
  CAMPI_SCHEDA.forEach(([k])=>{ $("cli-" + k).value = (valori && valori[k]) || ""; });
  const avvisaOmonimi = ()=>{
    const stessi = omonimi(elencoAnagrafica, $("cli-nome").value, { archiviati: true }).filter(x=>!base || x.id !== base.id);
    $("cli-omonimi").classList.toggle("nascosto", !stessi.length);
    $("cli-omonimi").textContent = stessi.length ? "Esistono già " + stessi.length + (stessi.length === 1 ? " cliente" : " clienti") + " con questo nome: " +
      stessi.slice(0, 4).map(x=>x.indirizzo || "indirizzo non indicato").join("; ") + ". Puoi comunque creare una scheda distinta." : "";
  };
  $("cli-nome").addEventListener("input", avvisaOmonimi);
  elencoClienti().then(l=>{ elencoAnagrafica = l; avvisaOmonimi(); });
  $("cli-azioni").innerHTML = '<button type="button" class="btn btn-primario btn-blocco" id="cli-salva">' + icona("check") + 'Salva</button>' +
    '<button type="button" class="btn btn-secondario btn-blocco" id="cli-annulla">Annulla</button>';
  $("cli-azioni").onclick = async e=>{
    if(e.target.closest("#cli-annulla")) return base ? apriSchedaCliente({ id: base.id, onSalvato: schedaAperta && schedaAperta.onSalvato }) : chiudiSchedaCliente();
    if(!e.target.closest("#cli-salva")) return;
    const dati = Object.fromEntries(CAMPI_SCHEDA.map(([k])=>[k, $("cli-" + k).value]));
    if(base) dati.archiviato = base.archiviato;
    const errori = erroriCliente(dati);
    if(errori.length){ msgScheda(errori.join(" "), "err"); return; }
    $("cli-salva").disabled = true;
    try{
      const salvato = await salvaCliente(dati, base);
      const dopo = schedaAperta && schedaAperta.onSalvato;
      elencoAnagrafica = await elencoClienti();
      if(dopo){ chiudiSchedaCliente(); dopo(salvato); return; }
      await apriSchedaCliente({ id: salvato.id });
      msgScheda(navigator.onLine === false ? "Salvato sul telefono: verrà inviato appena c'è rete." : "Cliente salvato.");
    }catch(err){ msgScheda(err.message, "err"); }
    finally{ const b = $("cli-salva"); if(b) b.disabled = false; }
  };
  $("cli-nome").focus({ preventScroll: true });
}
export function nuovoClienteUI(){
  apriSchedaCliente({ nuovo: { nome: $("cerca-input").value.trim() } });
}
document.addEventListener("keydown", e=>{ if(e.key === "Escape" && !$("cli-foglio").classList.contains("nascosto")) chiudiSchedaCliente(); });
document.getElementById("cli-foglio").addEventListener("click", e=>{ if(e.target.closest("[data-cli-chiudi]")) chiudiSchedaCliente(); });
registraSchedaCliente(apriSchedaCliente);

// ---------------------------------------------------------------- importazione dallo storico (esplicita)
// Coppie nome + indirizzo di interventi, rapportini e giornate della vecchia app che non hanno ancora una
// scheda con lo stesso nome e lo stesso indirizzo. Si creano SOLO quelle spuntate; i documenti esistenti
// non vengono modificati ne' collegati.
export async function importaClientiUI(btn){
  btn.disabled = true;
  try{
    const da = new Date(); da.setFullYear(da.getFullYear() - 3);
    const dal = da.toISOString().slice(0, 10);
    const [interventi, rapportini] = await Promise.all([elencoInterventi({ dal }).catch(()=>[]), elencoRapportini({ dal }).catch(()=>[])]);
    const vecchi = [];
    Object.entries(leggiDB()).forEach(([iso, g])=>((g && g.clienti) || []).forEach(c=>vecchi.push({ cliente: c.nome, indirizzo: c.indirizzo, data: iso })));
    const candidati = candidatiImportazione([...interventi, ...rapportini, ...vecchi], await elencoClienti());
    apriFoglio("Importa dallo storico");
    if(!candidati.length){ $("cli-corpo").innerHTML = '<p class="nota">Nessun nuovo cliente da importare: ogni nome e indirizzo dei lavori ha già una scheda.</p>'; $("cli-azioni").innerHTML = ""; return; }
    $("cli-corpo").innerHTML = '<p class="nota" style="padding:0 0 8px">Spunta i clienti da aggiungere all\'anagrafica. Nomi uguali con indirizzi diversi restano schede distinte. I documenti già salvati non cambiano.</p>' +
      candidati.map((c, i)=>'<label class="check"><input type="checkbox" data-imp="' + i + '"><span><b>' + esc(c.nome) + '</b><br><small>' + esc(c.indirizzo || "indirizzo non indicato") +
        ' · ' + c.volte + (c.volte === 1 ? " lavoro" : " lavori") + (c.ultimo ? ", ultimo " + esc(dataIt(c.ultimo)) : "") + '</small></span></label>').join("");
    $("cli-azioni").innerHTML = '<button type="button" class="btn btn-primario btn-blocco" id="cli-importa">Aggiungi i selezionati</button>';
    $("cli-azioni").onclick = async e=>{
      if(!e.target.closest("#cli-importa")) return;
      const scelti = [...$("cli-corpo").querySelectorAll("[data-imp]:checked")].map(x=>candidati[+x.dataset.imp]);
      if(!scelti.length){ msgScheda("Spunta almeno un cliente.", "err"); return; }
      for(const c of scelti) await salvaCliente({ nome: c.nome, indirizzo: c.indirizzo, telefono: c.telefono }, null);
      chiudiSchedaCliente();
      await aggiornaVistaClienti();
    };
  }catch(err){ alert(err.message); }
  finally{ btn.disabled = false; }
}

// ---------------------------------------------------------------- nuovi documenti per un cliente
export async function nuovoRapportinoPerCliente(c){
  await nuovoRapportinoAutonomo(datiPerDocumento(c));
}
export async function nuovoInterventoPerCliente(c){
  mostraVista("interventi");
  await apriModuloIntervento(null, datiPerDocumento(c));
}
// compatibilita' con i pulsanti esistenti
export function apriCliente(nome){ $("cerca-input").value = nome; eseguiRicerca(); window.scrollTo(0, 0); }
export function nuovoPerCliente(btn){ nuovoRapportino({ nome: btn.dataset.nome, indirizzo: btn.dataset.indirizzo }); }

// ---------------------------------------------------------------- vecchia app: ricerca nelle giornate
function storicoVecchio(query, cont){
  const db = leggiDB();
  const corrispondenze = [];

  Object.keys(db).sort().reverse().forEach(iso=>{
    const d = db[iso];
    if(!d || !d.clienti) return;
    const clientiTrovati = d.clienti.filter(cl=>
      (cl.nome && cl.nome.toLowerCase().includes(query)) ||
      (cl.indirizzo && cl.indirizzo.toLowerCase().includes(query)) ||
      (cl.fatturare && cl.fatturare.toLowerCase().includes(query)) ||
      (cl.dettagli && cl.dettagli.toLowerCase().includes(query))
    );
    if(clientiTrovati.length) corrispondenze.push({iso, d, clienti: clientiTrovati});
  });

  if(corrispondenze.length === 0){
    cont.innerHTML = '<div class="ris-niente">Nessun lavoro della vecchia app per "' + esc(query) + '"</div>';
    return;
  }

  corrispondenze.forEach(({iso, clienti})=>{
    const card = document.createElement("div");
    card.className = "card ris-giorno";

    const nomi = clienti.map(cl=>cl.nome).join(", ");
    let html =
      '<div class="rg-header">' +
        '<span class="rg-data">' + dataIt(iso) + '</span>' +
        '<span class="rg-clienti">' + evidenzia(nomi, query) + '</span>' +
      '</div>';

    clienti.forEach(cl=>{
      html += '<div style="margin-bottom:10px;padding-left:4px">';

      if(cl.indirizzo)
        html += '<div class="rg-riga" style="color:var(--testo-2);font-size:13px">' + icona("pin", "i-sm") + '<span>' + evidenzia(cl.indirizzo, query) + '</span></div>';

      const fasce = cl.fasce && cl.fasce.length ? cl.fasce
                  : ((cl.dalle || cl.alle) ? [{d: cl.dalle, a: cl.alle}] : []);
      const or = fasce.map(f=>(f.d && f.a ? f.d+" - "+f.a : f.d || f.a || "")).filter(Boolean).join(" / ");
      if(or) html += '<div class="rg-riga" style="font-size:13px">' + icona("clock", "i-sm") + '<span>' + esc(or) + '</span>' + '</div>';

      const meta = [];
      if(cl.tipologia) meta.push(cl.tipologia);
      if(cl.stato && cl.stato !== "Completato") meta.push('<span style="color:var(--err-testo)">' + cl.stato + '</span>');
      if(meta.length) html += '<div class="rg-riga" style="font-size:13px">' + meta.join(" · ") + '</div>';

      if(cl.dettagli){
        html += '<div class="rg-sezione">Lavoro</div>';
        cl.dettagli.split("\n").forEach(riga=>{
          if(riga.trim()) html += '<div class="rg-riga">' + evidenzia(riga, query) + '</div>';
        });
      }

      if(cl.materiali && cl.materiali.length){
        html += '<div class="rg-sezione">Materiale</div>';
        cl.materiali.forEach(m=>{
          html += '<div class="rg-riga">- ' + evidenzia(m.a, query) + (m.q ? ' <span style="color:var(--testo-2)">(' + esc(m.q) + ')</span>' : '') + '</div>';
        });
      }

      if(cl.importo)
        html += '<div class="rg-riga" style="font-size:13px">' + icona("euro", "i-sm") + '<span>Da fatturare: <b>' + euro(cl.importo) + '</b></span></div>';

      if(cl.fatturare)
        html += '<div class="rg-riga" style="font-size:13px;color:#5A6068">Fatturare a: ' + evidenzia(cl.fatturare, query) + '</div>';

      html += '</div>';
    });

    html += '<button type="button" class="btn btn-secondario btn-blocco" style="margin-top:6px" onclick="apriGiorno(\'' + iso + '\')">' +
            icona("file") + 'Apri rapporto del ' + dataIt(iso) + '</button>';

    card.innerHTML = html;
    cont.appendChild(card);
  });

  cont.insertAdjacentHTML("afterbegin",
    '<div class="elenco-nota">' +
    corrispondenze.length + ' giorn' + (corrispondenze.length === 1 ? "o" : "i") + ' trovat' +
    (corrispondenze.length === 1 ? "o" : "i") + '</div>');
}

registraVista("cerca", ()=>{ eseguiRicerca(); aggiornaClienti().then(l=>{ elencoAnagrafica = l; disegnaAnagrafica($("cerca-input").value.trim()); }); });
su("clienti-aggiornati", ()=>{ if(!$("vista-cerca").classList.contains("nascosto")) aggiornaVistaClienti(); });
su("vista-cambiata", chiudiSuggerimenti);
su("giornata-salvata", aggiornaClientiNoti);
su("archivio-aggiornato", origine=>{ if(origine === "importazione") aggiornaClientiNoti(); });
