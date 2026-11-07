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

const $ = id=>document.getElementById(id);
const BADGE = {
  firmata: '<span class="badge ok">' + icona("check") + 'Firmato</span>',
  compilata: '<span class="badge att">' + icona("clock") + 'Da firmare</span>',
  dafare: '<span class="badge neutro">' + icona("file") + 'Da compilare</span>',
};

export function disegnaRapporti(){
  if(!$("rap-mese").value) $("rap-mese").value = oggiIso().slice(0, 7);
  disegnaRapportiniOperai();
  if(puo("giornate.consulta")) disegnaGiornate();
}
async function disegnaRapportiniOperai(){
  const mese = $("rap-mese").value, giorni = giorniMese(mese);
  $("rap-nuovi").innerHTML = '<div class="card nota">Caricamento…</div>';
  try{
    const operai = await operaiAttivi().catch(()=>[]);
    const filtro = $("rap-filtro-operaio");
    if(filtro.options.length <= 1) operai.forEach(o=>filtro.insertAdjacentHTML("beforeend", '<option value="' + o.id + '">' + esc(o.nome || o.username) + '</option>'));
    const elenco = await elencoRapportini({ dal: giorni[0], al: giorni[giorni.length - 1],
      stato: $("rap-filtro-stato").value || null, autore: puo("rapportini.consulta") ? ($("rap-filtro-operaio").value || null) : null });
    $("rap-nuovi").innerHTML = elenco.length
      ? '<div class="card cli-elenco">' + elenco.map(r=>voceRapportino(r, puo("rapportini.consulta") ? nomeOperaio : null)).join("") + '</div>'
      : '<div class="card nota">Nessun rapportino in questo mese.</div>';
  }catch(e){
    $("rap-nuovi").innerHTML = '<div class="card nota">' + esc(e.message) + '</div>';
  }
}
function disegnaGiornate(){
  const db = leggiDB(), ass = leggiMappa("assegnazioni");
  const giorni = giorniMese($("rap-mese").value).filter(g=>db[g]).reverse();
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

registraVista("rapporti", ()=>{ disegnaRapporti(); if(puo("giornate.consulta")) sincronizza(true); });
su("sincronizzato", ()=>{ if(vistaCorrente === "rapporti" && puo("giornate.consulta")) disegnaGiornate(); });
