// Sezione Altro: collegamenti alle sezioni e informazioni sull'archivio.
import { DESTINATARIO, SINC_ATTIVA } from "../core/config.js";
import { leggiDB } from "../core/storage.js";
import { mostraVista, registraVista } from "../core/navigation.js";
import { aggiornaTestiData } from "./rapportini.js";
import { haRuolo, nomeCompleto, profilo } from "../core/sessione.js";
import { attivaNotifiche, disattivaNotifiche, provaNotifica, statoNotifiche } from "../services/notifiche.js";

export function vaiASezione(cls){
  mostraVista("giorno");
  const el = document.querySelector("#vista-giorno ." + cls);
  if(el) el.scrollIntoView({block:"start"});
}
export function aggiornaAltro(){
  aggiornaTestiData();
  const n = Object.keys(leggiDB()).length;
  document.getElementById("info-giorni").textContent = n;
  document.getElementById("info-sinc").textContent = SINC_ATTIVA() ? (navigator.onLine === false ? "Attiva (offline)" : "Attiva") : "Non configurata";
  document.getElementById("info-mail").textContent = DESTINATARIO;
  document.getElementById("altro-utente").textContent = profilo ? nomeCompleto(profilo) + " (@" + profilo.username + ")" : "—";
  aggiornaNotificheUI();
}

// ---------------------------------------------------------------- notifiche
function cosaRicevi(){
  const v = [];
  if(haRuolo("worker")) v.push("quando ti viene assegnato un intervento, o viene modificato o annullato");
  if(haRuolo("company")) v.push("quando un operaio aggiunge o completa un rapportino");
  return v.length ? "Ricevi un avviso " + v.join("; ") + "." : "";
}
const TESTI = {
  "attive": ["Attive", ""],
  "spente": ["Spente", ""],
  "negate": ["Bloccate", "Le notifiche sono bloccate: abilitale per Rapportino nelle impostazioni del telefono, poi torna qui."],
  "serve-installare": ["Da installare", "Su iPhone le notifiche funzionano solo con l'app sulla schermata Home: in Safari tocca Condividi → \"Aggiungi alla schermata Home\", poi apri Rapportino dall'icona e torna qui."],
  "non-supportate": ["Non disponibili", "Questo browser non supporta le notifiche. Su Android usa Chrome; su iPhone aggiungi l'app alla schermata Home."],
};
export async function aggiornaNotificheUI(){
  const $ = id=>document.getElementById(id);
  let stato;
  try{ stato = await statoNotifiche(); }catch(e){ stato = "non-supportate"; }
  const [etichetta, nota] = TESTI[stato] || TESTI["non-supportate"];
  $("notifiche-stato").textContent = etichetta;
  $("notifiche-nota").textContent = nota || cosaRicevi();
  $("notifiche-attiva").classList.toggle("nascosto", stato !== "spente");
  $("notifiche-prova").classList.toggle("nascosto", stato !== "attive");
  $("notifiche-spegni").classList.toggle("nascosto", stato !== "attive");
}
async function conPulsante(btn, azione){
  btn.disabled = true;
  try{ await azione(); }
  catch(e){ alert(e.message); }
  finally{ btn.disabled = false; aggiornaNotificheUI(); }
}
export function attivaNotificheUI(btn){
  return conPulsante(btn, async()=>{ await attivaNotifiche(); await provaNotifica().catch(()=>{}); });
}
export function provaNotificaUI(btn){
  return conPulsante(btn, async()=>{ await provaNotifica(); });
}
export function disattivaNotificheUI(btn){
  return conPulsante(btn, async()=>{ await disattivaNotifiche(); });
}

registraVista("altro", aggiornaAltro);
