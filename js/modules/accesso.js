// Schermate di accesso e di cambio password. Nessuna password viene salvata nel browser:
// i campi si svuotano subito dopo l'invio.
import { accedi, cambiaPassword, esci, profilo } from "../core/sessione.js";
import { sincronizza } from "../services/sync.js";

const $ = id=>document.getElementById(id);

function occupato(btn, si, testo){
  btn.disabled = si;
  btn.classList.toggle("in-corso", si);
  const s = btn.querySelector("span");
  if(s && testo) s.textContent = testo;
}
function mostraSchermata(id){
  ["schermata-accesso", "schermata-password"].forEach(k=>$(k).classList.toggle("nascosto", k !== id));
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
// mostra il login e si risolve con il profilo quando l'accesso riesce
export function chiediAccesso(messaggio){
  $("acc-errore").textContent = messaggio || "";
  $("acc-password").value = "";
  mostraSchermata("schermata-accesso");
  setTimeout(()=>($("acc-username").value ? $("acc-password") : $("acc-username")).focus(), 50);
  return new Promise(r=>{ risolviAccesso = r; });
}
$("form-accesso").addEventListener("submit", async e=>{
  e.preventDefault();
  const username = $("acc-username").value.trim();
  const password = $("acc-password").value;
  if(!username || !password){
    $("acc-errore").textContent = "Inserisci username e password.";
    return;
  }
  const btn = $("acc-invia");
  occupato(btn, true, "Accesso…");
  $("acc-errore").textContent = "";
  const r = await accedi(username, password);
  $("acc-password").value = "";
  occupato(btn, false, "Accedi");
  if(!r.ok){
    $("acc-errore").textContent = r.errore;
    $("acc-password").focus();
    return;
  }
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
  await esci();
}
export function nascondiSchermate(){ mostraSchermata(null); }
