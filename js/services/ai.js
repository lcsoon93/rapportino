// Assistente AI: UNICO punto dell'app che parla con l'AI.
// Le richieste vanno alla Edge Function "ai" (Supabase), che usa Groq con la chiave nei secret del
// server: qui non c'e' nessuna chiave e nessun modello da scegliere. Il server controlla sessione,
// ruolo, limiti e legge i dati con i permessi dell'utente (RLS).
// Le risposte sono PROPOSTE: l'app le mostra in anteprima modificabile e le applica solo dopo la
// conferma dell'utente, con i salvataggi gia' esistenti (bozza sul telefono + sincronizzazione).
// Senza rete l'assistente non e' disponibile, ma il resto dell'app (bozze, coda, controllo automatico)
// continua a funzionare come prima.
import { chiamaFunzione } from "../core/sessione.js";
import { leggiDB } from "../core/storage.js";

// limiti lato app (il server applica comunque i suoi)
export const LIMITI_AI = {
  testo: 4000, domanda: 500, ricerca: 300, immagini: 3,
  latoFoto: 1024,                 // lato lungo delle foto inviate all'AI (px)
  caratteriFoto: 1400000,         // data URL di una foto ridotta
};
const TEMPO = { foto: 75000, predefinito: 45000 };

export class ErroreAI extends Error {
  constructor(messaggio, codice){ super(messaggio); this.codice = codice || "errore"; }
}
export const inLinea = ()=>typeof navigator === "undefined" || navigator.onLine !== false;

function messaggioErrore(r){
  const codice = (r.dati && r.dati.codice) || "";
  if(r.stato === 0) return "Nessuna connessione: l'assistente AI richiede Internet. Il rapportino resta salvato sul telefono.";
  if(r.stato === 401) return "Sessione scaduta: accedi di nuovo.";
  if(r.stato === 404 && !codice) return "L'assistente AI non è ancora attivo sul server.";
  if(codice === "non_configurata") return "L'assistente AI non è ancora configurato (manca la chiave Groq sul server).";
  return r.errore || "Errore dell'assistente AI.";
}

// chiamata generica: restituisce i dati della risposta o lancia ErroreAI con un messaggio leggibile
export async function chiediAI(azione, dati = {}){
  if(!inLinea()) throw new ErroreAI("Nessuna connessione: l'assistente AI richiede Internet. Il resto dell'app funziona anche offline.", "offline");
  const r = await chiamaFunzione("ai", { ...dati, azione }, true, { timeout: TEMPO[azione] || TEMPO.predefinito });
  if(r.ok && r.dati && r.dati.ok) return r.dati;
  if(r.ok) throw new ErroreAI("Risposta dell'assistente AI non valida.", "risposta_non_valida");
  throw new ErroreAI(messaggioErrore(r), (r.dati && r.dati.codice) || (r.stato === 0 ? "offline" : "http_" + r.stato));
}

// ---------------------------------------------------------------- dati del rapportino per l'AI
// Solo testo e indicatori: MAI l'immagine della firma ne' identificativi interni.
export function contestoRapportino(rapportino, ore, foto, intervento){
  const r = rapportino || {};
  return {
    data: r.data || "", cliente: r.cliente || "", indirizzo: r.indirizzo || "", tipologia: r.tipologia || "",
    attivita: String(r.attivita || "").slice(0, LIMITI_AI.testo), note: r.note || "", esito: r.esito || "",
    materiali: (r.materiali || []).filter(m=>m && m.a).map(m=>({ a: m.a, q: m.q || "" })),
    ore: (ore || []).map(o=>({ operaio: o.nome || "", dalle: o.dalle || "", alle: o.alle || "" })),
    firma: !!r.firma, firmatario: r.firmatario || "",
    foto: (foto && foto.totali) || 0, fotoNonInviate: (foto && foto.nonInviate) || 0,
    intervento: intervento || "",
  };
}

// ---------------------------------------------------------------- funzioni
export function elaboraTesto(modo, testo, contesto){
  const t = String(testo || "");
  if(!t.trim()) return Promise.reject(new ErroreAI(modo === "genera" ? "Scrivi prima gli appunti nel campo Attività svolte." : "Il campo Attività svolte è vuoto.", "input"));
  if(t.length > LIMITI_AI.testo) return Promise.reject(new ErroreAI("Testo troppo lungo (massimo " + LIMITI_AI.testo + " caratteri).", "input"));
  return chiediAI("testo", { modo, testo: t, contesto });
}
export async function descriviFoto(sorgenti, note, contesto){
  const scelte = (sorgenti || []).filter(Boolean).slice(0, LIMITI_AI.immagini);
  if(!scelte.length) throw new ErroreAI("Aggiungi almeno una foto al rapportino.", "input");
  const immagini = [];
  for(const s of scelte) immagini.push(await riduciPerAI(s));
  return chiediAI("foto", { immagini, note: note || "", contesto });
}
export const controlloAI = (rapportino, segnalate)=>chiediAI("controllo", { rapportino, segnalate: (segnalate || []).slice(0, 20) });
export const suggerimenti = (rapportino, id)=>chiediAI("suggerimenti", { rapportino, id });
export function ricercaIntelligente(domanda){
  const d = String(domanda || "").trim();
  if(!d) return Promise.reject(new ErroreAI("Scrivi cosa cercare.", "input"));
  if(d.length > LIMITI_AI.ricerca) return Promise.reject(new ErroreAI("Ricerca troppo lunga (massimo " + LIMITI_AI.ricerca + " caratteri).", "input"));
  return chiediAI("ricerca", { domanda: d });
}
export function domandaDati(domanda, dal, al){
  const d = String(domanda || "").trim();
  if(!d) return Promise.reject(new ErroreAI("Scrivi la domanda.", "input"));
  if(d.length > LIMITI_AI.domanda) return Promise.reject(new ErroreAI("Domanda troppo lunga (massimo " + LIMITI_AI.domanda + " caratteri).", "input"));
  return chiediAI("domanda", { domanda: d, dal, al });
}
export const tendenze = (dal, al)=>chiediAI("predittiva", { dal, al });
export const verificaModelli = ()=>chiediAI("modelli");

// ---------------------------------------------------------------- foto ridotte (meno dati, meno costi)
function carica(src){
  return new Promise((ok, ko)=>{
    const img = new Image();
    img.onload = ()=>ok(img);
    img.onerror = ()=>ko(new ErroreAI("Foto non leggibile.", "input"));
    img.src = src;
  });
}
export async function riduciPerAI(src){
  const img = await carica(src);
  const lato = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  const k = Math.min(1, LIMITI_AI.latoFoto / lato);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);      // PNG trasparenti: sfondo bianco
  ctx.drawImage(img, 0, 0, c.width, c.height);
  for(const q of [0.72, 0.55, 0.4]){
    const url = c.toDataURL("image/jpeg", q);
    if(url.length <= LIMITI_AI.caratteriFoto) return url;
  }
  throw new ErroreAI("Foto troppo grande anche dopo la riduzione.", "input");
}

// ---------------------------------------------------------------- archivio della vecchia app (sul telefono)
// Stessi filtri della ricerca intelligente applicati alle giornate gia' presenti sul telefono
// (sincronizzate secondo i permessi): nessuna richiesta in piu' al server.
const norma = t=>String(t || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export function cercaArchivioLocale(filtri, massimo = 30){
  if(!filtri || filtri.tipo === "interventi") return [];
  const db = leggiDB(), out = [];
  const cliente = norma(filtri.cliente), parole = (filtri.parole || []).map(norma).filter(Boolean), operaio = norma(filtri.operaio);
  Object.keys(db).filter(iso=>iso >= filtri.dal && iso <= filtri.al).sort().reverse().forEach(iso=>{
    const g = db[iso] || {};
    const tecnici = norma([(g.operai || []).map(o=>o.nome).join(" "), g.tecnici].join(" "));
    if(operaio && !tecnici.includes(operaio.split(" ")[0])) return;
    (g.clienti || []).forEach(c=>{
      if(!c || !String(c.nome || "").trim() || c.nome === "(senza nome)" || out.length >= massimo) return;
      if(cliente && !norma(c.nome).includes(cliente)) return;
      const testo = norma([c.nome, c.indirizzo, c.dettagli, c.tipologia, c.fatturare].join(" "));
      if(!parole.every(p=>testo.includes(p))) return;
      if(filtri.stato === "bozza" || filtri.stato === "annullato" || filtri.stato === "pianificato") return;
      out.push({ iso, nome: c.nome, indirizzo: c.indirizzo || "", dettagli: String(c.dettagli || "").slice(0, 140) });
    });
  });
  return out;
}
