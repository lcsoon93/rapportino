// Clienti: anagrafica ricavata dai rapporti, ricerca, storico, suggerimenti di completamento.
import { dataIt } from "../utils/dates.js";
import { esc, euro, evidenzia, iniziali } from "../utils/formatters.js";
import { leggiDB } from "../core/storage.js";
import { registraVista } from "../core/navigation.js";
import { icona } from "../utils/dom.js";
import { nuovoRapportino } from "./dashboard.js";
import { su } from "../core/eventi.js";

export function aggiornaClientiNoti(){
  const db = leggiDB();
  const nomi = new Set();
  Object.values(db).forEach(d=>{
    (d.clienti || []).forEach(c=>{
      if(c.nome && c.nome !== "(senza nome)") nomi.add(c.nome);
    });
  });
  nomiNoti = [...nomi].sort();
  const indirizzi = new Set();
  Object.values(db).forEach(d=>{
    (d.clienti || []).forEach(c=>{ if(c.indirizzo) indirizzi.add(c.indirizzo); });
  });
  indirizziNoti = [...indirizzi].sort();
}
// Suggerimenti fatti a mano al posto del <datalist>: quello di Safari si apre a ogni lettera
// e si finiva per toccarlo per sbaglio. Questi compaiono solo dopo una pausa nella scrittura,
// spariscono appena si riprende a scrivere e ignorano i tocchi arrivati subito dopo la comparsa.
export let nomiNoti = [], indirizziNoti = [];
export const SUGG_MIN_LETTERE = 3;     // lettere da scrivere prima di vedere suggerimenti
export const SUGG_PAUSA = 900;         // ms di pausa nella scrittura prima di mostrarli
export const SUGG_MAX = 4;             // quanti al massimo
export const SUGG_BLOCCO_TOCCO = 400;  // ms dopo la comparsa in cui un tocco viene ignorato
export let suggTimer = null, suggCampo = null, suggMostratiAlle = 0;
export function chiudiSuggerimenti(){
  clearTimeout(suggTimer);
  const box = document.getElementById("suggerimenti");
  box.classList.add("nascosto");
  box.innerHTML = "";
  suggCampo = null;
}
export function programmaSuggerimenti(campo){
  chiudiSuggerimenti();
  suggTimer = setTimeout(()=>mostraSuggerimenti(campo), SUGG_PAUSA);
}
export function mostraSuggerimenti(campo){
  if(document.activeElement !== campo) return;
  const testo = campo.value.trim().toLowerCase();
  if(testo.length < SUGG_MIN_LETTERE) return;
  const elenco = campo.classList.contains("c-nome") ? nomiNoti : indirizziNoti;
  // prima quelli che iniziano con il testo, poi quelli che lo contengono; esclusa la corrispondenza esatta
  const trovati = elenco.filter(v=>v.toLowerCase() !== testo && v.toLowerCase().includes(testo))
    .sort((a,b)=>(b.toLowerCase().startsWith(testo) - a.toLowerCase().startsWith(testo)) || a.localeCompare(b))
    .slice(0, SUGG_MAX);
  if(!trovati.length) return;
  const box = document.getElementById("suggerimenti");
  box.innerHTML = "";
  trovati.forEach(v=>{
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sugg-voce";
    b.textContent = v;
    b.addEventListener("mousedown", e=>e.preventDefault());   // il campo non perde il fuoco
    b.addEventListener("click", ()=>{
      if(Date.now() - suggMostratiAlle < SUGG_BLOCCO_TOCCO) return;   // tocco troppo ravvicinato: era per la tastiera
      campo.value = v;
      chiudiSuggerimenti();
      campo.dispatchEvent(new Event("input", {bubbles:true}));
      chiudiSuggerimenti();                                        // l'evento input li riprogrammerebbe
    });
    box.appendChild(b);
  });
  const chiudi = document.createElement("button");
  chiudi.type = "button";
  chiudi.className = "sugg-chiudi";
  chiudi.textContent = "Chiudi suggerimenti";
  chiudi.addEventListener("mousedown", e=>e.preventDefault());
  chiudi.addEventListener("click", chiudiSuggerimenti);
  box.appendChild(chiudi);
  // larghezza della scheda cliente (il campo nome e' stretto), subito sotto il campo
  const r = campo.getBoundingClientRect();
  const rs = (campo.closest(".cliente") || campo).getBoundingClientRect();
  box.style.left = (rs.left + window.scrollX) + "px";
  box.style.top = (r.bottom + window.scrollY + 4) + "px";
  box.style.width = rs.width + "px";
  box.classList.remove("nascosto");
  suggCampo = campo;
  suggMostratiAlle = Date.now();
  // se finisce sotto la tastiera o la barra in basso, faccio scorrere la pagina
  const altezzaVisibile = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const barra = document.querySelector(".barra:not(.nascosto)");
  const nav = document.querySelector(".navbar");
  const fondo = barra ? barra.getBoundingClientRect().top : (nav ? nav.getBoundingClientRect().top : window.innerHeight);
  const limite = Math.min(altezzaVisibile, fondo);
  const sporgenza = box.getBoundingClientRect().bottom - limite + 8;
  if(sporgenza > 0) window.scrollBy(0, Math.min(sporgenza, r.top - 70));   // il campo resta visibile
}
document.addEventListener("input", e=>{
  const t = e.target;
  if(t.classList && (t.classList.contains("c-nome") || t.classList.contains("c-indirizzo"))) programmaSuggerimenti(t);
});
document.addEventListener("focusout", e=>{
  if(e.target === suggCampo || (e.target.classList && (e.target.classList.contains("c-nome") || e.target.classList.contains("c-indirizzo")))){
    setTimeout(()=>{ if(!suggCampo || document.activeElement !== suggCampo) chiudiSuggerimenti(); }, 150);
  }
});
window.addEventListener("resize", ()=>{ if(suggCampo) chiudiSuggerimenti(); });
// anagrafica ricavata dai rapportini salvati (nessuna anagrafica separata, nessun id nuovo):
// un cliente per nome, con l'indirizzo e la data dell'intervento piu' recente
export function anagraficaClienti(){
  const db = leggiDB();
  const mappa = {};
  Object.keys(db).sort().forEach(iso=>{
    ((db[iso] && db[iso].clienti) || []).forEach(c=>{
      if(!c.nome || c.nome === "(senza nome)") return;
      const k = c.nome.trim().toLowerCase();
      const v = mappa[k] || (mappa[k] = {nome: c.nome.trim(), indirizzo: "", n: 0, ultimo: ""});
      v.n++;
      v.ultimo = iso;
      v.nome = c.nome.trim();
      if(c.indirizzo) v.indirizzo = c.indirizzo;
    });
  });
  return Object.values(mappa).sort((a,b)=>b.ultimo.localeCompare(a.ultimo) || a.nome.localeCompare(b.nome));
}
export function rigaClienteHtml(v){
  return '<button type="button" class="cli-riga" data-nome="' + esc(v.nome) + '" onclick="apriCliente(this.dataset.nome)">' +
    '<span class="avatar" aria-hidden="true">' + esc(iniziali(v.nome)) + '</span>' +
    '<span class="cli-testi">' +
      '<span class="cli-nome" style="display:block">' + esc(v.nome) + '</span>' +
      (v.indirizzo ? '<span class="cli-ind" style="display:block">' + esc(v.indirizzo) + '</span>' : '') +
      '<span class="cli-info" style="display:block">' + v.n + (v.n === 1 ? " intervento" : " interventi") + ' · ultimo ' + dataIt(v.ultimo) + '</span>' +
    '</span>' + icona("chev-r", "chev") + '</button>';
}
export function apriCliente(nome){
  const inp = document.getElementById("cerca-input");
  inp.value = nome;
  eseguiRicerca();
  window.scrollTo(0, 0);
}
export function nuovoPerCliente(btn){
  nuovoRapportino({nome: btn.dataset.nome, indirizzo: btn.dataset.indirizzo});
}
export function eseguiRicerca(){
  const query = (document.getElementById("cerca-input").value || "").trim().toLowerCase();
  const cont = document.getElementById("cerca-risultati");
  cont.innerHTML = "";
  const anagrafica = anagraficaClienti();

  if(query.length < 2){
    if(!anagrafica.length){
      cont.innerHTML = '<div class="card vuoto"><div class="v-icona">' + icona("users", "i-lg") + '</div>' +
        '<h3>Nessun cliente ancora</h3><p>I clienti compaiono qui dopo il primo rapportino.</p>' +
        '<button type="button" class="btn btn-primario" onclick="nuovoRapportino()">' + icona("plus") + 'Nuovo rapportino</button></div>';
      return;
    }
    cont.innerHTML = '<div class="elenco-nota">' + anagrafica.length + (anagrafica.length === 1 ? " cliente" : " clienti") +
      ' · tocca per vedere lo storico</div>' +
      '<div class="card cli-elenco">' + anagrafica.map(rigaClienteHtml).join("") + '</div>';
    return;
  }

  // cliente esatto: scheda con azione rapida
  const esatto = anagrafica.find(v=>v.nome.toLowerCase() === query);
  let testa = "";
  if(esatto){
    testa = '<div class="card cli-scheda"><div class="cs-top"><span class="avatar">' + esc(iniziali(esatto.nome)) + '</span>' +
      '<div style="min-width:0"><h2>' + esc(esatto.nome) + '</h2>' +
      (esatto.indirizzo ? '<div class="cs-ind">' + esc(esatto.indirizzo) + '</div>' : '') + '</div></div>' +
      '<button type="button" class="btn btn-primario btn-blocco" data-nome="' + esc(esatto.nome) + '" data-indirizzo="' + esc(esatto.indirizzo) + '" onclick="nuovoPerCliente(this)">' +
      icona("plus") + 'Nuovo rapportino per questo cliente</button></div>';
  } else {
    const simili = anagrafica.filter(v=>v.nome.toLowerCase().includes(query) || v.indirizzo.toLowerCase().includes(query)).slice(0, 8);
    if(simili.length) testa = '<div class="elenco-nota">Clienti</div><div class="card cli-elenco" style="margin-bottom:16px">' + simili.map(rigaClienteHtml).join("") + '</div>';
  }

  const db = leggiDB();
  const corrispondenze = [];

  Object.keys(db).sort().reverse().forEach(iso=>{
    const d = db[iso];
    if(!d || !d.clienti) return;
    const clientiTrovati = d.clienti.filter(cl=>
      (cl.nome && cl.nome.toLowerCase().includes(query)) ||
      (cl.indirizzo && cl.indirizzo.toLowerCase().includes(query)) ||
      (cl.fatturare && cl.fatturare.toLowerCase().includes(query)) ||
      (cl.dettagli && cl.dettagli.toLowerCase().includes(query))
    );
    if(clientiTrovati.length) corrispondenze.push({iso, d, clienti: clientiTrovati});
  });

  if(corrispondenze.length === 0){
    cont.innerHTML = testa + '<div class="ris-niente">Nessun intervento per "' + esc(query) + '"</div>';
    return;
  }

  corrispondenze.forEach(({iso, clienti})=>{
    const card = document.createElement("div");
    card.className = "card ris-giorno";

    const nomi = clienti.map(cl=>cl.nome).join(", ");
    let html =
      '<div class="rg-header">' +
        '<span class="rg-data">' + dataIt(iso) + '</span>' +
        '<span class="rg-clienti">' + evidenzia(nomi, query) + '</span>' +
      '</div>';

    clienti.forEach(cl=>{
      html += '<div style="margin-bottom:10px;padding-left:4px">';

      if(cl.indirizzo)
        html += '<div class="rg-riga" style="color:var(--testo-2);font-size:13px">' + icona("pin", "i-sm") + '<span>' + evidenzia(cl.indirizzo, query) + '</span></div>';

      const fasce = cl.fasce && cl.fasce.length ? cl.fasce
                  : ((cl.dalle || cl.alle) ? [{d: cl.dalle, a: cl.alle}] : []);
      const or = fasce.map(f=>(f.d && f.a ? f.d+" - "+f.a : f.d || f.a || "")).filter(Boolean).join(" / ");
      if(or) html += '<div class="rg-riga" style="font-size:13px">' + icona("clock", "i-sm") + '<span>' + esc(or) + '</span>' + '</div>';

      const meta = [];
      if(cl.tipologia) meta.push(cl.tipologia);
      if(cl.stato && cl.stato !== "Completato") meta.push('<span style="color:var(--err-testo)">' + cl.stato + '</span>');
      if(meta.length) html += '<div class="rg-riga" style="font-size:13px">' + meta.join(" · ") + '</div>';

      if(cl.dettagli){
        html += '<div class="rg-sezione">Lavoro</div>';
        cl.dettagli.split("\n").forEach(riga=>{
          if(riga.trim()) html += '<div class="rg-riga">' + evidenzia(riga, query) + '</div>';
        });
      }

      if(cl.materiali && cl.materiali.length){
        html += '<div class="rg-sezione">Materiale</div>';
        cl.materiali.forEach(m=>{
          html += '<div class="rg-riga">- ' + evidenzia(m.a, query) + (m.q ? ' <span style="color:var(--testo-2)">(' + esc(m.q) + ')</span>' : '') + '</div>';
        });
      }

      if(cl.importo)
        html += '<div class="rg-riga" style="font-size:13px">' + icona("euro", "i-sm") + '<span>Da fatturare: <b>' + euro(cl.importo) + '</b></span></div>';

      if(cl.fatturare)
        html += '<div class="rg-riga" style="font-size:13px;color:#5A6068">Fatturare a: ' + evidenzia(cl.fatturare, query) + '</div>';

      html += '</div>';
    });

    html += '<button type="button" class="btn btn-secondario btn-blocco" style="margin-top:6px" onclick="apriGiorno(\'' + iso + '\')">' +
            icona("file") + 'Apri rapporto del ' + dataIt(iso) + '</button>';

    card.innerHTML = html;
    cont.appendChild(card);
  });

  cont.insertAdjacentHTML("afterbegin", testa +
    '<div class="elenco-nota">' +
    corrispondenze.length + ' giorn' + (corrispondenze.length === 1 ? "o" : "i") + ' trovat' +
    (corrispondenze.length === 1 ? "o" : "i") + '</div>');
}

registraVista("cerca", eseguiRicerca);
su("vista-cambiata", chiudiSuggerimenti);
su("giornata-salvata", aggiornaClientiNoti);
su("archivio-aggiornato", origine=>{ if(origine === "importazione") aggiornaClientiNoti(); });
