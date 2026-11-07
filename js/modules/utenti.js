// Gestione utenti (solo admin): elenco, nuovo operaio, disattiva/riattiva, reimposta password.
// Tutte le operazioni passano dalla Edge Function "utenti", che ricontrolla che chi chiama sia admin.
import { chiamaFunzione } from "../core/sessione.js";
import { registraVista } from "../core/navigation.js";
import { esc, iniziali } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";

const $ = id=>document.getElementById(id);
const NOMI_RUOLO = { admin: "Amministratore", company: "Company", worker: "Operaio" };
let utenti = [];

// password iniziale casuale (lettere e numeri, senza caratteri ambigui)
export function generaPasswordIniziale(){
  const lettere = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", cifre = "23456789", tutti = lettere + cifre;
  const r = new Uint32Array(12);
  crypto.getRandomValues(r);
  let p = [...r].map((x, i)=>(i === 0 ? lettere : i === 1 ? cifre : tutti)[x % (i === 0 ? lettere.length : i === 1 ? cifre.length : tutti.length)]);
  // mescola, cosi' lettera e cifra obbligatorie non stanno sempre all'inizio
  for(let i = p.length - 1; i > 0; i--){ const j = r[i] % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  p = p.join("");
  $("ut-password").value = p;
  return p;
}

async function carica(){
  $("utenti-elenco").innerHTML = '<div class="card nota">Caricamento…</div>';
  const r = await chiamaFunzione("utenti", { azione: "elenco" });
  if(!r.ok){
    $("utenti-elenco").innerHTML = '<div class="card nota">' + esc(r.errore) + '</div>';
    return;
  }
  utenti = r.dati.utenti || [];
  disegna();
}
function disegna(){
  $("utenti-elenco").innerHTML = '<div class="card">' + utenti.map(u=>{
    const badge = [
      '<span class="badge ' + (u.ruolo === "worker" ? "pervinca" : "ok") + '">' + NOMI_RUOLO[u.ruolo] + '</span>',
      u.attivo ? "" : '<span class="badge err">' + icona("lock") + 'Disattivato</span>',
      u.attivo && u.deve_cambiare_password ? '<span class="badge att">Primo accesso da fare</span>' : "",
    ].join("");
    const azioni = u.ruolo === "worker"
      ? '<div class="utente-azioni">' +
          '<button type="button" class="btn btn-secondario" onclick="azioneUtente(\'' + u.id + '\',\'' + (u.attivo ? "disattiva" : "riattiva") + '\')">' + (u.attivo ? "Disattiva" : "Riattiva") + '</button>' +
          '<button type="button" class="btn btn-secondario" onclick="azioneUtente(\'' + u.id + '\',\'reset_password\')">Reimposta password</button>' +
        '</div>'
      : "";
    return '<div class="utente-riga">' +
      '<span class="avatar" aria-hidden="true">' + esc(iniziali(u.nome || u.username)) + '</span>' +
      '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(u.nome || u.username) + '</span>' +
      '<span class="cli-ind" style="display:block">@' + esc(u.username) + '</span>' +
      '<span class="int-badge" style="margin-top:6px">' + badge + '</span></span>' + azioni + '</div>';
  }).join("") + '</div>';
}

export async function azioneUtente(id, azione){
  const u = utenti.find(x=>x.id === id);
  if(!u) return;
  $("ut-ok").textContent = ""; $("ut-errore").textContent = "";
  let corpo = { azione, id };
  if(azione === "disattiva" && !confirm("Disattivare l'account di " + (u.nome || u.username) + "? Non potrà più accedere.")) return;
  if(azione === "reset_password"){
    if(!confirm("Reimpostare la password di " + (u.nome || u.username) + "? Riceverà una nuova password iniziale da cambiare al primo accesso.")) return;
    corpo.password = generaPasswordIniziale();
    $("ut-password").value = "";
  }
  const r = await chiamaFunzione("utenti", corpo);
  if(!r.ok){ $("ut-errore").textContent = r.errore; $("utenti-form").scrollIntoView({block:"start"}); return; }
  if(azione === "reset_password"){
    $("ut-ok").textContent = "Nuova password iniziale per @" + u.username + ": " + corpo.password + " — comunicala all'operaio (non verrà più mostrata).";
    $("utenti-form").scrollIntoView({block:"start"});
  }
  await carica();
}

$("utenti-form").addEventListener("submit", async e=>{
  e.preventDefault();
  $("ut-ok").textContent = ""; $("ut-errore").textContent = "";
  const nome = $("ut-nome").value.trim(), username = $("ut-username").value.trim(), password = $("ut-password").value;
  if(!nome || !username || !password){ $("ut-errore").textContent = "Compila nome, username e password iniziale."; return; }
  const btn = $("ut-crea");
  btn.disabled = true; btn.classList.add("in-corso");
  // il ruolo NON si sceglie: il server crea sempre e solo operai
  const r = await chiamaFunzione("utenti", { azione: "crea", nome, username, password });
  btn.disabled = false; btn.classList.remove("in-corso");
  if(!r.ok){ $("ut-errore").textContent = r.errore; return; }
  $("ut-ok").textContent = "Account creato: @" + username + " con password iniziale " + password + " — comunicala all'operaio (non verrà più mostrata).";
  $("ut-nome").value = ""; $("ut-username").value = ""; $("ut-password").value = "";
  await carica();
});

registraVista("utenti", ()=>{ $("ut-ok").textContent = ""; $("ut-errore").textContent = ""; carica(); });
