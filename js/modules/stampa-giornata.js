// PDF della giornata: tutti i rapportini COMPLETATI di un giorno in un solo PDF (una scheda per
// rapportino, con i suoi tecnici, orari, attivita', materiali, foto e firma; impaginazione del foglio
// giornaliero: un rapportino = A4, piu' rapportini = due A5 per foglio).
// Comprende anche le schede compilate del foglio giornaliero della vecchia app per quel giorno (se ci sono),
// con i tecnici e gli orari della giornata.
// Esclusi: bozze e rapportini rimasti sul telefono (non ancora inviati o in attesa di completamento):
// l'app li elenca, cosi' si sa cosa manca.
// Due passi: "Prepara" legge i dati e scarica le foto (con la sessione dell'utente, RLS); "Condividi"
// genera il PDF subito dal tocco (su iPhone la condivisione deve partire dal gesto dell'utente).
import { puo } from "../core/permessi.js";
import { mostraVista } from "../core/navigation.js";
import { leggiDB } from "../core/storage.js";
import { schedaCompilata } from "../services/stato-schede.js";
import { profilo } from "../core/sessione.js";
import { su } from "../core/eventi.js";
import { elencoAllegati, elencoRapportini, nomeOperaio, operaiAttivi, rapportiniCompletatiDelGiorno, scaricaFoto } from "../services/api-lavori.js";
import { elencoCoda } from "../services/sinc-rapportini.js";
import { blobInDataUrl } from "../services/immagini.js";
import { condividi } from "../services/condivisione.js";
import { generaPDFPerCliente } from "../services/pdf/giornata.js";
import { dataIt, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { minutiSulPosto } from "../services/calculations.js";
import { aggiornaOrari, orarioDelGiorno } from "../services/orario-giornata.js";
import { sulComputer } from "../utils/dispositivo.js";
import { icona } from "../utils/dom.js";

const $ = id=>document.getElementById(id);
let preparato = null;          // { iso, dati, nome }
const ora = t=>String(t || "").slice(0, 5);

function messaggio(t, tipo){ $("rg-msg").textContent = t || ""; $("rg-msg").className = "msg-info" + (tipo ? " " + tipo : ""); }
// i dati sono cambiati (data, operaio): si prepara di nuovo
export function azzeraPDFGiornata(){
  preparato = null;
  $("rg-esito").innerHTML = "";
  $("rg-condividi").classList.add("nascosto");
  messaggio("");
}

async function fotoDi(r){
  const allegati = await elencoAllegati(r.id).catch(()=>null);
  if(!allegati) return { foto: [], mancanti: 0, errore: true };
  const foto = [];
  let mancanti = 0;
  for(const a of allegati){
    try{
      const src = a.contenuto || (a.percorso ? await blobInDataUrl(await scaricaFoto(a.percorso)) : "");
      if(src) foto.push({ src, w: a.larghezza, h: a.altezza }); else mancanti++;
    }catch(e){ mancanti++; }
  }
  return { foto, mancanti };
}
// scheda del PDF per un rapportino (stesso formato del PDF del singolo rapportino)
function schedaPDF(r, foto){
  const operai = (r.rapportino_operai || []).map(o=>({ nome: nomeOperaio(o.operaio_id), dalle: ora(o.dalle), alle: ora(o.alle) }));
  return {
    id: r.id, nome: r.cliente, indirizzo: [r.indirizzo, r.telefono ? "Tel. " + r.telefono : ""].filter(Boolean).join(" · "),
    fasce: [], fatturare: "", importo: 0, tipologia: r.tipologia, stato: r.esito, firmatario: r.firmatario,
    dettagli: r.attivita, note: r.note || "", materiali: r.materiali || [], foto, firma: r.firma, urgente: false,
    tecnici: operai.map(o=>o.nome).filter((x, i, a)=>x && a.indexOf(x) === i).join(" / "), operai,
  };
}
// come nel PDF: tecnico e intervallo segnato (dalle-alle), senza il totale delle ore
const orariScheda = c=>c.operai.map(o=>o.nome + (o.dalle && o.alle ? " " + o.dalle + "–" + o.alle + " · " + oreTesto(minutiSulPosto([o])) : o.dalle ? " dalle " + o.dalle : o.alle ? " fino alle " + o.alle : "")).join(", ");
// schede compilate del foglio giornaliero (vecchia app) dello stesso giorno, gia' sul telefono
function schedeFoglioGiornaliero(iso){
  const g = leggiDB()[iso];
  if(!g) return { schede: [], spese: [] };
  const operai = (g.operai || []).map(o=>({ nome: String(o.nome || "").trim(), dalle: o.dalle || "", alle: o.alle || "" })).filter(o=>o.nome);
  const tecnici = String(g.tecnici || "").trim() || operai.map(o=>o.nome).join(" / ");
  const schede = (g.clienti || []).filter(c=>c && String(c.nome || "").trim() && schedaCompilata(c))
    .map(c=>({ ...c, tecnici, operai, foglio: true }));
  const ids = new Set(schede.map(c=>c.id));
  return { schede, spese: (g.spese || []).filter(sp=>!sp.clienteId || ids.has(sp.clienteId)) };
}
const inizioScheda = c=>(c.fasce && c.fasce[0] && c.fasce[0].d) || c.dalle || c.operai.map(o=>o.dalle).filter(Boolean).sort()[0] || "99:99";

// ordine: ora dell'intervento, poi primo orario dei tecnici, poi completamento
const chiaveOrdine = r=>(r.interventi && r.interventi.ora ? ora(r.interventi.ora) : "") ||
  (r.rapportino_operai || []).map(o=>ora(o.dalle)).filter(Boolean).sort()[0] || "99:99";

export async function preparaPDFGiornata(btn){
  azzeraPDFGiornata();
  const iso = $("rg-data").value || oggiIso();
  const autore = puo("rapportini.consulta") ? ($("rg-operaio").value || null) : (profilo && profilo.id);
  if(navigator.onLine === false){ messaggio("Serve la connessione: il PDF della giornata usa i rapportini confermati dal server.", "err"); return; }
  btn.disabled = true; btn.classList.add("in-corso");
  messaggio("Preparazione: rapportini completati e foto del " + dataIt(iso) + "…");
  try{
    await operaiAttivi().catch(()=>[]);
    const [completati, bozze, coda] = await Promise.all([
      rapportiniCompletatiDelGiorno(iso, autore),
      elencoRapportini({ dal: iso, al: iso, stato: "bozza", autore }).catch(()=>[]),
      elencoCoda().then(c=>c.voci).catch(()=>[]),
    ]);
    completati.sort((a, b)=>chiaveOrdine(a).localeCompare(chiaveOrdine(b)) || String(a.completato_il).localeCompare(String(b.completato_il)));
    // rimasti sul telefono (non ancora inviati/confermati) per lo stesso giorno: esclusi e segnalati
    const idServer = new Set(completati.map(r=>r.id).concat(bozze.map(r=>r.id)));
    const sospesi = coda.filter(v=>v.rapportino && v.rapportino.data === iso && v.stato !== "inviato" && !idServer.has(v.id) &&
      (!autore || v.autore === autore));
    const inBozza = bozze.filter(r=>!completati.some(c=>c.id === r.id));
    const esclusi = [
      ...inBozza.map(r=>({ cliente: r.cliente, motivo: "in bozza: non completato" })),
      ...sospesi.map(v=>({ cliente: v.rapportino.cliente || "(senza cliente)", motivo: v.completa ? "completato sul telefono ma non ancora inviato" : "sul telefono, non ancora inviato" })),
    ];
    let mancanti = 0, fotoNonLette = 0;
    const schede = [];
    for(const r of completati){
      const f = await fotoDi(r);
      mancanti += f.mancanti; if(f.errore) fotoNonLette++;
      schede.push(schedaPDF(r, f.foto));
    }
    const elencoEsclusi = esclusi.length ? '<div class="ai-sez-tit">Non inclusi</div><ul class="ai-lista att">' +
      esclusi.map(e=>'<li>' + esc(e.cliente) + ' — ' + esc(e.motivo) + '</li>').join("") + '</ul>' : "";
    // foglio giornaliero della vecchia app: solo senza filtro operaio (non ha un autore per scheda)
    const foglio = autore && puo("rapportini.consulta") ? { schede: [], spese: [] } : schedeFoglioGiornaliero(iso);
    if(!completati.length && !foglio.schede.length){
      messaggio("Nessun rapportino completato il " + dataIt(iso) + (autore && puo("rapportini.consulta") ? " per " + nomeOperaio(autore) : "") + ".", "att");
      $("rg-esito").innerHTML = elencoEsclusi;
      return;
    }
    // rapportini e schede del foglio giornaliero insieme, in ordine di orario
    const tutte = schede.concat(foglio.schede).map((c, i)=>({ c, k: inizioScheda(c), i })).sort((a, b)=>a.k.localeCompare(b.k) || a.i - b.i).map(x=>x.c);
    const tecnici = [...new Set(tutte.flatMap(c=>c.operai.map(o=>o.nome)).filter(Boolean))];
    // orario della giornata (8-17 salvo inserimento): mostrato sullo schermo, non nel PDF
    await aggiornaOrari();
    const orario = orarioDelGiorno(iso);
    const dati = {
      tecnici: tecnici.join(" / "),
      operai: tutte.length === 1 ? tutte[0].operai : [],
      spese: foglio.spese, mostraOrario: true, soloIntervalli: true, clienti: tutte,   // solo dalle-alle, mai le ore
      ...(tutte.length === 1 && completati.length ? { riferimento: "RAP-" + iso.replace(/-/g, "") + "-" + String(completati[0].id).replace(/-/g, "").slice(0, 4).toUpperCase() } : {}),
    };
    const chi = autore && puo("rapportini.consulta") ? "_" + nomeOperaio(autore).replace(/[^\w]+/g, "_").slice(0, 30) : "";
    preparato = { iso, dati, nome: "Rapportini_" + iso + chi + ".pdf" };
    $("rg-esito").innerHTML = '<div class="card nota" id="rg-orario">Orario della giornata: <b>' + orario.dalle + '–' + orario.alle + ' · ' + oreTesto(orario.minuti) + '</b>' +
        (orario.escludi ? ' (esclusa dal monte ore)' : '') + '</div>' +
      '<div class="ai-sez-tit">Nel PDF (' + tutte.length + (tutte.length === 1 ? " scheda" : " schede") + ')</div>' +
      '<div class="card cli-elenco">' + tutte.map((c, i)=>'<div class="st-rap" style="cursor:default"><span class="cli-testi">' +
        '<span class="cli-nome" style="display:block">' + (i + 1) + '. ' + esc(c.nome) + '</span>' +
        '<span class="cli-ind" style="display:block;white-space:normal">' + esc([c.indirizzo, orariScheda(c)].filter(Boolean).join(" · ")) + '</span>' +
        (c.foto && c.foto.length ? '<span class="cli-ind" style="display:block">' + icona("image", "i-sm") + ' ' + c.foto.length + ' foto</span>' : '') +
        '</span>' + (c.foglio ? '<span class="badge neutro">Foglio giornaliero</span>' : '<span class="badge ok">' + icona("check") + 'Completato</span>') + '</div>').join("") + '</div>' +
      elencoEsclusi;
    messaggio((mancanti ? mancanti + (mancanti === 1 ? " foto non disponibile verrà saltata. " : " foto non disponibili verranno saltate. ") : "") +
      (fotoNonLette ? "Foto non lette per " + fotoNonLette + " rapportini. " : "") + (sulComputer() ? "Pronto: clicca «Stampa PDF»." : "Pronto: tocca «Condividi PDF»."), mancanti || fotoNonLette ? "att" : "");
    $("rg-condividi").classList.remove("nascosto");
    $("rg-condividi").querySelector("span").textContent = (sulComputer() ? "Stampa PDF (" : "Condividi PDF (") + tutte.length + ")";
  }catch(e){
    messaggio(e.message, "err");
  }finally{ btn.disabled = false; btn.classList.remove("in-corso"); }
}

export function condividiPDFGiornata(btn){
  if(!preparato) return;
  const { dati, iso, nome } = preparato;
  return condividi(btn, ()=>generaPDFPerCliente(dati, iso), nome);
}

// "Invia PDF della giornata" (Altro, Home, Apri giornata): il PDF del giorno indicato (da "Apri giornata")
// oppure del giorno aperto nel foglio giornaliero, gia' preparato; poi basta toccare "Condividi PDF"
// (sul computer "Stampa PDF")
export async function apriPDFGiornata(giorno){
  const iso = (/^\d{4}-\d{2}-\d{2}$/.test(giorno || "") && giorno) || ($("data") && $("data").value) || oggiIso();
  mostraVista("rapporti");
  $("rg-data").value = iso;
  $("rg-operaio").value = "";
  $("rg-data").closest(".rg-box").scrollIntoView({ block: "start" });
  return preparaPDFGiornata($("rg-prepara"));
}

// filtro operaio (admin e company) e data predefinita
export async function inizializzaPDFGiornata(){
  if(!$("rg-data").value) $("rg-data").value = ($("data") && $("data").value) || oggiIso();   // il giorno scelto in Home
  if(!puo("rapportini.consulta")) return;
  const sel = $("rg-operaio");
  if(sel.options.length > 1) return;
  const operai = await operaiAttivi().catch(()=>[]);
  operai.forEach(o=>sel.insertAdjacentHTML("beforeend", '<option value="' + o.id + '">' + esc(o.nome || o.username) + '</option>'));
}
su("giorno-pdf-cambiato", ()=>azzeraPDFGiornata());   // il giorno scelto in Home vale anche qui
su("uscita", ()=>{ preparato = null; const s = $("rg-operaio"); while(s.options.length > 1) s.remove(1); $("rg-data").value = ""; });
