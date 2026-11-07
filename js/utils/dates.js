// Date: formati italiani, giorni della settimana e del mese, ora corrente.

export const GIORNI = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
// monte ore del mese = giorni lavorativi (lun-ven) del mese x 9 ore
export function giorniLavorativiMese(iso){   // iso = "2026-09"
  const [a, m] = iso.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  let n = 0;
  for(let g = 1; g <= ultimo; g++){
    const w = new Date(a, m - 1, g).getDay();
    if(w !== 0 && w !== 6) n++;
  }
  return n;
}
export function oggiIso(){ return isoDi(new Date()); }
export function dataLunga(iso){
  const t = new Date(iso + "T12:00:00").toLocaleDateString("it-IT", {weekday:"long", day:"numeric", month:"long", year:"numeric"});
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function etichettaGiorno(iso){
  const o = oggiIso();
  const d = new Date(o + "T12:00:00");
  d.setDate(d.getDate() - 1);
  if(iso === o) return "Oggi, " + new Date(iso + "T12:00:00").toLocaleDateString("it-IT", {day:"numeric", month:"long"});
  if(iso === isoDi(d)) return "Ieri, " + new Date(iso + "T12:00:00").toLocaleDateString("it-IT", {day:"numeric", month:"long"});
  return new Date(iso + "T12:00:00").toLocaleDateString("it-IT", {weekday:"short", day:"numeric", month:"short", year:"numeric"});
}
export function oraCorrente(){
  const d = new Date();
  return String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
}
export function dataIt(iso){
  const v = iso || document.getElementById("data").value;
  if(!v) return "";
  const p = v.split("-");
  return p[2] + "/" + p[1] + "/" + p[0];
}
export function isoDi(d){
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
export function lunediDi(iso){
  const d = new Date(iso + "T12:00:00");
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}
export function giorniSettimana(iso){
  const lun = lunediDi(iso);
  const out = [];
  for(let i=0;i<7;i++){
    const g = new Date(lun);
    g.setDate(lun.getDate()+i);
    out.push(isoDi(g));
  }
  return out;
}
export function giorniMese(iso){           // iso = "2026-08"
  const [a, m] = iso.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  const out = [];
  for(let g = 1; g <= ultimo; g++){
    out.push(iso + "-" + String(g).padStart(2,"0"));
  }
  return out;
}
