// Ricerca dal computer (js/services/ricerca-logica.js): voci da rapportini e foglio, filtri, riepilogo, CSV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cella, csvMateriali, filtraVoci, minutiIntervallo, riepilogo, unisciVoci, voceDaRapportino, vociDaGiornata } from "../../js/services/ricerca-logica.js";

const NOMI = { u1: "Mario Bianchi", u2: "Anna Verdi" };
const nome = id=>NOMI[id] || "Utente non disponibile";
const rapportini = [
  { id: "r1", data: "2026-11-12", cliente: "Rossi Srl", indirizzo: "Via Roma 10", attivita: "Pulizia bruciatore", stato: "completato", autore_id: "u1",
    materiali: [{ a: "Ugello 0.6", q: "1" }, { a: "  ", q: "2" }], firmatario: "ROSSI",
    rapportino_operai: [{ operaio_id: "u1", dalle: "08:00:00", alle: "10:30:00" }, { operaio_id: "u2", dalle: "09:00:00", alle: null }],
    interventi: { priorita: "urgente", descrizione: "Caldaia in blocco" } },
  { id: "r2", data: "2026-11-13", cliente: "Città Nuova", indirizzo: "", attivita: "Verifica", stato: "bozza", autore_id: "u2",
    materiali: [], rapportino_operai: [{ operaio_id: "u2", dalle: "14:00", alle: "15:00" }] },
];
const giornate = [
  { data: "2026-11-05", dati: { tecnici: "Luca / Mario", spese: [{ d: "Gasolio", i: 40.5 }, { d: "Pranzo", i: "12" }],
    clienti: [{ nome: "Bar Centrale", indirizzo: "Piazza 1", dettagli: "Cambio guarnizione", materiali: [{ a: "Guarnizione", q: "3" }], urgente: true, importo: "80" },
      { nome: "(senza nome)" }, { nome: "" }] } },
  { data: "2026-11-06", dati: { operai: [{ nome: "Anna" }], clienti: [{ nome: "Hotel Lago", dettagli: "Controllo" }] } },
];

test("minutiIntervallo: solo intervalli completi e positivi", ()=>{
  assert.equal(minutiIntervallo("08:00:00", "10:30:00"), 150);
  assert.equal(minutiIntervallo("09:00", null), 0);
  assert.equal(minutiIntervallo("10:00", "09:00"), 0);
});

test("voce da rapportino: operai con nome e intervallo, materiali vuoti scartati, urgenza dall'intervento", ()=>{
  const v = voceDaRapportino(rapportini[0], nome);
  assert.equal(v.fonte, "rapportino");
  assert.deepEqual(v.operai.map(o=>[o.nome, o.dalle, o.alle]), [["Mario Bianchi", "08:00", "10:30"], ["Anna Verdi", "09:00", ""]]);
  assert.equal(v.minuti, 150);
  assert.deepEqual(v.materiali, [{ a: "Ugello 0.6", q: "1" }]);
  assert.equal(v.urgente, true);
  assert.equal(v.descrizioneIntervento, "Caldaia in blocco");
  assert.equal(v.autore, "Mario Bianchi");
});

test("voci dal foglio: una per scheda con nome; tecnici da 'operai' oppure dal testo libero", ()=>{
  const a = vociDaGiornata(giornate[0]);
  assert.equal(a.length, 1);
  assert.equal(a[0].stato, "foglio");
  assert.deepEqual(a[0].operai.map(o=>o.nome), ["Luca", "Mario"]);
  assert.equal(a[0].importo, 80);
  assert.deepEqual(vociDaGiornata(giornate[1])[0].operai.map(o=>o.nome), ["Anna"]);
  assert.deepEqual(vociDaGiornata({ data: "2026-01-01", dati: null }), []);
});

test("unione ordinata dalla piu' recente", ()=>{
  const v = unisciVoci(rapportini, giornate, nome);
  assert.deepEqual(v.map(x=>x.cliente), ["Città Nuova", "Rossi Srl", "Hotel Lago", "Bar Centrale"]);
});

test("filtri: testo senza accenti su piu' campi, giorno, stato, operaio per id o per nome libero", ()=>{
  const v = unisciVoci(rapportini, giornate, nome);
  assert.deepEqual(filtraVoci(v, { testo: "citta" }).map(x=>x.cliente), ["Città Nuova"]);
  assert.deepEqual(filtraVoci(v, { testo: "ugello" }).map(x=>x.cliente), ["Rossi Srl"]);
  assert.deepEqual(filtraVoci(v, { testo: "blocco caldaia" }).map(x=>x.cliente), ["Rossi Srl"], "parole in qualsiasi ordine, anche dalla richiesta");
  assert.equal(filtraVoci(v, { testo: "x" }).length, 4, "una lettera sola non filtra");
  assert.deepEqual(filtraVoci(v, { dal: "2026-11-05", al: "2026-11-05" }).map(x=>x.cliente), ["Bar Centrale"]);
  assert.deepEqual(filtraVoci(v, { stato: "bozza" }).map(x=>x.cliente), ["Città Nuova"]);
  // Anna Verdi: nei rapportini per id; nel foglio "Anna" per primo nome
  assert.deepEqual(filtraVoci(v, { operaio: "u2", operaioNome: "Anna Verdi" }).map(x=>x.cliente), ["Città Nuova", "Rossi Srl", "Hotel Lago"]);
  // un altro "Mario" nei rapportini (id diverso) non conta; nel foglio sì
  assert.deepEqual(filtraVoci(v, { operaio: "u9", operaioNome: "Mario Rossi" }).map(x=>x.cliente), ["Bar Centrale"]);
});

test("riepilogo: completati, bozze, ore solo dei completati, spese del foglio, clienti distinti", ()=>{
  const r = riepilogo(unisciVoci(rapportini, giornate, nome), giornate);
  assert.deepEqual(r, { completati: 1, bozze: 1, schedeFoglio: 2, minuti: 150, spese: 52.5, righeMateriali: 2, clienti: 4 });
});

test("CSV: BOM, separatore ';', virgolette, formule neutralizzate, riga per materiale o 'Nessun materiale'", ()=>{
  assert.equal(cella('Via "A"; 1'), '"Via ""A""; 1"');
  assert.equal(cella("=SOMMA(A1)"), "'=SOMMA(A1)");
  assert.equal(cella("riga\nnuova"), "riga nuova");
  const csv = csvMateriali(unisciVoci(rapportini, giornate, nome));
  assert.ok(csv.startsWith("﻿Data;Origine;Cliente;Indirizzo;Operai;Materiale;Quantità\r\n"));
  const righe = csv.trim().split("\r\n");
  assert.equal(righe.length, 5);
  assert.ok(righe.includes("12/11/2026;Rapportino;Rossi Srl;Via Roma 10;Mario Bianchi 08:00-10:30, Anna Verdi;Ugello 0.6;1"));
  assert.ok(righe.includes("05/11/2026;Foglio giornaliero;Bar Centrale;Piazza 1;Luca, Mario;Guarnizione;3"));
  assert.ok(righe.includes("13/11/2026;Rapportino;Città Nuova;;Anna Verdi 14:00-15:00;Nessun materiale;"));
});
