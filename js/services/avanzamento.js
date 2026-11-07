// Avanzamento di un intervento con piu' operai (dati gia' letti con RLS: interventi + intervento_operai
// + rapportini). Nessun accesso al database qui: e' solo la lettura dei dati.
//
// Avanzamento per operaio, con la stessa regola del database (stato_intervento_calcolato):
// un operaio assegnato (assegnazione attiva) ha finito quando ha un PROPRIO rapportino completato.
// Le assegnazioni rimosse restano come storico; contano solo se l'operaio ha scritto un rapportino.
// Nota: all'operaio i rapportini dei colleghi non arrivano (RLS), quindi i conteggi complessivi
// si mostrano solo a chi consulta tutti i rapportini (admin, company).
export function avanzamento(i){
  const ass = i.intervento_operai || [];
  const rapp = i.rapportini || [];
  const attivi = ass.filter(a=>!a.rimosso_il).map(a=>a.operaio_id);
  const suoi = id=>rapp.filter(r=>r.autore_id === id);
  const fatto = id=>suoi(id).some(r=>r.stato === "completato");
  return {
    attivi,
    completati: attivi.filter(fatto),
    mancanti: attivi.filter(id=>!fatto(id)),
    rimossi: ass.filter(a=>a.rimosso_il && suoi(a.operaio_id).length).map(a=>a.operaio_id),
    suoi, fatto,
  };
}
