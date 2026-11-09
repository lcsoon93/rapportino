// Schermate di accesso (password o PIN), cambio password e PIN di accesso.
// Nessuna password e nessun PIN vengono salvati nel browser: i campi si svuotano subito dopo l'invio.
// Del PIN il telefono ricorda solo lo username di chi l'ha attivato (per proporre l'accesso con PIN).
import { scollegaNotifiche } from "../services/notifiche.js";
import {
  accedi, accediConPin, cambiaPassword, esci, impostaPin, profilo, ricordaUtentePin, rimuoviPin, statoPin, utentePin,
} from "../core/sessione.js";
import { sincronizza } from "../services/sync.js";

const $ = id=>document.getElementById(id);

function occupato(btn, si, testo){
  btn.disabled = si;
  btn.classList.toggle("in-corso", si);
  const s = btn.querySelector("span");
  if(s && testo) s.textContent = testo;
}
function mostraSchermata(id){
  ["schermata-accesso", "schermata-password", "schermata-pin"].forEach(k=>$(k).classList.toggle("nascosto", k !== id));
  document.body.classList.toggle("non-autenticato", !!id);
}

// pulsanti "occhio" sui campi password
document.addEventListener("click", e=>{
  const b = e.target.closest(".mostra-pw[data-per]");
  if(!b) return;
  const campo = $(b.dataset.per);
  const visibile = campo.type === "text";
  campo.type = visibile ? "password" : "text";
  b.setAttribute("aria-label", visibile ? "Mostra password" : "Nascondi password");
});

// ---------------------------------------------------------------- accesso
let risolviAccesso = null;
let modoPin = false;
function impostaModo(pin){
  modoPin = pin;
  $("acc-blocco-password").classList.toggle("nascosto", pin);
  $("acc-blocco-pin").classList.toggle("nascosto", !pin);
  $("acc-cambia-modo").textContent = pin ? "Accedi con la password" : "Accedi con il PIN";
  $("acc-sottotitolo").textContent = pin ? "Accedi con il tuo username e il PIN" : "Accedi con il tuo username e la password";
  $("acc-password").value = ""; $("acc-pin").value = "";
}
const campoDaRiempire = ()=>!$("acc-username").value ? $("acc-username") : modoPin ? $("acc-pin") : $("acc-password");
// mostra il login e si risolve con il profilo quando l'accesso riesce. Se su questo telefono e' stato
// attivato un PIN si propone l'accesso con PIN per quello username.
export function chiediAccesso(messaggio){
  $("acc-errore").textContent = messaggio || "";
  const u = utentePin();
  if(u) $("acc-username").value = u;
  impostaModo(!!u);
  mostraSchermata("schermata-accesso");
  setTimeout(()=>campoDaRiempire().focus(), 50);
  return new Promise(r=>{ risolviAccesso = r; });
}
$("acc-cambia-modo").addEventListener("click", ()=>{
  impostaModo(!modoPin);
  $("acc-errore").textContent = "";
  campoDaRiempire().focus();
});
// il PIN accetta solo cifre
document.addEventListener("input", e=>{
  if(e.target.classList && e.target.classList.contains("campo-pin")) e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
});
$("form-accesso").addEventListener("submit", async e=>{
  e.preventDefault();
  const username = $("acc-username").value.trim();
  const segreto = modoPin ? $("acc-pin").value : $("acc-password").value;
  if(!username || !segreto){
    $("acc-errore").textContent = modoPin ? "Inserisci username e PIN." : "Inserisci username e password.";
    return;
  }
  if(modoPin && !/^[0-9]{6}$/.test(segreto)){ $("acc-errore").textContent = "Il PIN è di 6 cifre."; return; }
  const btn = $("acc-invia");
  occupato(btn, true, "Accesso…");
  $("acc-errore").textContent = "";
  const r = modoPin ? await accediConPin(username, segreto) : await accedi(username, segreto);
  $("acc-password").value = ""; $("acc-pin").value = "";
  occupato(btn, false, "Accedi");
  if(!r.ok){
    $("acc-errore").textContent = r.errore;
    // PIN non piu' valido per questo username (disattivato, eliminato dopo troppi errori): si torna alla password
    if(modoPin && r.stato === 401 && /password/i.test(r.errore || "")){
      if(utentePin().toLowerCase() === username.toLowerCase()) ricordaUtentePin("");
      impostaModo(false);
    }
    campoDaRiempire().focus();
    return;
  }
  if(modoPin) ricordaUtentePin(r.profilo.username);
  if(risolviAccesso){ const f = risolviAccesso; risolviAccesso = null; f(r.profilo); }
});

// ---------------------------------------------------------------- cambio password
let risolviPassword = null;
function regole(){
  const v = $("pw-nuova").value, u = profilo ? profilo.username.toLowerCase() : "";
  const stato = {
    lunghezza: v.length >= 10,
    misto: /[A-Za-z]/.test(v) && /[0-9]/.test(v),
    username: !!v && !(u && v.toLowerCase().includes(u)),
  };
  document.querySelectorAll("#pw-regole li").forEach(li=>li.classList.toggle("ok", stato[li.dataset.regola]));
  return stato.lunghezza && stato.misto && stato.username;
}
$("pw-nuova").addEventListener("input", regole);

// obbligatorio = primo accesso / password reimpostata: non si puo' annullare
export function chiediCambioPassword(obbligatorio){
  ["pw-attuale", "pw-nuova", "pw-conferma"].forEach(id=>{ $(id).value = ""; $(id).type = "password"; });
  $("pw-errore").textContent = "";
  $("pw-titolo").textContent = obbligatorio ? "Scegli la tua password" : "Cambia password";
  $("pw-sottotitolo").textContent = obbligatorio
    ? "Al primo accesso (o dopo un reset) devi sostituire il codice ricevuto con una password personale."
    : "Inserisci la password attuale e quella nuova.";
  $("pw-annulla").classList.toggle("nascosto", !!obbligatorio);
  $("pw-esci").classList.toggle("nascosto", !obbligatorio);
  regole();
  mostraSchermata("schermata-password");
  setTimeout(()=>$("pw-attuale").focus(), 50);
  return new Promise(r=>{ risolviPassword = r; });
}
function chiudiPassword(esito){
  if(risolviPassword){ const f = risolviPassword; risolviPassword = null; f(esito); }
}
$("form-password").addEventListener("submit", async e=>{
  e.preventDefault();
  const attuale = $("pw-attuale").value, nuova = $("pw-nuova").value, conferma = $("pw-conferma").value;
  if(!attuale){ $("pw-errore").textContent = "Inserisci la password attuale."; return; }
  if(!regole()){ $("pw-errore").textContent = "La nuova password non rispetta le regole indicate."; return; }
  if(nuova !== conferma){ $("pw-errore").textContent = "Le due password nuove non coincidono."; return; }
  const btn = $("pw-invia");
  occupato(btn, true, "Salvataggio…");
  const r = await cambiaPassword(attuale, nuova);
  occupato(btn, false, "Salva password");
  if(!r.ok){ $("pw-errore").textContent = r.errore; return; }
  ["pw-attuale", "pw-nuova", "pw-conferma"].forEach(id=>{ $(id).value = ""; });
  chiudiPassword(true);
});
$("pw-annulla").addEventListener("click", ()=>chiudiPassword(false));
$("pw-esci").addEventListener("click", ()=>{ chiudiPassword(false); esci(); });

// dalla sezione Altro
export async function apriCambioPassword(){
  const ok = await chiediCambioPassword(false);
  mostraSchermata(null);
  if(ok) alert("Password cambiata.");
}
// "Esci": prima si prova a inviare le modifiche al server
export async function esciDallApp(){
  if(!confirm("Uscire dall'app? Le modifiche vengono prima inviate al server.")) return;
  await sincronizza(true);
  await scollegaNotifiche();       // il telefono non riceve piu' gli avvisi di questo utente
  await esci();
}
export function nascondiSchermate(){ mostraSchermata(null); }

// ---------------------------------------------------------------- PIN di accesso (Altro)
let pinAttivo = false;
function campiPin(){ ["pin-nuovo", "pin-conferma", "pin-password"].forEach(id=>{ $(id).value = ""; }); }
function disegnaPin(){
  $("pin-stato").textContent = pinAttivo
    ? "Il PIN è attivo: puoi cambiarlo o disattivarlo. Per cambiarlo serve la password attuale."
    : "Accedi più in fretta con un PIN di 6 cifre. Per attivarlo serve la password attuale.";
  $("pin-salva").querySelector("span").textContent = pinAttivo ? "Cambia PIN" : "Attiva PIN";
  $("pin-rimuovi").classList.toggle("nascosto", !pinAttivo);
}
export async function apriPin(){
  campiPin();
  $("pin-errore").textContent = ""; $("pin-ok").textContent = "";
  mostraSchermata("schermata-pin");
  $("pin-stato").textContent = "Controllo del PIN…";
  const s = await statoPin();
  if(!s.ok){ $("pin-stato").textContent = ""; $("pin-errore").textContent = s.errore; return; }
  pinAttivo = s.attivo;
  // PIN tolto da un'altra parte (es. dall'amministratore): il telefono smette di proporlo
  if(!pinAttivo && profilo && utentePin().toLowerCase() === profilo.username.toLowerCase()) ricordaUtentePin("");
  disegnaPin();
  setTimeout(()=>$("pin-nuovo").focus(), 50);
}
$("form-pin").addEventListener("submit", async e=>{
  e.preventDefault();
  $("pin-errore").textContent = ""; $("pin-ok").textContent = "";
  const pin = $("pin-nuovo").value, conferma = $("pin-conferma").value, password = $("pin-password").value;
  if(!/^[0-9]{6}$/.test(pin)){ $("pin-errore").textContent = "Il PIN deve essere di 6 cifre."; return; }
  if(pin !== conferma){ $("pin-errore").textContent = "I due PIN non coincidono."; return; }
  if(!password){ $("pin-errore").textContent = "Inserisci la password attuale."; return; }
  const btn = $("pin-salva");
  occupato(btn, true, "Salvataggio…");
  const r = await impostaPin(pin, { password });
  campiPin();
  occupato(btn, false);
  if(!r.ok){ disegnaPin(); $("pin-errore").textContent = r.errore; return; }
  pinAttivo = true;
  disegnaPin();
  $("pin-ok").textContent = "PIN salvato. Al prossimo accesso da questo telefono ti verrà chiesto il PIN.";
});
$("pin-rimuovi").addEventListener("click", async ()=>{
  if(!confirm("Disattivare il PIN? Per accedere servirà la password.")) return;
  $("pin-errore").textContent = ""; $("pin-ok").textContent = "";
  const r = await rimuoviPin();
  if(!r.ok){ $("pin-errore").textContent = r.errore; return; }
  pinAttivo = false;
  disegnaPin();
  $("pin-ok").textContent = "PIN disattivato.";
});
$("pin-chiudi").addEventListener("click", ()=>{ campiPin(); mostraSchermata(null); });
