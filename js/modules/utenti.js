// Gestione utenti (solo admin): elenco, nuovo operaio, modifica di nome/cognome (e del ruolo di
// operaio per gli amministratori), PIN, disattiva/riattiva, reimposta password.
// Tutte le operazioni passano dalla Edge Function "utenti", che ricontrolla che chi chiama sia admin.
// Nell'elenco si mostrano nome e cognome, ruoli, stato e username: mai gli identificativi interni.
import { chiamaFunzione, nomeCompleto, profilo } from "../core/sessione.js";
import { registraVista } from "../core/navigation.js";
import { dimenticaOperai } from "../services/api-lavori.js";
import { esc, iniziali } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";

const $ = id=>document.getElementById(id);
const NOMI_RUOLO = { admin: "Amministratore", company: "Company", worker: "Operaio" };
let utenti = [];
let inModifica = null;

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
const ruoliDi = u=>Array.isArray(u.ruoli) && u.ruoli.length ? u.ruoli : [u.ruolo];

function moduloModifica(u){
  const admin = u.ruolo === "admin";
  return '<form class="utente-modifica" onsubmit="modificaUtente(event, \'' + u.id + '\')">' +
    '<div class="due"><div><label for="um-nome">Nome</label><input type="text" id="um-nome" maxlength="80" value="' + esc(u.nome || "") + '"></div>' +
    '<div><label for="um-cognome">Cognome</label><input type="text" id="um-cognome" maxlength="80" value="' + esc(u.cognome || "") + '"></div></div>' +
    (admin ? '<label class="spunta"><input type="checkbox" id="um-operaio"' + (ruoliDi(u).includes("worker") ? " checked" : "") + '> ' +
      'Lavora anche come operaio (compare tra gli operai, si assegna agli interventi, compila i propri rapportini)</label>' : '') +
    '<div class="msg-errore" id="um-errore" role="alert"></div>' +
    '<div class="utente-azioni" style="padding-left:0"><button type="submit" class="btn btn-primario">Salva</button>' +
    '<button type="button" class="btn btn-secondario" onclick="annullaModificaUtente()">Annulla</button></div></form>';
}
function disegna(){
  $("utenti-elenco").innerHTML = '<div class="card">' + utenti.map(u=>{
    const ruoli = ruoliDi(u);
    const badge = [
      ...["admin", "company", "worker"].filter(r=>ruoli.includes(r))
        .map(r=>'<span class="badge ' + (r === "worker" ? "pervinca" : "ok") + '">' + NOMI_RUOLO[r] + '</span>'),
      u.attivo ? '<span class="badge neutro">Attivo</span>' : '<span class="badge err">' + icona("lock") + 'Disattivato</span>',
      u.attivo && u.deve_cambiare_password ? '<span class="badge att">Primo accesso da fare</span>' : "",
      u.pin ? '<span class="badge neutro">PIN attivo</span>' : "",
    ].join("");
    const pulsanti = [
      '<button type="button" class="btn btn-secondario" onclick="azioneUtente(\'' + u.id + '\',\'modifica\')">Modifica</button>',
      u.pin ? '<button type="button" class="btn btn-secondario" onclick="azioneUtente(\'' + u.id + '\',\'rimuovi_pin\')">Rimuovi PIN</button>' : "",
    ];
    if(u.ruolo === "worker"){
      pulsanti.push('<button type="button" class="btn btn-secondario" onclick="azioneUtente(\'' + u.id + '\',\'' + (u.attivo ? "disattiva" : "riattiva") + '\')">' + (u.attivo ? "Disattiva" : "Riattiva") + '</button>');
      pulsanti.push('<button type="button" class="btn btn-secondario" onclick="azioneUtente(\'' + u.id + '\',\'reset_password\')">Reimposta password</button>');
    }
    const io = profilo && u.id === profilo.id;
    return '<div class="utente-riga" data-utente="' + esc(u.username) + '">' +
      '<span class="avatar" aria-hidden="true">' + esc(iniziali(nomeCompleto(u))) + '</span>' +
      '<span class="cli-testi"><span class="cli-nome" style="display:block">' + esc(nomeCompleto(u)) + (io ? " (tu)" : "") + '</span>' +
      '<span class="cli-ind" style="display:block">@' + esc(u.username) + '</span>' +
      '<span class="int-badge" style="margin-top:6px">' + badge + '</span></span>' +
      (inModifica === u.id ? moduloModifica(u) : '<div class="utente-azioni">' + pulsanti.join("") + '</div>') + '</div>';
  }).join("") + '</div>';
}

export function annullaModificaUtente(){ inModifica = null; disegna(); }
export async function modificaUtente(e, id){
  e.preventDefault();
  const u = utenti.find(x=>x.id === id);
  if(!u) return;
  const corpo = { azione: "modifica", id, nome: $("um-nome").value.trim(), cognome: $("um-cognome").value.trim() };
  if(!corpo.nome){ $("um-errore").textContent = "Inserisci il nome."; return; }
  if($("um-operaio")) corpo.operaio = $("um-operaio").checked;
  const r = await chiamaFunzione("utenti", corpo);
  if(!r.ok){ $("um-errore").textContent = r.errore; return; }
  inModifica = null;
  dimenticaOperai();                    // nomi ed elenco operai cambiati
  $("ut-ok").textContent = "Dati di " + nomeCompleto({ ...u, ...corpo }) + " aggiornati." +
    (profilo && id === profilo.id && corpo.operaio !== undefined ? " Il cambio di ruolo vale dal prossimo accesso." : "");
  await carica();
}

export async function azioneUtente(id, azione){
  const u = utenti.find(x=>x.id === id);
  if(!u) return;
  $("ut-ok").textContent = ""; $("ut-errore").textContent = "";
  if(azione === "modifica"){ inModifica = id; disegna(); setTimeout(()=>$("um-nome") && $("um-nome").focus(), 30); return; }
  const nome = nomeCompleto(u);
  let corpo = { azione, id };
  if(azione === "disattiva" && !confirm("Disattivare l'account di " + nome + "? Non potrà più accedere. Interventi e rapportini già fatti restano.")) return;
  if(azione === "rimuovi_pin" && !confirm("Rimuovere il PIN di " + nome + "? Per accedere servirà la password.")) return;
  if(azione === "reset_password"){
    if(!confirm("Reimpostare la password di " + nome + "? Riceverà una nuova password iniziale da cambiare al primo accesso (il PIN viene disattivato).")) return;
    corpo.password = generaPasswordIniziale();
    $("ut-password").value = "";
  }
  const r = await chiamaFunzione("utenti", corpo);
  if(!r.ok){ $("ut-errore").textContent = r.errore; $("utenti-form").scrollIntoView({block:"start"}); return; }
  if(azione === "reset_password"){
    $("ut-ok").textContent = "Nuova password iniziale per @" + u.username + ": " + corpo.password + " — comunicala all'operaio (non verrà più mostrata).";
    $("utenti-form").scrollIntoView({block:"start"});
  }
  if(azione === "disattiva" || azione === "riattiva") dimenticaOperai();
  await carica();
}

$("utenti-form").addEventListener("submit", async e=>{
  e.preventDefault();
  $("ut-ok").textContent = ""; $("ut-errore").textContent = "";
  const nome = $("ut-nome").value.trim(), cognome = $("ut-cognome").value.trim();
  const username = $("ut-username").value.trim(), password = $("ut-password").value;
  if(!nome || !cognome || !username || !password){ $("ut-errore").textContent = "Compila nome, cognome, username e password iniziale."; return; }
  const btn = $("ut-crea");
  btn.disabled = true; btn.classList.add("in-corso");
  // il ruolo NON si sceglie: il server crea sempre e solo operai
  const r = await chiamaFunzione("utenti", { azione: "crea", nome, cognome, username, password });
  btn.disabled = false; btn.classList.remove("in-corso");
  if(!r.ok){ $("ut-errore").textContent = r.errore; return; }
  $("ut-ok").textContent = "Account creato per " + nome + " " + cognome + ": @" + username + " con password iniziale " + password + " — comunicala all'operaio (non verrà più mostrata).";
  ["ut-nome", "ut-cognome", "ut-username", "ut-password"].forEach(k=>{ $(k).value = ""; });
  dimenticaOperai();
  await carica();
});

registraVista("utenti", ()=>{ $("ut-ok").textContent = ""; $("ut-errore").textContent = ""; inModifica = null; carica(); });
