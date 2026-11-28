// Altro -> Amministrazione -> Bot Telegram: stato del bot e collegamento del webhook (solo amministratore).
// Il token del bot resta nei secret di Supabase: qui si chiede solo alla funzione "telegram" di collegarsi.
import { chiamaFunzione } from "../core/sessione.js";
import { esc } from "../utils/formatters.js";

const $ = id=>document.getElementById(id);
function mostra(r){
  const box = $("tg-stato");
  if(!r.ok){ box.className = "msg-info err"; box.textContent = r.errore || "Errore."; return; }
  const d = r.dati || {};
  if(d.errore){ box.className = "msg-info err"; box.textContent = d.errore; return; }
  const righe = [];
  if(d.bot) righe.push("Bot: <b>" + esc(d.bot) + "</b>");
  if(d.mancano && d.mancano.length) righe.push("Secret da impostare in Supabase: <b>" + esc(d.mancano.join(", ")) + "</b>");
  if(d.bot) righe.push(d.collegato ? "✅ Collegato: scrivi /start al bot su Telegram." : "Non ancora collegato: tocca «Collega il bot».");
  if(d.ultimoErrore) righe.push("Ultimo errore segnalato da Telegram: " + esc(d.ultimoErrore));
  box.className = "msg-info" + (d.collegato && !(d.mancano || []).length ? " ok" : " att");
  box.innerHTML = righe.join("<br>") || "Bot non configurato.";
}
async function chiedi(btn, azione){
  btn.disabled = true;
  $("tg-stato").className = "msg-info"; $("tg-stato").textContent = azione === "collega" ? "Collegamento…" : "Controllo…";
  try{ mostra(await chiamaFunzione("telegram", { azione })); }
  finally{ btn.disabled = false; }
}
export const statoBotTelegram = btn=>chiedi(btn, "stato");
export const collegaBotTelegram = btn=>chiedi(btn, "collega");
