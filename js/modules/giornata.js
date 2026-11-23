// "La mia giornata": dashboard principale per tutti i ruoli.
// Mostra gli interventi di oggi con il loro stato, le bozze in sospeso,
// le azioni rapide (programma intervento / registra imprevisto) e il riepilogo di fine giornata.
import { profilo } from "../core/sessione.js";
import { puo } from "../core/permessi.js";
import { registraVista, mostraVista } from "../core/navigation.js";
import { su, emetti } from "../core/eventi.js";
import { elencoInterventi, interventiPeriodo, invalidaInterventi, contaRapportini } from "../services/api-lavori.js";
import { avanzamento } from "../services/avanzamento.js";
import { nomeOperaio, operaiAttivi } from "../services/api-lavori.js";
import { elencoCoda, connessione, messaggioConnessione } from "../services/sinc-rapportini.js";
import { bozzeDi, leggiBozza } from "../services/coda-locale.js";
import { icona, esc, iso, formattaData, formattaOra, minutiAOre } from "./giornata-utils.js";

const $ = id => document.getElementById(id);

function oggi() { return new Date().toISOString().slice(0, 10); }

// stati derivati dell'intervento per la vista operaio
function statoIntervento(i, io) {
  const rapp = i.rapportini || [];
  const mioRap = rapp.find(r => r.autore_id === io);
  const av = avanzamento(i);
  if (i.stato === "annullato") return { codice: "annullato", label: "Annullato", classe: "neutro" };
  if (mioRap && mioRap.stato === "completato") return { codice: "completato", label: "Completato", classe: "ok" };
  if (mioRap && mioRap.stato === "bozza") return { codice: "da_completare", label: "Da completare", classe: "att" };
  if (i.stato === "in_corso" || av.completati.length > 0) return { codice: "in_corso", label: "In corso", classe: "pervinca" };
  return { codice: "da_iniziare", label: "Da iniziare", classe: "neutro" };
}

function cardIntervento(i, io) {
  const st = statoIntervento(i, io);
  const rapp = (i.rapportini || []).find(r => r.autore_id === io);
  const ora = i.ora ? i.ora.slice(0, 5) : "";

  let azione = "";
  if (st.codice === "da_iniziare" || st.codice === "in_corso") {
    azione = `<button type="button" class="btn btn-primario" onclick="compilaRapportinoIntervento('${i.id}')">
      <svg class="i"><use href="#i-pen"/></svg>Compila rapportino</button>`;
  } else if (st.codice === "da_completare") {
    azione = `<button type="button" class="btn btn-primario" onclick="compilaRapportinoIntervento('${i.id}')">
      <svg class="i"><use href="#i-pen"/></svg>Riprendi bozza</button>`;
  } else if (st.codice === "completato") {
    azione = `<button type="button" class="btn btn-secondario" onclick="apriRapportino('${rapp.id}')">
      <svg class="i"><use href="#i-file"/></svg>Vedi rapportino</button>`;
  }
  const dettaglio = puo("interventi.gestisci")
    ? `<button type="button" class="btn btn-secondario btn-dettagli" onclick="apriDettaglioIntervento('${i.id}')">
      <svg class="i"><use href="#i-search"/></svg></button>` : "";

  return `<div class="card intervento mg-intervento ${st.codice === "annullato" ? "annullato" : ""}">
    <div class="int-top">
      <div class="int-ora${ora ? "" : " vuota"}">${ora || '<svg class="i i-sm"><use href="#i-clock"/></svg>'}</div>
      <div class="int-corpo">
        <div class="int-cliente">${esc(i.cliente || "Senza cliente")}</div>
        ${i.descrizione ? `<div class="int-desc">${esc(i.descrizione)}</div>` : ""}
        <div class="int-badge">
          <span class="badge ${st.classe}">${st.label}</span>
          ${i.priorita === "urgente" ? '<span class="badge err">Urgente</span>' : ""}
          ${i.tipologia ? `<span class="badge neutro">${esc(i.tipologia)}</span>` : ""}
        </div>
      </div>
    </div>
    ${azione || dettaglio ? `<div class="int-azioni">${azione}${dettaglio}</div>` : ""}
  </div>`;
}

function cardBozza(b) {
  const cl = b.rapportino?.cliente || "Senza cliente";
  const data = b.rapportino?.data || "";
  return `<div class="card intervento mg-bozza">
    <div class="int-top">
      <div class="int-ora vuota"><svg class="i i-sm"><use href="#i-pen"/></svg></div>
      <div class="int-corpo">
        <div class="int-cliente">${esc(cl)}</div>
        <div class="int-desc">${data ? formattaData(data) : "Data non indicata"}${b.intervento ? " · " + esc(b.intervento) : ""}</div>
        <div class="int-badge"><span class="badge att">Bozza</span></div>
      </div>
    </div>
    <div class="int-azioni">
      <button type="button" class="btn btn-primario" onclick="apriRapportino('${b.id}')">
        <svg class="i"><use href="#i-pen"/></svg>Completa</button>
    </div>
  </div>`;
}

function cardProssimo(i, dataStr) {
  const ora = i.ora ? i.ora.slice(0, 5) : "";
  return `<div class="card intervento mg-prossimo" style="cursor:pointer" onclick="apriDettaglioIntervento('${i.id}')">
    <div class="int-top">
      <div class="int-ora${ora ? "" : " vuota"}">${ora || formattaData(dataStr).slice(0, 5)}</div>
      <div class="int-corpo">
        <div class="int-cliente">${esc(i.cliente || "Senza cliente")}</div>
        <div class="int-desc">${formattaData(i.data)}${i.descrizione ? " · " + esc(i.descrizione) : ""}</div>
      </div>
    </div>
  </div>`;
}

async function disegnaGiornata() {
  if (!profilo) return;
  const io = profilo.id;
  const oggiStr = oggi();
  const isAdmin = puo("interventi.gestisci");

  // saluto
  const ore = new Date().getHours();
  const saluto = ore < 13 ? "Buongiorno" : ore < 18 ? "Buon pomeriggio" : "Buonasera";
  $("mg-saluto").textContent = saluto + (profilo.nome ? ", " + profilo.nome.split(" ")[0] : "");
  $("mg-data-oggi").textContent = formattaData(oggiStr);

  await operaiAttivi().catch(() => {});

  // interventi di oggi
  let interventiOggi = [];
  try {
    const tutti = await elencoInterventi({ dal: oggiStr, al: oggiStr, soloMiei: !isAdmin });
    interventiOggi = tutti.filter(i => i.stato !== "annullato");
  } catch (e) {
    $("mg-lista-oggi").innerHTML = `<div class="vuoto"><p>${esc(e.message)}</p></div>`;
  }

  // statistiche
  let completati = 0, inCorso = 0, oreTotali = 0;
  for (const i of interventiOggi) {
    const st = statoIntervento(i, io);
    if (st.codice === "completato") completati++;
    else if (st.codice === "in_corso" || st.codice === "da_completare") inCorso++;
    for (const r of (i.rapportini || [])) {
      if (r.autore_id === io && r.rapportino_operai) {
        for (const o of r.rapportino_operai) {
          if (o.operaio_id === io && o.dalle && o.alle) {
            oreTotali += minutiTra(o.dalle, o.alle);
          }
        }
      }
    }
  }
  $("mg-tot").textContent = interventiOggi.length;
  $("mg-completati").textContent = completati;
  $("mg-incorso").textContent = inCorso;
  $("mg-ore").textContent = minutiAOre(oreTotali);

  // lista interventi di oggi
  $("mg-conta-oggi").textContent = interventiOggi.length ? interventiOggi.length + " interventi" : "";
  if (interventiOggi.length) {
    // ordine: da_completare > in_corso > da_iniziare > completato
    const ordine = { da_completare: 0, in_corso: 1, da_iniziare: 2, completato: 3, annullato: 4 };
    interventiOggi.sort((a, b) => {
      const sa = statoIntervento(a, io), sb = statoIntervento(b, io);
      return (ordine[sa.codice] ?? 5) - (ordine[sb.codice] ?? 5);
    });
    $("mg-lista-oggi").innerHTML = interventiOggi.map(i => cardIntervento(i, io)).join("");
  } else {
    $("mg-lista-oggi").innerHTML = `<div class="vuoto">
      <div class="v-icona"><svg class="i"><use href="#i-cal"/></svg></div>
      <h3>Nessun intervento per oggi</h3>
      <p>${isAdmin ? "Programma un intervento o registra un imprevisto" : "Al momento non hai interventi assegnati"}</p>
    </div>`;
  }

  // bozze locali non legate a un intervento di oggi
  try {
    const bozze = await bozzeDi(io);
    const bozzeOggiIds = new Set(interventiOggi.flatMap(i => (i.rapportini || []).filter(r => r.autore_id === io && r.stato === "bozza").map(r => r.id)));
    const bozzeExtra = bozze.filter(b => b.stato !== "inviato" && b.stato !== "in_sincronizzazione" && !bozzeOggiIds.has(b.id));
    const sez = $("mg-sez-bozze-head");
    if (bozzeExtra.length) {
      sez.classList.remove("nascosto");
      $("mg-conta-bozze").textContent = bozzeExtra.length;
      $("mg-lista-bozze").innerHTML = bozzeExtra.map(cardBozza).join("");
    } else {
      sez.classList.add("nascosto");
      $("mg-lista-bozze").innerHTML = "";
    }
  } catch (e) { /* offline: le bozze si vedranno al prossimo caricamento */ }

  // prossimi giorni (admin/company)
  if (isAdmin) {
    try {
      const fra7 = new Date(); fra7.setDate(fra7.getDate() + 7);
      const domani = new Date(); domani.setDate(domani.getDate() + 1);
      const prossimi = await interventiPeriodo(domani.toISOString().slice(0, 10), fra7.toISOString().slice(0, 10));
      const attivi = prossimi.filter(i => i.stato !== "annullato");
      const sezP = $("mg-sez-prossimi-head");
      if (attivi.length) {
        sezP.classList.remove("nascosto");
        $("mg-lista-prossimi").innerHTML = attivi.slice(0, 5).map(i => cardProssimo(i, i.data)).join("");
      } else {
        sezP.classList.add("nascosto");
        $("mg-lista-prossimi").innerHTML = "";
      }
    } catch (e) { /* non critico */ }
  }

  // coda sincronizzazione
  try {
    const coda = await elencoCoda();
    const sezS = $("mg-sez-sync-head");
    const inAttesa = coda.conteggi.attesa + coda.conteggi.conflitti + coda.conteggi.falliti;
    if (inAttesa > 0) {
      sezS.classList.remove("nascosto");
      $("mg-conta-sync").textContent = inAttesa;
      $("mg-lista-sync").innerHTML = `<div class="card sinc-testa">
        <div class="sinc-conn">
          <span class="sinc-punto ${coda.connessione.stato === "online" ? "ok" : coda.connessione.stato === "offline" ? "err" : "att"}"></span>
          ${messaggioConnessione(coda.connessione.stato)}
        </div>
        <div class="sinc-conti">
          ${coda.conteggi.attesa ? `<span>In attesa: <b>${coda.conteggi.attesa}</b></span>` : ""}
          ${coda.conteggi.conflitti ? `<span>Conflitti: <b>${coda.conteggi.conflitti}</b></span>` : ""}
          ${coda.conteggi.falliti ? `<span>Falliti: <b>${coda.conteggi.falliti}</b></span>` : ""}
        </div>
        <button type="button" class="btn btn-secondario btn-blocco" style="margin-top:10px" onclick="mostraVista('rapporti')">
          <svg class="i"><use href="#i-send"/></svg>Gestisci invii</button>
      </div>`;
    } else {
      sezS.classList.add("nascosto");
      $("mg-lista-sync").innerHTML = "";
    }
  } catch (e) { /* non critico */ }

  // riepilogo fine giornata: visibile se ci sono interventi completati e l'ora > 16
  const oraCorrente = new Date().getHours();
  const fineGiornata = $("mg-fine-giornata");
  if (completati > 0 && oraCorrente >= 16) {
    const mancanti = interventiOggi.length - completati;
    const daFare = interventiOggi.filter(i => {
      const s = statoIntervento(i, io);
      return s.codice !== "completato" && s.codice !== "annullato";
    });
    fineGiornata.classList.remove("nascosto");
    $("mg-fine-contenuto").innerHTML = `
      <div class="stat-griglia" style="margin-bottom:12px">
        <div class="stat ok"><span class="stat-val">${completati}</span><span class="stat-lab">Completati</span></div>
        <div class="stat ${mancanti ? "att" : "ok"}"><span class="stat-val">${mancanti}</span><span class="stat-lab">Da completare</span></div>
        <div class="stat"><span class="stat-val">${minutiAOre(oreTotali)}</span><span class="stat-lab">Ore lavorate</span></div>
      </div>
      ${mancanti ? `<p class="elenco-nota" style="margin:0 0 8px">Interventi ancora da completare:</p>
        ${daFare.map(i => `<div class="mg-fine-item" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bordo)">
          <span style="flex:1;font-weight:500">${esc(i.cliente || "Senza cliente")}</span>
          <button type="button" class="btn btn-primario" style="min-height:36px;padding:6px 12px;font-size:13px" onclick="compilaRapportinoIntervento('${i.id}')">Compila</button>
        </div>`).join("")}` : `<p class="elenco-nota" style="margin:0 0 8px;color:var(--ok-testo)">Tutti gli interventi di oggi sono completati!</p>`}
      <div class="mg-fine-azioni" style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondario" onclick="apriPDFGiornata()" style="flex:1;min-width:140px"><svg class="i"><use href="#i-file"/></svg>PDF giornata</button>
        <button type="button" class="btn btn-secondario" onclick="mostraVista('rapporti')" style="flex:1;min-width:140px"><svg class="i"><use href="#i-send"/></svg>Rapportini</button>
      </div>
    `;
  } else {
    fineGiornata.classList.add("nascosto");
  }
}

// funzione "Registra imprevisto": apre un rapportino autonomo
window.registraImprevisto = function () {
  if (typeof window.nuovoRapportinoAutonomo === "function") {
    window.nuovoRapportinoAutonomo();
  } else {
    mostraVista("rapportino");
  }
};

// funzione per compilare rapportino da un intervento
window.compilaRapportinoIntervento = function (interventoId) {
  if (typeof window.rapportinoPerIntervento === "function") {
    window.rapportinoPerIntervento(interventoId);
  }
};

function minutiTra(dalle, alle) {
  if (!dalle || !alle) return 0;
  const [a, b] = [dalle, alle].map(t => { const p = t.split(":"); return +p[0] * 60 + +p[1]; });
  return Math.max(0, b - a);
}

registraVista("giornata", disegnaGiornata);

su("rapportino-sincronizzato", () => { invalidaInterventi(); disegnaGiornata(); });
su("coda-aggiornata", disegnaGiornata);
su("coda-sincronizzata", disegnaGiornata);
