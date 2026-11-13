// Interfaccia dell'assistente AI: pulsanti contestuali nel rapportino, nello Storico e in Altro.
// Schema comune (foglio "ai-foglio"): richiesta -> caricamento -> anteprima MODIFICABILE ->
// "Applica" (conferma esplicita) oppure "Annulla". Niente viene salvato o modificato senza conferma:
// "Applica" cambia solo i campi del modulo aperto, poi valgono i salvataggi normali dell'app.
// Le chiamate passano tutte da services/ai.js.
import { mostraVista } from "../core/navigation.js";
import { puo } from "../core/permessi.js";
import { su } from "../core/eventi.js";
import {
  ErroreAI, cercaArchivioLocale, contestoRapportino, controlloAI, descriviFoto, domandaDati, elaboraTesto, inLinea,
  ricercaIntelligente, suggerimenti, tendenze, verificaModelli,
} from "../services/ai.js";
import { applicaAlRapportino, controlloRapportinoAperto, statoRapportinoAperto } from "./modulo-rapportino.js";
import { apriModuloIntervento } from "./gestione-interventi.js";
import { disegnaStorico } from "./storico.js";
import { dataIt, isoDi, oggiIso } from "../utils/dates.js";
import { esc } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";

const $ = id=>document.getElementById(id);
const norma = t=>String(t || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const NOTA_AI = "Proposta generata dall'AI: controllala e modificala prima di applicarla.";

// ---------------------------------------------------------------- foglio comune
let richiesta = 0;
let focusPrima = null;
function msg(testo, tipo){ $("ai-msg").textContent = testo || ""; $("ai-msg").className = "msg-info" + (tipo ? " " + tipo : ""); }
function apriFoglio(titolo, nota){
  if($("ai-foglio").classList.contains("nascosto")) focusPrima = document.activeElement;
  $("ai-titolo").textContent = titolo;
  $("ai-nota").textContent = nota === undefined ? NOTA_AI : nota;
  msg("");
  $("ai-corpo").innerHTML = ""; $("ai-azioni").innerHTML = "";
  $("ai-foglio").classList.remove("nascosto");
  document.body.classList.add("foglio-aperto");
  $("ai-chiudi").focus({ preventScroll: true });
}
export function chiudiPannelloAI(){
  richiesta++;                                     // una risposta che arriva dopo viene ignorata
  $("ai-foglio").classList.add("nascosto");
  document.body.classList.remove("foglio-aperto");
  if(focusPrima && document.contains(focusPrima)) focusPrima.focus({ preventScroll: true });
  focusPrima = null;
}
function pulsanti(lista){
  const box = $("ai-azioni");
  box.innerHTML = "";
  lista.forEach(p=>{
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-blocco " + (p.primario ? "btn-primario" : "btn-secondario");
    b.innerHTML = (p.icona ? icona(p.icona) : "") + "<span>" + esc(p.testo) + "</span>";
    if(p.id) b.id = p.id;
    b.onclick = p.azione;
    box.appendChild(b);
  });
}
const attesa = testo=>'<div class="ai-attesa" role="status"><span class="ai-spinner" aria-hidden="true"></span>' + esc(testo || "Elaborazione in corso…") + '</div>';
const elencoHtml = (titolo, voci, cls)=>voci && voci.length
  ? '<div class="ai-sez"><div class="ai-sez-tit">' + esc(titolo) + '</div><ul class="ai-lista' + (cls ? " " + cls : "") + '">' + voci.map(v=>"<li>" + esc(v) + "</li>").join("") + "</ul></div>" : "";

// Esegue una richiesta con caricamento, errore (con "Riprova") e anteprima.
// mostra(risultato, corpo) disegna l'anteprima; applica(corpo) -> true se applicato, stringa = errore.
async function esegui({ titolo, carica, mostra, applica, etichetta, dopo }){
  const n = ++richiesta;
  if($("ai-foglio").classList.contains("nascosto")) apriFoglio(titolo);
  msg("");
  $("ai-corpo").innerHTML = attesa();
  pulsanti([{ testo: "Annulla", azione: chiudiPannelloAI }]);
  let ris;
  try{ ris = await carica(); }
  catch(e){
    if(n !== richiesta) return;
    $("ai-corpo").innerHTML = "";
    msg((e && e.message) || "Errore dell'assistente AI.", "err");
    const ripetibile = !(e instanceof ErroreAI) || !["input", "chiave", "non_configurata", "limite_giorno"].includes(e.codice);
    pulsanti([...(ripetibile ? [{ testo: "Riprova", primario: true, azione: ()=>esegui({ titolo, carica, mostra, applica, etichetta, dopo }) }] : []),
      { testo: "Chiudi", azione: chiudiPannelloAI }]);
    return;
  }
  if(n !== richiesta) return;
  $("ai-corpo").innerHTML = "";
  mostra(ris, $("ai-corpo"));
  if(!applica){ pulsanti([{ testo: "Chiudi", azione: chiudiPannelloAI }]); return; }
  pulsanti([
    { testo: etichetta || "Applica", primario: true, icona: "check", id: "ai-applica", azione: ()=>{
      const esito = applica($("ai-corpo"));
      if(esito !== true){ msg(typeof esito === "string" ? esito : "Non applicato.", "err"); return; }
      chiudiPannelloAI();
      if(dopo) dopo();
    } },
    { testo: "Annulla", azione: chiudiPannelloAI },
  ]);
}
document.addEventListener("keydown", e=>{ if(e.key === "Escape" && !$("ai-foglio").classList.contains("nascosto")) chiudiPannelloAI(); });
$("ai-foglio").addEventListener("click", e=>{ if(e.target.closest("[data-ai-chiudi]")) chiudiPannelloAI(); });
su("uscita", ()=>{ if(!$("ai-foglio").classList.contains("nascosto")) chiudiPannelloAI(); });

// ---------------------------------------------------------------- rapportino
function rapMsg(testo, tipo){ $("rap-msg").textContent = testo; $("rap-msg").className = "msg-info" + (tipo ? " " + tipo : ""); }
const APPLICATO = "Proposta dell'AI applicata: controlla il testo. È salvata sul telefono; premi Salva bozza per inviarla.";
function rapportinoModificabile(){
  const st = statoRapportinoAperto();
  if(!st) return null;
  if(!st.modificabile){ rapMsg("Il rapportino non è modificabile da questo account.", "err"); return null; }
  return st;
}
const contesto = st=>contestoRapportino(st.rapportino, st.ore, st.foto, st.intervento);

const TITOLI_TESTO = { genera: "Descrizione da appunti", migliora: "Migliora il testo", correggi: "Correggi il testo" };
export function aiTestoRapportino(modo){
  const st = rapportinoModificabile();
  if(!st) return;
  const originale = st.rapportino.attivita;
  esegui({
    titolo: TITOLI_TESTO[modo] || "Assistente",
    carica: ()=>elaboraTesto(modo, originale, contesto(st)),
    mostra: (r, corpo)=>{
      corpo.innerHTML = '<label for="ai-testo">Testo proposto (modificabile)</label>' +
        '<textarea id="ai-testo" rows="8" maxlength="6000"></textarea>' +
        elencoHtml("Da verificare", r.avvisi, "att") +
        '<details class="ai-orig"><summary>Testo attuale</summary><div class="idt-desc"></div></details>';
      corpo.querySelector("#ai-testo").value = r.testo;
      corpo.querySelector(".ai-orig .idt-desc").textContent = originale;
    },
    etichetta: "Sostituisci il testo",
    applica: corpo=>{
      const t = corpo.querySelector("#ai-testo").value.trim();
      if(!t) return "Il testo è vuoto.";
      return applicaAlRapportino({ attivita: t }) || "Rapportino non modificabile.";
    },
    dopo: ()=>rapMsg(APPLICATO, "att"),
  });
}

export function aiSuggerimentiRapportino(){
  const st = rapportinoModificabile();
  if(!st) return;
  if(!st.rapportino.cliente){ rapMsg("Indica prima il cliente: i suggerimenti usano i suoi lavori precedenti.", "err"); return; }
  esegui({
    titolo: "Suggerimenti",
    carica: ()=>suggerimenti(contesto(st), st.id),
    mostra: (r, corpo)=>{
      const voce = (tipo, i, testo, extra)=>'<label class="check ai-scelta"><input type="checkbox" data-' + tipo + '="' + i + '"><span>' + esc(testo) + '</span>' + (extra || "") + '</label>';
      corpo.innerHTML =
        (r.attivita.length ? '<div class="ai-sez"><div class="ai-sez-tit">Attività da aggiungere</div>' + r.attivita.map((a, i)=>voce("att", i, a)).join("") + '</div>' : "") +
        (r.materiali.length ? '<div class="ai-sez"><div class="ai-sez-tit">Materiali usati in passato per questo cliente</div>' +
          r.materiali.map((m, i)=>voce("mat", i, m.a, '<input type="text" class="ai-qta" data-qta="' + i + '" aria-label="Quantità" placeholder="Q.tà">')).join("") + '</div>' : "") +
        elencoHtml("Controlli consigliati (promemoria, non vengono scritti)", r.controlli) +
        (!r.attivita.length && !r.materiali.length && !r.controlli.length ? '<p class="nota" style="padding:0">Nessun suggerimento utile per questo rapportino.</p>' : "") +
        '<p class="nota ai-fonte">' + (r.storico ? "Basati anche su " + r.storico + (r.storico === 1 ? " rapportino precedente" : " rapportini precedenti") + " del cliente che puoi vedere." : "Nessun rapportino precedente del cliente visibile al tuo account.") + '</p>';
      r.materiali.forEach((m, i)=>{ corpo.querySelector('[data-qta="' + i + '"]').value = m.q || ""; });
      corpo._dati = r;
    },
    etichetta: "Aggiungi i selezionati",
    applica: corpo=>{
      const r = corpo._dati;
      const att = [...corpo.querySelectorAll("[data-att]:checked")].map(x=>"- " + r.attivita[+x.dataset.att]);
      const mat = [...corpo.querySelectorAll("[data-mat]:checked")].map(x=>({ a: r.materiali[+x.dataset.mat].a, q: corpo.querySelector('[data-qta="' + x.dataset.mat + '"]').value.trim() }));
      if(!att.length && !mat.length) return "Seleziona almeno un suggerimento da aggiungere.";
      return applicaAlRapportino({ aggiungiAttivita: att.join("\n"), materiali: mat }) || "Rapportino non modificabile.";
    },
    dopo: ()=>rapMsg(APPLICATO, "att"),
  });
}

export function aiFotoRapportino(){
  const st = rapportinoModificabile();
  if(!st) return;
  if(!st.sorgentiFoto.length){ rapMsg("Aggiungi prima almeno una foto (quelle ancora in caricamento non sono disponibili).", "err"); return; }
  // passo 1: scelta delle foto (al massimo 3) e note facoltative
  apriFoglio("Descrizione dalle foto", "Le foto scelte vengono ridotte e inviate al servizio AI solo per questa richiesta.");
  const corpo = $("ai-corpo");
  corpo.innerHTML = '<div class="ai-sez-tit">Scegli fino a 3 foto</div><div class="ai-foto-scelta">' +
    st.sorgentiFoto.map((_, i)=>'<label class="ai-foto"><input type="checkbox" data-foto="' + i + '"' + (i < 3 ? " checked" : "") + '><img alt="Foto ' + (i + 1) + '"></label>').join("") + '</div>' +
    '<label for="ai-foto-note">Indicazioni (facoltative)</label><input type="text" id="ai-foto-note" maxlength="300" placeholder="Es. quadro elettrico dopo la sostituzione">';
  corpo.querySelectorAll(".ai-foto img").forEach((img, i)=>{ img.src = st.sorgentiFoto[i]; });
  const conta = ()=>corpo.querySelectorAll("[data-foto]:checked").length;
  corpo.addEventListener("change", e=>{ if(e.target.dataset.foto !== undefined && conta() > 3){ e.target.checked = false; msg("Al massimo 3 foto per richiesta.", "att"); } });
  pulsanti([
    { testo: "Analizza le foto", primario: true, id: "ai-analizza", azione: ()=>{
      const scelte = [...corpo.querySelectorAll("[data-foto]:checked")].map(x=>st.sorgentiFoto[+x.dataset.foto]);
      if(!scelte.length){ msg("Scegli almeno una foto.", "err"); return; }
      const note = corpo.querySelector("#ai-foto-note").value;
      $("ai-nota").textContent = NOTA_AI;
      esegui({
        titolo: "Descrizione dalle foto",
        carica: ()=>descriviFoto(scelte, note, contesto(st)),
        mostra: (r, c)=>{
          c.innerHTML = '<label for="ai-testo">Descrizione proposta (modificabile)</label><textarea id="ai-testo" rows="6" maxlength="3000"></textarea>' +
            elencoHtml("Non certo dalle foto (da verificare)", r.incertezze, "att") +
            elencoHtml("Elementi visibili", r.elementi) +
            (r.materiali.length ? '<div class="ai-sez"><div class="ai-sez-tit">Materiali visibili (spunta per aggiungerli)</div>' +
              r.materiali.map((m, i)=>'<label class="check ai-scelta"><input type="checkbox" data-mat="' + i + '"><span>' + esc(m) + '</span></label>').join("") + '</div>' : "");
          c.querySelector("#ai-testo").value = r.descrizione;
          c._dati = r;
        },
        etichetta: "Aggiungi alle attività",
        applica: c=>{
          const t = c.querySelector("#ai-testo").value.trim();
          const mat = [...c.querySelectorAll("[data-mat]:checked")].map(x=>({ a: c._dati.materiali[+x.dataset.mat], q: "" }));
          if(!t && !mat.length) return "Niente da aggiungere.";
          return applicaAlRapportino({ aggiungiAttivita: t, materiali: mat }) || "Rapportino non modificabile.";
        },
        dopo: ()=>rapMsg(APPLICATO, "att"),
      });
    } },
    { testo: "Annulla", azione: chiudiPannelloAI },
  ]);
}

const LIVELLO = { errore: ["err", "Da correggere"], attenzione: ["att", "Da controllare"], info: ["neutro", "Suggerimento"] };
function segnalazioniHtml(lista){
  if(!lista.length) return '<p class="msg-info">Nessun problema trovato.</p>';
  return '<ul class="ai-segn">' + lista.map(s=>'<li class="ai-segn-' + esc(s.livello) + '"><span class="badge ' + LIVELLO[s.livello][0] + '">' + LIVELLO[s.livello][1] + '</span>' +
    (s.origine === "ai" ? '<span class="badge pervinca">AI</span>' : "") + '<span>' + esc(s.messaggio) + '</span></li>').join("") + '</ul>';
}
// Controllo: subito le regole dell'app (anche offline); a richiesta la coerenza con l'AI.
export function aiControlloRapportino(){
  const st = statoRapportinoAperto();
  if(!st) return;
  const base = controlloRapportinoAperto();
  apriFoglio("Controllo del rapportino", "Controlli automatici dell'app: dati mancanti, ore, materiali, firma e foto. Nessuna modifica viene fatta.");
  $("ai-corpo").innerHTML = '<div id="ai-segn-base">' + segnalazioniHtml(base) + '</div><div id="ai-segn-ai"></div>';
  const azioni = [];
  if(puo("ai.controllo")){
    azioni.push({ testo: "Controlla la coerenza con l'AI", primario: true, id: "ai-coerenza", azione: async()=>{
      const n = ++richiesta;
      const box = $("ai-segn-ai");
      if(!inLinea()){ msg("Nessuna connessione: il controllo con l'AI richiede Internet. I controlli qui sopra valgono anche offline.", "att"); return; }
      box.innerHTML = attesa("Controllo di coerenza in corso…");
      $("ai-coerenza").disabled = true;
      try{
        const r = await controlloAI(contesto(st), base.map(s=>s.messaggio));
        if(n !== richiesta) return;
        box.innerHTML = '<div class="ai-sez-tit">Coerenza (AI, da verificare)</div>' + (r.segnalazioni.length ? segnalazioniHtml(r.segnalazioni) : '<p class="nota" style="padding:0">Nessuna incoerenza trovata dall\'AI.</p>');
      }catch(e){
        if(n !== richiesta) return;
        box.innerHTML = "";
        msg(e.message, "err");
      }finally{ const b = $("ai-coerenza"); if(b) b.disabled = false; }
    } });
  }
  azioni.push({ testo: "Chiudi", azione: chiudiPannelloAI });
  pulsanti(azioni);
}

// ---------------------------------------------------------------- Storico: ricerca intelligente
// Il risultato diventa filtri dello Storico (periodo, cliente, operaio, stato, parole): l'elenco e il PDF
// restano quelli di sempre e i filtri si possono correggere a mano.
export async function aiRicercaStorico(btn){
  const q = $("st-ai").value.trim();
  const stato = (t, tipo)=>{ $("st-stato-msg").textContent = t; $("st-stato-msg").className = "msg-info" + (tipo ? " " + tipo : "") + (t ? "" : " nascosto"); };
  if(!q){ stato("Scrivi cosa cercare, ad esempio: caldaie riparate a ottobre da Mario.", "att"); return; }
  btn.disabled = true; btn.classList.add("in-corso");
  stato("Ricerca intelligente in corso…");
  try{
    const r = await ricercaIntelligente(q);
    const f = r.filtri;
    $("st-mese").value = ""; $("st-dal").value = f.dal; $("st-al").value = f.al;
    $("st-cliente").value = ""; $("st-operaio").value = ""; $("st-stato").value = ""; $("st-cerca").value = "";
    await disegnaStorico();                                         // carica il periodo e i nomi nei filtri
    const scegli = (sel, testo)=>{
      if(!testo) return true;
      const t = norma(testo);
      const o = [...$(sel).options].find(x=>x.value && norma(x.textContent) === t) || [...$(sel).options].find(x=>x.value && norma(x.textContent).includes(t));
      if(o){ $(sel).value = o.value; return true; }
      return false;
    };
    const parole = [...f.parole];
    if(!scegli("st-cliente", f.cliente) && f.cliente) parole.unshift(f.cliente);   // cliente non in elenco: diventa parola chiave
    const operaioTrovato = scegli("st-operaio", f.operaio);
    if(["pianificato", "in_corso", "completato", "annullato", "bozza"].includes(f.stato)) $("st-stato").value = f.stato;
    $("st-cerca").value = parole.join(" ");
    await disegnaStorico();
    stato("Ricerca AI: " + (f.spiegazione || q) + " — " + dataIt(f.dal) + "–" + dataIt(f.al) + ". Filtri applicati qui sotto: puoi modificarli." +
      (f.operaio && !operaioTrovato ? " Operaio \"" + f.operaio + "\" non trovato." : ""), "");
  }catch(e){ stato(e.message, "err"); }
  finally{ btn.disabled = false; btn.classList.remove("in-corso"); }
}

// ---------------------------------------------------------------- Altro: assistente dati
let ultimaPredittiva = null;
function esito(html, testo, tipo){
  $("ai-esito").innerHTML = html || "";
  $("ai-esito-msg").textContent = testo || "";
  $("ai-esito-msg").className = "msg-info" + (tipo ? " " + tipo : "");
}
function periodoAltro(){
  if(!$("ai-al").value) $("ai-al").value = oggiIso();
  if(!$("ai-dal").value){ const d = new Date(oggiIso() + "T12:00:00"); d.setDate(d.getDate() - 90); $("ai-dal").value = isoDi(d); }
  return { dal: $("ai-dal").value, al: $("ai-al").value };
}
const rigaRisultato = (onclick, titolo, sotto, badge)=>'<button type="button" class="st-rap ai-ris" onclick="' + onclick + '">' +
  '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(titolo) + '</span>' +
  (sotto ? '<span class="cli-ind" style="display:block">' + esc(sotto) + '</span>' : "") + '</span>' + (badge || "") + icona("chev-r", "chev") + '</button>';
const STATI = { pianificato: "Pianificato", in_corso: "In corso", completato: "Completato", annullato: "Annullato", bozza: "Bozza" };
const badgeStato = s=>'<span class="badge neutro">' + esc(STATI[s] || s) + '</span>';
const UUID = /^[0-9a-f-]{36}$/i;

function disegnaRicerca(r){
  const f = r.filtri;
  const vecchi = puo("vista.storico") || puo("vista.giorno") ? cercaArchivioLocale(f) : [];
  const n = r.interventi.length + r.rapportini.length + vecchi.length;
  let html = '<p class="nota ai-fonte">' + esc(f.spiegazione || "Risultati") + " · " + esc(dataIt(f.dal)) + "–" + esc(dataIt(f.al)) + '</p>';
  if(r.interventi.length) html += '<div class="ai-sez-tit">Interventi</div>' + r.interventi.filter(i=>UUID.test(i.id)).map(i=>
    rigaRisultato("apriDettaglioIntervento('" + i.id + "')", i.cliente, [dataIt(i.data) + (i.ora ? " " + i.ora : ""), i.descrizione].filter(Boolean).join(" · "), badgeStato(i.stato))).join("");
  if(r.rapportini.length) html += '<div class="ai-sez-tit">Rapportini</div>' + r.rapportini.filter(x=>UUID.test(x.id)).map(x=>
    rigaRisultato("apriRapportino('" + x.id + "')", x.cliente, [dataIt(x.data), (x.operai || []).join(", "), x.attivita].filter(Boolean).join(" · "), badgeStato(x.stato))).join("");
  if(vecchi.length) html += '<div class="ai-sez-tit">Vecchia app (archivio sul telefono)</div>' + vecchi.map(v=>
    puo("vista.giorno") ? rigaRisultato("apriGiorno('" + v.iso + "')", v.nome, [dataIt(v.iso), v.dettagli].filter(Boolean).join(" · "))
      : '<div class="st-rap ai-ris"><span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(v.nome) + '</span><span class="cli-ind" style="display:block">' + esc([dataIt(v.iso), v.dettagli].filter(Boolean).join(" · ")) + '</span></span></div>').join("");
  esito(html, n ? n + (n === 1 ? " risultato" : " risultati") + "." : (r.nota || "Nessun risultato con questi criteri."), n ? "" : "att");
}
function disegnaDomanda(r){
  esito('<div class="idt-desc ai-risposta"></div>' + elencoHtml("Dati usati", r.dati_usati) +
    (r.limiti ? '<p class="nota ai-fonte">Limiti: ' + esc(r.limiti) + '</p>' : "") +
    '<p class="nota ai-fonte">Periodo ' + esc(dataIt(r.periodo.dal)) + "–" + esc(dataIt(r.periodo.al)) + (r.righe ? " · " + r.righe.rapportini + " rapportini, " + r.righe.interventi + " interventi visibili al tuo account" : "") + '. Risposta generata dall\'AI: verificala.</p>');
  $("ai-esito").querySelector(".ai-risposta").textContent = r.risposta;
}
function disegnaPredittiva(r){
  ultimaPredittiva = r;
  const s = r.statistiche;
  let html = "";
  if(r.commento && r.commento.sintesi) html += '<div class="idt-desc ai-risposta"></div>' + elencoHtml("Attività suggerite (da valutare)", r.commento.suggerimenti);
  if(s.ricorrenze.length) html += '<div class="ai-sez-tit">Ricorrenze per cliente</div>' + s.ricorrenze.map((x, i)=>
    '<div class="ai-ric"><div><b>' + esc(x.cliente) + '</b><span class="cli-ind" style="display:block">' + x.volte + ' lavori, in media ogni ' + x.ogniGiorni + ' giorni' +
    (x.regolare ? "" : " (irregolare)") + ' · ultimo ' + esc(dataIt(x.ultima)) + (x.prossimaStimata ? " · prossimo stimato " + esc(dataIt(x.prossimaStimata)) : "") + '</span></div>' +
    (x.prossimaStimata && puo("interventi.gestisci") ? '<button type="button" class="btn btn-secondario" onclick="aiPreparaIntervento(' + i + ')">Prepara intervento</button>' : "") + '</div>').join("");
  if(s.anomalie.length) html += '<div class="ai-sez-tit">Anomalie</div>' + s.anomalie.map(a=>{
    const apri = a.tipo === "intervento scaduto" ? "apriDettaglioIntervento('" + a.id + "')" : "apriRapportino('" + a.id + "')";
    return UUID.test(a.id) ? rigaRisultato(apri, a.cliente, dataIt(a.data) + " · " + a.dettaglio, '<span class="badge att">' + esc(a.tipo) + '</span>') : "";
  }).join("");
  if(s.tendenze) html += '<div class="ai-sez-tit">Tendenza: ' + esc(s.tendenze.direzione) + (s.tendenze.variazionePercento !== null ? " (" + (s.tendenze.variazionePercento > 0 ? "+" : "") + s.tendenze.variazionePercento + "%)" : "") + '</div>' +
    '<div class="ai-mesi">' + s.tendenze.mesi.map(m=>'<div class="ai-mese"><span>' + esc(m.mese) + '</span><b>' + m.rapportini + '</b><small>' + m.ore + ' h</small></div>').join("") + '</div>';
  if(s.insufficienti.length) html += elencoHtml("Dati insufficienti per", s.insufficienti, "neutro");
  html += '<p class="nota ai-fonte">Calcolato su ' + s.rapportini + ' rapportini e ' + s.interventi + ' interventi dal ' + esc(dataIt(s.periodo.dal)) + ' al ' + esc(dataIt(s.periodo.al)) + '. Le stime non sono certezze.</p>';
  esito(html, r.sufficienti ? (r.avviso ? "Statistiche calcolate; commento AI non disponibile: " + r.avviso : "") : "Dati insufficienti per individuare ricorrenze, anomalie o tendenze affidabili.", r.sufficienti ? (r.avviso ? "att" : "") : "att");
  const box = $("ai-esito").querySelector(".ai-risposta");
  if(box) box.textContent = r.commento.sintesi;
}
function disegnaModelli(r){
  esito('<div class="info-riga"><span>Testo</span><b>' + esc(r.configurati.testo) + '</b></div><div class="info-riga"><span>Riserva</span><b>' + esc(r.configurati.riserva) + '</b></div>' +
    '<div class="info-riga"><span>Visione (foto)</span><b>' + esc(r.configurati.visione) + '</b></div>' +
    '<p class="nota ai-fonte">Modelli attivi sull\'account Groq: ' + esc(r.disponibili.join(", ") || "nessuno") + '</p>',
    r.mancanti.length ? "Non disponibili su Groq: " + r.mancanti.join(", ") + ". Imposta un altro modello nei secret (vedi README)." : "Tutti i modelli configurati sono disponibili.",
    r.mancanti.length ? "err" : "");
}

export async function aiAssistente(tipo, btn){
  const domanda = $("ai-domanda").value.trim();
  if((tipo === "ricerca" || tipo === "domanda") && !domanda){ esito("", "Scrivi la domanda o cosa cercare.", "att"); $("ai-domanda").focus(); return; }
  btn.disabled = true; btn.classList.add("in-corso");
  esito(attesa(), "");
  try{
    if(tipo === "ricerca") disegnaRicerca(await ricercaIntelligente(domanda));
    else if(tipo === "domanda"){ const p = periodoAltro(); disegnaDomanda(await domandaDati(domanda, p.dal, p.al)); }
    else if(tipo === "predittiva"){
      // ricorrenze e tendenze: almeno 12 mesi fino alla data "Al"
      const al = $("ai-al").value || oggiIso();
      const d = new Date(al + "T12:00:00"); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1);
      disegnaPredittiva(await tendenze(isoDi(d), al));
    }
    else if(tipo === "modelli") disegnaModelli(await verificaModelli());
  }catch(e){ esito("", e.message, "err"); }
  finally{ btn.disabled = false; btn.classList.remove("in-corso"); }
}

// Automazione proposta: prepara il modulo di un nuovo intervento, che l'utente controlla e salva.
export async function aiPreparaIntervento(i){
  const x = ultimaPredittiva && ultimaPredittiva.statistiche.ricorrenze[i];
  if(!x || !puo("interventi.gestisci")) return;
  mostraVista("interventi");
  await apriModuloIntervento();
  $("int-cliente").value = x.cliente;
  $("int-data").value = x.prossimaStimata > oggiIso() ? x.prossimaStimata : oggiIso();
  $("int-descrizione").value = "Intervento periodico: in media ogni " + x.ogniGiorni + " giorni (ultimo " + dataIt(x.ultima) + "). Proposto dall'assistente: verifica prima di salvare.";
}

// periodo predefinito dei campi in Altro
su("accesso", ()=>{ $("ai-dal").value = ""; $("ai-al").value = ""; esito("", ""); });
