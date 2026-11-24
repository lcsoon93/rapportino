// "La mia giornata": dashboard principale per tutti i ruoli.
// Interventi di oggi, imprevisti (rapportini autonomi) di oggi, bozze di ogni giorno (server + telefono),
// ritorni da programmare, invii in attesa e riepilogo di fine giornata. Calcoli in giornata-dati.js.
import { profilo } from "../core/sessione.js";
import { puo } from "../core/permessi.js";
import { registraVista, vistaCorrente } from "../core/navigation.js";
import { su } from "../core/eventi.js";
import { controllaInterventoPrevisto, elencoInterventi, elencoRapportini, interventiPeriodo, invalidaInterventi, operaiAttivi } from "../services/api-lavori.js";
import { elencoCoda, messaggioConnessione } from "../services/sinc-rapportini.js";
import { elencoFollowup, idInterventoPrevisto, leggiFollowup, rimuoviFollowup, segnaProgrammato } from "../services/followup.js";
import { apriModuloIntervento } from "./gestione-interventi.js";
import { apriRapportino, nuovoRapportinoAutonomo, rapportinoPerIntervento, testoDescrizioneRitorno } from "./modulo-rapportino.js";
import { calcolaGiornata } from "./giornata-dati.js";
import { isoDi, oggiIso } from "../utils/dates.js";
import { esc, formattaData, minutiAOre } from "./giornata-utils.js";

const $ = id=>document.getElementById(id);
const sposta = (iso, giorni)=>{ const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + giorni); return isoDi(d); };
const mostra = (id, si)=>$(id).classList.toggle("nascosto", !si);

function bottone(testo, azione, primario, icona){
  return `<button type="button" class="btn ${primario ? "btn-primario" : "btn-secondario"}" onclick="${azione}">` +
    (icona ? `<svg class="i"><use href="#i-${icona}"/></svg>` : "") + testo + `</button>`;
}
function card({ ora, oraIcona, titolo, sotto, badge, azioni, classe }){
  return `<div class="card intervento mg-intervento ${classe || ""}">
    <div class="int-top">
      <div class="int-ora${ora ? "" : " vuota"}">${ora || `<svg class="i i-sm"><use href="#i-${oraIcona || "clock"}"/></svg>`}</div>
      <div class="int-corpo">
        <div class="int-cliente">${esc(titolo || "Senza cliente")}</div>
        ${sotto ? `<div class="int-desc">${sotto}</div>` : ""}
        <div class="int-badge">${badge}</div>
      </div>
    </div>
    ${azioni ? `<div class="int-azioni">${azioni}</div>` : ""}
  </div>`;
}
const badge = (testo, classe)=>`<span class="badge ${classe}">${esc(testo)}</span>`;

function cardIntervento({ intervento: i, stato: st }){
  let azione = "";
  const rap = st.rapportino;
  if(st.codice === "completato" && rap) azione = bottone("Vedi rapportino", `apriRapportino('${rap.id}')`, false, "file");
  else if(st.codice === "da_completare") azione = bottone("Riprendi rapportino", `compilaRapportinoIntervento('${i.id}')`, true, "pen");
  else if(st.codice !== "completato" && puo("rapportini.compila")) azione = bottone("Compila rapportino", `compilaRapportinoIntervento('${i.id}')`, true, "pen");
  const dettaglio = `<button type="button" class="btn btn-secondario btn-dettagli" aria-label="Dettagli" onclick="apriDettaglioIntervento('${i.id}')"><svg class="i"><use href="#i-search"/></svg></button>`;
  return card({ ora: i.ora ? i.ora.slice(0, 5) : "", titolo: i.cliente, sotto: i.descrizione ? esc(i.descrizione) : "",
    badge: badge("Programmato", "neutro") + badge(st.label, st.classe) + (i.priorita === "urgente" ? badge("Urgente", "err") : ""),
    azioni: azione + dettaglio });
}
function cardImprevisto({ rapportino: r, stato: st }){
  return card({ oraIcona: "alert", titolo: r.cliente, classe: "mg-imprevisto",
    sotto: r.daInviare ? "Modifiche sul telefono, non ancora inviate" : "",
    badge: badge("Imprevisto", "att") + badge(st.label, st.classe),
    azioni: st.codice === "completato" ? bottone("Vedi rapportino", `apriRapportino('${r.id}')`, false, "file")
      : bottone("Riprendi", `apriRapportino('${r.id}')`, true, "pen") });
}
function cardBozza(r){
  const tipo = r.intervento_id ? "Intervento" : "Imprevisto";
  const dove = !r.sulServer ? badge("Solo sul telefono", "att") : r.daInviare ? badge("Modifiche da inviare", "att") : badge("Bozza sul server", "neutro");
  return card({ oraIcona: "pen", titolo: r.cliente, classe: "mg-bozza",
    sotto: (r.data ? formattaData(r.data) : "Data non indicata") + " · " + tipo,
    badge: (r.conflitto ? badge("Conflitto", "err") : r.completaInAttesa ? badge("Completamento da inviare", "att") : badge("Bozza", "att")) + dove,
    azioni: bottone("Riprendi", `apriRapportino('${r.id}')`, true, "pen") });
}
function cardFollowup(f){
  const gestisce = puo("interventi.gestisci");
  return card({ oraIcona: "clock", titolo: f.cliente, classe: "mg-bozza",
    sotto: esc(f.desc || "Lavoro da ultimare") + (f.data ? " · ritorno proposto: " + esc(formattaData(f.data)) : " · data di ritorno da decidere"),
    badge: (f.daCompletare ? badge("Intervento creato: operai da assegnare", "err") : badge("Da programmare", "att")) + (f.data_rapportino ? badge("Rapportino del " + formattaData(f.data_rapportino), "neutro") : ""),
    azioni: (gestisce ? bottone("Programma", `programmaFollowup('${esc(f.id)}')`, true, "cal") : `<span class="nota" style="padding:0">Da comunicare a chi programma gli interventi</span>`) +
      (f.rapportino_id ? bottone("Rapportino", `apriRapportino('${esc(f.rapportino_id)}')`, false, "file") : "") +
      `<button type="button" class="btn btn-secondario" aria-label="Elimina" onclick="eliminaFollowup('${esc(f.id)}')"><svg class="i"><use href="#i-trash"/></svg></button>` });
}

// Ritorni con un tentativo di creazione già fatto: se l'intervento è sul server (risposta persa)
// e ha gli operai previsti, il ritorno è programmato; se mancano operai resta, da completare.
async function riconciliaRitorni(lista){
  const out = [];
  for(const f of lista){
    const c = f.intervento_previsto ? await controllaInterventoPrevisto(f.intervento_previsto) : null;
    if(c && c.esiste && (f.operai || []).every(o=>c.operai.includes(o))){ segnaProgrammato(f.id, f.intervento_previsto); continue; }
    out.push(Object.assign({}, f, { daCompletare: !!(c && c.esiste) }));
  }
  return out;
}

let inDisegno = null;
function disegnaGiornata(){
  if(!inDisegno) inDisegno = disegna().finally(()=>{ inDisegno = null; });
  return inDisegno;
}
async function disegna(){
  if(!profilo) return;
  const io = profilo.id;
  const oggi = oggiIso();
  const gestisce = puo("interventi.gestisci");
  const ora = new Date().getHours();
  $("mg-saluto").textContent = (ora < 13 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera") + (profilo.nome ? ", " + profilo.nome.split(" ")[0] : "");
  $("mg-data-oggi").textContent = formattaData(oggi);
  await operaiAttivi().catch(()=>{});

  let errore = "";
  const [interventi, rapOggi, rapBozze, coda] = await Promise.all([
    elencoInterventi({ dal: oggi, al: oggi, soloMiei: !gestisce }).catch(e=>{ errore = e.message; return []; }),
    elencoRapportini({ dal: oggi, al: oggi, autore: io }).catch(()=>[]),
    elencoRapportini({ stato: "bozza", autore: io }).catch(()=>[]),
    elencoCoda().catch(()=>({ voci: [], conteggi: { attesa: 0, conflitti: 0, falliti: 0 }, connessione: { stato: "offline" } })),
  ]);
  const server = [...new Map([...rapOggi, ...rapBozze].map(r=>[r.id, r])).values()];
  const g = calcolaGiornata({ oggi, io, interventi, rapportiniServer: server, coda: coda.voci });
  const c = g.conteggi;

  $("mg-tot").textContent = c.totale;
  $("mg-completati").textContent = c.completati;
  $("mg-incorso").textContent = c.inCorso;
  $("mg-ore").textContent = minutiAOre(c.minuti);

  // interventi programmati di oggi: prima quelli da riprendere
  const ordine = { da_completare: 0, in_corso: 1, da_iniziare: 2, completato: 3 };
  g.schede.sort((a, b)=>(ordine[a.stato.codice] ?? 5) - (ordine[b.stato.codice] ?? 5));
  $("mg-conta-oggi").textContent = g.schede.length ? g.schede.length + (g.schede.length === 1 ? " intervento" : " interventi") : "";
  $("mg-lista-oggi").innerHTML = errore && !g.schede.length
    ? `<div class="vuoto"><p>${esc(errore)}</p><p>Imprevisti e bozze salvati sul telefono restano disponibili qui sotto.</p></div>`
    : g.schede.length ? g.schede.map(cardIntervento).join("")
    : `<div class="vuoto"><div class="v-icona"><svg class="i"><use href="#i-cal"/></svg></div><h3>Nessun intervento programmato per oggi</h3>
        <p>${gestisce ? "Programma un intervento o registra un imprevisto" : "Per un lavoro non programmato usa \"Registra imprevisto\""}</p></div>`;

  mostra("mg-sez-imprevisti-head", g.imprevisti.length);
  $("mg-conta-imprevisti").textContent = g.imprevisti.length || "";
  $("mg-lista-imprevisti").innerHTML = g.imprevisti.map(cardImprevisto).join("");

  mostra("mg-sez-bozze-head", g.bozze.length);
  $("mg-conta-bozze").textContent = g.bozze.length || "";
  $("mg-lista-bozze").innerHTML = g.bozze.map(cardBozza).join("");

  const ritorni = await riconciliaRitorni(elencoFollowup());
  mostra("mg-sez-followup-head", ritorni.length);
  $("mg-conta-followup").textContent = ritorni.length || "";
  $("mg-lista-followup").innerHTML = ritorni.map(cardFollowup).join("");

  if(gestisce){
    try{
      const prossimi = (await interventiPeriodo(sposta(oggi, 1), sposta(oggi, 7))).filter(i=>i.stato !== "annullato");
      mostra("mg-sez-prossimi-head", prossimi.length);
      $("mg-lista-prossimi").innerHTML = prossimi.slice(0, 5).map(i=>`<div class="card intervento mg-prossimo" style="cursor:pointer" onclick="apriDettaglioIntervento('${i.id}')">
        <div class="int-top"><div class="int-ora${i.ora ? "" : " vuota"}">${i.ora ? i.ora.slice(0, 5) : '<svg class="i i-sm"><use href="#i-cal"/></svg>'}</div>
        <div class="int-corpo"><div class="int-cliente">${esc(i.cliente || "Senza cliente")}</div>
        <div class="int-desc">${esc(formattaData(i.data))}${i.descrizione ? " · " + esc(i.descrizione) : ""}</div></div></div></div>`).join("");
    }catch(e){ /* non essenziale */ }
  }

  const n = coda.conteggi.attesa + coda.conteggi.conflitti + coda.conteggi.falliti;
  mostra("mg-sez-sync-head", n);
  $("mg-conta-sync").textContent = n || "";
  const st = coda.connessione && coda.connessione.stato;
  $("mg-lista-sync").innerHTML = n ? `<div class="card sinc-testa">
      <div class="sinc-conn"><span class="sinc-punto ${st === "online" ? "ok" : st === "offline" ? "err" : "att"}"></span>${esc(messaggioConnessione(st))}</div>
      <div class="sinc-conti">${coda.conteggi.attesa ? `<span>In attesa: <b>${coda.conteggi.attesa}</b></span>` : ""}
        ${coda.conteggi.conflitti ? `<span>Conflitti: <b>${coda.conteggi.conflitti}</b></span>` : ""}
        ${coda.conteggi.falliti ? `<span>Falliti: <b>${coda.conteggi.falliti}</b></span>` : ""}</div>
      <button type="button" class="btn btn-secondario btn-blocco" style="margin-top:10px" onclick="mostraVista('${puo("vista.lavoro") ? "lavoro" : "rapporti"}')"><svg class="i"><use href="#i-send"/></svg>Gestisci invii</button>
    </div>` : "";

  // fine giornata: dalle 16, se c'è stato lavoro
  const fine = c.totale > 0 && ora >= 16;
  mostra("mg-fine-giornata", fine);
  if(fine){
    const daFare = [...g.schede.filter(s=>s.stato.codice !== "completato").map(s=>({ nome: s.intervento.cliente, azione: `compilaRapportinoIntervento('${s.intervento.id}')` })),
      ...g.imprevisti.filter(x=>x.stato.codice !== "completato").map(x=>({ nome: x.rapportino.cliente + " (imprevisto)", azione: `apriRapportino('${x.rapportino.id}')` }))];
    $("mg-fine-contenuto").innerHTML = `
      <div class="stat-griglia" style="margin-bottom:12px">
        <div class="stat ok"><span class="stat-val">${c.completati}</span><span class="stat-lab">Completati</span></div>
        <div class="stat ${daFare.length ? "att" : "ok"}"><span class="stat-val">${daFare.length}</span><span class="stat-lab">Da completare</span></div>
        <div class="stat att"><span class="stat-val">${c.daUltimare}</span><span class="stat-lab">Da ultimare</span></div>
        <div class="stat pervinca"><span class="stat-val">${minutiAOre(c.minuti)}</span><span class="stat-lab">Ore lavorate</span></div>
      </div>
      ${daFare.length ? `<p class="elenco-nota" style="margin:0 0 8px">Ancora da completare:</p>` + daFare.map(x=>`<div class="mg-fine-item">
          <span>${esc(x.nome || "Senza cliente")}</span>${bottone("Riprendi", x.azione, true)}</div>`).join("")
        : `<p class="elenco-nota" style="margin:0 0 8px;color:var(--ok-testo)">Tutto il lavoro di oggi è completato.</p>`}
      ${ritorni.length ? `<p class="elenco-nota" style="margin:8px 0">${ritorni.length === 1 ? "1 ritorno" : ritorni.length + " ritorni"} da programmare (vedi sotto).</p>` : ""}
      ${coda.conteggi.attesa ? `<p class="elenco-nota" style="margin:8px 0">${coda.conteggi.attesa} rapportini ancora da inviare dal telefono.</p>` : ""}
      <div class="mg-fine-azioni">
        ${bottone("PDF giornata", "apriPDFGiornata()", false, "file")}
        ${bottone("Rapportini", "mostraVista('rapporti')", false, "send")}
      </div>`;
  }
}

// ---------------------------------------------------------------- azioni
window.registraImprevisto = ()=>nuovoRapportinoAutonomo();
window.compilaRapportinoIntervento = id=>rapportinoPerIntervento(id);
window.apriRapportinoGiornata = id=>apriRapportino(id);

// Programmare un ritorno: il modulo intervento si apre precompilato; il follow-up diventa
// "programmato" solo quando il server conferma il salvataggio (evento "intervento-salvato").
window.programmaFollowup = async id=>{
  const f = leggiFollowup(id);
  if(!f) return disegnaGiornata();
  if(f.stato === "programmato"){ alert("Questo ritorno è già stato programmato."); return disegnaGiornata(); }
  await apriModuloIntervento(null,
    { cliente: f.cliente, indirizzo: f.indirizzo || "", telefono: f.telefono || "", cliente_id: f.cliente_id || null, tipologia: f.tipologia || "" },
    { data: f.data || sposta(oggiIso(), 1), ora: f.ora || "", descrizione: testoDescrizioneRitorno(f), operai: f.operai, origine: "followup:" + f.id, idNuovo: idInterventoPrevisto(f.id) });
};
window.eliminaFollowup = id=>{
  if(!confirm("Eliminare questo ritorno da programmare? Il rapportino di origine non cambia.")) return;
  rimuoviFollowup(id);
  disegnaGiornata();
};
su("intervento-salvato", ({ id, origine } = {})=>{
  if(origine && origine.startsWith("followup:")) segnaProgrammato(origine.slice(9), id);
});

registraVista("giornata", disegnaGiornata);
const ridisegna = ()=>{ if(vistaCorrente === "giornata") disegnaGiornata(); };
su("rapportino-sincronizzato", ()=>{ invalidaInterventi(); ridisegna(); });
su("coda-aggiornata", ridisegna);
su("coda-sincronizzata", ridisegna);
