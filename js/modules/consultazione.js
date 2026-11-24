// Rapportini: elenco per mese dei rapportini degli operai (tabella "rapportini": l'operaio vede i
// propri, admin e company tutti) e, sotto, le giornate del foglio giornaliero (storico, admin/company).
import { leggiDB, leggiMappa } from "../core/storage.js";
import { registraVista, vistaCorrente } from "../core/navigation.js";
import { su } from "../core/eventi.js";
import { caricaGiornata } from "./rapportini.js";
import { schedaCompilata, statoScheda } from "../services/stato-schede.js";
import { inviaPDF } from "../services/condivisione.js";
import { sincronizza } from "../services/sync.js";
import { dataLunga, giorniMese, oggiIso } from "../utils/dates.js";
import { esc } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { puo } from "../core/permessi.js";
import { elencoRapportini, nomeOperaio, operaiAttivi } from "../services/api-lavori.js";
import { voceRapportino } from "./lavoro.js";
import { inizializzaPDFGiornata } from "./stampa-giornata.js";
import { inizializzaPDFMese } from "./stampa-mese.js";

const $ = id=>document.getElementById(id);
const BADGE = {
  firmata: '<span class="badge ok">' + icona("check") + 'Firmato</span>',
  compilata: '<span class="badge att">' + icona("clock") + 'Da firmare</span>',
  dafare: '<span class="badge neutro">' + icona("file") + 'Da compilare</span>',
};

// periodo dell'elenco: il giorno scelto ("Solo il giorno") oppure tutto il mese. Date locali "AAAA-MM-GG",
// estremi inclusi, nessuna conversione UTC.
function periodo(){
  const giorno = $("rap-giorno").value;
  if(giorno && giorno.slice(0, 7) !== $("rap-mese").value) $("rap-giorno").value = "";   // mese cambiato: tutto il mese
  const g = $("rap-giorno").value;
  if(g) return { dal: g, al: g, giorni: [g], giorno: g };
  const giorni = giorniMese($("rap-mese").value);
  return { dal: giorni[0], al: giorni[giorni.length - 1], giorni, giorno: null };
}
// un giorno scelto (qui o nel PDF della giornata): l'elenco mostra solo quel giorno; "" = tutto il mese
export function filtraGiornoRapporti(iso){
  $("rap-giorno").value = iso || "";
  if(iso) $("rap-mese").value = iso.slice(0, 7);
  disegnaRapporti();
}
export function disegnaRapporti(){
  if(!$("rap-mese").value) $("rap-mese").value = oggiIso().slice(0, 7);
  $("rap-giorno-tutti").classList.toggle("nascosto", !$("rap-giorno").value);
  disegnaRapportiniOperai();
  if(puo("giornate.consulta")) disegnaGiornate();
}
let richiesta = 0;     // solo l'ultima lettura aggiorna l'elenco (filtri cambiati mentre si caricava)
async function disegnaRapportiniOperai(){
  const p = periodo(), n = ++richiesta;
  $("rap-nuovi").innerHTML = '<div class="card nota">Caricamento…</div>';
  try{
    const operai = await operaiAttivi().catch(()=>[]);
    const filtro = $("rap-filtro-operaio");
    if(filtro.options.length <= 1) operai.forEach(o=>filtro.insertAdjacentHTML("beforeend", '<option value="' + o.id + '">' + esc(o.nome || o.username) + '</option>'));
    const stato = $("rap-filtro-stato").value || null, autore = puo("rapportini.consulta") ? ($("rap-filtro-operaio").value || null) : null;
    const letti = await elencoRapportini({ dal: p.dal, al: p.al, stato, autore });
    if(n !== richiesta) return;
    // stessi filtri anche sui dati ricevuti: mai rapportini di altri giorni, stati o operai
    const elenco = letti.filter(r=>r.data >= p.dal && r.data <= p.al && (!stato || r.stato === stato) && (!autore || r.autore_id === autore));
    $("rap-nuovi").innerHTML = elenco.length
      ? '<div class="card cli-elenco">' + elenco.map(r=>voceRapportino(r, puo("rapportini.consulta") ? nomeOperaio : null)).join("") + '</div>'
      : '<div class="card nota">' + (p.giorno ? "Nessun rapportino il " + esc(dataLunga(p.giorno).toLowerCase()) + "." : "Nessun rapportino in questo mese.") + '</div>';
  }catch(e){
    if(n === richiesta) $("rap-nuovi").innerHTML = '<div class="card nota">' + esc(e.message) + '</div>';
  }
}
function disegnaGiornate(){
  const db = leggiDB(), ass = leggiMappa("assegnazioni");
  const giorni = periodo().giorni.filter(g=>db[g]).reverse();
  $("rap-elenco").innerHTML = giorni.length ? giorni.map(g=>{
    const clienti = db[g].clienti || [];
    const conPdf = clienti.some(schedaCompilata);
    return '<article class="card giorno-rap">' +
      '<div class="gr-top"><span class="rg-data">' + g.slice(8) + '/' + g.slice(5, 7) + '</span>' +
      '<b style="flex:1;min-width:0">' + esc(dataLunga(g)) + '</b>' +
      (conPdf ? '<button type="button" class="btn btn-secondario" style="min-height:40px;padding:6px 12px" onclick="pdfRapporto(this,\'' + g + '\')">' + icona("file") + '<span>PDF</span></button>' : '') +
      '</div>' +
      '<div class="int-meta">' + (db[g].tecnici ? '<span>' + icona("users", "i-sm") + esc(db[g].tecnici) + '</span>' : '') +
        '<span>' + (ass[g] && ass[g].length ? ass[g].length + (ass[g].length === 1 ? " operaio assegnato" : " operai assegnati") : "nessuna assegnazione") + '</span></div>' +
      '<div class="gr-clienti">' + (clienti.length ? clienti.map(c=>
        '<div class="gr-cliente"><b>' + esc(c.nome || "(senza nome)") + '</b>' + BADGE[statoScheda(c)] + '</div>').join("") : '<span class="nota" style="padding:0">Nessuna scheda</span>') + '</div>' +
    '</article>';
  }).join("") : '<div class="card nota">Nessuna giornata in questo mese.</div>';
}
export function spostaMeseRapporti(delta){
  const [a, m] = ($("rap-mese").value || oggiIso().slice(0, 7)).split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  $("rap-mese").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  disegnaRapporti();
}
// il PDF si genera dalla giornata caricata nel modulo (nascosto): stessa impaginazione di sempre
export function pdfRapporto(btn, giorno){
  document.getElementById("data").value = giorno;
  caricaGiornata(giorno);
  inviaPDF(btn);
}

registraVista("rapporti", ()=>{ inizializzaPDFGiornata(); inizializzaPDFMese(); disegnaRapporti(); if(puo("giornate.consulta")) sincronizza(true); });
su("uscita", ()=>{ $("rap-giorno").value = ""; });
su("sincronizzato", ()=>{ if(vistaCorrente === "rapporti" && puo("giornate.consulta")) disegnaGiornate(); });
