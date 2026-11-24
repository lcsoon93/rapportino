// PDF dei rapportini del mese (sezione Rapportini): tutti i rapportini COMPLETATI di un mese, di tutti
// gli operai o di uno solo, organizzati per giorno, con firme e foto; riepilogo ore per giorno e per
// operaio e totale. Bozze e rapportini rimasti sul telefono sono elencati a parte, mai tra i completati.
// Come il PDF della giornata: "Prepara" legge dati e foto, "Condividi" genera il PDF dal tocco.
import { puo } from "../core/permessi.js";
import { profilo } from "../core/sessione.js";
import { su } from "../core/eventi.js";
import { elencoRapportini, nomeOperaio, operaiAttivi, rapportiniCompletatiPeriodo } from "../services/api-lavori.js";
import { elencoCoda } from "../services/sinc-rapportini.js";
import { condividi } from "../services/condivisione.js";
import { aggiornaOrari, orarioDelGiorno } from "../services/orario-giornata.js";
import { limitiMese, riepilogoRapportini } from "../services/rapportini-mese-logica.js";
import { generaPDFRapportiniMese } from "../services/pdf/rapportini-mese.js";
import { fotoDi, orariScheda, schedaPDF } from "./stampa-giornata.js";
import { dataIt, oggiIso } from "../utils/dates.js";
import { esc, oreTesto } from "../utils/formatters.js";
import { sulComputer } from "../utils/dispositivo.js";

const $ = id=>document.getElementById(id);
let preparato = null;          // { dati, nome }
const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
export const nomeMese = mese=>{ const [a, m] = mese.split("-").map(Number); return MESI[m - 1] + " " + a; };
const ora = t=>String(t || "").slice(0, 5);

function messaggio(t, tipo){ $("rm-msg").textContent = t || ""; $("rm-msg").className = "msg-info" + (tipo ? " " + tipo : ""); }
export function azzeraPDFMese(){
  preparato = null;
  $("rm-esito").innerHTML = "";
  $("rm-condividi").classList.add("nascosto");
  messaggio("");
}
export function spostaMesePDF(delta){
  const [a, m] = ($("rm-mese").value || oggiIso().slice(0, 7)).split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  $("rm-mese").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  azzeraPDFMese();
}

export async function preparaPDFMese(btn){
  azzeraPDFMese();
  const mese = $("rm-mese").value || oggiIso().slice(0, 7);
  $("rm-mese").value = mese;
  const consulta = puo("rapportini.consulta");
  const autore = consulta ? ($("rm-operaio").value || null) : (profilo && profilo.id);
  if(navigator.onLine === false){ messaggio("Serve la connessione: il PDF del mese usa i rapportini confermati dal server.", "err"); return; }
  const { dal, al } = limitiMese(mese);
  btn.disabled = true; btn.classList.add("in-corso");
  messaggio("Preparazione: rapportini completati di " + nomeMese(mese) + "…");
  try{
    await operaiAttivi().catch(()=>[]);
    await aggiornaOrari();
    const [completati, bozze, coda] = await Promise.all([
      // admin/company: tutto il mese (anche i rapportini dei colleghi in cui compare l'operaio scelto);
      // l'operaio: solo i propri (come sempre)
      rapportiniCompletatiPeriodo(dal, al, consulta ? null : autore),
      elencoRapportini({ dal, al, stato: "bozza", autore }).catch(()=>[]),
      elencoCoda().then(c=>c.voci).catch(()=>[]),
    ]);
    // operaio scelto (o l'operaio stesso): solo i suoi rapportini e le sue ore; "Tutti": tutti gli operai
    const rp = riepilogoRapportini({ completati, bozze, coda, dal, al, operaio: autore, nome: nomeOperaio, fascia: iso=>orarioDelGiorno(iso) });
    let mancanti = 0, fotoNonLette = 0, fatte = 0;
    for(const g of rp.giorni){
      g.rapportini.sort((a, b)=>String(a.completato_il).localeCompare(String(b.completato_il)));
      g.schede = [];
      for(const r of g.rapportini){
        messaggio("Preparazione: foto e firme (" + (++fatte) + " di " + rp.rapportini + ")…");
        const f = await fotoDi(r);
        mancanti += f.mancanti; if(f.errore) fotoNonLette++;
        const c = schedaPDF(r, f.foto);
        const i = r.interventi;
        c.intervento = i ? [i.ora ? ora(i.ora) : "", i.descrizione || "programmato"].filter(Boolean).join(" · ") : "imprevisto (senza intervento programmato)";
        c.rif = "RAP-" + r.data.replace(/-/g, "") + "-" + String(r.id).replace(/-/g, "").slice(0, 4).toUpperCase();
        g.schede.push(c);
      }
    }
    const operaio = autore && consulta ? nomeOperaio(autore) : consulta ? "Tutti" : nomeOperaio(profilo.id);
    const elencoEsclusi = rp.esclusi.length ? '<div class="ai-sez-tit">Non inclusi (bozze e non inviati)</div><ul class="ai-lista att" id="rm-esclusi">' +
      rp.esclusi.map(e=>'<li>' + esc(dataIt(e.data)) + ' · ' + esc(e.cliente) + (e.operaio && consulta ? ' (' + esc(e.operaio) + ')' : '') + ' — ' + esc(e.motivo) + '</li>').join("") + '</ul>' : "";
    preparato = {
      dati: { periodo: nomeMese(mese), mese, operaio, riepilogo: rp },
      nome: "Rapportini_" + mese + (autore && consulta ? "_" + nomeOperaio(autore).replace(/[^\w]+/g, "_").slice(0, 30) : "") + ".pdf",
    };
    $("rm-esito").innerHTML = (rp.giorni.length
      ? '<div class="card nota" id="rm-riepilogo">' + rp.rapportini + (rp.rapportini === 1 ? " rapportino completato" : " rapportini completati") + " in " +
          rp.giorni.length + (rp.giorni.length === 1 ? " giorno" : " giorni") + ' · ore effettivamente lavorate: <b id="rm-totale">' + oreTesto(rp.totale) + '</b>' +
          (rp.operai.length ? '<br>' + rp.operai.map(o=>esc(o.nome) + ': ' + oreTesto(o.minuti)).join(" · ") : '') + '</div>' +
        '<div class="card cli-elenco" id="rm-giorni">' + rp.giorni.map(g=>'<div class="st-rap" style="cursor:default"><span class="cli-testi">' +
          '<span class="cli-nome" style="display:block">' + esc(dataIt(g.iso)) + ' · ' + g.rapportini.length + (g.rapportini.length === 1 ? " rapportino" : " rapportini") + '</span>' +
          '<span class="cli-ind" style="display:block;white-space:normal">' + esc(g.schede.map(c=>c.nome + (orariScheda(c) ? " (" + orariScheda(c) + ")" : "")).join("; ")) + '</span>' +
          '<span class="cli-ind" style="display:block">Ore lavorate: ' + oreTesto(g.minuti) + (g.fascia ? ' · fascia della giornata ' + g.fascia.dalle + '–' + g.fascia.alle : '') + '</span>' +
          '</span></div>').join("") + '</div>'
      : '<div class="card nota" id="rm-riepilogo">Nessun rapportino completato in ' + esc(nomeMese(mese)) + '.</div>') + elencoEsclusi;
    messaggio((mancanti ? mancanti + (mancanti === 1 ? " foto non disponibile verrà saltata. " : " foto non disponibili verranno saltate. ") : "") +
      (fotoNonLette ? "Foto non lette per " + fotoNonLette + " rapportini. " : "") +
      (rp.giorni.length ? (sulComputer() ? "Pronto: clicca «Stampa PDF»." : "Pronto: tocca «Condividi PDF».") : "Il PDF conterrà solo il riepilogo vuoto" + (rp.esclusi.length ? " e i non inclusi." : ".")),
      mancanti || fotoNonLette || !rp.giorni.length ? "att" : "");
    $("rm-condividi").classList.remove("nascosto");
    $("rm-condividi").querySelector("span").textContent = (sulComputer() ? "Stampa PDF (" : "Condividi PDF (") + rp.rapportini + ")";
  }catch(e){
    messaggio(e.message, "err");
  }finally{ btn.disabled = false; btn.classList.remove("in-corso"); }
}

export function condividiPDFMese(btn){
  if(!preparato) return;
  const { dati, nome } = preparato;
  return condividi(btn, ()=>generaPDFRapportiniMese(dati), nome);
}

export async function inizializzaPDFMese(){
  if(!$("rm-mese").value) $("rm-mese").value = oggiIso().slice(0, 7);
  if(!puo("rapportini.consulta")) return;
  const sel = $("rm-operaio");
  if(sel.options.length > 1) return;
  const operai = await operaiAttivi().catch(()=>[]);
  operai.forEach(o=>sel.insertAdjacentHTML("beforeend", '<option value="' + o.id + '">' + esc(o.nome || o.username) + '</option>'));
}
su("uscita", ()=>{ preparato = null; const s = $("rm-operaio"); while(s.options.length > 1) s.remove(1); $("rm-mese").value = ""; });
