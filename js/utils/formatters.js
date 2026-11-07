// Formattazione testi: ore, euro, saldo, HTML sicuro, evidenziazione ricerca.

export function saldoTesto(min){
  if(min === 0) return "0";
  return (min > 0 ? "+" : "-") + oreTesto(Math.abs(min));
}
// testo sicuro dentro innerHTML
export function esc(t){
  return String(t == null ? "" : t).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
export function oreTesto(min){
  const h = Math.floor(min/60), m = min%60;
  if(h === 0 && m === 0) return "0 ore";
  if(m === 0) return h + (h === 1 ? " ora" : " ore");
  return h + "h " + m + "m";
}
export function euro(n){ return n.toFixed(2).replace(".", ",") + " €"; }
export function iniziali(nome){
  const p = nome.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}
export function evidenzia(testo, query){
  if(!testo || !query) return esc(testo || "");
  const re = new RegExp("(" + esc(query).replace(/[.*+?^${}()|[\]\\]/g,"\\$&") + ")", "gi");
  return esc(testo).replace(re, "<b>$1</b>");
}
