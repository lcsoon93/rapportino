// Home (admin): riepilogo degli interventi pianificati (tabella interventi) e lavori del giorno scelto
// (interventi e rapportini). Le funzioni sulle schede del foglio giornaliero (vecchia app) restano per la
// vista "giorno".
import { dataIt, dataLunga, isoDi, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { leggiDB } from "../core/storage.js";
import { mostraVista, registraVista, vistaCorrente } from "../core/navigation.js";
import { icona } from "../utils/dom.js";
import { aggiornaTestiData, caricaGiornata, datiGiornata, salvaGiornata } from "./rapportini.js";
import { aggiungiCliente, elencoClienti } from "./interventi.js";
import { apriFirmaOverlay } from "../services/signature.js";
import { aggiornaSelectSpese } from "./spese.js";
import { emetti, su } from "../core/eventi.js";
import { puo } from "../core/permessi.js";
import { contaRapportini, interventiPeriodo, operaiAttivi } from "../services/api-lavori.js";
import { attivo, contaEseguiti, contaLavori, elencoRighe, htmlLavoriGiorno, lavoriDelGiorno, messaggioErrore } from "./agenda.js";
import { bozzeLocali } from "./modulo-rapportino.js";
import { aggiornaOrari, orarioDelGiorno, salvaOrarioGiorno } from "../services/orario-giornata.js";
import { ORARIO_PREDEFINITO } from "../services/giornate-logica.js";

// ---- home ----
export function fasceTesto(c){
  const fasce = c.fasce && c.fasce.length ? c.fasce : ((c.dalle || c.alle) ? [{d: c.dalle, a: c.alle}] : []);
  return fasce.filter(f=>f.d || f.a);
}
// Home: lavori del giorno scelto (interventi programmati e rapportini senza intervento), non piu' il
// foglio giornaliero della vecchia app. "Ore di lavoro" = ore della giornata: dal primo inizio
// all'ultima fine degli orari segnati nei rapportini del giorno (unione degli intervalli, non la somma).
let giroHome = 0, lavoriHome = 0;
export async function disegnaHome(){
  const ora = new Date().getHours();
  document.getElementById("home-saluto").textContent = ora < 13 ? "Buongiorno" : (ora < 18 ? "Buon pomeriggio" : "Buonasera");
  document.getElementById("home-oggi").textContent = dataLunga(oggiIso());
  aggiornaTestiData();
  const iso = document.getElementById("data").value || oggiIso();
  document.getElementById("home-riep-data").textContent = dataIt(iso);
  document.getElementById("home-int-titolo").textContent = iso === oggiIso() ? "Lavori di oggi" : "Lavori del " + dataIt(iso);
  const cont = document.getElementById("home-interventi");
  disegnaOrarioHome(iso);
  const n = ++giroHome;
  let g;
  try{ g = await lavoriDelGiorno(iso); }
  catch(e){
    if(n !== giroHome) return;
    ["st-interventi", "st-ore", "st-firmati", "st-dafirmare"].forEach(id=>{ document.getElementById(id).textContent = "–"; });
    cont.innerHTML = '<div class="card nota">' + esc(messaggioErrore(e)) + '</div>';
    return;
  }
  if(n !== giroHome) return;
  // ore della giornata: 8-17 (9 ore) salvo orario inserito; senza lavori quel giorno, zero
  lavoriHome = contaLavori(g);
  document.getElementById("st-interventi").textContent = lavoriHome;
  document.getElementById("st-ore").textContent = oreTesto(lavoriHome ? orarioDelGiorno(iso).minuti : 0);
  document.getElementById("st-firmati").textContent = contaEseguiti(g);
  document.getElementById("st-dafirmare").textContent = g.daEseguire.length;
  cont.innerHTML = htmlLavoriGiorno(g, iso);
}
// ---- orario della giornata (Home): 08:00-17:00 per tutti salvo inserimento; "escludi dal monte ore" ----
// giorno dell'orario: campo nel riquadro di Giornata (oggi se vuoto)
const giornoHome = ()=>{ const el = document.getElementById("og-giorno"); return (el && el.value) || oggiIso(); };
export function disegnaOrarioGiornata(){
  const el = document.getElementById("og-giorno");
  if(el && !el.value) el.value = oggiIso();
  aggiornaOrari().then(()=>disegnaOrarioHome(giornoHome())).catch(()=>disegnaOrarioHome(giornoHome()));
}
function disegnaOrarioHome(iso, nota){
  const o = orarioDelGiorno(iso);
  document.getElementById("og-dalle").value = o.dalle;
  document.getElementById("og-alle").value = o.alle;
  document.getElementById("og-escludi").checked = o.escludi;
  document.getElementById("og-ore").textContent = oreTesto(o.minuti) + (o.escludi ? " · esclusa" : "");
  const predefinito = o.dalle === ORARIO_PREDEFINITO.dalle && o.alle === ORARIO_PREDEFINITO.alle;
  document.getElementById("og-ripristina").classList.toggle("nascosto", predefinito);
  const el = document.getElementById("og-nota");
  el.className = "og-nota" + (nota && nota.errore ? " err" : "");
  el.textContent = nota ? nota.testo : o.origine === "inserito" ? "Orario inserito per questo giorno."
    : o.origine === "foglio" ? "Orario dal foglio giornaliero di questo giorno." : "Orario fisso 8–17: cambialo solo se quel giorno è diverso.";
  return o;
}
async function salvaOrarioHome(valore){
  const iso = giornoHome();
  try{
    await salvaOrarioGiorno(iso, valore);
    if(giornoHome() !== iso) return;
    const o = disegnaOrarioHome(iso, { testo: "Salvato ✓" });
    const st = document.getElementById("st-ore");
    if(st) st.textContent = oreTesto(lavoriHome ? o.minuti : 0);
  }catch(e){
    if(giornoHome() === iso) disegnaOrarioHome(iso, { testo: /policy|row-level|permission|42501/i.test(e.message) ? "Solo l'amministratore può cambiare l'orario." : "Non salvato: " + e.message, errore: true });
  }
}
export function cambiaOrarioGiorno(){
  return salvaOrarioHome({ dalle: document.getElementById("og-dalle").value, alle: document.getElementById("og-alle").value,
    escludi: document.getElementById("og-escludi").checked });
}
export function ripristinaOrarioGiorno(){
  return salvaOrarioHome({ ...ORARIO_PREDEFINITO, escludi: document.getElementById("og-escludi").checked });
}
export function schedaCliente(id){
  return [...document.querySelectorAll("#clienti .cliente")].find(c=>c.dataset.id === id) || null;
}
export function evidenziaScheda(card, focusNome){
  if(!card) return;
  card.scrollIntoView({block:"start"});
  card.classList.add("evidenziata");
  setTimeout(()=>card.classList.remove("evidenziata"), 1600);
  if(focusNome) card.querySelector(".c-nome").focus({preventScroll:true});
}
export function apriIntervento(id){
  mostraVista("giorno");
  evidenziaScheda(schedaCliente(id), false);
}
export function firmaIntervento(id){
  const card = schedaCliente(id);
  if(card) apriFirmaOverlay(card.querySelector(".firma-anteprima"));
}
// "+ Nuovo rapportino": nuova scheda cliente nella giornata selezionata (riusa quella vuota se c'e')
export function nuovoRapportino(dati){
  mostraVista("giorno");
  const schede = [...document.querySelectorAll("#clienti .cliente")];
  const vuota = schede.length === 1 && elencoClienti().length === 0 ? schede[0] : null;
  let card = vuota;
  if(!card){
    aggiungiCliente();
    const tutte = document.querySelectorAll("#clienti .cliente");
    card = tutte[tutte.length - 1];
  }
  if(dati){
    card.querySelector(".c-nome").value = dati.nome || "";
    card.querySelector(".c-indirizzo").value = dati.indirizzo || "";
    aggiornaSelectSpese();
    salvaGiornata();
  }
  evidenziaScheda(card, !dati);
}
export function apriGiornoHome(iso){
  document.getElementById("data").value = iso;
  caricaGiornata(iso);
}

// ---- riepilogo degli interventi pianificati ----
// Periodo letto: dagli ultimi 30 giorni ai prossimi 7 (una richiesta) + il numero di rapportini in bozza.
// Conteggi (gli stati sono quelli del database, nessuno stato inventato):
//   Oggi / Prossimi 7 giorni: interventi non annullati con quella data
//   In corso: stato "in_corso"; Completati: stato "completato" (ultimi 30 giorni)
//   Rapportini mancanti: non annullati, data fino a oggi, stato del database diverso da "completato"
//     (cioe' almeno un operaio assegnato non ha ancora completato il proprio rapportino, o nessun assegnato)
//   Rapportini in bozza: rapportini con stato "bozza" (piu' quelli solo su questo telefono, se ci sono)
let giroRiepilogo = 0;
const PROSSIMI = 7;
export async function disegnaRiepilogoInterventi(){
  const n = ++giroRiepilogo;
  const el = id=>document.getElementById(id);
  const oggi = oggiIso();
  const d = new Date(oggi + "T12:00:00");
  d.setDate(d.getDate() - 30); const dal = isoDi(d);
  d.setDate(d.getDate() + 30 + PROSSIMI); const al = isoDi(d);
  const locali = (await bozzeLocali().catch(()=>[])).filter(v=>v.stato !== "inviato").length;
  el("ha-locali").classList.toggle("nascosto", !locali);
  el("ha-locali").textContent = locali ? locali + (locali === 1 ? " rapportino salvato" : " rapportini salvati") + " solo su questo telefono (da inviare)." : "";
  el("ha-stato").textContent = "Caricamento…"; el("ha-stato").className = "msg-info";
  let lista, bozze;
  try{
    await operaiAttivi().catch(()=>[]);
    [lista, bozze] = await Promise.all([interventiPeriodo(dal, al), contaRapportini({ stato: "bozza" })]);
  }catch(e){
    if(n !== giroRiepilogo) return;
    el("ha-stato").textContent = messaggioErrore(e); el("ha-stato").className = "msg-info err";
    ["ha-oggi-n", "ha-prossimi-n", "ha-incorso-n", "ha-completati-n", "ha-senza-n", "ha-bozze-n"].forEach(id=>{ el(id).textContent = "–"; });
    el("ha-oggi").innerHTML = ""; el("ha-prossimi").innerHTML = ""; el("ha-mancanti").innerHTML = "";
    return;
  }
  if(n !== giroRiepilogo) return;
  el("ha-stato").textContent = ""; el("ha-stato").className = "msg-info nascosto";
  const attivi = lista.filter(attivo);
  const diOggi = attivi.filter(i=>i.data === oggi);
  const prossimi = attivi.filter(i=>i.data > oggi && i.data <= al);
  el("ha-oggi-n").textContent = diOggi.length;
  el("ha-prossimi-n").textContent = prossimi.length;
  el("ha-incorso-n").textContent = lista.filter(i=>i.stato === "in_corso").length;
  el("ha-completati-n").textContent = lista.filter(i=>i.stato === "completato" && i.data <= oggi).length;
  const mancanti = attivi.filter(i=>i.data <= oggi && i.stato !== "completato");
  el("ha-senza-n").textContent = mancanti.length;
  el("ha-bozze-n").textContent = bozze;
  const ordina = (a, b)=>a.data.localeCompare(b.data) || String(a.ora || "").localeCompare(String(b.ora || ""));
  el("ha-oggi").innerHTML = diOggi.length ? elencoRighe(diOggi.sort(ordina), false) : '<div class="card nota">Nessun intervento in programma oggi.</div>';
  const primi = prossimi.sort(ordina).slice(0, 5);
  el("ha-prossimi").innerHTML = primi.length
    ? elencoRighe(primi, true) + (prossimi.length > primi.length
      ? '<button type="button" class="link-btn" style="margin:4px 2px" onclick="mostraVista(\'sett\')">Altri ' + (prossimi.length - primi.length) + ' nel calendario</button>' : '')
    : '<div class="card nota">Nessun intervento nei prossimi ' + PROSSIMI + ' giorni.</div>';
  // da sollecitare: giorni passati (fino a oggi) con rapportini mancanti, i piu' vecchi prima
  const daSollecitare = mancanti.filter(i=>i.data < oggi).sort(ordina);
  el("ha-mancanti").innerHTML = daSollecitare.length
    ? elencoRighe(daSollecitare.slice(0, 5), true) + (daSollecitare.length > 5
      ? '<button type="button" class="link-btn" style="margin:4px 2px" onclick="mostraVista(\'interventi\')">Altri ' + (daSollecitare.length - 5) + ' in Interventi</button>' : '')
    : '<div class="card nota">Nessun rapportino mancante nei giorni precedenti.</div>';
}

registraVista("home", ()=>{
  disegnaHome(); disegnaRiepilogoInterventi();
  // orari inseriti da un altro telefono: si rileggono e, se la Home e' ancora aperta, si ridisegna
  aggiornaOrari().then(()=>{ if(vistaCorrente === "home") disegnaOrarioHome(giornoHome()); });
});
// Un solo giorno scelto per tutta l'app: quello della Home. Calendario -> Giorno e "PDF della giornata"
// lo seguono; scegliendo un giorno nel Calendario cambia anche quello della Home.
let ultimoGiornoHome = "";
su("giornata-caricata", ()=>{
  const iso = giornoHome();
  if(iso !== ultimoGiornoHome){                    // solo quando il giorno cambia davvero (non a ogni sincronizzazione)
    ultimoGiornoHome = iso;
    const cg = document.getElementById("cg-data"), rg = document.getElementById("rg-data");
    if(cg) cg.value = iso;
    if(rg && rg.value !== iso){ rg.value = iso; emetti("giorno-pdf-cambiato"); }
  }
  if(vistaCorrente === "home") disegnaHome();
});
su("giorno-scelto", iso=>{ if(puo("vista.home") && iso && giornoHome() !== iso) apriGiornoHome(iso); });
su("firma-chiusa", ()=>{ if(vistaCorrente === "home") disegnaHome(); });
