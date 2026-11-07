// Stato di una scheda cliente, calcolato dai dati (nessun campo nuovo):
//   "firmata"   ha la firma del cliente
//   "compilata" l'operaio ha scritto lavoro, materiale, foto o firmatario (o e' "Da ultimare")
//   "dafare"    solo dati di pianificazione
// La stessa regola di "compilata" e' nel database (public.scheda_compilata): tenerle allineate.
export function schedaCompilata(c){
  return !!((c.dettagli || "").trim() || c.firma || (c.firmatario || "").trim() ||
    (Array.isArray(c.materiali) && c.materiali.length) || (Array.isArray(c.foto) && c.foto.length));
}
export function statoScheda(c){
  if(c.firma) return "firmata";
  if(schedaCompilata(c) || c.stato === "Da ultimare") return "compilata";
  return "dafare";
}
