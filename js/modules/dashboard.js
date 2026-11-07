// Home: riepilogo della giornata, elenco interventi, nuovo rapportino.
import { dataIt, dataLunga, oggiIso } from "../utils/dates.js";
import { minutiOperaio } from "../services/calculations.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { leggiDB } from "../core/storage.js";
import { mostraVista, registraVista, vistaCorrente } from "../core/navigation.js";
import { icona } from "../utils/dom.js";
import { aggiornaTestiData, caricaGiornata, datiGiornata, salvaGiornata } from "./rapportini.js";
import { aggiungiCliente, elencoClienti } from "./interventi.js";
import { apriFirmaOverlay } from "../services/signature.js";
import { aggiornaSelectSpese } from "./spese.js";
import { su } from "../core/eventi.js";

// ---- home ----
export function fasceTesto(c){
  const fasce = c.fasce && c.fasce.length ? c.fasce : ((c.dalle || c.alle) ? [{d: c.dalle, a: c.alle}] : []);
  return fasce.filter(f=>f.d || f.a);
}
export function disegnaHome(){
  const ora = new Date().getHours();
  document.getElementById("home-saluto").textContent = ora < 13 ? "Buongiorno" : (ora < 18 ? "Buon pomeriggio" : "Buonasera");
  document.getElementById("home-oggi").textContent = dataLunga(oggiIso());
  aggiornaTestiData();
  const iso = document.getElementById("data").value;
  const d = datiGiornata();                  // dal modulo: comprende anche le modifiche non ancora salvate
  // una giornata nuova ha gli operai precompilati: le ore contano solo se c'e' qualcosa di registrato
  const registrata = !!leggiDB()[iso] || d.clienti.length > 0;
  const clienti = d.clienti;
  const firmati = clienti.filter(c=>c.firma).length;
  const minuti = registrata ? d.operai.reduce((a,op)=>a + minutiOperaio(op), 0) : 0;
  document.getElementById("st-interventi").textContent = clienti.length;
  document.getElementById("st-ore").textContent = oreTesto(minuti);
  document.getElementById("st-firmati").textContent = firmati;
  document.getElementById("st-dafirmare").textContent = clienti.length - firmati;
  document.getElementById("home-riep-data").textContent = dataIt(iso);
  document.getElementById("home-int-titolo").textContent = iso === oggiIso() ? "Interventi di oggi" : "Interventi del " + dataIt(iso);

  const cont = document.getElementById("home-interventi");
  if(!clienti.length){
    cont.innerHTML =
      '<div class="card vuoto">' +
        '<div class="v-icona">' + icona("file", "i-lg") + '</div>' +
        '<h3>Nessun intervento registrato</h3>' +
        '<p>' + (iso === oggiIso() ? "Oggi non c'è ancora nessun rapportino." : "Nessun rapportino per il " + dataIt(iso) + ".") + '</p>' +
        '<button type="button" class="btn btn-primario" onclick="nuovoRapportino()">' + icona("plus") + 'Crea il primo rapportino</button>' +
      '</div>';
    return;
  }
  cont.innerHTML = clienti.map(c=>{
    const fasce = fasceTesto(c);
    const prima = fasce[0];
    const oraHtml = prima
      ? '<div class="int-ora">' + esc(prima.d || prima.a) + (prima.d && prima.a ? '<small>' + esc(prima.a) + '</small>' : '') + '</div>'
      : '<div class="int-ora vuota">' + icona("clock") + '</div>';
    const desc = (c.dettagli || "").split("\n").find(r=>r.trim()) || "";
    const badge = [];
    badge.push(c.firma
      ? '<span class="badge ok">' + icona("check") + 'Firmato</span>'
      : '<span class="badge att">' + icona("pen") + 'Da firmare</span>');
    if(c.stato === "Da ultimare") badge.push('<span class="badge neutro">' + icona("clock") + 'Da ultimare</span>');
    if(c.urgente) badge.push('<span class="badge err">' + icona("zap") + 'Urgenza</span>');
    if(c.tipologia) badge.push('<span class="badge pervinca">' + esc(c.tipologia) + '</span>');
    const meta = [];
    if(fasce.length > 1) meta.push('<span>' + icona("clock", "i-sm") + esc(fasce.map(f=>(f.d || "…") + "–" + (f.a || "…")).join(" / ")) + '</span>');
    if(c.indirizzo) meta.push('<span>' + icona("pin", "i-sm") + esc(c.indirizzo) + '</span>');
    if(d.tecnici) meta.push('<span>' + icona("user", "i-sm") + esc(d.tecnici) + '</span>');
    return '<article class="card intervento">' +
      '<div class="int-top">' + oraHtml +
        '<div class="int-corpo">' +
          '<div class="int-cliente">' + esc(c.nome) + '</div>' +
          (desc ? '<div class="int-desc">' + esc(desc) + '</div>' : '') +
          (meta.length ? '<div class="int-meta">' + meta.join("") + '</div>' : '') +
          '<div class="int-badge">' + badge.join("") + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="int-azioni">' +
        '<button type="button" class="btn btn-secondario" onclick="apriIntervento(\'' + esc(c.id) + '\')">' + icona("file") + 'Apri</button>' +
        (c.firma ? '' : '<button type="button" class="btn btn-primario" onclick="firmaIntervento(\'' + esc(c.id) + '\')">' + icona("pen") + 'Fai firmare</button>') +
      '</div>' +
    '</article>';
  }).join("");
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

registraVista("home", disegnaHome);
su("giornata-caricata", ()=>{ if(vistaCorrente === "home") disegnaHome(); });
su("firma-chiusa", ()=>{ if(vistaCorrente === "home") disegnaHome(); });
