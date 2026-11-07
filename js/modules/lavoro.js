// Dashboard dell'operaio (e "Il mio lavoro" dell'admin): interventi assegnati, bozze, completati.
// I dati arrivano dalle tabelle interventi/rapportini: le policy RLS restituiscono solo quelli dell'utente.
import { profilo } from "../core/sessione.js";
import { registraVista } from "../core/navigation.js";
import { elencoInterventi, elencoRapportini, minutiTra, operaiAttivi } from "../services/api-lavori.js";
import { dataIt, dataLunga, isoDi, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { PRIORITA, STATO_INTERVENTO, STATO_RAPPORTINO, oraBreve } from "./gestione-interventi.js";

const $ = id=>document.getElementById(id);
const PESO = { urgente: 0, alta: 1, normale: 2, bassa: 3 };
function vuoto(testo){ return '<div class="card nota">' + testo + '</div>'; }

function voceIntervento(i, mioRapportino){
  let azione;
  if(i.stato === "annullato") azione = '<span class="nota" style="padding:0">Intervento annullato</span>';
  else if(!mioRapportino) azione = '<button type="button" class="btn btn-primario" onclick="rapportinoPerIntervento(\'' + i.id + '\')">' + icona("pen") + 'Compila rapportino</button>';
  else if(mioRapportino.stato === "bozza") azione = '<button type="button" class="btn btn-primario" onclick="apriRapportino(\'' + mioRapportino.id + '\')">' + icona("pen") + 'Riprendi bozza</button>';
  else azione = '<button type="button" class="btn btn-secondario" onclick="apriRapportino(\'' + mioRapportino.id + '\')">' + icona("check") + 'Rapportino completato</button>';
  return '<article class="card intervento">' +
    '<div class="int-top">' +
      '<div class="int-ora">' + esc(dataIt(i.data).slice(0, 5)) + (i.ora ? '<small>' + esc(oraBreve(i.ora)) + '</small>' : '') + '</div>' +
      '<div class="int-corpo">' +
        '<div class="int-cliente">' + esc(i.cliente) + '</div>' +
        (i.descrizione ? '<div class="int-desc">' + esc(i.descrizione) + '</div>' : '') +
        (i.indirizzo ? '<div class="int-meta"><span>' + icona("pin", "i-sm") + esc(i.indirizzo) + '</span></div>' : '') +
        '<div class="int-badge">' + PRIORITA[i.priorita] + STATO_INTERVENTO[i.stato] + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="int-azioni">' + azione + '</div>' +
  '</article>';
}
export function voceRapportino(r, conAutore){
  const min = (r.rapportino_operai || []).reduce((a, o)=>a + minutiTra(o.dalle, o.alle), 0);
  return '<button type="button" class="cli-riga" onclick="apriRapportino(\'' + r.id + '\')">' +
    '<span class="avatar" aria-hidden="true">' + esc(dataIt(r.data).slice(0, 2)) + '</span>' +
    '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(r.cliente) + '</span>' +
    '<span class="cli-ind" style="display:block">' + esc(dataIt(r.data)) + ' · ' + oreTesto(min) +
      (r.intervento_id ? '' : ' · autonomo') + (conAutore ? ' · ' + esc(conAutore(r.autore_id)) : '') + '</span>' +
    '<span class="int-badge" style="margin-top:4px">' + STATO_RAPPORTINO[r.stato] + '</span></span>' +
    icona("chev-r", "chev") + '</button>';
}

export async function disegnaLavoro(){
  const ora = new Date().getHours();
  $("lavoro-saluto").textContent = (ora < 13 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera") + (profilo ? ", " + profilo.nome : "");
  $("lavoro-sub").textContent = dataLunga(oggiIso());
  $("lavoro-stato").textContent = "Caricamento…"; $("lavoro-stato").className = "msg-info";
  const da = new Date(oggiIso() + "T12:00:00"); da.setDate(da.getDate() - 60);
  let interventi, rapportini;
  try{
    await operaiAttivi().catch(()=>[]);
    [interventi, rapportini] = await Promise.all([
      elencoInterventi({ dal: isoDi(da), soloMiei: true }),
      elencoRapportini({ dal: isoDi(da), autore: profilo.id }),
    ]);
  }catch(e){
    $("lavoro-stato").textContent = e.message; $("lavoro-stato").className = "msg-info err";
    return;
  }
  $("lavoro-stato").textContent = "";
  const mio = id=>rapportini.find(r=>r.intervento_id === id);
  const aperti = interventi.filter(i=>{
    const r = mio(i.id);
    return !(r && r.stato === "completato") && i.stato !== "completato" && !(i.stato === "annullato" && !r);
  }).sort((a, b)=>(PESO[a.priorita] - PESO[b.priorita]) || a.data.localeCompare(b.data));
  const bozze = rapportini.filter(r=>r.stato === "bozza");
  const mese = oggiIso().slice(0, 7);
  const completatiMese = rapportini.filter(r=>r.stato === "completato" && r.data.startsWith(mese));
  const minMese = rapportini.filter(r=>r.data.startsWith(mese)).reduce((a, r)=>a +
    (r.rapportino_operai || []).filter(o=>o.operaio_id === profilo.id).reduce((b, o)=>b + minutiTra(o.dalle, o.alle), 0), 0);
  $("st-l-dafare").textContent = aperti.filter(i=>!mio(i.id)).length;
  $("st-l-bozze").textContent = bozze.length;
  $("st-l-completati").textContent = completatiMese.length;
  $("st-l-ore").textContent = oreTesto(minMese);
  $("lavoro-interventi").innerHTML = aperti.length ? aperti.map(i=>voceIntervento(i, mio(i.id))).join("")
    : vuoto("Nessun intervento assegnato da fare. Per un lavoro non pianificato usa \"Nuovo rapportino\".");
  $("lavoro-bozze").innerHTML = bozze.length ? '<div class="card cli-elenco">' + bozze.map(r=>voceRapportino(r)).join("") + '</div>' : vuoto("Nessuna bozza.");
  const recenti = rapportini.filter(r=>r.stato === "completato").slice(0, 10);
  $("lavoro-completati").innerHTML = recenti.length ? '<div class="card cli-elenco">' + recenti.map(r=>voceRapportino(r)).join("") + '</div>' : vuoto("Nessun rapportino completato di recente.");
}

registraVista("lavoro", disegnaLavoro);
