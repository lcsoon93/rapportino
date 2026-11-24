// Schede della vecchia app importate come rapportini: chiave uguale alla migrazione, una sola volta nelle
// viste, ore della giornata invariate. Esecuzione: node --test tests/unit/importati.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { archivioSenzaImportate, chiaveScheda, giornataSenzaImportate, schedaImportata } from "../../js/services/importati-logica.js";
import { giornateUnite } from "../../js/services/giornate-logica.js";
import { unisciVoci } from "../../js/services/ricerca-logica.js";

const G = { tecnici: "Luca / Francesco", operai: [{ nome: "Luca", dalle: "08:00", alle: "17:00" }, { nome: "Francesco", dalle: "08:00", alle: "16:00" }],
  clienti: [{ id: "c1", nome: "Alfa" }, { nome: "Gamma" }, { nome: "Delta" }], spese: [] };

test("chiave della scheda: id se c'è, altrimenti posizione da 1 (come rapportini.origine)", ()=>{
  assert.equal(chiaveScheda("2026-10-01", G.clienti[0], 0), "rapporti:2026-10-01:id:c1");
  assert.equal(chiaveScheda("2026-10-01", G.clienti[1], 1), "rapporti:2026-10-01:n:2");
  assert.equal(chiaveScheda("2026-10-01", { id: "", nome: "x" }, 4), "rapporti:2026-10-01:n:5");
});

test("giornata e archivio senza le schede importate; originale intatto; nulla importato = stesso oggetto", ()=>{
  const imp = new Set(["rapporti:2026-10-01:id:c1", "rapporti:2026-10-01:n:3"]);
  const g = giornataSenzaImportate(imp, "2026-10-01", G);
  assert.deepEqual(g.clienti.map(c=>c.nome), ["Gamma"]);
  assert.deepEqual(g.operai, G.operai, "operai e orari restano");
  assert.equal(G.clienti.length, 3, "archivio originale non modificato");
  assert.equal(giornataSenzaImportate(new Set(), "2026-10-01", G), G);
  const db = { "2026-10-01": G, "2026-10-02": { clienti: [{ nome: "Altro" }] } };
  const vis = archivioSenzaImportate(imp, db);
  assert.equal(vis["2026-10-02"], db["2026-10-02"]);
  assert.equal(vis["2026-10-01"].clienti.length, 1);
  assert.equal(schedaImportata(imp, "2026-10-02", { id: "c1" }, 0), false, "stesso id, altro giorno");
});

test("report: scheda importata contata una volta (come rapportino), ore della giornata invariate", ()=>{
  const db = { "2026-10-01": G };
  const imp = new Set(["rapporti:2026-10-01:id:c1", "rapporti:2026-10-01:n:2", "rapporti:2026-10-01:n:3"]);
  const rapportini = [
    { data: "2026-10-01", cliente: "Alfa", stato: "completato", autore_id: "L", rapportino_operai: [{ operaio_id: "L", dalle: "08:30:00", alle: "10:00:00" }] },
    { data: "2026-10-01", cliente: "Gamma", stato: "completato", autore_id: "L", rapportino_operai: [{ operaio_id: "L", dalle: null, alle: null }] },
    { data: "2026-10-01", cliente: "Delta", stato: "completato", autore_id: "L", rapportino_operai: [{ operaio_id: "L", dalle: null, alle: null }] },
  ];
  const nome = id=>({ L: "Luca" })[id] || id;
  const prima = giornateUnite(["2026-10-01"], { fogli: db, rapportini: [], nome, utenti: ["Luca"] })["2026-10-01"];
  const dopo = giornateUnite(["2026-10-01"], { fogli: archivioSenzaImportate(imp, db), rapportini, nome, utenti: ["Luca"] })["2026-10-01"];
  assert.deepEqual(dopo.clienti.map(c=>c.nome).sort(), ["Alfa", "Delta", "Gamma"], "ogni cliente una volta");
  assert.deepEqual(dopo.operai, prima.operai, "Luca 8-17 e Francesco 8-16 come prima");
  const doppio = giornateUnite(["2026-10-01"], { fogli: db, rapportini, nome, utenti: ["Luca"] })["2026-10-01"];
  assert.equal(doppio.clienti.length, 6, "senza filtro sarebbero doppi");
});

test("ricerca: scheda importata non ripetuta come voce del foglio", ()=>{
  const giornate = [{ data: "2026-10-01", dati: G }];
  const imp = new Set(["rapporti:2026-10-01:id:c1"]);
  const rap = [{ id: "r1", data: "2026-10-01", cliente: "Alfa", stato: "completato", rapportino_operai: [], origine: "rapporti:2026-10-01:id:c1" }];
  const v = unisciVoci(rap, giornate, x=>x, imp);
  assert.deepEqual(v.map(x=>[x.cliente, x.fonte || "rapportino"]).sort(), [["Alfa", "rapportino"], ["Delta", "foglio"], ["Gamma", "foglio"]]);
  assert.equal(unisciVoci([], giornate, x=>x).length, 3, "senza importate: tutte le schede");
});
