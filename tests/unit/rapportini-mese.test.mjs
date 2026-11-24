// Rapportini del mese / del giorno: periodo, filtro operaio, ore effettive, esclusi.
// Esecuzione: node --test tests/unit/rapportini-mese.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { limitiMese, minutiPerOperaio, nelPeriodo, riepilogoRapportini } from "../../js/services/rapportini-mese-logica.js";

const LUCA = "u-luca", MARCO = "u-marco";
const nome = id=>({ [LUCA]: "Luca", [MARCO]: "Marco" })[id] || id;
const rap = (id, data, autore, ore, extra = {})=>({ id, data, autore_id: autore, stato: "completato", cliente: "C" + id,
  rapportino_operai: ore.map(([op, dalle, alle])=>({ operaio_id: op, dalle: dalle + ":00", alle: alle + ":00" })), ...extra });

test("limiti del mese: date locali, febbraio bisestile, cambio anno", ()=>{
  assert.deepEqual(limitiMese("2026-11"), { dal: "2026-11-01", al: "2026-11-30" });
  assert.deepEqual(limitiMese("2028-02"), { dal: "2028-02-01", al: "2028-02-29" });
  assert.deepEqual(limitiMese("2026-12"), { dal: "2026-12-01", al: "2026-12-31" });
  assert.deepEqual(limitiMese("2027-01"), { dal: "2027-01-01", al: "2027-01-31" });
  assert.equal(nelPeriodo("2026-11-30", "2026-11-01", "2026-11-30"), true, "estremi inclusi");
  assert.equal(nelPeriodo("2026-12-01", "2026-11-01", "2026-11-30"), false);
});

test("ore effettive: sovrapposte una volta, contigue sommate, per operaio", ()=>{
  const m = minutiPerOperaio([
    rap("a", "2026-11-03", LUCA, [[LUCA, "08:00", "12:00"], [MARCO, "08:00", "10:00"]]),
    rap("b", "2026-11-03", LUCA, [[LUCA, "11:00", "13:00"], [MARCO, "10:00", "12:30"]]),
  ]);
  assert.deepEqual(m, { [LUCA]: 300, [MARCO]: 270 }, "Luca 08-13 = 5h (sovrapposte); Marco 08-10 + 10-12:30 = 4h30 (contigue)");
  assert.deepEqual(minutiPerOperaio([rap("a", "x", LUCA, [[LUCA, "08:00", "12:00"], [MARCO, "08:00", "10:00"]])], MARCO), { [MARCO]: 120 });
});

test("caso dello screenshot: fascia 08-17 (9h) ma due rapportini = 8h30 effettive", ()=>{
  const r = riepilogoRapportini({ completati: [
      rap("a", "2026-11-24", LUCA, [[LUCA, "08:00", "12:30"]]),
      rap("b", "2026-11-24", LUCA, [[LUCA, "13:00", "17:00"]]),
    ], dal: "2026-11-24", al: "2026-11-24", nome, fascia: ()=>({ dalle: "08:00", alle: "17:00", minuti: 540 }) });
  assert.equal(r.giorni[0].fascia.minuti, 540);
  assert.equal(r.giorni[0].minuti, 510);
  assert.equal(r.totale, 510);
});

test("mese: per giorno e per operaio, totale, altri mesi esclusi, bozze e non inviati a parte", ()=>{
  const completati = [
    rap("a", "2026-11-03", LUCA, [[LUCA, "08:00", "10:00"], [MARCO, "08:00", "10:00"]]),
    rap("b", "2026-11-03", MARCO, [[MARCO, "09:00", "11:00"]]),
    rap("c", "2026-11-17", MARCO, [[MARCO, "14:00", "15:00"]]),
    rap("x", "2026-10-31", LUCA, [[LUCA, "08:00", "17:00"]]),          // mese precedente
    rap("y", "2026-12-01", LUCA, [[LUCA, "08:00", "17:00"]]),          // mese successivo
    rap("z", "2026-11-05", LUCA, [[LUCA, "08:00", "09:00"]], { stato: "bozza" }),   // non completato
  ];
  const bozze = [rap("z", "2026-11-05", LUCA, [], { stato: "bozza" }), rap("w", "2026-10-30", LUCA, [], { stato: "bozza" })];
  const coda = [
    { id: "t1", autore: MARCO, stato: "in_attesa", completa: true, rapportino: { data: "2026-11-20", cliente: "Telefono" } },
    { id: "c", autore: MARCO, stato: "in_attesa", rapportino: { data: "2026-11-17", cliente: "Cc" } },   // già completato sul server
    { id: "t2", autore: LUCA, stato: "inviato", rapportino: { data: "2026-11-21", cliente: "Inviato" } },
    { id: "t3", autore: LUCA, stato: "in_attesa", rapportino: { data: "2026-12-02", cliente: "Dicembre" } },
  ];
  const r = riepilogoRapportini({ completati, bozze, coda, ...limitiMese("2026-11"), nome });
  assert.deepEqual(r.giorni.map(g=>[g.iso, g.rapportini.map(x=>x.id)]), [["2026-11-03", ["a", "b"]], ["2026-11-17", ["c"]]]);
  assert.equal(r.giorni[0].minuti, 120 + 180, "Luca 2h + Marco 08-11 = 3h");
  assert.deepEqual(r.operai.map(o=>[o.nome, o.giorni, o.minuti]), [["Luca", 1, 120], ["Marco", 2, 240]]);
  assert.equal(r.totale, 360);
  assert.deepEqual(r.esclusi.map(e=>[e.data, e.cliente, e.motivo]), [
    ["2026-11-05", "Cz", "in bozza: non completato"],
    ["2026-11-20", "Telefono", "completato sul telefono ma non ancora inviato"],
  ]);
});

test("singolo operaio: i suoi rapportini, quelli dei colleghi dove compare, solo le sue ore", ()=>{
  const completati = [
    rap("a", "2026-11-03", LUCA, [[LUCA, "08:00", "10:00"], [MARCO, "08:00", "10:00"]]),
    rap("b", "2026-11-03", MARCO, [[MARCO, "09:00", "11:00"]]),
    rap("c", "2026-11-04", LUCA, [[LUCA, "08:00", "10:00"]]),
  ];
  const r = riepilogoRapportini({ completati, ...limitiMese("2026-11"), operaio: MARCO, nome });
  assert.deepEqual(r.giorni.map(g=>[g.iso, g.rapportini.map(x=>x.id)]), [["2026-11-03", ["a", "b"]]]);
  assert.deepEqual(r.operai.map(o=>[o.nome, o.minuti]), [["Marco", 180]], "08-10 e 09-11 = 3h, senza le ore di Luca");
  const tutti = riepilogoRapportini({ completati, ...limitiMese("2026-11"), nome });
  assert.equal(tutti.operai.find(o=>o.nome === "Marco").minuti, 180, "stesse ore di Marco con «Tutti»");
});

test("mese senza rapportini", ()=>{
  const r = riepilogoRapportini({ completati: [rap("x", "2026-10-31", LUCA, [[LUCA, "08:00", "09:00"]])], ...limitiMese("2026-11"), nome });
  assert.deepEqual([r.giorni.length, r.operai.length, r.totale, r.rapportini, r.esclusi.length], [0, 0, 0, 0, 0]);
});
