// Notifiche push sul telefono (Web Push).
// - Iscrizione: il browser crea un'iscrizione con la chiave pubblica VAPID; il database la salva per
//   l'utente collegato (rpc notifiche_iscrivi). Nessun dato degli altri utenti arriva al browser.
// - Invio: i trigger del database mettono in coda chi avvisare e cosa scrivere; dopo ogni salvataggio
//   l'app chiama la Edge Function "notifiche", che svuota la coda e invia.
// Su iPhone funziona solo con l'app aggiunta alla schermata Home (iOS 16.4 o successivo).
import { VAPID_PUBLIC_KEY } from "../core/config.js";
import { chiamaFunzione, client, profilo } from "../core/sessione.js";

export function supportate(){
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export function installata(){
  return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
}
export function iOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function permesso(){ return "Notification" in window ? Notification.permission : "unsupported"; }

let registrazione = null;
export async function registraServiceWorker(){
  if(!("serviceWorker" in navigator)) return null;
  try{
    registrazione = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    return registrazione;
  }catch(e){ console.warn("Service worker non registrato:", e.message); return null; }
}
// service worker pronto, con un tempo massimo (su alcuni browser "ready" puo' restare in attesa)
async function pronta(){
  if(!registrazione) await registraServiceWorker();
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, no)=>setTimeout(()=>no(new Error("L'app non è ancora pronta per le notifiche: chiudila e riaprila, poi riprova.")), 6000)),
  ]);
}
function chiaveApplicazione(){
  const s = VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/");
  const b = atob(s + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(b, c=>c.charCodeAt(0));
}
function nomeDispositivo(){
  const ua = navigator.userAgent;
  const so = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Browser";
  return so + (installata() ? " (app)" : "");
}
async function salvaSulServer(sub){
  const j = sub.toJSON();
  const { error } = await client.rpc("notifiche_iscrivi", {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_dispositivo: nomeDispositivo(),
  });
  if(error) throw new Error(/notifiche_iscrivi|function/i.test(error.message) ? "Notifiche non ancora attive sul server." : error.message);
}

// stato su questo telefono: "non-supportate" | "serve-installare" | "negate" | "attive" | "spente"
export async function statoNotifiche(){
  // su iPhone/iPad le notifiche esistono solo nell'app aperta dalla schermata Home
  if(iOS() && !installata()) return "serve-installare";
  if(!supportate()) return "non-supportate";
  if(permesso() === "denied") return "negate";
  const reg = await pronta();
  const sub = await reg.pushManager.getSubscription();
  return sub && permesso() === "granted" ? "attive" : "spente";
}

export async function attivaNotifiche(){
  if(iOS() && !installata()) throw new Error("Su iPhone aggiungi prima l'app alla schermata Home (Condividi → Aggiungi alla schermata Home) e aprila da lì.");
  if(!supportate()) throw new Error("Questo browser non supporta le notifiche.");
  const p = await Notification.requestPermission();
  if(p !== "granted") throw new Error("Permesso negato: abilita le notifiche per Rapportino nelle impostazioni del telefono.");
  const reg = await pronta();
  let sub = await reg.pushManager.getSubscription();
  // iscrizione creata con un'altra chiave: si rifa'
  if(sub && sub.options && sub.options.applicationServerKey){
    const k = new Uint8Array(sub.options.applicationServerKey);
    const atteso = chiaveApplicazione();
    if(k.length !== atteso.length || k.some((v, i)=>v !== atteso[i])){ await sub.unsubscribe(); sub = null; }
  }
  if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiaveApplicazione() });
  await salvaSulServer(sub);
}

export async function disattivaNotifiche(){
  if(!supportate()) return;
  const reg = await pronta();
  const sub = await reg.pushManager.getSubscription();
  if(!sub) return;
  await client.rpc("notifiche_disiscrivi", { p_endpoint: sub.endpoint }).catch(()=>{});
  await sub.unsubscribe();
}

// all'accesso: un'iscrizione gia' presente sul telefono viene (ri)collegata all'utente attuale
export async function ricollegaNotifiche(){
  try{
    if(!supportate() || permesso() !== "granted" || !profilo) return;
    const reg = await pronta();
    const sub = await reg.pushManager.getSubscription();
    if(sub) await salvaSulServer(sub);
  }catch(e){ console.warn("Notifiche:", e.message); }
}
// all'uscita: il telefono non riceve piu' gli avvisi di questo utente
export async function scollegaNotifiche(){
  try{
    if(!supportate()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if(sub) await client.rpc("notifiche_disiscrivi", { p_endpoint: sub.endpoint });
  }catch(e){}
}

export async function provaNotifica(){
  const r = await chiamaFunzione("notifiche", { azione: "prova" });
  if(!r.ok) throw new Error(r.errore);
  return r.dati;
}

// dopo un salvataggio: invia le notifiche in coda (in ritardo di poco per raccogliere piu' modifiche)
let attesa = null;
export function inviaNotificheInCoda(){
  if(!profilo) return;
  clearTimeout(attesa);
  attesa = setTimeout(()=>{ chiamaFunzione("notifiche", {}).catch(()=>{}); }, 1500);
}
