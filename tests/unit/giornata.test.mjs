// "La mia giornata": unione server/telefono, stati, conteggi. Esecuzione: node --test tests/unit/giornata.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcolaGiornata, unisciRapportini } from "../../js/modules/giornata-dati.js";
import { isoDi } from "../../js/utils/dates.js";

const IO = "u1", ALTRO = "u2", OGGI = "2026-11-24";
const intervento = (id, extra = {})=>({ id, data: OGGI, cliente: "Cliente " + id, stato: "pianificato",
  intervento_operai: [{ operaio_id: IO, rimosso_il: null }], rapportini: [], ...extra });
const srv = (id, extra = {})=>({ id, intervento_id: null, autore_id: IO, data: OGGI, cliente: "C" + id, esito: "Completato", stato: "bozza", rapportino_operai: [], ...extra });
const loc = (id, extra = {}, rap = {})=>({ id, autore: IO, stato: "in_attesa", testoDaInviare: true, salvato: false,
  rapportino: { data: OGGI, cliente: "L" + id, esito: "Completato", ...rap }, ore: [], ...extra });

test("copia locale e server dello stesso rapportino: una sola voce, completato solo dal server", ()=>{
  const l = unisciRapportini([srv("r1")], [loc("r1", { completa: true, salvato: true })]);
  assert.equal(l.length, 1);
  assert.equal(l[0].stato, "bozza");
  assert.equal(l[0].completaInAttesa, true);
  assert.equal(l[0].daInviare, true);
});

test("copia già inviata (o solo foto in attesa) non sostituisce il server", ()=>{
  const l = unisciRapportini([srv("r1", { stato: "completato" })], [loc("r1", { stato: "inviato" }), loc("r2", { testoDaInviare: false, stato: "allegati_in_attesa" })]);
  assert.deepEqual(l.map(r=>[r.id, r.stato, r.daInviare]), [["r1", "completato", false]]);
});

test("imprevisti di oggi inclusi nei conteggi; bozze di altri giorni nell'elenco bozze, senza doppioni", ()=>{
  const g = calcolaGiornata({ oggi: OGGI, io: IO,
    interventi: [intervento("i1"), intervento("i2"), intervento("i3", { stato: "annullato" })],
    rapportiniServer: [
      srv("a", { intervento_id: "i1", stato: "completato", rapportino_operai: [{ operaio_id: IO, dalle: "08:00", alle: "10:30" }] }),
      srv("imp1", { stato: "completato", esito: "Da ultimare", rapportino_operai: [{ operaio_id: IO, dalle: "11:00", alle: "12:00" }, { operaio_id: ALTRO, dalle: "11:00", alle: "12:00" }] }),
      srv("vecchia", { data: "2026-11-20" }),
    ],
    coda: [loc("imp2", {}, { data: OGGI }), loc("vecchia", { salvato: true }, { data: "2026-11-20" }), loc("altrui", { autore: ALTRO })],
  });
  assert.equal(g.schede.length, 2, "annullato escluso");
  assert.deepEqual(g.imprevisti.map(x=>x.rapportino.id).sort(), ["imp1", "imp2"]);
  assert.deepEqual(g.bozze.map(r=>r.id), ["vecchia"], "bozza di un giorno precedente, una sola volta");
  assert.equal(g.bozze[0].daInviare, true);
  assert.deepEqual(g.conteggi, { totale: 4, completati: 2, inCorso: 1, daIniziare: 1, daUltimare: 1, minuti: 210 });
});

test("bozza solo sul telefono di un intervento di oggi: l'intervento risulta da completare", ()=>{
  const g = calcolaGiornata({ oggi: OGGI, io: IO, interventi: [intervento("i1")], rapportiniServer: [],
    coda: [loc("x", { intervento_id: "i1" })] });
  assert.equal(g.schede[0].stato.codice, "da_completare");
  assert.equal(g.bozze.length, 0, "non ripetuta tra le bozze");
});

test("completamento ancora sul telefono: non conta come completato", ()=>{
  const g = calcolaGiornata({ oggi: OGGI, io: IO, interventi: [], rapportiniServer: [],
    coda: [loc("imp", { completa: true })] });
  assert.equal(g.conteggi.completati, 0);
  assert.equal(g.imprevisti[0].stato.label, "Completamento da inviare");
});

test("intervento di altri (vista admin): stato complessivo, non quello dell'admin", ()=>{
  const i = intervento("i1", { intervento_operai: [{ operaio_id: ALTRO, rimosso_il: null }], rapportini: [{ id: "z", autore_id: ALTRO, stato: "completato" }] });
  const g = calcolaGiornata({ oggi: OGGI, io: IO, interventi: [i], rapportiniServer: [], coda: [] });
  assert.equal(g.schede[0].stato.codice, "completato");
});

test("date locali: isoDi non cambia giorno vicino alla mezzanotte", ()=>{
  assert.equal(isoDi(new Date(2026, 10, 24, 0, 30)), "2026-11-24");
  assert.equal(isoDi(new Date(2026, 10, 24, 23, 59)), "2026-11-24");
  const d = new Date("2026-12-31T12:00:00"); d.setDate(d.getDate() + 1);
  assert.equal(isoDi(d), "2027-01-01");
});
