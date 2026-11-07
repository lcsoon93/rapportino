// Home dell'operaio (e "Il mio lavoro" dell'admin): i miei interventi (oggi, prossimi giorni,
// da completare), rapportini da inviare, bozze, completati.
// I dati arrivano dalle tabelle interventi/rapportini: le policy RLS restituiscono solo quelli dell'utente.
// Lo stato dell'intervento e' quello restituito dal database (non ricalcolato qui).
import { profilo } from "../core/sessione.js";
import { registraVista, vistaCorrente } from "../core/navigation.js";
import { su } from "../core/eventi.js";
import { elencoCoda, eliminaBozzaMaiInviata, messaggioConnessione, riprova, sincronizzaCoda, verificaBackend } from "../services/sinc-rapportini.js";
import { elencoInterventi, elencoRapportini, minutiTra, operaiAttivi } from "../services/api-lavori.js";
import { dataIt, dataLunga, isoDi, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { PRIORITA, STATO_INTERVENTO, STATO_RAPPORTINO, oraBreve } from "./gestione-interventi.js";
import { giornoBreve } from "./agenda.js";

const $ = id=>document.getElementById(id);
const PESO = { urgente: 0, alta: 1, normale: 2, bassa: 3 };
function vuoto(testo){ return '<div class="card nota">' + testo + '</div>'; }

function voceIntervento(i, mioRapportino){
  let azione;
  if(i.stato === "annullato") azione = '<span class="nota" style="padding:0">Intervento annullato</span>';
  else if(!mioRapportino) azione = '<button type="button" class="btn btn-primario" onclick="rapportinoPerIntervento(\'' + i.id + '\')">' + icona("pen") + 'Compila rapportino</button>';
  else if(mioRapportino.stato === "bozza") azione = '<button type="button" class="btn btn-primario" onclick="apriRapportino(\'' + mioRapportino.id + '\')">' + icona("pen") + 'Riprendi bozza</button>';
  else azione = '<button type="button" class="btn btn-secondario" onclick="apriRapportino(\'' + mioRapportino.id + '\')">' + icona("check") + 'Rapportino completato</button>';
  const urgente = i.priorita === "urgente" || i.priorita === "alta";
  return '<article class="card intervento' + (i.priorita === "urgente" ? " urgente" : "") + '" data-intervento="' + i.id + '">' +
    '<div class="int-top">' +
      '<div class="int-ora">' + esc(dataIt(i.data).slice(0, 5)) + (i.ora ? '<small>' + esc(oraBreve(i.ora)) + '</small>' : '') + '</div>' +
      '<div class="int-corpo">' +
        '<div class="int-cliente">' + esc(i.cliente) + '</div>' +
        (i.descrizione ? '<div class="int-desc">' + esc(i.descrizione) + '</div>' : '') +
        '<div class="int-meta"><span>' + icona("cal", "i-sm") + esc(giornoBreve(i.data)) + (i.ora ? ' · ' + esc(oraBreve(i.ora)) : '') + '</span>' +
          (i.indirizzo ? '<span>' + icona("pin", "i-sm") + esc(i.indirizzo) + '</span>' : '') + '</div>' +
        '<div class="int-badge">' + (urgente ? PRIORITA[i.priorita] : '') + STATO_INTERVENTO[i.stato] + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="int-azioni">' + azione +
      '<button type="button" class="btn btn-secondario btn-dettagli" onclick="apriDettaglioIntervento(\'' + i.id + '\')">' + icona("info") + 'Dettagli</button>' +
    '</div>' +
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
  // rapportini rimasti sul telefono: visibili anche senza rete o con il server in errore
  disegnaDaInviare();
  let interventi, rapportini;
  try{
    await operaiAttivi().catch(()=>[]);
    [interventi, rapportini] = await Promise.all([
      elencoInterventi({ dal: isoDi(da), soloMiei: true }),
      elencoRapportini({ dal: isoDi(da), autore: profilo.id }),
    ]);
  }catch(e){
    $("lavoro-stato").textContent = e.message; $("lavoro-stato").className = "msg-info err";
    ["lavoro-interventi", "lavoro-bozze", "lavoro-completati"].forEach(id=>{ $(id).innerHTML = ""; });
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
  // i miei interventi: oggi (prima gli urgenti, poi per ora), prossimi giorni, giorni passati ancora da completare
  const oggi = oggiIso();
  const perOra = (a, b)=>a.data.localeCompare(b.data) || String(a.ora || "").localeCompare(String(b.ora || ""));
  const gruppi = [
    ["Oggi", aperti.filter(i=>i.data === oggi).sort((a, b)=>(PESO[a.priorita] - PESO[b.priorita]) || perOra(a, b)), "oggi"],
    ["Prossimi giorni", aperti.filter(i=>i.data > oggi).sort(perOra), "prossimi"],
    ["Da completare · giorni precedenti", aperti.filter(i=>i.data < oggi), "arretrati"],
  ].filter(g=>g[1].length);
  $("lavoro-interventi").innerHTML = gruppi.length ? gruppi.map(([titolo, lista, id])=>
    '<div class="gruppo-int" data-gruppo="' + id + '"><div class="gruppo-tit">' + titolo + ' (' + lista.length + ')</div>' +
    lista.map(i=>voceIntervento(i, mio(i.id))).join("") + '</div>').join("")
    : vuoto("Nessun intervento assegnato da fare. Per un lavoro non pianificato usa \"Nuovo rapportino\".");
  $("lavoro-bozze").innerHTML = bozze.length ? '<div class="card cli-elenco">' + bozze.map(r=>voceRapportino(r)).join("") + '</div>' : vuoto("Nessuna bozza.");
  const recenti = rapportini.filter(r=>r.stato === "completato").slice(0, 10);
  $("lavoro-completati").innerHTML = recenti.length ? '<div class="card cli-elenco">' + recenti.map(r=>voceRapportino(r)).join("") + '</div>' : vuoto("Nessun rapportino completato di recente.");
}

// ---------------------------------------------------------------- Da inviare (centro di controllo della sincronizzazione)
const STATI_CODA = {
  locale: ['neutro', "pen", "Sul telefono: dati incompleti"],
  in_attesa: ['att', "clock", "In attesa di invio"],
  in_sincronizzazione: ['pervinca', "upload", "Invio in corso…"],
  allegati_in_attesa: ['att', "image", "Foto in attesa"],
  conflitto: ['err', "alert", "Conflitto: serve una tua scelta"],
  errore: ['err', "alert", "Invio non riuscito"],
};
const oraBrevissima = iso=>iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
let disegnoCoda = 0;
export async function disegnaDaInviare(){
  const n = ++disegnoCoda;
  const { voci, conteggi, connessione } = await elencoCoda();
  if(n !== disegnoCoda) return;
  $("lavoro-locali-box").classList.toggle("nascosto", !voci.length);
  const punto = { online: "ok", offline: "err", server: "att", sessione: "err", sconosciuto: "neutro" }[connessione.stato] || "neutro";
  $("sinc-testa").innerHTML =
    '<div class="sinc-conn"><span class="sinc-punto ' + punto + '" aria-hidden="true"></span><b id="sinc-connessione" data-stato="' + connessione.stato + '">' +
      esc(messaggioConnessione(connessione.stato)) + '</b>' + (connessione.quando ? '<small>verificata ' + esc(oraBrevissima(connessione.quando)) + '</small>' : '') + '</div>' +
    '<div class="sinc-conti" id="sinc-conti">' +
      '<span data-c="attesa"><b>' + conteggi.attesa + '</b> in attesa</span>' +
      '<span data-c="inviati"><b>' + conteggi.inviati + '</b> inviati (24 h)</span>' +
      '<span data-c="conflitti"><b>' + conteggi.conflitti + '</b> conflitti</span>' +
      '<span data-c="falliti"><b>' + conteggi.falliti + '</b> non riusciti</span></div>';
  $("lavoro-locali").innerHTML = voci.map(v=>{
    const [cls, ic, testo] = STATI_CODA[v.stato] || STATI_CODA.in_attesa;
    const r = v.rapportino || {};
    const dettagli = [
      v.intervento ? "Intervento: " + v.intervento : (v.intervento_id ? "Intervento" : "Autonomo"),
      r.data ? dataIt(r.data) : "",
      v.completa ? "da completare all'invio" : "",
      v.salvato ? "già sul server" : "mai inviato",
    ].filter(Boolean).join(" · ");
    const azioni = [
      '<button type="button" class="btn btn-secondario" onclick="apriRapportino(\'' + v.id + '\')">' + icona(v.stato === "conflitto" ? "alert" : "pen") + (v.stato === "conflitto" ? "Vedi conflitto" : "Apri") + '</button>',
      v.stato !== "conflitto" && v.stato !== "locale" ? '<button type="button" class="btn btn-secondario" data-azione="riprova" onclick="riprovaInvio(\'' + v.id + '\')">' + icona("refresh") + 'Riprova</button>' : '',
      !v.salvato ? '<button type="button" class="btn btn-secondario" aria-label="Elimina bozza" data-azione="elimina" onclick="eliminaBozzaLocale(\'' + v.id + '\')">' + icona("trash") + '</button>' : '',
    ].join("");
    return '<article class="card coda-voce" data-id="' + v.id + '" data-stato="' + v.stato + '">' +
      '<div class="coda-top"><div class="cli-nome">' + esc(r.cliente || "(senza cliente)") + '</div>' +
        '<span class="badge ' + cls + '">' + icona(ic) + esc(testo) + '</span></div>' +
      '<div class="cli-ind">' + esc(dettagli) + '</div>' +
      (v.fotoInAttesa ? '<div class="cli-ind" data-foto="' + v.fotoInAttesa + '">' + icona("image", "i-sm") + ' ' + v.fotoInAttesa + ' foto da inviare</div>' : '') +
      (v.ultimoTentativo ? '<div class="cli-ind">Ultimo tentativo: ' + esc(oraBrevissima(v.ultimoTentativo)) +
        (v.prossimoTentativo && !["errore", "conflitto"].includes(v.stato) ? ' · prossimo: ' + esc(oraBrevissima(v.prossimoTentativo)) : '') + '</div>' : '') +
      (v.errore ? '<div class="coda-errore">' + esc(v.errore) + '</div>' : '') +
      '<div class="int-azioni">' + azioni + '</div>' +
    '</article>';
  }).join("");
}
export async function sincronizzaOra(){
  const b = $("sinc-ora");
  b.disabled = true;
  try{ await verificaBackend(); await sincronizzaCoda("manuale"); }finally{ b.disabled = false; }
  disegnaDaInviare();
}
export async function riprovaInvio(id){
  await riprova(id);
  disegnaDaInviare();
}
export async function eliminaBozzaLocale(id){
  if(!confirm("Eliminare questa bozza mai inviata (e le sue foto sul telefono)? Non si potrà recuperare.")) return;
  await eliminaBozzaMaiInviata(id);
  disegnaDaInviare();
}
// la coda cambia (invio, errore, connessione): si aggiorna solo questa sezione; a fine giro, se e'
// stato inviato qualcosa, anche le liste del server
let ritardo = null;
const ridisegna = ()=>{ clearTimeout(ritardo); ritardo = setTimeout(()=>{ if(vistaCorrente === "lavoro") disegnaDaInviare(); }, 150); };
su("coda-aggiornata", ridisegna);
su("connessione-cambiata", ridisegna);
su("coda-sincronizzata", r=>{ if(r && r.inviati && vistaCorrente === "lavoro") disegnaLavoro(); });

registraVista("lavoro", disegnaLavoro);
