// Storico (admin e company): interventi e rapportini di un periodo, con filtri e ricerca.
// Solo lettura con le API esistenti (elencoInterventi + storicoRapportini): cosa arriva lo decide RLS.
// Dettaglio intervento e rapportino (foto, PDF) con le schermate gia' esistenti.
import { registraVista } from "../core/navigation.js";
import { elencoInterventi, minutiTra, nomeOperaio, operaiAttivi, storicoRapportini } from "../services/api-lavori.js";
import { avanzamento } from "../services/avanzamento.js";
import { dataIt, isoDi, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { STATO_INTERVENTO, STATO_RAPPORTINO, oraBreve } from "./gestione-interventi.js";
import { condividi } from "../services/condivisione.js";
import { generaPDFRiepilogoCliente } from "../services/pdf/cliente-mese.js";

const $ = id=>document.getElementById(id);
const GIORNI_DEFAULT = 30;
let dati = { interventi: [], rapportini: [], periodo: "" };
let richiesta = 0;

const minuti = o=>minutiTra(String(o.dalle || "").slice(0, 5), String(o.alle || "").slice(0, 5));
const minutiRapportino = r=>(r.rapportino_operai || []).reduce((t, o)=>t + minuti(o), 0);
const nFoto = r=>(r.allegati && r.allegati[0] && r.allegati[0].count) || 0;
const norma = t=>String(t || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[̀-ͯ]/g, "");

function predefiniti(){
  const d = new Date(oggiIso() + "T12:00:00"); d.setDate(d.getDate() - GIORNI_DEFAULT);
  $("st-dal").value = isoDi(d); $("st-al").value = oggiIso(); $("st-mese").value = "";
  $("st-cliente").value = ""; $("st-operaio").value = ""; $("st-stato").value = ""; $("st-cerca").value = "";
}
export function azzeraFiltriStorico(){ predefiniti(); disegnaStorico(); }

// ---------------------------------------------------------------- mese
const NOMI_MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const ultimoGiorno = am=>{ const [a, m] = am.split("-").map(Number); return am + "-" + String(new Date(a, m, 0).getDate()).padStart(2, "0"); };
// "AAAA-MM" se il periodo Dal-Al e' esattamente un mese intero, altrimenti ""
function meseDelPeriodo(){
  const dal = $("st-dal").value, al = $("st-al").value;
  return dal && dal.endsWith("-01") && al === ultimoGiorno(dal.slice(0, 7)) ? dal.slice(0, 7) : "";
}
// scelta del mese: imposta Dal e Al sul primo e sull'ultimo giorno
export function scegliMeseStorico(){
  const m = $("st-mese").value;
  if(!m) return;
  $("st-dal").value = m + "-01"; $("st-al").value = ultimoGiorno(m);
  disegnaStorico();
}
// Dal/Al cambiati a mano: il campo Mese resta valorizzato solo se il periodo e' ancora un mese intero
export function cambiaDateStorico(){ $("st-mese").value = meseDelPeriodo(); disegnaStorico(); }
function etichettaPeriodo(){
  const m = meseDelPeriodo();
  if(m){ const [a, mm] = m.split("-"); return NOMI_MESI[+mm - 1] + " " + a; }
  return "dal " + dataIt($("st-dal").value) + " al " + dataIt($("st-al").value);
}
function aggiornaPulsantePDF(){
  const cliente = $("st-cliente").value;
  $("st-pdf-cliente").disabled = !cliente || !dati.periodo;
  $("st-pdf-nota").textContent = cliente
    ? "Tutti i rapportini di " + cliente + " " + (meseDelPeriodo() ? "di " : "") + etichettaPeriodo() + " (gli altri filtri non contano)."
    : "Scegli un cliente (e il mese) per stampare il riepilogo dei suoi lavori.";
}

// ---------------------------------------------------------------- PDF riepilogo cliente
// Dai rapportini gia' caricati per il periodo (stessi dati che RLS mostra nello Storico): solo quelli con
// data nel periodo e il cliente scelto, in ordine di data. Nessuna richiesta in piu' al server, cosi' la
// condivisione parte subito dal tocco sul pulsante.
export function datiRiepilogoCliente(){
  const cliente = $("st-cliente").value, dal = $("st-dal").value, al = $("st-al").value;
  const righe = dati.rapportini
    .filter(r=>r.cliente === cliente && r.data >= dal && r.data <= al)
    .sort((a, b)=>a.data.localeCompare(b.data) || String(a.completato_il || "").localeCompare(String(b.completato_il || "")))
    .map(r=>({
      data: r.data, indirizzo: r.indirizzo || "", tipologia: r.tipologia || "", attivita: r.attivita || "",
      materiali: Array.isArray(r.materiali) ? r.materiali : [], esito: r.esito || "", bozza: r.stato !== "completato",
      operai: (r.rapportino_operai || []).map(o=>({ nome: nomeOperaio(o.operaio_id), dalle: String(o.dalle || "").slice(0, 5),
        alle: String(o.alle || "").slice(0, 5), minuti: minuti(o) })).sort((a, b)=>a.nome.localeCompare(b.nome, "it")),
    }));
  // indirizzi del cliente nel periodo (senza doppioni); nella tabella l'indirizzo si ripete solo se ce n'e' piu' d'uno
  const indirizzi = [...new Set(righe.map(r=>r.indirizzo.trim()).filter(Boolean))];
  if(indirizzi.length <= 1) righe.forEach(r=>{ r.indirizzo = ""; });
  return { cliente, indirizzi, periodo: etichettaPeriodo(), righe };
}
export function pdfClienteStorico(btn){
  if(!$("st-cliente").value || !dati.periodo) return;
  const d = datiRiepilogoCliente();
  const nome = "Riepilogo_" + d.cliente.replace(/[^\w]+/g, "_").slice(0, 40) + "_" +
    (meseDelPeriodo() || ($("st-dal").value + "_" + $("st-al").value)) + ".pdf";
  condividi(btn, ()=>generaPDFRiepilogoCliente(d), nome);
}

// ---------------------------------------------------------------- dati
async function carica(){
  const periodo = $("st-dal").value + "|" + $("st-al").value;
  if(dati.periodo === periodo) return;                 // stesso periodo: si filtra in memoria
  const n = ++richiesta;
  stato("Caricamento…");
  await operaiAttivi().catch(()=>[]);
  const interventi = await elencoInterventi({ dal: $("st-dal").value, al: $("st-al").value });
  const rapportini = await storicoRapportini({ dal: $("st-dal").value, al: $("st-al").value, interventi: interventi.map(i=>i.id) });
  if(n !== richiesta) return;
  dati = { interventi, rapportini, periodo };
  // clienti e operai presenti nel periodo per i due elenchi a scelta
  const clienti = [...new Set([...interventi.map(i=>i.cliente), ...rapportini.map(r=>r.cliente)].filter(Boolean))]
    .sort((a, b)=>a.localeCompare(b, "it"));
  const scelto = $("st-cliente").value;
  $("st-cliente").innerHTML = '<option value="">Tutti i clienti</option>' + clienti.map(c=>'<option>' + esc(c) + '</option>').join("");
  if(clienti.includes(scelto)) $("st-cliente").value = scelto;
  const ids = new Set();
  interventi.forEach(i=>(i.intervento_operai || []).forEach(a=>ids.add(a.operaio_id)));
  rapportini.forEach(r=>{ ids.add(r.autore_id); (r.rapportino_operai || []).forEach(o=>ids.add(o.operaio_id)); });
  const operaio = $("st-operaio").value;
  $("st-operaio").innerHTML = '<option value="">Tutti gli operai</option>' + [...ids].map(id=>[id, nomeOperaio(id)])
    .sort((a, b)=>a[1].localeCompare(b[1], "it")).map(([id, n])=>'<option value="' + id + '">' + esc(n) + '</option>').join("");
  if(ids.has(operaio)) $("st-operaio").value = operaio;
}
function stato(testo, tipo){ $("st-stato-msg").textContent = testo || ""; $("st-stato-msg").className = "msg-info" + (tipo ? " " + tipo : "") + (testo ? "" : " nascosto"); }

// ---------------------------------------------------------------- filtri
function voci(){
  const cliente = $("st-cliente").value, operaio = $("st-operaio").value, st = $("st-stato").value, cerca = norma($("st-cerca").value.trim());
  const perIntervento = {};
  dati.rapportini.forEach(r=>{ if(r.intervento_id) (perIntervento[r.intervento_id] = perIntervento[r.intervento_id] || []).push(r); });
  const conOperaio = rr=>!operaio || rr.some(r=>r.autore_id === operaio || (r.rapportino_operai || []).some(o=>o.operaio_id === operaio));
  const out = [];
  dati.interventi.forEach(i=>{
    const rr = perIntervento[i.id] || [];
    if(cliente && i.cliente !== cliente) return;
    if(operaio && !(i.intervento_operai || []).some(a=>a.operaio_id === operaio) && !conOperaio(rr)) return;
    if(st && !(st === "bozza" ? rr.some(r=>r.stato === "bozza") : i.stato === st)) return;
    if(cerca && !norma([i.cliente, i.indirizzo, i.descrizione, ...rr.map(r=>r.attivita)].join(" ")).includes(cerca)) return;
    out.push({ tipo: "intervento", data: i.data, ora: i.ora || "", i, rr });
  });
  // rapportini autonomi e rapportini di interventi fuori dal periodo (il rapportino e' nel periodo)
  const idInterventi = new Set(dati.interventi.map(i=>i.id));
  dati.rapportini.filter(r=>!r.intervento_id || !idInterventi.has(r.intervento_id)).forEach(r=>{
    if(cliente && r.cliente !== cliente) return;
    if(!conOperaio([r])) return;
    if(st && !((st === "completato" && r.stato === "completato") || ((st === "bozza" || st === "in_corso") && r.stato === "bozza"))) return;
    if(cerca && !norma([r.cliente, r.indirizzo, r.attivita, r.note].join(" ")).includes(cerca)) return;
    out.push({ tipo: "rapportino", data: r.data, ora: "", r });
  });
  // piu' recenti prima
  return out.sort((a, b)=>b.data.localeCompare(a.data) || String(b.ora).localeCompare(String(a.ora)));
}

// ---------------------------------------------------------------- disegno
function rigaRapportino(r){
  const ore = (r.rapportino_operai || []).map(o=>esc(nomeOperaio(o.operaio_id)) + ' ' + esc(String(o.dalle || "").slice(0, 5)) + '–' +
    esc(String(o.alle || "").slice(0, 5)) + ' (' + oreTesto(minuti(o)) + ')').join(" · ");
  const f = nFoto(r);
  return '<button type="button" class="st-rap" data-rapportino="' + r.id + '" onclick="apriRapportino(\'' + r.id + '\')">' +
    '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(nomeOperaio(r.autore_id)) + ' · ' + esc(dataIt(r.data)) + '</span>' +
    '<span class="cli-ind st-ore" style="display:block">' + (ore || "nessuna ora") + '</span>' +
    (f ? '<span class="cli-ind" style="display:block">' + icona("image", "i-sm") + ' ' + f + (f === 1 ? " foto" : " foto") + '</span>' : '') +
    '</span>' + STATO_RAPPORTINO[r.stato] + icona("chev-r", "chev") + '</button>';
}
function scheda(v){
  if(v.tipo === "intervento"){
    const { i, rr } = v;
    const av = avanzamento({ ...i, rapportini: rr });
    const tot = rr.reduce((t, r)=>t + minutiRapportino(r), 0);
    return '<article class="card st-voce" data-tipo="intervento" data-id="' + i.id + '">' +
      '<button type="button" class="st-testa" onclick="apriDettaglioIntervento(\'' + i.id + '\')">' +
        '<span class="int-ora">' + esc(dataIt(i.data).slice(0, 5)) + (i.ora ? '<small>' + esc(oraBreve(i.ora)) + '</small>' : '') + '</span>' +
        '<span class="cli-testi"><span class="int-cliente">' + esc(i.cliente) + '</span>' +
          '<span class="cli-ind" style="display:block">' + esc([dataIt(i.data), i.indirizzo].filter(Boolean).join(" · ")) + '</span>' +
          (i.descrizione ? '<span class="int-desc">' + esc(i.descrizione) + '</span>' : '') +
          '<span class="int-badge">' + STATO_INTERVENTO[i.stato] +
            (av.attivi.length ? '<span class="badge pervinca">' + icona("users") + av.completati.length + ' di ' + av.attivi.length + ' completati</span>' : '') +
            (tot ? '<span class="badge neutro">' + icona("clock") + oreTesto(tot) + '</span>' : '') + '</span></span>' +
        icona("chev-r", "chev") + '</button>' +
      (rr.length ? '<div class="st-rapportini">' + rr.sort((a, b)=>a.data.localeCompare(b.data)).map(rigaRapportino).join("") + '</div>'
        : '<div class="nota" style="padding:8px 0 0">Nessun rapportino.</div>') +
    '</article>';
  }
  const r = v.r;
  return '<article class="card st-voce" data-tipo="rapportino" data-id="' + r.id + '">' +
    '<div class="st-autonomo">' + (r.intervento_id
      ? '<button type="button" class="link-btn" onclick="apriDettaglioIntervento(\'' + r.intervento_id + '\')">Intervento fuori periodo</button>'
      : '<span class="badge pervinca">Rapportino autonomo</span>') + ' <b>' + esc(r.cliente) + '</b>' +
    (r.indirizzo ? '<span class="cli-ind" style="display:block">' + esc(r.indirizzo) + '</span>' : '') + '</div>' +
    '<div class="st-rapportini">' + rigaRapportino(r) + '</div></article>';
}
let disegno = 0;
export async function disegnaStorico(){
  const n = ++disegno;                                  // conta solo l'ultimo disegno richiesto
  if(!$("st-dal").value) predefiniti();
  if($("st-al").value && $("st-dal").value > $("st-al").value){ $("st-pdf-cliente").disabled = true; stato("La data iniziale è dopo quella finale.", "err"); $("st-elenco").innerHTML = ""; $("st-conteggio").textContent = ""; return; }
  try{ await carica(); }
  catch(e){ if(n === disegno){ stato(e.message, "err"); $("st-elenco").innerHTML = ""; } dati.periodo = ""; $("st-pdf-cliente").disabled = true; return; }
  if(n !== disegno) return;
  aggiornaPulsantePDF();
  const lista = voci();
  stato("");
  $("st-conteggio").textContent = lista.length ? lista.length + (lista.length === 1 ? " risultato" : " risultati") : "";
  $("st-elenco").innerHTML = lista.length ? lista.map(scheda).join("")
    : '<div class="card vuoto"><h3>Nessun risultato</h3><p>Nessun intervento o rapportino con questi filtri nel periodo scelto.</p>' +
      '<button type="button" class="btn btn-secondario" onclick="azzeraFiltriStorico()">Azzera i filtri</button></div>';
}
// ricerca: si filtra in memoria mentre si scrive (nessuna richiesta al server)
let ritardo = null;
export function cercaStorico(){ clearTimeout(ritardo); ritardo = setTimeout(disegnaStorico, 200); }

registraVista("storico", ()=>{ dati.periodo = ""; disegnaStorico(); });
