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
export function minutiNetti(d){
  return (d.operai || []).reduce((a,op)=>a + minutiOperaio(op), 0);
}
export function totaleSpese(spese){ return spese.reduce((a,s)=>a+s.i, 0); }
export function totaleImporti(clienti){ return clienti.reduce((a,c)=>a + (+c.importo || 0), 0); }
