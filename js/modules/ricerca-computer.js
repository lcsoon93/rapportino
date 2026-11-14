// Pagina search.html: ricerca e consultazione dal computer (amministratore e ufficio).
// Stesso accesso dell'app (stessa sessione Supabase salvata nel browser) e solo letture: cosa si vede
// lo decidono le policy RLS. Rapportini nuovi + schede del vecchio foglio giornaliero, riepilogo del
// mese, dettaglio con PDF (stampa), esportazione dei materiali in Excel (CSV) e in PDF.
import { client, accedi, esci, haRuolo, nomeCompleto, ripristina } from "../core/sessione.js";
import { elencoRapportini, nomeOperaio, operaiAttivi } from "../services/api-lavori.js";
import { csvMateriali, dataItaliana, filtraVoci, intervalliTesto, riepilogo, unisciVoci } from "../services/ricerca-logica.js";
import { pdfMateriali, pdfVoce } from "../services/pdf/ricerca.js";
import { stampaPDF } from "../services/stampa.js";
import { esc, euro, oreTesto } from "../utils/formatters.js";
import { giorniMese, isoDi } from "../utils/dates.js";

const $ = id=>document.getElementById(id);
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
let voci = [], giornate = [], risultati = [], interventiMese = null, periodo = "", richiesta = 0;
const selezionate = new Set();

const meseCorrente = ()=>isoDi(new Date()).slice(0, 7);
const nomePeriodo = p=>p === "tutto" ? "Intero storico" : MESI[+p.slice(5) - 1] + " " + p.slice(0, 4);
const nomeFile = t=>String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
function stato(testo, tipo = ""){ const s = $("stato-db"); s.textContent = testo; s.dataset.tipo = tipo; }
function mostra(id){ ["schermo-accesso", "schermo-negato", "schermo-ricerca"].forEach(x=>{ $(x).hidden = x !== id; }); }

// ---------------------------------------------------------------- accesso
async function avvio(){
  $("filtro-mese").value = meseCorrente();
  let p = null;
  try{ p = await ripristina(); }catch(e){ stato("Server non raggiungibile: " + e.message, "err"); }
  if(!p){ mostra("schermo-accesso"); $("acc-username").focus(); return; }
  entra(p);
}
function entra(p){
  $("utente").textContent = nomeCompleto(p);
  $("btn-esci").hidden = false;
  if(p.deve_cambiare_password){
    $("negato-testo").textContent = "Prima di usare la ricerca cambia la password dall'app.";
    return mostra("schermo-negato");
  }
  if(!haRuolo("admin", p) && !haRuolo("company", p)){
    $("negato-testo").textContent = "La ricerca dal computer è riservata ad amministratore e ufficio. I tuoi rapportini sono nell'app.";
    return mostra("schermo-negato");
  }
  mostra("schermo-ricerca");
  operaiAttivi().then(elenco=>{
    const sel = $("cerca-operaio");
    elenco.forEach(o=>sel.insertAdjacentHTML("beforeend", '<option value="' + esc(o.id) + '">' + esc(o.nome || o.username) + "</option>"));
  }).catch(()=>{}).finally(()=>carica($("filtro-mese").value));
}
async function inviaAccesso(e){
  e.preventDefault();
  const btn = $("acc-invia"), err = $("acc-errore");
  btn.disabled = true; err.textContent = "";
  try{
    const r = await accedi($("acc-username").value, $("acc-password").value);
    if(!r.ok){ err.textContent = r.errore || "Accesso non riuscito."; return; }
    $("acc-password").value = "";
    entra(r.profilo);
  }finally{ btn.disabled = false; }
}

// ---------------------------------------------------------------- dati
// p = "AAAA-MM" oppure "tutto"
async function carica(p){
  const mia = ++richiesta;
  periodo = p;
  selezionate.clear();
  stato(p === "tutto" ? "Caricamento dell'intero storico…" : "Caricamento di " + nomePeriodo(p) + "…");
  $("risultati").innerHTML = '<div class="vuoto">Caricamento…</div>';
  const giorni = p === "tutto" ? null : giorniMese(p);
  const dal = giorni ? giorni[0] : null, al = giorni ? giorni[giorni.length - 1] : null;
  try{
    let qRap = client.from("rapporti").select("data, dati");
    let qInt = client.from("interventi").select("id, stato");
    if(dal){ qRap = qRap.gte("data", dal).lte("data", al); qInt = qInt.gte("data", dal).lte("data", al); }
    const [rapportini, vecchi, interventi] = await Promise.all([elencoRapportini({ dal, al }), qRap, qInt]);
    if(mia !== richiesta) return;
    if(vecchi.error) throw new Error(vecchi.error.message);
    giornate = vecchi.data || [];
    interventiMese = interventi.error ? null : interventi.data || [];
    voci = unisciVoci(rapportini, giornate, nomeOperaio);
    stato("Aggiornato alle " + new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) + " · " + nomePeriodo(p), "ok");
  }catch(e){
    if(mia !== richiesta) return;
    voci = []; giornate = []; interventiMese = null;
    stato("Errore: " + (e.message || e), "err");
  }
  $("btn-storico").hidden = p === "tutto";
  $("titolo-periodo").textContent = nomePeriodo(p);
  disegnaRiepilogo();
  cerca();
}

function disegnaRiepilogo(){
  const r = riepilogo(voci, giornate);
  const n = interventiMese;
  const schede = [
    ["Rapportini completati", r.completati, r.bozze ? r.bozze + (r.bozze === 1 ? " bozza" : " bozze") + " da completare" : "nessuna bozza"],
    ["Ore lavorate", oreTesto(r.minuti), "dai rapportini completati"],
    ["Interventi programmati", n ? n.length : "–", n ? n.filter(i=>i.stato === "completato").length + " completati" : ""],
    ["Clienti", r.clienti, r.schedeFoglio ? r.schedeFoglio + (r.schedeFoglio === 1 ? " scheda" : " schede") + " del foglio giornaliero" : ""],
    ["Spese anticipate", euro(r.spese), "dal foglio giornaliero"],
  ];
  $("riepilogo").innerHTML = schede.map(([t, v, s])=>
    '<div class="stat"><div class="stat-t">' + esc(t) + '</div><div class="stat-v">' + esc(v) + '</div><div class="stat-s">' + esc(s) + "</div></div>").join("");
}

// ---------------------------------------------------------------- ricerca
function filtri(){
  const operaio = $("cerca-operaio").value;
  const data = $("cerca-data").value;
  return { testo: $("cerca-input").value, dal: data, al: data, stato: $("cerca-stato").value,
    operaio, operaioNome: operaio ? nomeOperaio(operaio) : "" };
}
function cerca(){
  risultati = filtraVoci(voci, filtri());
  const visibili = new Set(risultati.map(v=>v.chiave));
  [...selezionate].forEach(k=>{ if(!visibili.has(k)) selezionate.delete(k); });
  disegnaRisultati();
}
const BADGE = {
  completato: '<span class="badge ok">Completato</span>',
  bozza: '<span class="badge att">Bozza</span>',
  foglio: '<span class="badge neutro">Foglio giornaliero</span>',
};
function disegnaRisultati(){
  const c = $("risultati");
  $("info-risultati").textContent = risultati.length
    ? (risultati.length === 1 ? "1 risultato" : risultati.length + " risultati") + " · " + nomePeriodo(periodo)
    : "";
  if(!risultati.length){
    c.innerHTML = '<div class="vuoto">Nessun risultato con questi filtri.' +
      (periodo !== "tutto" ? '<br><button type="button" class="btn btn-sec" data-azione="storico">Cerca in tutto lo storico</button>' : "") + "</div>";
  }else{
    c.innerHTML = risultati.map((v, i)=>{
      const testo = v.lavoro || v.descrizioneIntervento;
      return '<article class="voce" data-indice="' + i + '" tabindex="0">' +
        '<input type="checkbox" class="chk" aria-label="Seleziona ' + esc(v.cliente) + '"' + (selezionate.has(v.chiave) ? " checked" : "") + ">" +
        '<div class="voce-corpo"><div class="voce-top"><b class="voce-cliente">' + esc(v.cliente || "(senza nome)") + "</b>" +
        (v.urgente ? '<span class="badge err">Urgente</span>' : "") + BADGE[v.stato] +
        '<span class="voce-data">' + dataItaliana(v.data) + "</span></div>" +
        (v.indirizzo ? '<div class="voce-riga">' + esc(v.indirizzo) + "</div>" : "") +
        (testo ? '<div class="voce-riga voce-testo">' + esc(testo.length > 160 ? testo.slice(0, 160) + "…" : testo) + "</div>" : "") +
        '<div class="voce-riga voce-meta">' + esc(intervalliTesto(v) || "Operai non indicati") +
        (v.materiali.length ? " · " + v.materiali.length + (v.materiali.length === 1 ? " materiale" : " materiali") : "") + "</div>" +
        "</div></article>";
    }).join("");
  }
  aggiornaSelezione();
}
function aggiornaSelezione(){
  const n = selezionate.size, ci = risultati.length > 0;
  $("btn-tutti").hidden = !ci;
  $("btn-tutti").textContent = ci && risultati.every(v=>selezionate.has(v.chiave)) ? "Deseleziona tutti" : "Seleziona tutti";
  $("btn-csv").disabled = $("btn-pdf-materiali").disabled = !n;
  $("conta-selezione").textContent = n ? (n === 1 ? "1 selezionato" : n + " selezionati") : (ci ? "Spunta i risultati da esportare" : "");
}
const scelte = ()=>risultati.filter(v=>selezionate.has(v.chiave));

// ---------------------------------------------------------------- dettaglio
let aperta = null;
function apriDettaglio(v){
  aperta = v;
  const campo = (t, x)=>x ? '<div class="campo"><div class="campo-t">' + esc(t) + '</div><div class="campo-v">' + esc(x) + "</div></div>" : "";
  $("dettaglio-corpo").innerHTML =
    '<h2 id="dettaglio-titolo">' + esc(v.cliente || "(senza nome)") + "</h2>" +
    '<div class="voce-top">' + (v.urgente ? '<span class="badge err">Urgente</span>' : "") + BADGE[v.stato] + '<span class="voce-data">' + dataItaliana(v.data) + "</span></div>" +
    '<div class="campi">' + campo("Indirizzo", v.indirizzo) + campo("Telefono", v.telefono) + campo("Tipologia", v.tipologia) +
      campo("Operai", intervalliTesto(v)) + campo("Autore", v.autore) + campo("Importo", v.importo ? euro(v.importo) : "") + "</div>" +
    (v.descrizioneIntervento ? '<h3>Richiesta</h3><p class="testo">' + esc(v.descrizioneIntervento) + "</p>" : "") +
    '<h3>Lavoro eseguito</h3><p class="testo">' + esc(v.lavoro || "-") + "</p>" +
    "<h3>Materiale utilizzato</h3>" + (v.materiali.length
      ? '<ul class="materiali">' + v.materiali.map(m=>"<li><span>" + esc(m.a) + "</span><b>" + esc(m.q) + "</b></li>").join("") + "</ul>"
      : '<p class="nota">Nessun materiale segnato</p>') +
    (v.note ? '<h3>Note</h3><p class="testo">' + esc(v.note) + "</p>" : "") +
    (v.esito || v.firmatario ? '<div class="campi">' + campo("Esito", v.esito) + campo("Firmatario", v.firmatario) + "</div>" : "");
  $("dettaglio").showModal();
}
function pdfDettaglio(stampa){
  if(!aperta) return;
  const doc = pdfVoce(aperta), nome = "Intervento_" + nomeFile(aperta.cliente || "cliente") + "_" + aperta.data + ".pdf";
  stampa ? stampaPDF(doc, nome) : doc.save(nome);
}

// ---------------------------------------------------------------- esportazioni
function scarica(contenuto, tipo, nome){
  const url = URL.createObjectURL(new Blob([contenuto], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}
function esportaCSV(){
  const s = scelte();
  if(s.length) scarica(csvMateriali(s), "text/csv;charset=utf-8", "Materiali_" + nomeFile(nomePeriodo(periodo)) + ".csv");
}
function stampaMateriali(){
  const s = scelte();
  if(s.length) stampaPDF(pdfMateriali(s, nomePeriodo(periodo)), "Materiali_" + nomeFile(nomePeriodo(periodo)) + ".pdf");
}

// ---------------------------------------------------------------- eventi
let ritardo = null;
function collega(){
  $("form-accesso").addEventListener("submit", inviaAccesso);
  $("btn-esci").addEventListener("click", async()=>{ await esci(); location.reload(); });
  $("filtro-mese").addEventListener("change", e=>{ if(e.target.value) carica(e.target.value); });
  $("btn-storico").addEventListener("click", ()=>carica("tutto"));
  $("btn-aggiorna").addEventListener("click", ()=>carica(periodo || meseCorrente()));
  $("cerca-input").addEventListener("input", ()=>{ clearTimeout(ritardo); ritardo = setTimeout(cerca, 200); });
  ["cerca-data", "cerca-operaio", "cerca-stato"].forEach(id=>$(id).addEventListener("change", cerca));
  $("btn-reset").addEventListener("click", ()=>{
    $("cerca-input").value = ""; $("cerca-data").value = ""; $("cerca-operaio").value = ""; $("cerca-stato").value = "";
    cerca();
  });
  $("btn-tutti").addEventListener("click", ()=>{
    const tutti = risultati.every(v=>selezionate.has(v.chiave));
    risultati.forEach(v=>tutti ? selezionate.delete(v.chiave) : selezionate.add(v.chiave));
    disegnaRisultati();
  });
  $("btn-csv").addEventListener("click", esportaCSV);
  $("btn-pdf-materiali").addEventListener("click", stampaMateriali);
  const elenco = $("risultati");
  elenco.addEventListener("click", e=>{
    if(e.target.closest("[data-azione=storico]")) return carica("tutto");
    const art = e.target.closest(".voce");
    if(!art) return;
    const v = risultati[+art.dataset.indice];
    if(e.target.classList.contains("chk")){
      e.target.checked ? selezionate.add(v.chiave) : selezionate.delete(v.chiave);
      return aggiornaSelezione();
    }
    apriDettaglio(v);
  });
  elenco.addEventListener("keydown", e=>{
    const art = e.target.classList && e.target.classList.contains("voce") ? e.target : null;
    if(art && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); apriDettaglio(risultati[+art.dataset.indice]); }
  });
  $("btn-chiudi").addEventListener("click", ()=>$("dettaglio").close());
  $("dettaglio").addEventListener("click", e=>{ if(e.target === $("dettaglio")) $("dettaglio").close(); });
  $("btn-stampa-voce").addEventListener("click", ()=>pdfDettaglio(true));
  $("btn-scarica-voce").addEventListener("click", ()=>pdfDettaglio(false));
}

collega();
avvio();
