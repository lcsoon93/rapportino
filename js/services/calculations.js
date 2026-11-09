// Calcoli: minuti lavorati, ore ordinarie (9 h) e straordinario, totali spese e importi.
import { oreTesto } from "../utils/formatters.js";

export const ORARIO_ORDINARIO = 9 * 60;   // minuti di lavoro ordinario al giorno (nessuna pausa): oltre le 9 ore si segna l'extra
export function eccedenza(min){ return Math.max(0, min - ORARIO_ORDINARIO); }
// "9h +30m" quando si supera l'orario ordinario, altrimenti solo il totale
export function oreConStraordinario(min){
  const ecc = eccedenza(min);
  if(!ecc) return oreTesto(min);
  return oreTesto(ORARIO_ORDINARIO) + " +" + oreTesto(ecc);
}
export function minutiOperaio(op){
  if(!op.dalle || !op.alle) return 0;
  return Math.max(0, minutiGiornata(op.dalle, op.alle));
}
export function toMin(t){ const p = t.split(":"); return +p[0]*60 + +p[1]; }
export function minutiGiornata(dalle, alle){
  if(!dalle || !alle) return 0;
  let m = toMin(alle) - toMin(dalle);
  if(m < 0) m += 24*60;
  return m;
}
// "Tempo sul posto": durata dell'unione degli intervalli [{dalle, alle}] ("HH:MM"), cioe' dal primo arrivo
// all'ultima uscita senza contare due volte le ore in comune (Luca 8-11 e Francesco 9-12 = 4 ore).
// Un intervallo che passa la mezzanotte (alle < dalle) finisce il giorno dopo.
export function minutiSulPosto(intervalli){
  const seg = (intervalli || []).filter(i=>i && i.dalle && i.alle).map(i=>{
    const a = toMin(String(i.dalle).slice(0, 5)); let b = toMin(String(i.alle).slice(0, 5));
    if(b < a) b += 24 * 60;
    return [a, b];
  }).sort((x, y)=>x[0] - y[0]);
  let tot = 0, fine = -1, inizio = -1;
  seg.forEach(([a, b])=>{
    if(a > fine){ if(fine > inizio) tot += fine - inizio; inizio = a; fine = b; }
    else if(b > fine) fine = b;
  });
  if(fine > inizio) tot += fine - inizio;
  return tot;
}
// ore di lavoro presso un cliente di una giornata: le fasce orarie del cliente, se indicate; altrimenti,
// se nella giornata c'e' un solo cliente, il tempo sul posto dei tecnici; altrimenti non si sa (null)
export function minutiCliente(c, giornata){
  const fasce = (c.fasce && c.fasce.length ? c.fasce : [{ d: c.dalle, a: c.alle }])
    .filter(f=>f && f.d && f.a).map(f=>({ dalle: f.d, alle: f.a }));
  if(fasce.length) return minutiSulPosto(fasce);
  if(giornata && (giornata.clienti || []).length === 1){
    const m = minutiSulPosto(giornata.operai);
    return m || null;
  }
  return null;
}
export function minutiNetti(d){
  return (d.operai || []).reduce((a,op)=>a + minutiOperaio(op), 0);
}
export function totaleSpese(spese){ return spese.reduce((a,s)=>a+s.i, 0); }
export function totaleImporti(clienti){ return clienti.reduce((a,c)=>a + (+c.importo || 0), 0); }
