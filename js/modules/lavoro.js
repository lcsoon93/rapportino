// Dashboard dell'operaio: interventi delle giornate a cui e' assegnato (dati sincronizzati dal server).
import { leggiDB, leggiMappa } from "../core/storage.js";
import { profilo } from "../core/sessione.js";
import { registraVista, vistaCorrente } from "../core/navigation.js";
import { su } from "../core/eventi.js";
import { apriGiorno } from "./rapportini.js";
import { evidenziaScheda, schedaCliente } from "./dashboard.js";
import { statoScheda } from "../services/stato-schede.js";
import { dataIt, dataLunga, oggiIso } from "../utils/dates.js";
import { esc } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";

const $ = id=>document.getElementById(id);
const BADGE = {
  firmata: '<span class="badge ok">' + icona("check") + 'Firmato</span>',
  compilata: '<span class="badge att">' + icona("clock") + 'In lavorazione</span>',
  dafare: '<span class="badge neutro">' + icona("file") + 'Da fare</span>',
};

// giornate assegnate all'utente collegato
function mieGiornate(){
  const db = leggiDB(), ass = leggiMappa("assegnazioni");
  return Object.keys(ass).filter(iso=>profilo && ass[iso].includes(profilo.id) && db[iso]).sort();
}
function voce(iso, c){
  const fascia = (c.fasce || []).find(f=>f.d || f.a);
  const desc = c.richiesta || (c.dettagli || "").split("\n")[0];
  return '<article class="card intervento">' +
    '<div class="int-top">' +
      '<div class="int-ora">' + esc(dataIt(iso).slice(0,5)) + (fascia ? '<small>' + esc(fascia.d || fascia.a) + '</small>' : '') + '</div>' +
      '<div class="int-corpo">' +
        '<div class="int-cliente">' + esc(c.nome || "(senza nome)") + '</div>' +
        (desc ? '<div class="int-desc">' + esc(desc) + '</div>' : '') +
        (c.indirizzo ? '<div class="int-meta"><span>' + icona("pin", "i-sm") + esc(c.indirizzo) + '</span></div>' : '') +
        '<div class="int-badge">' + BADGE[statoScheda(c)] + (c.urgente ? '<span class="badge err">' + icona("zap") + 'Urgenza</span>' : '') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="int-azioni"><button type="button" class="btn ' + (statoScheda(c) === "firmata" ? "btn-secondario" : "btn-primario") +
      '" onclick="apriSchedaLavoro(\'' + iso + '\',\'' + esc(c.id || "") + '\')">' + icona("file") + 'Apri</button></div>' +
  '</article>';
}
function vuoto(testo){ return '<div class="card nota">' + testo + '</div>'; }

export function disegnaLavoro(){
  const db = leggiDB(), oggi = oggiIso();
  const ora = new Date().getHours();
  $("lavoro-saluto").textContent = (ora < 13 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera") + (profilo ? ", " + profilo.nome : "");
  $("lavoro-sub").textContent = dataLunga(oggi);
  const giornate = mieGiornate();
  const dafare = [], incorso = [], completati = [];
  giornate.forEach(iso=>{
    (db[iso].clienti || []).forEach(c=>{
      const s = statoScheda(c);
      if(s === "dafare") dafare.push([iso, c]);
      else if(s === "compilata") incorso.push([iso, c]);
      else completati.push([iso, c]);
    });
  });
  $("st-l-dafare").textContent = dafare.length;
  $("st-l-incorso").textContent = incorso.length;
  $("st-l-completati").textContent = completati.length;
  $("st-l-giornate").textContent = giornate.filter(iso=>iso >= oggi).length;
  $("lavoro-assegnati").innerHTML = dafare.length ? dafare.map(x=>voce(...x)).join("") : vuoto("Nessun intervento da fare. Quando ti assegnano una giornata la trovi qui.");
  $("lavoro-incorso").innerHTML = incorso.length ? incorso.map(x=>voce(...x)).join("") : vuoto("Nessun rapportino in lavorazione.");
  const recenti = completati.reverse().slice(0, 10);
  $("lavoro-completati").innerHTML = recenti.length ? recenti.map(x=>voce(...x)).join("") : vuoto("Nessun rapportino firmato.");
  const storico = giornate.filter(iso=>iso < oggi).reverse().slice(0, 30);
  $("lavoro-storico").innerHTML = storico.length
    ? '<div class="card cli-elenco">' + storico.map(iso=>
        '<button type="button" class="cli-riga" onclick="apriGiorno(\'' + iso + '\')">' +
        '<span class="avatar" aria-hidden="true">' + iso.slice(8) + '</span>' +
        '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(dataLunga(iso)) + '</span>' +
        '<span class="cli-ind" style="display:block">' + esc((db[iso].clienti || []).map(c=>c.nome).join(", ") || "—") + '</span></span>' +
        icona("chev-r", "chev") + '</button>').join("") + '</div>'
    : vuoto("Nessuna giornata passata.");
}
export function apriSchedaLavoro(iso, id){
  apriGiorno(iso);
  evidenziaScheda(schedaCliente(id), false);
}

registraVista("lavoro", disegnaLavoro);
su("sincronizzato", ()=>{ if(vistaCorrente === "lavoro") disegnaLavoro(); });
