// Interventi (admin e company): creazione, modifica, assegnazione a uno o piu' operai, stato e
// rapportini collegati. I dati stanno nelle tabelle "interventi" e "intervento_operai" (RLS).
import { registraVista } from "../core/navigation.js";
import { puo } from "../core/permessi.js";
import { annullaIntervento, elencoInterventi, eliminaIntervento, leggiIntervento, nomeOperaio, operaiAttivi, salvaIntervento } from "../services/api-lavori.js";
import { dataIt, isoDi, oggiIso } from "../utils/dates.js";
import { esc } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { avanzamento } from "../services/avanzamento.js";
import { collegaSceltaCliente } from "./scelta-cliente.js";
import { sincronizzaClienti } from "../services/clienti-archivio.js";

const $ = id=>document.getElementById(id);
let inModifica = null;
let interventoAperto = null;   // dati dell'intervento in modifica (per avvisare se si toglie chi ha gia' un rapportino)
let interventi = [];
let operai = [];

export const PRIORITA = {
  urgente: '<span class="badge err">' + icona("zap") + 'Urgente</span>',
  alta: '<span class="badge att">Alta</span>',
  normale: '<span class="badge neutro">Normale</span>',
  bassa: '<span class="badge pervinca">Bassa</span>',
};
export const STATO_INTERVENTO = {
  pianificato: '<span class="badge neutro">' + icona("cal") + 'Pianificato</span>',
  in_corso: '<span class="badge att">' + icona("clock") + 'In corso</span>',
  completato: '<span class="badge ok">' + icona("check") + 'Completato</span>',
  annullato: '<span class="badge err">Annullato</span>',
};
export const STATO_RAPPORTINO = {
  bozza: '<span class="badge att">' + icona("pen") + 'Bozza</span>',
  completato: '<span class="badge ok">' + icona("check") + 'Completato</span>',
};
export const oraBreve = o=>o ? String(o).slice(0, 5) : "";
// campo cliente con suggerimenti dall'anagrafica (indirizzo e telefono copiati, modificabili per l'intervento)
const sceltaCliente = collegaSceltaCliente({ campo: $("int-cliente"), indirizzo: $("int-indirizzo"), telefono: $("int-telefono") });
function messaggio(testo, tipo){ $("int-stato").textContent = testo || ""; $("int-stato").className = "msg-info" + (tipo ? " " + tipo : ""); }

async function caricaOperai(){
  try{ operai = await operaiAttivi(); }catch(e){ operai = []; }
  return operai;
}

// ---------------------------------------------------------------- elenco
export async function disegnaInterventi(){
  if(!$("int-dal").value){
    const d = new Date(oggiIso() + "T12:00:00"); d.setDate(d.getDate() - 7);
    $("int-dal").value = isoDi(d);
  }
  messaggio("Caricamento…");
  try{
    await caricaOperai();
    interventi = await elencoInterventi({ dal: $("int-dal").value });
  }catch(e){
    messaggio(e.message, "err"); return;
  }
  const chiusi = $("int-chiusi").checked;
  const visibili = interventi.filter(i=>chiusi || !["completato", "annullato"].includes(i.stato));
  messaggio(visibili.length ? "" : "Nessun intervento dal " + dataIt($("int-dal").value) + ".", visibili.length ? "" : "att");
  $("int-elenco").innerHTML = visibili.map(schedaIntervento).join("");
}
function schedaIntervento(i){
  const av = avanzamento(i);
  const assegnati = av.attivi.map(nomeOperaio);
  const rapp = i.rapportini || [];
  const completati = rapp.filter(r=>r.stato === "completato").length;
  // avanzamento: quanti assegnati hanno completato il proprio rapportino e chi manca
  const progresso = av.attivi.length && i.stato !== "annullato"
    ? '<span class="int-avanz">' + icona("check", "i-sm") + av.completati.length + ' di ' + av.attivi.length + ' rapportini completati' +
      (av.mancanti.length ? ' · manca: ' + esc(av.mancanti.map(nomeOperaio).join(", ")) : '') + '</span>' : '';
  return '<article class="card intervento' + (i.stato === "annullato" ? " annullato" : "") + '">' +
    '<div class="int-top">' +
      '<div class="int-ora">' + esc(dataIt(i.data).slice(0, 5)) + (i.ora ? '<small>' + esc(oraBreve(i.ora)) + '</small>' : '') + '</div>' +
      '<div class="int-corpo">' +
        '<div class="int-cliente">' + esc(i.cliente) + '</div>' +
        (i.descrizione ? '<div class="int-desc">' + esc(i.descrizione) + '</div>' : '') +
        '<div class="int-meta">' +
          (i.indirizzo ? '<span>' + icona("pin", "i-sm") + esc(i.indirizzo) + '</span>' : '') +
          (i.telefono ? '<span>' + icona("phone", "i-sm") + esc(i.telefono) + '</span>' : '') +
          '<span>' + icona("users", "i-sm") + (assegnati.length ? esc(assegnati.join(", ")) : '<b style="color:var(--err-testo)">Nessun operaio</b>') + '</span>' +
          '<span>' + icona("file", "i-sm") + rapp.length + (rapp.length === 1 ? " rapportino" : " rapportini") + (rapp.length ? " (" + completati + " completat" + (completati === 1 ? "o" : "i") + ")" : "") + '</span>' +
          progresso +
        '</div>' +
        '<div class="int-badge">' + STATO_INTERVENTO[i.stato] + PRIORITA[i.priorita] + (i.tipologia ? '<span class="badge pervinca">' + esc(i.tipologia) + '</span>' : '') + '</div>' +
      '</div>' +
    '</div>' +
    (rapp.length ? '<div class="int-rapportini">' + rapp.map(r=>
      '<button type="button" class="link-btn" onclick="apriRapportino(\'' + r.id + '\')">' + icona("file", "i-sm") +
      esc(nomeOperaio(r.autore_id)) + (av.rimossi.includes(r.autore_id) ? ' (rimosso)' : '') + ' · ' + esc(dataIt(r.data)) + '</button>' + STATO_RAPPORTINO[r.stato]).join("") + '</div>' : '') +
    '<div class="int-azioni">' +
      '<button type="button" class="btn btn-secondario" onclick="apriModuloIntervento(\'' + i.id + '\')">' + icona("pen") + 'Modifica</button>' +
      (i.stato === "annullato"
        ? '<button type="button" class="btn btn-secondario" onclick="annullaInterventoUI(\'' + i.id + '\', false)">Ripristina</button>'
        : (i.stato !== "completato" ? '<button type="button" class="btn btn-secondario" onclick="annullaInterventoUI(\'' + i.id + '\', true)">Annulla</button>' : '')) +
      (!rapp.length && puo("interventi.elimina") ? '<button type="button" class="btn btn-secondario" aria-label="Elimina intervento" onclick="eliminaInterventoUI(\'' + i.id + '\')">' + icona("trash") + '</button>' : '') +
    '</div>' +
  '</article>';
}
export function spostaPeriodoInterventi(delta){
  const d = new Date(($("int-dal").value || oggiIso()) + "T12:00:00");
  d.setDate(d.getDate() + 7 * delta);
  $("int-dal").value = isoDi(d);
  disegnaInterventi();
}

// ---------------------------------------------------------------- modulo
// id = intervento da modificare; cliente (facoltativo, nuovo intervento) = dati copiati da una scheda
export async function apriModuloIntervento(id, cliente){
  inModifica = id || null;
  $("int-errore").textContent = "";
  await caricaOperai();
  let i = { data: oggiIso(), ora: "", cliente: "", indirizzo: "", descrizione: "", priorita: "normale", tipologia: "", intervento_operai: [] };
  if(id){
    try{ i = await leggiIntervento(id) || i; }catch(e){ messaggio(e.message, "err"); return; }
  }
  interventoAperto = id ? i : null;
  $("int-form-titolo").textContent = id ? "Modifica intervento" : "Nuovo intervento";
  $("int-data").value = i.data; $("int-ora").value = oraBreve(i.ora);
  if(!id && cliente && cliente.cliente) Object.assign(i, cliente);
  $("int-cliente").value = i.cliente; $("int-indirizzo").value = i.indirizzo; $("int-telefono").value = i.telefono || "";
  sceltaCliente.imposta(i.cliente_id || null);
  $("int-descrizione").value = i.descrizione; $("int-priorita").value = i.priorita; $("int-tipologia").value = i.tipologia;
  const assegnati = new Set(avanzamento(i).attivi);
  $("int-operai").innerHTML = operai.length ? operai.map(o=>
    '<label class="spunta-operaio"><input type="checkbox" value="' + o.id + '"' + (assegnati.has(o.id) ? " checked" : "") + '>' +
    '<span>' + esc(o.nome || o.username) + ' <small>@' + esc(o.username) + '</small></span></label>').join("")
    : '<div class="nota" style="padding:8px 0">Nessun operaio attivo: l\'amministratore li crea da Gestione utenti.</div>';
  $("int-form").classList.remove("nascosto");
  $("int-nuovo").classList.add("nascosto");
  $("int-form").scrollIntoView({ block: "start" });
  if(!$("int-cliente").value) $("int-cliente").focus({ preventScroll: true });
}
export function chiudiModuloIntervento(){
  inModifica = null;
  interventoAperto = null;
  $("int-form").classList.add("nascosto");
  $("int-nuovo").classList.remove("nascosto");
}
$("int-form").addEventListener("submit", async e=>{
  e.preventDefault();
  const cliente = $("int-cliente").value.trim();
  if(!$("int-data").value || !cliente){ $("int-errore").textContent = "Data e cliente sono obbligatori."; return; }
  const scelti = [...$("int-operai").querySelectorAll("input:checked")].map(x=>x.value);
  // togliere chi ha gia' un rapportino: resta nello storico (il database non cancella nulla)
  if(interventoAperto){
    const av = avanzamento(interventoAperto);
    const conRapportino = av.attivi.filter(o=>!scelti.includes(o) && av.suoi(o).length);
    if(conRapportino.length && !confirm(conRapportino.map(nomeOperaio).join(", ") + (conRapportino.length === 1 ? " ha" : " hanno") +
      " già un rapportino su questo intervento: verrà tolto dagli assegnati ma il rapportino, le ore e le foto restano nello storico. Continuare?")) return;
  }
  const btn = $("int-salva");
  btn.disabled = true; btn.classList.add("in-corso");
  try{
    // una scheda cliente creata al volo (ancora sul telefono) va prima al server: cosi' il collegamento arriva
    if(sceltaCliente.id()) await sincronizzaClienti().catch(()=>{});
    await salvaIntervento({ id: inModifica, data: $("int-data").value, ora: $("int-ora").value, cliente,
      indirizzo: $("int-indirizzo").value.trim(), telefono: $("int-telefono").value.trim(), cliente_id: sceltaCliente.id(),
      descrizione: $("int-descrizione").value.trim(),
      priorita: $("int-priorita").value, tipologia: $("int-tipologia").value }, scelti);
    const nuovo = !inModifica;
    chiudiModuloIntervento();
    if(nuovo && $("int-data").value < $("int-dal").value) $("int-dal").value = $("int-data").value;
    await disegnaInterventi();
    messaggio(nuovo ? "Intervento creato" + (scelti.length ? " e assegnato." : ": ricordati di assegnarlo.") : "Intervento aggiornato.", scelti.length ? "" : "att");
  }catch(err){
    $("int-errore").textContent = err.message;
  }finally{
    btn.disabled = false; btn.classList.remove("in-corso");
  }
});
export async function annullaInterventoUI(id, annullato){
  if(annullato && !confirm("Annullare l'intervento? Gli operai lo vedranno come annullato.")) return;
  try{ await annullaIntervento(id, annullato); await disegnaInterventi(); }catch(e){ messaggio(e.message, "err"); }
}
export async function eliminaInterventoUI(id){
  if(!confirm("Eliminare definitivamente l'intervento?")) return;
  try{ await eliminaIntervento(id); await disegnaInterventi(); messaggio("Intervento eliminato."); }catch(e){ messaggio(e.message, "err"); }
}

registraVista("interventi", ()=>{ chiudiModuloIntervento(); disegnaInterventi(); });
