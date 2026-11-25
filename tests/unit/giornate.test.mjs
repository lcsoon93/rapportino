// Giornate (js/services/giornate-logica.js): orario 8-17 salvo inserimento, unione foglio + rapportini.
import { test } from "node:test";
import assert from "node:assert/strict";
import { giornataUnita, giornateUnite, leggiOrarioInserito, minutiTraOre, nomeCanonico, orarioGiornata } from "../../js/services/giornate-logica.js";

const NOMI = { u1: "Luca Bianchi", u2: "Francesco Neri" };
const nome = id=>NOMI[id] || "?";
const utenti = Object.values(NOMI);
const R = (cliente, operai, extra)=>({ data: "2026-11-14", cliente, stato: "completato", autore_id: "u1", rapportino_operai: operai, ...extra });

test("orario della giornata: 08:00-17:00 = 9 ore, salvo orario inserito; il foglio vale solo come storico", ()=>{
  assert.deepEqual(orarioGiornata(null, null), { dalle: "08:00", alle: "17:00", origine: "predefinito", minuti: 540, escludi: false });
  assert.deepEqual(orarioGiornata({ dalle: "07:30", alle: "12:00" }, null), { dalle: "07:30", alle: "12:00", origine: "inserito", minuti: 270, escludi: false });
  const foglio = { escludi: true, operai: [{ nome: "Luca", dalle: "08:00", alle: "18:00" }, { nome: "Francesco", dalle: "08:00", alle: "18:00" }] };
  assert.deepEqual(orarioGiornata(null, foglio), { dalle: "08:00", alle: "18:00", origine: "foglio", minuti: 600, escludi: true });
  // l'inserimento vince sul foglio, anche per "escludi"
  assert.equal(orarioGiornata({ dalle: "08:00", alle: "17:00", escludi: false }, foglio).escludi, false);
  // solo "escludi" inserito: l'orario resta quello predefinito
  assert.deepEqual(orarioGiornata({ escludi: true }, null), { dalle: "08:00", alle: "17:00", origine: "predefinito", minuti: 540, escludi: true });
  // operai del foglio con orari diversi: nessun orario unico da proporre
  assert.equal(orarioGiornata(null, { operai: [{ dalle: "08:00", alle: "17:00" }, { dalle: "08:00", alle: "12:00" }] }).origine, "predefinito");
});

test("valori non validi ignorati; minuti anche oltre la mezzanotte", ()=>{
  assert.equal(leggiOrarioInserito({ dalle: "8", alle: "17:00" }), null);
  assert.equal(leggiOrarioInserito("x"), null);
  assert.deepEqual(leggiOrarioInserito({ dalle: "08:00:00", alle: "17:00:00" }), { escludi: false, dalle: "08:00", alle: "17:00" });
  assert.equal(minutiTraOre("22:00", "02:00"), 240);
  assert.equal(minutiTraOre("", "17:00"), 0);
});

test("nomi liberi del vecchio foglio ricondotti agli utenti (solo se non ambigui)", ()=>{
  assert.equal(nomeCanonico("luca", utenti), "Luca Bianchi");
  assert.equal(nomeCanonico("Mario", utenti), "Mario");
  assert.equal(nomeCanonico("Luca", ["Luca Bianchi", "Luca Rossi"]), "Luca");
});

test("solo rapportini: operai dei rapportini con 8-17, clienti con l'orario passato da ciascuno", ()=>{
  const g = giornataUnita({ rapportini: [
    R("Rossi Srl", [{ operaio_id: "u1", dalle: "08:00:00", alle: "10:30:00" }, { operaio_id: "u2", dalle: "09:00", alle: "10:30" }]),
    R("Bar Centrale", [{ operaio_id: "u1", dalle: "11:00", alle: null }], { stato: "bozza" }),
    R("Senza ore", []),
  ], nome, utenti });
  assert.deepEqual(g.operai, [{ nome: "Luca Bianchi", dalle: "08:00", alle: "17:00" }, { nome: "Francesco Neri", dalle: "08:00", alle: "17:00" }]);
  assert.deepEqual(g.clienti, [
    { nome: "Rossi Srl", bozza: false, fasce: [{ d: "08:00", a: "10:30" }, { d: "09:00", a: "10:30" }], sintesi: "", materiali: [] },
    { nome: "Bar Centrale", bozza: true, fasce: [], sintesi: "", materiali: [] },
    { nome: "Senza ore", bozza: false, fasce: [], sintesi: "", materiali: [] },
  ]);
  assert.equal(g.escludi, false);
});

test("orario inserito: vale per tutti, anche al posto degli orari del vecchio foglio", ()=>{
  const foglio = { operai: [{ nome: "Luca", dalle: "08:00", alle: "19:00" }], clienti: [{ nome: "Hotel Lago", fasce: [{ d: "08:00", a: "12:00" }] }] };
  const senza = giornataUnita({ foglio, rapportini: [R("Rossi Srl", [{ operaio_id: "u2", dalle: "14:00", alle: "15:00" }])], nome, utenti });
  assert.deepEqual(senza.operai, [{ nome: "Luca Bianchi", dalle: "08:00", alle: "19:00" }, { nome: "Francesco Neri", dalle: "08:00", alle: "19:00" }],
    "storico: l'orario del foglio vale per la giornata");
  assert.deepEqual(senza.clienti.map(c=>c.nome), ["Hotel Lago", "Rossi Srl"]);
  const con = giornataUnita({ foglio, rapportini: [], inserito: { dalle: "08:00", alle: "13:00", escludi: true }, nome, utenti });
  assert.deepEqual(con.operai, [{ nome: "Luca Bianchi", dalle: "08:00", alle: "13:00" }]);
  assert.equal(con.escludi, true);
});

test("giorni senza lavoro esclusi: foglio con i soli operai proposti in automatico non conta", ()=>{
  const vuoto = { operai: [{ nome: "Luca", dalle: "08:00", alle: "17:00" }], clienti: [{ nome: "" }], spese: [] };
  assert.equal(giornataUnita({ foglio: vuoto, rapportini: [], nome, utenti }), null);
  assert.equal(giornataUnita({ foglio: undefined, rapportini: [], inserito: { dalle: "08:00", alle: "12:00" }, nome, utenti }), null);
  const u = giornateUnite(["2026-11-13", "2026-11-14", "2026-11-15"], { fogli: { "2026-11-13": vuoto, "2026-11-15": { ...vuoto, spese: [{ d: "Gasolio", i: 30 }] } },
    rapportini: [R("Rossi Srl", [{ operaio_id: "u1", dalle: "08:00", alle: "09:00" }])], inseriti: { "2026-11-14": { escludi: true } }, nome, utenti });
  assert.deepEqual(Object.keys(u), ["2026-11-14", "2026-11-15"]);
  assert.equal(u["2026-11-14"].escludi, true);
});

test("report del mese: sintesi dell'intervento e materiale da rapportini e vecchio foglio", ()=>{
  const foglio = { clienti: [{ nome: "Hotel Lago", dettagli: "  Sostituito\n quadro ", materiali: [{ a: "Interruttore", q: 2 }, { a: " " }] }] };
  const g = giornataUnita({ foglio, rapportini: [
    R("Rossi Srl", [], { attivita: "Riparata perdita", materiali: [{ a: "Raccordo 1/2", q: "3" }] }),
    R("Importato", [], { attivita: "Attività non indicata nella vecchia app.", materiali: null }),
  ], nome, utenti });
  assert.deepEqual(g.clienti.map(c=>[c.nome, c.sintesi, c.materiali]), [
    ["Hotel Lago", "Sostituito quadro", [{ a: "Interruttore", q: "2" }]],
    ["Rossi Srl", "Riparata perdita", [{ a: "Raccordo 1/2", q: "3" }]],
    ["Importato", "", []],
  ]);
});
