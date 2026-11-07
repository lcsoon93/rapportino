// Agenda degli interventi: pezzi condivisi da Home, Lavoro e Calendario.
//  - righe compatte di un intervento (cliente, ora, luogo, operai, stato restituito dal database)
//  - dettaglio di un intervento (foglio dal basso) con accesso al rapportino e alla gestione
//  - vista "Giorno" del Calendario e interventi delle viste Settimana e Mese
// Nessuna logica nuova sui dati: si leggono le tabelle interventi/rapportini con la sessione
// dell'utente (le policy RLS decidono cosa arriva) e si riusano le funzioni gia' esistenti
// (rapportinoPerIntervento, apriRapportino, apriModuloIntervento).
import { mostraVista, registraVista, vistaCorrente } from "../core/navigation.js";
import { puo } from "../core/permessi.js";
import { profilo } from "../core/sessione.js";
import { su } from "../core/eventi.js";
import { interventiPeriodo, invalidaInterventi, leggiIntervento, nomeOperaio, operaiAttivi } from "../services/api-lavori.js";
import { dataIt, dataLunga, giorniMese, giorniSettimana, isoDi, oggiIso } from "../utils/dates.js";
import { esc } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { PRIORITA, STATO_INTERVENTO, STATO_RAPPORTINO, apriModuloIntervento, oraBreve } from "./gestione-interventi.js";
import { rapportinoPerIntervento } from "./modulo-rapportino.js";
import { apriGiorno } from "./rapportini.js";

const $ = id=>document.getElementById(id);
const CALENDARIO = ["calgiorno", "sett", "mese"];
const CON_DATI = ["home", "lavoro", ...CALENDARIO];

// ---------------------------------------------------------------- pezzi comuni
export function giornoBreve(iso){
  const t = new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export const assegnatoAMe = i=>!!profilo && (i.intervento_operai || []).some(a=>a.operaio_id === profilo.id);
export const attivo = i=>i.stato !== "annullato";
// priorita' mostrata solo quando conta (alta/urgente): niente colori superflui
const prioritaRilevante = i=>i.priorita === "urgente" || i.priorita === "alta" ? PRIORITA[i.priorita] : "";
export function badgeIntervento(i){
  return STATO_INTERVENTO[i.stato] + prioritaRilevante(i) +
    (assegnatoAMe(i) && puo("interventi.gestisci") ? '<span class="badge pervinca">' + icona("user") + 'Assegnato a te</span>' : "");
}
export function messaggioErrore(e){ return (e && e.message) || "Errore del server."; }
function stato(el, testo, tipo){ el.textContent = testo || ""; el.className = "msg-info" + (tipo ? " " + tipo : "") + (testo ? "" : " nascosto"); }

// riga compatta (Calendario, Home admin): tocco = dettaglio
export function rigaIntervento(i, conData){
  const operai = (i.intervento_operai || []).map(a=>nomeOperaio(a.operaio_id));
  const meta = [];
  if(conData) meta.push(giornoBreve(i.data));
  if(i.indirizzo) meta.push(i.indirizzo);
  meta.push(operai.length ? operai.join(", ") : "nessun operaio");
  return '<button type="button" class="cli-riga ag-riga' + (attivo(i) ? "" : " annullato") + (assegnatoAMe(i) ? " mio" : "") +
    '" data-intervento="' + i.id + '" onclick="apriDettaglioIntervento(\'' + i.id + '\')">' +
    '<span class="ag-ora">' + (i.ora ? esc(oraBreve(i.ora)) : icona("clock")) + '</span>' +
    '<span class="cli-testi">' +
      '<span class="cli-nome" style="display:block">' + esc(i.cliente) + '</span>' +
      '<span class="cli-ind" style="display:block">' + esc(meta.join(" · ")) + '</span>' +
      '<span class="int-badge" style="margin-top:6px">' + badgeIntervento(i) + '</span>' +
    '</span>' + icona("chev-r", "chev") + '</button>';
}
export function elencoRighe(lista, conData){
  return '<div class="card cli-elenco">' + lista.map(i=>rigaIntervento(i, conData)).join("") + '</div>';
}
const ordina = (a, b)=>a.data.localeCompare(b.data) || String(a.ora || "").localeCompare(String(b.ora || ""));

// ---------------------------------------------------------------- dettaglio
let focusPrima = null;
let richiestaDettaglio = 0;
export async function apriDettaglioIntervento(id){
  const n = ++richiestaDettaglio;
  focusPrima = document.activeElement;
  $("idt-titolo").textContent = "Intervento";
  $("idt-corpo").innerHTML = '<div class="msg-info">Caricamento…</div>';
  $("idt-azioni").innerHTML = "";
  $("int-dettaglio").classList.remove("nascosto");
  document.body.classList.add("foglio-aperto");
  $("idt-chiudi").focus();
  let i;
  try{
    await operaiAttivi().catch(()=>[]);
    i = await leggiIntervento(id);           // sempre dal database: stato e assegnazioni aggiornati
  }catch(e){
    if(n === richiestaDettaglio) $("idt-corpo").innerHTML = '<div class="msg-info err">' + esc(messaggioErrore(e)) + '</div>';
    return;
  }
  if(n !== richiestaDettaglio) return;
  if(!i){ $("idt-corpo").innerHTML = '<div class="msg-info err">Intervento non trovato o non autorizzato.</div>'; return; }
  disegnaDettaglio(i);
}
function disegnaDettaglio(i){
  const operai = (i.intervento_operai || []).map(a=>a.operaio_id);
  const rapp = i.rapportini || [];
  const mio = profilo ? rapp.filter(r=>r.autore_id === profilo.id).sort((a, b)=>a.stato === "bozza" ? -1 : b.stato === "bozza" ? 1 : 0)[0] : null;
  $("idt-titolo").textContent = i.cliente;
  const righe = [];
  righe.push('<div class="idt-riga">' + icona("cal") + '<span>' + esc(dataLunga(i.data)) + (i.ora ? ' · ore ' + esc(oraBreve(i.ora)) : '') + '</span></div>');
  if(i.indirizzo) righe.push('<div class="idt-riga">' + icona("pin") + '<span>' + esc(i.indirizzo) + '</span></div>');
  if(i.tipologia) righe.push('<div class="idt-riga">' + icona("sliders") + '<span>' + esc(i.tipologia) + '</span></div>');
  righe.push('<div class="idt-riga">' + icona("users") + '<span>' + (operai.length
    ? operai.map(o=>esc(nomeOperaio(o)) + (profilo && o === profilo.id ? " (tu)" : "")).join(", ")
    : "Nessun operaio assegnato") + '</span></div>');
  let html = '<div class="int-badge" style="margin:0 0 12px">' + STATO_INTERVENTO[i.stato] + (PRIORITA[i.priorita] || "") + '</div>' +
    righe.join("") +
    (i.descrizione ? '<div class="idt-desc">' + esc(i.descrizione) + '</div>' : '');
  if(rapp.length){
    html += '<div class="gruppo-tit" style="margin:16px 0 6px">Rapportini</div><div class="card cli-elenco">' + rapp.map(r=>
      '<button type="button" class="cli-riga" onclick="chiudiDettaglioIntervento(); apriRapportino(\'' + r.id + '\')">' +
      '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(nomeOperaio(r.autore_id)) + (profilo && r.autore_id === profilo.id ? " (tu)" : "") + '</span>' +
      '<span class="cli-ind" style="display:block">' + esc(dataIt(r.data)) + '</span></span>' +
      STATO_RAPPORTINO[r.stato] + icona("chev-r", "chev") + '</button>').join("") + '</div>';
  }
  $("idt-corpo").innerHTML = html;
  // azioni: solo quelle che il ruolo puo' fare (il database le ricontrolla comunque)
  const azioni = [];
  const puoCompilare = puo("rapportini.compila") && attivo(i) && (operai.includes(profilo && profilo.id) || puo("rapportini.riapri"));
  if(puoCompilare || (mio && puo("rapportini.compila"))){
    const testo = !mio ? "Compila rapportino" : mio.stato === "bozza" ? "Riprendi bozza" : "Apri il mio rapportino";
    azioni.push('<button type="button" class="btn ' + (mio && mio.stato === "completato" ? "btn-secondario" : "btn-primario") + ' btn-blocco" id="idt-rapportino" onclick="rapportinoDaDettaglio(\'' + i.id + '\')">' +
      icona(mio && mio.stato === "completato" ? "check" : "pen") + testo + '</button>');
  }
  if(!attivo(i)) azioni.push('<div class="nota" style="padding:4px 2px">Intervento annullato.</div>');
  if(puo("interventi.gestisci")){
    azioni.push('<button type="button" class="btn btn-secondario btn-blocco" id="idt-modifica" onclick="modificaDaDettaglio(\'' + i.id + '\')">' + icona("pen") + 'Modifica o riassegna</button>');
  }
  $("idt-azioni").innerHTML = azioni.join("");
}
export function chiudiDettaglioIntervento(){
  richiestaDettaglio++;
  $("int-dettaglio").classList.add("nascosto");
  document.body.classList.remove("foglio-aperto");
  if(focusPrima && document.contains(focusPrima)) focusPrima.focus({ preventScroll: true });
  focusPrima = null;
}
export function rapportinoDaDettaglio(id){
  chiudiDettaglioIntervento();
  return rapportinoPerIntervento(id);
}
export async function modificaDaDettaglio(id){
  chiudiDettaglioIntervento();
  mostraVista("interventi");
  await apriModuloIntervento(id);
}
document.addEventListener("keydown", e=>{
  if(e.key === "Escape" && !$("int-dettaglio").classList.contains("nascosto")) chiudiDettaglioIntervento();
});

// ---------------------------------------------------------------- Calendario: Giorno
function meseDi(iso){ const m = iso.slice(0, 7), g = giorniMese(m); return [g[0], g[g.length - 1]]; }
export async function disegnaGiornoCal(){
  if(!$("cg-data").value) $("cg-data").value = oggiIso();
  const iso = $("cg-data").value;
  $("cg-titolo").textContent = dataLunga(iso);
  $("cg-oggi").classList.toggle("nascosto", iso === oggiIso());
  stato($("cg-stato"), "Caricamento…");
  let lista;
  try{
    const [dal, al] = meseDi(iso);
    await operaiAttivi().catch(()=>[]);
    lista = (await interventiPeriodo(dal, al)).filter(i=>i.data === iso).sort(ordina);
  }catch(e){
    if($("cg-data").value !== iso) return;
    stato($("cg-stato"), messaggioErrore(e), "err"); $("cg-elenco").innerHTML = ""; return;
  }
  if($("cg-data").value !== iso) return;          // nel frattempo si e' cambiato giorno
  stato($("cg-stato"), "");
  const attivi = lista.filter(attivo).length;
  $("cg-conteggio").textContent = attivi ? attivi + (attivi === 1 ? " intervento" : " interventi") : "";
  $("cg-elenco").innerHTML = lista.length ? elencoRighe(lista, false)
    : '<div class="card nota">Nessun intervento il ' + esc(dataIt(iso)) + '.</div>';
}
export function apriGiornoCal(iso){
  $("cg-data").value = iso || oggiIso();
  if(vistaCorrente === "calgiorno") disegnaGiornoCal(); else mostraVista("calgiorno");
}
export function spostaGiornoCal(delta){
  const d = new Date(($("cg-data").value || oggiIso()) + "T12:00:00");
  d.setDate(d.getDate() + delta);
  apriGiornoCal(isoDi(d));
}
export function apriFoglioGiornoCal(){ apriGiorno($("cg-data").value || oggiIso()); }

// ---------------------------------------------------------------- Calendario: Settimana
export async function disegnaInterventiSettimana(isoGiorno){
  const giorni = giorniSettimana(isoGiorno);
  const cont = $("sett-interventi");
  stato($("sett-int-stato"), "Caricamento…");
  let lista;
  try{
    await operaiAttivi().catch(()=>[]);
    lista = await interventiPeriodo(giorni[0], giorni[6]);
  }catch(e){
    if(!giorni.includes($("settdata").value)) return;
    stato($("sett-int-stato"), messaggioErrore(e), "err"); cont.innerHTML = ""; return;
  }
  if(!giorni.includes($("settdata").value)) return;
  stato($("sett-int-stato"), "");
  const oggi = oggiIso();
  cont.innerHTML = giorni.map(g=>{
    const delGiorno = lista.filter(i=>i.data === g).sort(ordina);
    const n = delGiorno.filter(attivo).length;
    return '<div class="ag-giorno' + (g === oggi ? " oggi" : "") + '">' +
      '<button type="button" class="ag-giorno-testa" onclick="apriGiornoCal(\'' + g + '\')">' +
        '<span>' + esc(giornoBreve(g)) + (g === oggi ? ' · oggi' : '') + '</span>' +
        '<span class="ag-conta">' + (n ? n + (n === 1 ? " intervento" : " interventi") : "—") + '</span></button>' +
      (delGiorno.length ? elencoRighe(delGiorno, false) : '') +
    '</div>';
  }).join("");
}

// ---------------------------------------------------------------- Calendario: Mese
// interventi (non annullati) per giorno del mese: per la griglia e il giorno piu' carico
export async function conteggiMese(mese){
  const g = giorniMese(mese);
  const lista = await interventiPeriodo(g[0], g[g.length - 1]);
  const conta = {};
  lista.filter(attivo).forEach(i=>{ conta[i.data] = (conta[i.data] || 0) + 1; });
  return { conta, totale: lista.filter(attivo).length };
}
export function riepilogoMese(c){
  const giorni = Object.keys(c.conta);
  if(!c.totale) return "Nessun intervento in programma nel mese.";
  const max = giorni.reduce((a, g)=>c.conta[g] > (c.conta[a] || 0) ? g : a, giorni[0]);
  return c.totale + (c.totale === 1 ? " intervento" : " interventi") + " nel mese · giorno più carico: " +
    giornoBreve(max) + " (" + c.conta[max] + ")";
}

// apertura di Home, Lavoro o Calendario da un'altra schermata: dati rinfrescati dal database.
// Spostandosi dentro il Calendario (giorno/settimana/mese, frecce) si riusa quanto gia' letto.
su("vista-cambiata", v=>{
  const gruppo = x=>CALENDARIO.includes(x) ? "cal" : x;
  if(CON_DATI.includes(v) && gruppo(v) !== gruppo(vistaCorrente)) invalidaInterventi();
});
registraVista("calgiorno", disegnaGiornoCal);
