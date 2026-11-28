// Scheda cliente evoluta (dentro il foglio "Cliente" dell'anagrafica): azioni rapide e quattro sezioni
//   Dati      anagrafica, recapiti, sedi, dati fiscali, note, storico della scheda
//   Lavori    rapportini e interventi del cliente con filtri (periodo, stato, tipologia), ore, materiali,
//             apertura del rapportino originale (con il suo PDF) e PDF dello storico
//   Impianti  impianti e attrezzature (marca, modello, matricola, garanzia...) e lavori che li citano
//   Documenti file del cliente (PDF e immagini) nel bucket privato
// Lavori e dati della vecchia app si leggono anche offline (archivio sul telefono); impianti e
// documenti richiedono la rete.
import { puo } from "../core/permessi.js";
import { profilo } from "../core/sessione.js";
import { dataIt, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { minutiTra, nomeOperaio } from "../services/api-lavori.js";
import { STATI_CLIENTE, TIPOLOGIE_CLIENTE } from "../services/clienti-logica.js";
import { STATI_STORICO, dimensioneTesto, filtraStorico, linkEmail, linkMappe, linkTelefono, manutenzioniImpianto, opzioniStorico,
  pulisciImpianto, riepilogoStorico, statoGaranzia, vociStorico } from "../services/scheda-cliente-logica.js";
import { caricaDocumento, elencoDocumenti, elencoImpianti, eliminaDocumento, eliminaImpianto, salvaImpianto, scaricaDocumento, storicoCliente } from "../services/scheda-cliente.js";
import { condividi } from "../services/condivisione.js";
import { generaPDFRiepilogoCliente } from "../services/pdf/cliente-mese.js";

const $ = id=>document.getElementById(id);
const PAGINA = 30;
const etichetta = (elenco, v)=>(elenco.find(x=>x[0] === v) || [v, v])[1];
const BADGE_STATO = { completato: ["ok", "Completato"], da_ultimare: ["att", "Da ultimare"], bozza: ["att", "Bozza"],
  pianificato: ["neutro", "Programmato"], in_corso: ["att", "In corso"], annullato: ["err", "Annullato"] };
const badge = s=>{ const b = BADGE_STATO[s] || ["neutro", s]; return '<span class="badge ' + b[0] + '">' + esc(b[1]) + '</span>'; };

let stato = null;   // { c, sezione, voci, caricamento, errore, filtri, mostrate, impianti, documenti, modifica }

// ---------------------------------------------------------------- intestazione e azioni rapide
export function testaSchedaHtml(c){
  const tel = linkTelefono(c.telefono), mail = linkEmail(c.email), mappe = linkMappe(c.indirizzo);
  const rapida = (href, ic, testo, attr = "")=>href
    ? '<a class="sc-rapida" href="' + esc(href) + '"' + attr + '>' + icona(ic) + '<span>' + testo + '</span></a>'
    : '<span class="sc-rapida spenta" aria-disabled="true">' + icona(ic) + '<span>' + testo + '</span></span>';
  const azione = (az, ic, testo)=>'<button type="button" class="sc-rapida" data-az="' + az + '">' + icona(ic) + '<span>' + testo + '</span></button>';
  const badges = [
    c.tipologia ? '<span class="badge pervinca">' + esc(etichetta(TIPOLOGIE_CLIENTE, c.tipologia)) + '</span>' : '',
    c.stato && c.stato !== "attivo" ? '<span class="badge ' + (c.stato === "potenziale" ? "att" : "neutro") + '">' + esc(etichetta(STATI_CLIENTE, c.stato)) + '</span>' : '',
    c.archiviato ? '<span class="badge neutro">Archiviato</span>' : '',
  ].join("");
  return (badges ? '<div class="int-badge sc-badge">' + badges + '</div>' : '') +
    '<div class="sc-rapide">' +
      rapida(tel, "phone", "Chiama") + rapida(mail, "mail", "Email") + rapida(mappe, "pin", "Mappe", ' target="_blank" rel="noopener"') +
      (puo("rapportini.compila") ? azione("rapportino", "plus", "Rapportino") : '') +
      (puo("interventi.gestisci") ? azione("intervento", "cal", "Intervento") : '') +
    '</div>' +
    '<div class="seg sc-tab" role="tablist">' + [["dati", "Dati"], ["lavori", "Lavori"], ["impianti", "Impianti"], ["documenti", "Documenti"]]
      .map(([k, t])=>'<button type="button" role="tab" data-sc-tab="' + k + '" aria-pressed="false">' + t + '</button>').join("") + '</div>' +
    '<div id="sc-pannello" role="tabpanel"></div>';
}

// ---------------------------------------------------------------- sezione Dati
function datiHtml(c){
  const riga = (ic, testo, link, nuova)=>testo ? '<div class="idt-riga">' + icona(ic) +
    (link ? '<a href="' + esc(link) + '"' + (nuova ? ' target="_blank" rel="noopener"' : '') + '>' + esc(testo) + '</a>' : '<span>' + esc(testo) + '</span>') + '</div>' : '';
  const campo = (et, v)=>v ? '<div class="sc-campo"><span>' + esc(et) + '</span><b>' + esc(v) + '</b></div>' : '';
  const sedi = Array.isArray(c.sedi) ? c.sedi : [];
  const fiscali = campo("Partita IVA", c.partita_iva) + campo("Codice fiscale", c.codice_fiscale) + campo("Codice SDI", c.codice_sdi) + campo("PEC", c.pec);
  return riga("pin", c.indirizzo || "Indirizzo non indicato", linkMappe(c.indirizzo), true) +
    (c.referente ? riga("users", "Referente: " + c.referente) : '') +
    riga("phone", c.telefono, linkTelefono(c.telefono)) +
    riga("mail", c.email, linkEmail(c.email)) +
    (sedi.length ? '<div class="gruppo-tit sc-sottotit">Sedi e indirizzi aggiuntivi</div>' + sedi.map(s=>
      '<div class="idt-riga">' + icona("pin") + '<span><b>' + esc(s.nome || "Sede") + '</b>' + (s.indirizzo ? '<br>' +
        (linkMappe(s.indirizzo) ? '<a href="' + esc(linkMappe(s.indirizzo)) + '" target="_blank" rel="noopener">' + esc(s.indirizzo) + '</a>' : esc(s.indirizzo)) : '') + '</span></div>').join("") : '') +
    (fiscali ? '<div class="gruppo-tit sc-sottotit">Dati fiscali</div><div class="sc-campi">' + fiscali + '</div>' : '') +
    (c.note ? '<div class="gruppo-tit sc-sottotit">Note interne</div><div class="idt-desc" id="sc-note"></div>' : '') +
    '<p class="nota cli-id">' + [c.creato_il ? "Creato il " + dataIt(String(c.creato_il).slice(0, 10)) + (c.creato_da ? " da " + nomeOperaio(c.creato_da) : "") : "",
      c.aggiornato_il && c.versione > 1 ? "aggiornato il " + dataIt(String(c.aggiornato_il).slice(0, 10)) : ""].filter(Boolean).map(esc).join(", ") +
      (c.creato_il ? '<br>' : '') + 'ID scheda: ' + esc(c.id) + '</p>';
}

// ---------------------------------------------------------------- sezione Lavori
async function caricaLavori(){
  const s = stato;
  s.caricamento = true; s.errore = "";
  disegna();
  const d = await storicoCliente(s.c);
  if(stato !== s) return;
  s.voci = vociStorico({ cliente: s.c, rapportini: d.rapportini, interventi: d.interventi, vecchi: d.vecchi, nome: nomeOperaio });
  s.errore = d.errore; s.troncato = d.troncato; s.caricamento = false;
  if(stato.sezione === "lavori" || stato.sezione === "impianti") disegna();
}
function vociFiltrate(){ return filtraStorico(stato.voci || [], { ...stato.filtri, oggi: oggiIso() }); }
function voceHtml(v){
  const tit = v.tipo === "intervento" ? "Intervento" + (v.ora ? " delle " + v.ora : "") : v.tipo === "vecchio" ? "Vecchia app" : "Rapportino";
  const desc = v.descrizione || v.richiesta || "";
  const azioni = v.tipo === "rapportino" ? '<button type="button" class="btn btn-secondario" data-sc-rap="' + esc(v.id) + '">' + icona("file") + '<span>Apri rapportino e PDF</span></button>'
    : v.tipo === "intervento" ? '<button type="button" class="btn btn-secondario" data-sc-int="' + esc(v.id) + '">' + icona("cal") + '<span>Apri intervento</span></button>'
    : '<button type="button" class="btn btn-secondario" data-sc-pdfg="' + esc(v.data) + '">' + icona("file") + '<span>PDF giornata</span></button>';
  return '<article class="card sc-voce" data-voce="' + esc(v.id) + '">' +
    '<div class="sc-voce-testa"><b>' + esc(dataIt(v.data)) + '</b><span class="sc-voce-tipo">' + tit + '</span>' + badge(v.stato) + '</div>' +
    (v.tipologia ? '<div class="cli-ind">' + esc(v.tipologia) + '</div>' : '') +
    (desc ? '<div class="sc-desc">' + esc(desc) + '</div>' : '<div class="sc-desc nota">Descrizione non indicata</div>') +
    '<div class="sc-meta">' +
      (v.tecnici.length ? '<span>' + icona("users", "i-sm") + esc(v.tecnici.join(", ")) + '</span>' : '') +
      (v.minuti ? '<span>' + icona("clock", "i-sm") + oreTesto(v.minuti) + '</span>' : '') +
      (v.foto ? '<span>' + icona("image", "i-sm") + v.foto + ' foto</span>' : '') +
      (v.link === "nome" ? '<span class="sc-pernome" title="Documento non collegato alla scheda: trovato per nome">trovato per nome</span>' : '') +
    '</div>' +
    (v.materiali.length ? '<div class="sc-mat"><span>Materiale:</span> ' + esc(v.materiali.map(m=>m.q ? m.a + " (" + m.q + ")" : m.a).join(", ")) + '</div>' : '') +
    '<div class="sc-voce-az">' + azioni + '</div></article>';
}
function lavoriHtml(){
  const s = stato;
  if(s.caricamento && !s.voci) return '<div class="sc-attesa" role="status">' + icona("clock") + ' Caricamento dei lavori…</div>';
  const op = opzioniStorico(s.voci || []);
  const sel = (id, opzioni, valore)=>'<select id="' + id + '" data-sc-filtro>' + opzioni.map(([v, t])=>'<option value="' + esc(v) + '"' + (v === valore ? " selected" : "") + '>' + esc(t) + '</option>').join("") + '</select>';
  const voci = vociFiltrate(), rp = riepilogoStorico(voci);
  const filtri = '<div class="sc-filtri">' +
    sel("sc-f-periodo", [["tutto", "Sempre"], ["12m", "Ultimi 12 mesi"], ...op.anni.map(a=>[a, a])], s.filtri.periodo) +
    sel("sc-f-stato", STATI_STORICO, s.filtri.stato) +
    sel("sc-f-tipologia", [["", "Tutte le tipologie"], ...op.tipologie.map(t=>[t, t])], s.filtri.tipologia) + '</div>';
  return filtri +
    (s.errore ? '<p class="msg-info att">' + esc(s.errore) + '</p>' : '') +
    (s.troncato ? '<p class="msg-info att">Molti lavori: si vedono i più recenti.</p>' : '') +
    (voci.length ? '<div class="card nota sc-riepilogo">' + rp.lavori + (rp.lavori === 1 ? " lavoro" : " lavori") +
        (rp.minuti ? ' · ' + oreTesto(rp.minuti) + ' lavorate' : '') + (rp.ultimo ? ' · ultimo il ' + esc(dataIt(rp.ultimo)) : '') +
        (rp.prossimo ? ' · prossimo intervento il ' + esc(dataIt(rp.prossimo)) : '') + '</div>' +
      voci.slice(0, s.mostrate).map(voceHtml).join("") +
      (voci.length > s.mostrate ? '<button type="button" class="btn btn-secondario btn-blocco" data-sc-altri>Mostra altri (' + (voci.length - s.mostrate) + ')</button>' : '') +
      (voci.some(v=>v.tipo !== "intervento") ? '<button type="button" class="btn btn-secondario btn-blocco sc-pdf" data-sc-pdf>' + icona("file") + '<span>PDF storico lavori</span></button>' : '')
      : '<div class="card vuoto"><div class="v-icona">' + icona("file", "i-lg") + '</div><h3>Nessun lavoro</h3><p>' +
        ((s.voci || []).length ? "Nessun lavoro con questi filtri." : "Per questo cliente non ci sono ancora interventi o rapportini.") + '</p></div>') +
    (s.caricamento ? '<div class="sc-attesa" role="status">Aggiornamento…</div>' : '');
}
// PDF "Riepilogo lavori" (stesso documento dello Storico) con i lavori filtrati
function pdfStorico(btn){
  const voci = vociFiltrate().filter(v=>v.tipo !== "intervento").slice().reverse();
  const righe = voci.map(v=>({ data: v.data, indirizzo: v.indirizzo || "", tipologia: v.tipologia, attivita: v.descrizione, materiali: v.materiali,
    esito: v.stato === "da_ultimare" ? "Da ultimare" : "Completato", bozza: v.stato === "bozza", vecchio: v.tipo === "vecchio", tecnici: v.tecnici,
    sulPosto: v.minuti, operai: (v.orari || []).map(o=>({ nome: o.nome, dalle: o.dalle, alle: o.alle, minuti: minutiTra(o.dalle, o.alle) })) }));
  const indirizzi = [...new Set(righe.map(r=>r.indirizzo.trim()).filter(Boolean))];
  if(indirizzi.length <= 1) righe.forEach(r=>{ r.indirizzo = ""; });
  const f = stato.filtri.periodo;
  const periodo = f === "tutto" ? "tutti i lavori" : f === "12m" ? "ultimi 12 mesi" : "anno " + f;
  const nome = "Storico_" + stato.c.nome.replace(/[^\w]+/g, "_").slice(0, 40) + ".pdf";
  condividi(btn, ()=>generaPDFRiepilogoCliente({ cliente: stato.c.nome, indirizzi, periodo, righe, soloOreCliente: true }), nome);
}

// ---------------------------------------------------------------- sezione Impianti
async function caricaImpianti(){
  const s = stato;
  s.impianti = { caricamento: true };
  disegna();
  try{ const elenco = await elencoImpianti(s.c.id); if(stato === s) s.impianti = { elenco }; }
  catch(e){ if(stato === s) s.impianti = { errore: e.message, nonAttivo: !!e.nonAttivo }; }
  if(stato === s && s.sezione === "impianti") disegna();
  if(!s.voci && !s.caricamento) caricaLavori();      // per le manutenzioni
}
const puoModificareImpianto = i=>puo("clienti.gestisci") || (profilo && i.creato_da === profilo.id);
function impiantoHtml(i){
  const g = statoGaranzia(i.garanzia_fino, oggiIso());
  const garanzia = g.stato === "nessuna" ? '' : g.stato === "scaduta" ? '<span class="badge neutro">Garanzia scaduta il ' + esc(dataIt(i.garanzia_fino)) + '</span>'
    : '<span class="badge ' + (g.stato === "in_scadenza" ? "att" : "ok") + '">Garanzia fino al ' + esc(dataIt(i.garanzia_fino)) + '</span>';
  const man = stato.voci ? manutenzioniImpianto(i, stato.voci) : [];
  const campo = (et, v)=>v ? '<div class="sc-campo"><span>' + esc(et) + '</span><b>' + esc(v) + '</b></div>' : '';
  return '<article class="card sc-voce sc-impianto' + (i.dismesso ? ' dismesso' : '') + '" data-impianto="' + esc(i.id) + '">' +
    '<div class="sc-voce-testa"><b>' + esc(i.nome) + '</b>' + (i.dismesso ? '<span class="badge neutro">Dismesso</span>' : '') + garanzia + '</div>' +
    '<div class="sc-campi">' + campo("Marca", i.marca) + campo("Modello", i.modello) + campo("Matricola", i.matricola) +
      campo("Installato il", i.installato_il ? dataIt(i.installato_il) : "") + campo("Posizione", i.posizione) + '</div>' +
    (i.note ? '<div class="sc-desc">' + esc(i.note) + '</div>' : '') +
    (stato.voci ? (man.length ? '<details class="sc-man"><summary>' + man.length + (man.length === 1 ? " lavoro cita" : " lavori citano") + ' questo impianto</summary>' +
        man.map(v=>'<div class="sc-man-riga"><b>' + esc(dataIt(v.data)) + '</b> ' + esc((v.descrizione || "").slice(0, 140)) + '</div>').join("") + '</details>'
      : '<div class="nota sc-man-vuoto">Nessun lavoro cita la matricola o marca e modello.</div>') : '') +
    (puoModificareImpianto(i) ? '<div class="sc-voce-az"><button type="button" class="btn btn-secondario" data-sc-imp-mod="' + esc(i.id) + '">' + icona("pen") + '<span>Modifica</span></button>' +
      (puo("clienti.elimina") ? '<button type="button" class="btn btn-secondario" data-sc-imp-del="' + esc(i.id) + '">' + icona("trash") + '<span>Elimina</span></button>' : '') + '</div>' : '') +
    '</article>';
}
function moduloImpiantoHtml(i){
  const v = pulisciImpianto(i || {});
  const inp = (k, et, tipo = "text", max = 100)=>'<div class="campo"><label for="sc-imp-' + k + '">' + et + '</label><input id="sc-imp-' + k + '" type="' + tipo + '"' +
    (tipo === "text" ? ' maxlength="' + max + '" autocomplete="off"' : '') + ' value="' + esc(v[k] || "") + '"></div>';
  return '<form class="card sc-modulo" id="sc-imp-form" novalidate><div class="gruppo-tit" style="margin:0 0 8px">' + (i ? "Modifica impianto" : "Nuovo impianto") + '</div>' +
    inp("nome", "Impianto o attrezzatura *", "text", 200) +
    '<div class="due"><div>' + inp("marca", "Marca") + '</div><div>' + inp("modello", "Modello") + '</div></div>' +
    inp("matricola", "Matricola") +
    '<div class="due"><div>' + inp("installato_il", "Installato il", "date") + '</div><div>' + inp("garanzia_fino", "Garanzia fino al", "date") + '</div></div>' +
    inp("posizione", "Posizione o sede", "text", 200) +
    '<div class="campo"><label for="sc-imp-note">Note tecniche</label><textarea id="sc-imp-note" rows="3" maxlength="2000">' + esc(v.note) + '</textarea></div>' +
    (i ? '<label class="check"><input type="checkbox" id="sc-imp-dismesso"' + (v.dismesso ? " checked" : "") + '><span>Dismesso (non più in uso)</span></label>' : '') +
    '<div class="msg-info" id="sc-imp-msg" role="status"></div>' +
    '<div class="due"><div><button type="button" class="btn btn-primario btn-blocco" data-sc-imp-salva>' + icona("check") + 'Salva</button></div>' +
    '<div><button type="button" class="btn btn-secondario btn-blocco" data-sc-imp-annulla>Annulla</button></div></div></form>';
}
function impiantiHtml(){
  const s = stato, im = s.impianti || {};
  if(im.caricamento) return '<div class="sc-attesa" role="status">' + icona("clock") + ' Caricamento degli impianti…</div>';
  if(im.errore) return '<p class="msg-info ' + (im.nonAttivo ? "att" : "err") + '">' + esc(im.errore) + '</p>' +
    (im.nonAttivo ? '' : '<button type="button" class="btn btn-secondario btn-blocco" data-sc-riprova="impianti">Riprova</button>');
  const elenco = im.elenco || [];
  if(s.modifica && s.modifica.tipo === "impianto") return moduloImpiantoHtml(s.modifica.base);
  return (elenco.length ? elenco.map(impiantoHtml).join("") : '<div class="card vuoto"><div class="v-icona">' + icona("grid", "i-lg") + '</div><h3>Nessun impianto</h3>' +
      '<p>Registra caldaie, condizionatori, quadri e le altre attrezzature del cliente.</p></div>') +
    '<button type="button" class="btn btn-primario btn-blocco" data-sc-imp-nuovo>' + icona("plus") + '<span>Aggiungi impianto</span></button>';
}

// ---------------------------------------------------------------- sezione Documenti
async function caricaDocumenti(){
  const s = stato;
  s.documenti = { caricamento: true };
  disegna();
  try{ const elenco = await elencoDocumenti(s.c.id); if(stato === s) s.documenti = { elenco }; }
  catch(e){ if(stato === s) s.documenti = { errore: e.message, nonAttivo: !!e.nonAttivo }; }
  if(stato === s && s.sezione === "documenti") disegna();
}
function documentiHtml(){
  const d = stato.documenti || {};
  const nota = '<p class="nota sc-nota-doc">I PDF dei rapportini si aprono da <button type="button" class="link-btn" data-sc-tab="lavori">Lavori</button> (Apri rapportino e PDF).</p>';
  if(d.caricamento) return nota + '<div class="sc-attesa" role="status">' + icona("clock") + ' Caricamento dei documenti…</div>';
  if(d.errore) return nota + '<p class="msg-info ' + (d.nonAttivo ? "att" : "err") + '">' + esc(d.errore) + '</p>' +
    (d.nonAttivo ? '' : '<button type="button" class="btn btn-secondario btn-blocco" data-sc-riprova="documenti">Riprova</button>');
  const elenco = d.elenco || [];
  const puoEliminare = x=>puo("clienti.gestisci") || (profilo && x.caricato_da === profilo.id);
  return nota +
    (elenco.length ? '<div class="card cli-elenco">' + elenco.map(x=>'<div class="sc-doc" data-doc="' + esc(x.id) + '">' +
        '<button type="button" class="sc-doc-apri" data-sc-doc-apri="' + esc(x.id) + '">' + icona(x.mime === "application/pdf" ? "file" : "image") +
          '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(x.nome) + '</span>' +
          '<span class="cli-ind" style="display:block">' + esc(dataIt(String(x.creato_il).slice(0, 10))) + ' · ' + esc(nomeOperaio(x.caricato_da)) + ' · ' + dimensioneTesto(x.dimensione) + '</span></span></button>' +
        (puoEliminare(x) ? '<button type="button" class="gdel" aria-label="Elimina ' + esc(x.nome) + '" data-sc-doc-del="' + esc(x.id) + '">' + icona("trash") + '</button>' : '') +
      '</div>').join("") + '</div>'
      : '<div class="card vuoto"><div class="v-icona">' + icona("file", "i-lg") + '</div><h3>Nessun documento</h3><p>Carica contratti, libretti, certificazioni o foto (PDF o immagini, max 10 MB).</p></div>') +
    '<div class="card sc-modulo"><div class="campo"><label for="sc-doc-nome">Nome del documento</label><input id="sc-doc-nome" type="text" maxlength="200" autocomplete="off" placeholder="es. Libretto impianto"></div>' +
      '<input type="file" id="sc-doc-file" accept="application/pdf,image/jpeg,image/png,image/webp" class="nascosto">' +
      '<button type="button" class="btn btn-primario btn-blocco" data-sc-doc-carica>' + icona("plus") + '<span>Scegli e carica un file</span></button>' +
      '<div class="msg-info" id="sc-doc-msg" role="status"></div></div>';
}

// ---------------------------------------------------------------- disegno e azioni
function disegna(){
  if(!stato || !$("sc-pannello")) return;
  document.querySelectorAll("[data-sc-tab][role=tab]").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.scTab === stato.sezione)));
  const p = $("sc-pannello");
  p.innerHTML = stato.sezione === "lavori" ? lavoriHtml() : stato.sezione === "impianti" ? impiantiHtml() : stato.sezione === "documenti" ? documentiHtml() : datiHtml(stato.c);
  const note = $("sc-note");
  if(note) note.textContent = stato.c.note;
}
export function apriSezione(sezione){
  if(!stato) return;
  stato.sezione = sezione; stato.modifica = null;
  if(sezione === "lavori" && !stato.voci && !stato.caricamento) return caricaLavori();
  if(sezione === "impianti" && !stato.impianti) return caricaImpianti();
  if(sezione === "documenti" && !stato.documenti) return caricaDocumenti();
  disegna();
}
// c = scheda del cliente; sezione iniziale
export function avviaScheda(c, sezione = "dati"){
  stato = { c, sezione: "dati", voci: null, caricamento: false, errore: "", filtri: { periodo: "tutto", stato: "", tipologia: "" }, mostrate: PAGINA,
    impianti: null, documenti: null, modifica: null };
  apriSezione(sezione);
}
export function chiudiScheda(){ stato = null; }
export const sezioneAperta = ()=>stato && stato.sezione;

function messaggio(id, t, tipo){ const m = $(id); if(m){ m.textContent = t || ""; m.className = "msg-info" + (tipo ? " " + tipo : ""); } }
async function apriDocumento(x){
  // finestra aperta subito al tocco (i browser bloccano quelle aperte dopo un'attesa)
  const w = window.open("", "_blank");
  try{
    const blob = await scaricaDocumento(x);
    const url = URL.createObjectURL(blob);
    if(w) w.location.href = url; else window.location.href = url;
    setTimeout(()=>URL.revokeObjectURL(url), 60000);
  }catch(e){ if(w) w.close(); messaggio("sc-doc-msg", e.message, "err"); }
}
document.getElementById("cli-corpo").addEventListener("click", async e=>{
  if(!stato) return;
  const t = e.target;
  const tab = t.closest("[data-sc-tab]");
  if(tab) return apriSezione(tab.dataset.scTab);
  if(t.closest("[data-sc-altri]")){ stato.mostrate += PAGINA; return disegna(); }
  if(t.closest("[data-sc-pdf]")) return pdfStorico(t.closest("[data-sc-pdf]"));
  const rap = t.closest("[data-sc-rap]");
  if(rap){ window.chiudiSchedaCliente(); return window.apriRapportino(rap.dataset.scRap); }
  const int = t.closest("[data-sc-int]");
  if(int){ window.chiudiSchedaCliente(); return window.apriDettaglioIntervento(int.dataset.scInt); }
  const pdfg = t.closest("[data-sc-pdfg]");
  if(pdfg) return window.pdfRapporto(pdfg, pdfg.dataset.scPdfg);
  const rip = t.closest("[data-sc-riprova]");
  if(rip) return rip.dataset.scRiprova === "impianti" ? caricaImpianti() : caricaDocumenti();
  // impianti
  if(t.closest("[data-sc-imp-nuovo]")){ stato.modifica = { tipo: "impianto", base: null }; disegna(); return $("sc-imp-nome").focus(); }
  const mod = t.closest("[data-sc-imp-mod]");
  if(mod){ stato.modifica = { tipo: "impianto", base: stato.impianti.elenco.find(i=>i.id === mod.dataset.scImpMod) }; disegna(); return $("sc-imp-nome").focus(); }
  if(t.closest("[data-sc-imp-annulla]")){ stato.modifica = null; return disegna(); }
  if(t.closest("[data-sc-imp-salva]")){
    const b = t.closest("[data-sc-imp-salva]");
    const dati = Object.fromEntries(["nome", "marca", "modello", "matricola", "installato_il", "garanzia_fino", "posizione", "note"].map(k=>[k, $("sc-imp-" + k).value]));
    dati.dismesso = !!($("sc-imp-dismesso") && $("sc-imp-dismesso").checked);
    b.disabled = true;
    try{ await salvaImpianto(stato.c.id, dati, stato.modifica.base); stato.modifica = null; await caricaImpianti(); }
    catch(err){ messaggio("sc-imp-msg", err.message, "err"); }
    finally{ b.disabled = false; }
    return;
  }
  const del = t.closest("[data-sc-imp-del]");
  if(del){
    const i = stato.impianti.elenco.find(x=>x.id === del.dataset.scImpDel);
    if(!i || !confirm("Eliminare l'impianto «" + i.nome + "»? Se non è più in uso puoi segnarlo come dismesso.")) return;
    try{ await eliminaImpianto(i.id); await caricaImpianti(); }
    catch(err){ alert(err.message); }
    return;
  }
  // documenti
  if(t.closest("[data-sc-doc-carica]")) return $("sc-doc-file").click();
  const apri = t.closest("[data-sc-doc-apri]");
  if(apri) return apriDocumento(stato.documenti.elenco.find(x=>x.id === apri.dataset.scDocApri));
  const dd = t.closest("[data-sc-doc-del]");
  if(dd){
    const x = stato.documenti.elenco.find(y=>y.id === dd.dataset.scDocDel);
    if(!x || !confirm("Eliminare il documento «" + x.nome + "»?")) return;
    try{ await eliminaDocumento(x); await caricaDocumenti(); }
    catch(err){ messaggio("sc-doc-msg", err.message, "err"); }
  }
});
document.getElementById("cli-corpo").addEventListener("change", async e=>{
  if(!stato) return;
  if(e.target.matches("[data-sc-filtro]")){
    stato.filtri = { periodo: $("sc-f-periodo").value, stato: $("sc-f-stato").value, tipologia: $("sc-f-tipologia").value };
    stato.mostrate = PAGINA;
    return disegna();
  }
  if(e.target.id === "sc-doc-file"){
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const s = stato;
    const nome = $("sc-doc-nome").value.trim() || file.name.replace(/\.[^.]+$/, "");
    messaggio("sc-doc-msg", "Caricamento di «" + nome + "»…");
    document.querySelectorAll("[data-sc-doc-carica]").forEach(b=>{ b.disabled = true; });
    try{ await caricaDocumento(s.c.id, file, nome); if(stato === s){ await caricaDocumenti(); messaggio("sc-doc-msg", "Documento caricato."); } }
    catch(err){ messaggio("sc-doc-msg", err.message, "err"); document.querySelectorAll("[data-sc-doc-carica]").forEach(b=>{ b.disabled = false; }); }
  }
});
