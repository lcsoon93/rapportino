// Home (admin): riepilogo degli interventi pianificati (tabella interventi) e lavori del giorno scelto
// (interventi e rapportini). Le funzioni sulle schede del foglio giornaliero (vecchia app) restano per la
// vista "giorno".
import { dataIt, dataLunga, isoDi, oggiIso } from "../utils/dates.js";
import { minutiSulPosto } from "../services/calculations.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { leggiDB } from "../core/storage.js";
import { mostraVista, registraVista, vistaCorrente } from "../core/navigation.js";
import { icona } from "../utils/dom.js";
import { aggiornaTestiData, caricaGiornata, datiGiornata, salvaGiornata } from "./rapportini.js";
import { aggiungiCliente, elencoClienti } from "./interventi.js";
import { apriFirmaOverlay } from "../services/signature.js";
import { aggiornaSelectSpese } from "./spese.js";
import { su } from "../core/eventi.js";
import { contaRapportini, interventiPeriodo, operaiAttivi } from "../services/api-lavori.js";
import { attivo, contaEseguiti, contaLavori, elencoRighe, htmlLavoriGiorno, lavoriDelGiorno, messaggioErrore } from "./agenda.js";
import { bozzeLocali } from "./modulo-rapportino.js";

// ---- home ----
export function fasceTesto(c){
  const fasce = c.fasce && c.fasce.length ? c.fasce : ((c.dalle || c.alle) ? [{d: c.dalle, a: c.alle}] : []);
  return fasce.filter(f=>f.d || f.a);
}
// Home: lavori del giorno scelto (interventi programmati e rapportini senza intervento), non piu' il
// foglio giornaliero della vecchia app. "Ore di lavoro" = ore della giornata: dal primo inizio
// all'ultima fine degli orari segnati nei rapportini del giorno (unione degli intervalli, non la somma).
let giroHome = 0;
export async function disegnaHome(){
  const ora = new Date().getHours();
  document.getElementById("home-saluto").textContent = ora < 13 ? "Buongiorno" : (ora < 18 ? "Buon pomeriggio" : "Buonasera");
  document.getElementById("home-oggi").textContent = dataLunga(oggiIso());
  aggiornaTestiData();
  const iso = document.getElementById("data").value || oggiIso();
  document.getElementById("home-riep-data").textContent = dataIt(iso);
  document.getElementById("home-int-titolo").textContent = iso === oggiIso() ? "Lavori di oggi" : "Lavori del " + dataIt(iso);
  const cont = document.getElementById("home-interventi");
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
  // orari dei rapportini del giorno e, se quel giorno ha schede, quelli degli operai del foglio giornaliero
  const intervalli = g.rapportini.flatMap(r=>(r.rapportino_operai || []).map(o=>({ dalle: String(o.dalle || "").slice(0, 5), alle: String(o.alle || "").slice(0, 5) })))
    .concat(g.foglio.schede.length ? g.foglio.operai.map(o=>({ dalle: String(o.dalle || "").slice(0, 5), alle: String(o.alle || "").slice(0, 5) })) : [])
    .filter(o=>o.dalle && o.alle);
  document.getElementById("st-interventi").textContent = contaLavori(g);
  document.getElementById("st-ore").textContent = oreTesto(intervalli.length ? minutiSulPosto(intervalli) : 0);
  document.getElementById("st-firmati").textContent = contaEseguiti(g);
  document.getElementById("st-dafirmare").textContent = g.daEseguire.length;
  cont.innerHTML = htmlLavoriGiorno(g, iso);
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

registraVista("home", ()=>{ disegnaHome(); disegnaRiepilogoInterventi(); });
su("giornata-caricata", ()=>{ if(vistaCorrente === "home") disegnaHome(); });
su("firma-chiusa", ()=>{ if(vistaCorrente === "home") disegnaHome(); });
