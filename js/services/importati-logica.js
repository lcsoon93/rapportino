// Schede della vecchia app (foglio giornaliero) gia' importate come rapportini: chiave della scheda uguale a
// rapportini.origine (migrazione 20261125090000). Solo calcoli, provati in tests/unit.
//   "rapporti:AAAA-MM-GG:id:<id scheda>"  oppure  "rapporti:AAAA-MM-GG:n:<posizione da 1>" (schede senza id)

export function chiaveScheda(iso, scheda, indice){
  const id = scheda && scheda.id != null ? String(scheda.id) : "";
  return "rapporti:" + iso + ":" + (id ? "id:" + id : "n:" + (indice + 1));
}
// la scheda (posizione indice nella giornata) e' gia' tra i rapportini?
export const schedaImportata = (importate, iso, scheda, indice)=>!!(importate && importate.size && importate.has(chiaveScheda(iso, scheda, indice)));

// giornata senza le schede gia' importate (operai, orari, spese restano: ore della giornata invariate)
export function giornataSenzaImportate(importate, iso, g){
  if(!g || !Array.isArray(g.clienti) || !importate || !importate.size) return g;
  const clienti = g.clienti.filter((c, i)=>!schedaImportata(importate, iso, c, i));
  return clienti.length === g.clienti.length ? g : { ...g, clienti };
}
// archivio { iso: giornata } senza le schede importate (copia: l'archivio originale non cambia)
export function archivioSenzaImportate(importate, db){
  if(!importate || !importate.size) return db;
  const out = {};
  Object.keys(db || {}).forEach(iso=>{ out[iso] = giornataSenzaImportate(importate, iso, db[iso]); });
  return out;
}
