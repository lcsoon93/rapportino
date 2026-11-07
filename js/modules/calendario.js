// Calendario: viste giorno (in agenda.js), settimana e mese; griglia del mese, eliminazione giorni.
// In ogni vista ci sono gli interventi (tabella "interventi", filtrati dalle policy RLS);
// il report delle giornate (ore, saldi, firme) resta solo a chi ha il permesso "report" (admin).
import { dataIt, giorniMese, isoDi, oggiIso } from "../utils/dates.js";
import { ORARIO_ORDINARIO } from "../services/calculations.js";
import { confrontoAttivo, datiMese, datiSettimana, monteOreMese, oreMeseTesto } from "./report.js";
import { esc, euro, oreTesto, saldoTesto } from "../utils/formatters.js";
import { leggiDB, scriviDB } from "../core/storage.js";
import { cancellaGiornoRemoto } from "../services/sync.js";
import { registraVista, vistaCorrente } from "../core/navigation.js";
import { icona } from "../utils/dom.js";
import { caricaGiornata } from "./rapportini.js";
import { su } from "../core/eventi.js";
import { puo } from "../core/permessi.js";
import { conteggiMese, disegnaInterventiSettimana, messaggioErrore, riepilogoMese } from "./agenda.js";

export function spostaSettimana(delta){
  const el = document.getElementById("settdata");
  const d = new Date((el.value || oggiIso()) + "T12:00:00");
  d.setDate(d.getDate() + 7 * delta);
  el.value = isoDi(d);
  disegnaSettimana();
}
export function spostaMese(delta){
  const el = document.getElementById("mesedata");
  const [a, m] = (el.value || oggiIso().slice(0,7)).split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  el.value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  disegnaMese();
}
export function disegnaSettimana(){
  if(!document.getElementById("settdata").value){
    document.getElementById("settdata").value = oggiIso();
  }
  disegnaInterventiSettimana(document.getElementById("settdata").value);
  if(puo("report")) disegnaReportSettimana();
}
function disegnaReportSettimana(){
  const s = datiSettimana();
  document.getElementById("sett-titolo").textContent = "Settimana " + s.dal.slice(0,5) + " – " + s.al;
  const cont = document.getElementById("settelenco");
  cont.innerHTML = "";
  s.righe.forEach(r=>{
    const div = document.createElement("div");
    div.className = "giorno";
    if(r.dati){
      const opTesto = r.operai.length ? r.operai.map(o=>o.nome + " " + oreTesto(o.minuti)).join(" · ") : "—";
      div.innerHTML =
        '<span class="gnome">' + r.nome + '</span>' +
        '<div class="ginfo apri" role="button" tabindex="0" onclick="apriGiorno(\'' + r.iso + '\')">' +
        '<div>' + dataIt(r.iso) + (r.escluso ? '<span class="escl">ESCLUSA</span>' : '') + '</div>' +
        '<div class="gclienti">' + esc(opTesto) + '</div>' +
        (r.clienti ? '<div class="gclienti cli">' + esc(r.clienti) + '</div>' : '') + '</div>' +
        '<span class="gore">' + oreTesto(r.totGiorno) + '</span>' +
        '<button type="button" class="gdel" data-permesso="rapportino.elimina" aria-label="Elimina giorno" onclick="eliminaGiorno(\'' + r.iso + '\')">&times;</button>';
    } else {
      div.innerHTML =
        '<span class="gnome">' + r.nome + '</span>' +
        '<div class="ginfo gvuoto apri" role="button" tabindex="0" onclick="apriGiorno(\'' + r.iso + '\')">' + dataIt(r.iso) + ' — nessun rapporto</div>' +
        '<span class="gore gvuoto">—</span>';
    }
    cont.appendChild(div);
  });

  let html = '<div class="saldo"><span>Giorni lavorati</span><b>' + s.giorniLavorati + '</b></div>';
  if(s.giorniLavorati - s.giorniConteggiati > 0){
    html += '<div class="saldo"><span>di cui escluse dal monte ore</span><b>' + (s.giorniLavorati - s.giorniConteggiati) + '</b></div>';
  }
  Object.keys(s.operaiTotali).sort().forEach(n=>{
    const info = s.operaiTotali[n];
    const saldo = info.minuti - (info.giorni * ORARIO_ORDINARIO);
    html += '<div class="saldo"><span>' + n + ' (' + info.giorni + ' g.)</span><b>' + oreTesto(info.minuti) + (saldo ? "  " + saldoTesto(saldo) : "") + '</b></div>';
  });
  document.getElementById("giornilav").innerHTML = html;
  document.getElementById("monteore").textContent = oreTesto(s.totGenerale);
}
export function eliminaGiorno(iso){
  if(!confirm("Eliminare il rapporto del " + dataIt(iso) + "?")) return;
  const db = leggiDB();
  delete db[iso];
  scriviDB(db);
  cancellaGiornoRemoto(iso);
  disegnaSettimana();
  if(document.getElementById("data").value === iso) caricaGiornata(iso);
}
export function disegnaMese(){
  if(!document.getElementById("mesedata").value){
    document.getElementById("mesedata").value = oggiIso().slice(0,7);
  }
  disegnaGrigliaMese(null);
  disegnaInterventiMese();
  if(puo("report")) disegnaReportMese();
}
// interventi del mese: numero per giorno nella griglia e giorno piu' carico
async function disegnaInterventiMese(){
  const mese = document.getElementById("mesedata").value;
  const msg = document.getElementById("mese-int-stato"), riep = document.getElementById("mese-int-riepilogo");
  riep.textContent = "";
  try{
    const c = await conteggiMese(mese);
    if(document.getElementById("mesedata").value !== mese) return;
    msg.classList.add("nascosto");
    disegnaGrigliaMese(c.conta);
    riep.textContent = riepilogoMese(c);
  }catch(e){
    if(document.getElementById("mesedata").value !== mese) return;
    msg.textContent = messaggioErrore(e); msg.className = "msg-info err";
  }
}
function disegnaReportMese(){
  const s = datiMese();
  document.getElementById("mese-titolo").textContent = "Report " + s.etichetta;
  const cont = document.getElementById("meseelenco");
  cont.innerHTML = "";
  if(s.righe.length === 0){
    cont.innerHTML = '<div class="giorno"><div class="ginfo gvuoto">Nessun rapporto in questo mese</div></div>';
  }
  s.righe.forEach(r=>{
    const div = document.createElement("div");
    div.className = "giorno";
    const opTesto = r.operai.length ? r.operai.map(o=>o.nome + " " + oreTesto(o.minuti)).join(" · ") : "—";
    div.innerHTML =
      '<span class="gnome">' + r.nome + '</span>' +
      '<div class="ginfo apri" role="button" tabindex="0" onclick="apriGiorno(\'' + r.iso + '\')"><div>' + dataIt(r.iso) +
      (r.escluso ? '<span class="escl">ESCLUSA</span>' : '') + '</div>' +
      '<div class="gclienti">' + esc(opTesto) + '</div>' +
      (r.clienti ? '<div class="gclienti cli">' + esc(r.clienti) + '</div>' : '') +
      '</div>' +
      '<span class="gore">' + oreTesto(r.totGiorno) + '</span>' +
      '<button type="button" class="gdel" data-permesso="rapportino.elimina" aria-label="Elimina giorno" onclick="eliminaGiornoMese(\'' + r.iso + '\')">&times;</button>';
    cont.appendChild(div);
  });

  let html = '<div class="saldo"><span>Giorni lavorati</span><b>' + s.giorniLavorati + '</b></div>';
  if(s.giorniLavorati - s.giorniConteggiati > 0){
    html += '<div class="saldo"><span>di cui escluse dal monte ore</span><b>' + (s.giorniLavorati - s.giorniConteggiati) + '</b></div>';
  }
  if(confrontoAttivo()) html += '<div class="saldo"><span>Monte ore del mese (' + monteOreMese().giorni + ' g. x 9 ore)</span><b>' + oreTesto(monteOreMese().minuti) + '</b></div>';
  Object.keys(s.operaiTotali).sort().forEach(n=>{
    const info = s.operaiTotali[n];
    html += '<div class="saldo"><span>' + n + ' (' + info.giorni + ' g.)</span><b>' + oreMeseTesto(info) + '</b></div>';
    if(confrontoAttivo()){
      const dd = info.minuti - monteOreMese().minuti;
      html += '<div class="saldo"><span>&nbsp;&nbsp;↳ ' + n + ' vs monte ore</span><b>' + (dd === 0 ? "pari" : saldoTesto(dd)) + '</b></div>';
    }
  });
  if(s.totSpese) html += '<div class="saldo"><span>Spese anticipate</span><b>' + euro(s.totSpese) + '</b></div>';
  document.getElementById("mesericap").innerHTML = html;
}
// calendario del mese: numero = interventi in programma quel giorno (piu' marcato se sono molti);
// per chi vede il report delle giornate anche: verde = tutte le schede firmate, arancione = qualche
// scheda da firmare, grigio = giorno feriale passato senza rapporto (anche con icona, non solo colore).
// Toccando un giorno si aprono i suoi interventi (da li' l'admin apre anche il foglio giornaliero).
const MOLTI = 4;
let ultimi = { mese: "", conta: null };   // ultimi conteggi: ridisegnando la griglia non spariscono
export function disegnaGrigliaMese(conteggi){
  const report = puo("report");
  const meseG = document.getElementById("mesedata").value;
  if(conteggi) ultimi = { mese: meseG, conta: conteggi };
  else if(ultimi.mese === meseG) conteggi = ultimi.conta;
  const mese = document.getElementById("mesedata").value;
  const db = leggiDB();
  const giorni = giorniMese(mese);
  const sel = document.getElementById("data").value;
  const oggi = oggiIso();
  const primo = (new Date(giorni[0] + "T12:00:00").getDay() + 6) % 7;
  let html = "";
  for(let i = 0; i < primo; i++) html += '<span class="cal-g fuori" aria-hidden="true"></span>';
  giorni.forEach(g=>{
    const d = db[g];
    const w = new Date(g + "T12:00:00").getDay();
    const weekend = w === 0 || w === 6;
    let stato = "", icn = "", testo = report ? "nessun rapporto" : "";
    if(!report){ /* solo interventi */ }
    else if(d){
      const cl = (d.clienti || []).filter(c=>c.nome || c.firma);
      const daFirmare = cl.filter(c=>!c.firma).length;
      if(daFirmare){ stato = "dafirmare"; icn = icona("pen"); testo = daFirmare + " da firmare"; }
      else { stato = "completo"; icn = icona("check"); testo = cl.length ? "tutto firmato" : "compilato"; }
    } else if(!weekend && g < oggi){
      stato = "mancante"; icn = icona("minus"); testo = "rapporto mancante";
    }
    const n = conteggi ? conteggi[g] || 0 : 0;
    const descr = [n ? n + (n === 1 ? " intervento" : " interventi") : (conteggi ? "nessun intervento" : ""), testo].filter(Boolean).join(", ");
    const cls = ["cal-g", stato, weekend ? "weekend" : "", g === oggi ? "oggi" : "", report && g === sel ? "sel" : ""].filter(Boolean).join(" ");
    html += '<button type="button" class="' + cls + '" data-giorno="' + g + '" onclick="apriGiornoCal(\'' + g + '\')" aria-label="' +
      new Date(g + "T12:00:00").toLocaleDateString("it-IT", {weekday:"long", day:"numeric", month:"long"}) + (descr ? ': ' + descr : '') + '"' +
      (report && g === sel ? ' aria-current="date"' : '') + '>' + (+g.slice(8)) + icn +
      (n ? '<b class="cal-n' + (n >= MOLTI ? ' molti' : '') + '" aria-hidden="true">' + n + '</b>' : '') + '</button>';
  });
  document.getElementById("mese-griglia").innerHTML = html;
}
export function eliminaGiornoMese(iso){
  if(!confirm("Eliminare il rapporto del " + dataIt(iso) + "?")) return;
  const db = leggiDB();
  delete db[iso];
  scriviDB(db);
  cancellaGiornoRemoto(iso);
  disegnaMese();
  if(document.getElementById("data").value === iso) caricaGiornata(iso);
}

registraVista("sett", disegnaSettimana);
registraVista("mese", disegnaMese);
su("archivio-aggiornato", origine=>{
  // come prima: dopo un'importazione la settimana si ridisegna sempre, dopo una sincronizzazione solo se visibile
  if(!puo("report")) return;
  if(origine === "importazione" || vistaCorrente === "sett") disegnaReportSettimana();
  if(origine === "sincronizzazione" && vistaCorrente === "mese"){ disegnaReportMese(); disegnaGrigliaMese(null); disegnaInterventiMese(); }
});
