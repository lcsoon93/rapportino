// Scheda cliente: storico (collegamento per scheda o per nome), ore, materiali, filtri, impianti.
// Esecuzione: node --test tests/unit/scheda-cliente.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { collegamento, controllaDocumento, erroriImpianto, filtraStorico, linkEmail, linkMappe, linkTelefono, manutenzioniImpianto,
  minutiRapportino, opzioniStorico, percorsoDocumento, pulisciImpianto, riepilogoStorico, statoGaranzia, vociStorico } from "../../js/services/scheda-cliente-logica.js";

const CLI = { id: "c1", nome: "Mario Rossi" };
const nome = id=>({ u1: "Luca", u2: "Anna" })[id] || id;
const R = (id, data, extra = {})=>({ id, data, cliente: "Mario Rossi", cliente_id: "c1", stato: "completato", esito: "Completato", autore_id: "u1",
  attivita: "Lavoro " + id, materiali: [], rapportino_operai: [{ operaio_id: "u1", dalle: "08:00:00", alle: "10:00:00" }], ...extra });

test("collegamento: per scheda, per nome solo se il documento non ha scheda, mai un omonimo collegato ad altra scheda", ()=>{
  assert.equal(collegamento({ cliente_id: "c1", cliente: "Altro nome" }, CLI), "scheda");
  assert.equal(collegamento({ cliente_id: null, cliente: " mario  ROSSI " }, CLI), "nome");
  assert.equal(collegamento({ cliente_id: "c2", cliente: "Mario Rossi" }, CLI), "", "omonimo con un'altra scheda");
  assert.equal(collegamento({ cliente_id: null, cliente: "Mario Rossini" }, CLI), "");
});

test("ore di un rapportino: per operaio, sovrapposizioni una volta", ()=>{
  assert.equal(minutiRapportino(R("a", "2026-11-01", { rapportino_operai: [
    { operaio_id: "u1", dalle: "08:00", alle: "10:00" }, { operaio_id: "u1", dalle: "09:00", alle: "11:00" }, { operaio_id: "u2", dalle: "08:00", alle: "09:30" }] })), 180 + 90);
  assert.equal(minutiRapportino(R("b", "2026-11-01", { rapportino_operai: [] })), 0);
});

test("storico: rapportini, interventi senza rapportino, vecchia app; ordine dal piu' recente; stati", ()=>{
  const voci = vociStorico({ cliente: CLI, nome,
    rapportini: [
      R("r1", "2026-10-01", { materiali: [{ a: "Valvola", q: 2 }, { a: " " }], tipologia: "Manutenzione" }),
      R("r2", "2026-11-05", { stato: "bozza" }),
      R("r3", "2026-11-03", { esito: "Da ultimare", cliente_id: null, rapportino_operai: [{ operaio_id: "u2", dalle: "14:00", alle: "15:00" }] }),
      R("r4", "2026-11-04", { cliente_id: "c2" }),                                     // omonimo: escluso
      R("r5", "2026-09-01", { attivita: "Attività non indicata nella vecchia app.", origine: "rapporti:x" }),
    ],
    interventi: [
      { id: "i1", data: "2026-12-01", cliente: "Mario Rossi", cliente_id: "c1", stato: "pianificato", descrizione: "Controllo", intervento_operai: [{ operaio_id: "u2" }, { operaio_id: "u1", rimosso_il: "x" }], rapportini: [] },
      { id: "i2", data: "2026-10-01", cliente: "Mario Rossi", cliente_id: "c1", stato: "completato", rapportini: [{ id: "r1" }] },
    ],
    vecchi: [{ iso: "2025-05-02", c: { nome: "MARIO ROSSI", dettagli: "Caldaia", materiali: [{ a: "Ugello", q: "1" }], stato: "Completato" }, tecnici: ["Luca"] },
             { iso: "2025-05-03", c: { nome: "Altro" }, tecnici: [] }],
  });
  assert.deepEqual(voci.map(v=>[v.tipo, v.id, v.stato, v.link]), [
    ["intervento", "i1", "pianificato", "scheda"],
    ["rapportino", "r2", "bozza", "scheda"],
    ["rapportino", "r3", "da_ultimare", "nome"],
    ["rapportino", "r1", "completato", "scheda"],
    ["rapportino", "r5", "completato", "scheda"],
    ["vecchio", "2025-05-02:0", "completato", "nome"],
  ]);
  const r1 = voci.find(v=>v.id === "r1");
  assert.deepEqual([r1.minuti, r1.materiali, r1.tecnici, r1.tipologia], [120, [{ a: "Valvola", q: "2" }], ["Luca"], "Manutenzione"]);
  assert.deepEqual(voci.find(v=>v.id === "i1").tecnici, ["Anna"], "operaio rimosso escluso");
  assert.equal(voci.find(v=>v.id === "r5").descrizione, "", "testo segnaposto dell'importazione nascosto");
  const rp = riepilogoStorico(voci);
  assert.deepEqual([rp.lavori, rp.minuti, rp.ultimo, rp.prossimo, rp.perNome], [5, 120 + 120 + 60 + 120, "2026-11-03", "2026-12-01", 2]);
});

test("filtri: periodo (12 mesi, anno, tutto), stato, tipologia; opzioni dai dati", ()=>{
  const voci = [
    { data: "2026-11-01", stato: "completato", tipologia: "Manutenzione" },
    { data: "2025-12-01", stato: "bozza", tipologia: "manutenzione" },
    { data: "2025-11-27", stato: "completato", tipologia: "Guasto" },
    { data: "2024-01-01", stato: "da_ultimare", tipologia: "" },
  ];
  const oggi = "2026-11-28";
  assert.equal(filtraStorico(voci, { periodo: "12m", oggi }).length, 2, "dal 28/11/2025");
  assert.equal(filtraStorico(voci, { periodo: "2025", oggi }).length, 2);
  assert.equal(filtraStorico(voci, { periodo: "tutto", stato: "completato", oggi }).length, 2);
  assert.equal(filtraStorico(voci, { tipologia: "MANUTENZIONE", oggi }).length, 2);
  assert.deepEqual(opzioniStorico(voci), { tipologie: ["Guasto", "Manutenzione"], anni: ["2026", "2025", "2024"] });
});

test("impianti: pulizia, errori, garanzia, manutenzioni trovate nel testo", ()=>{
  assert.deepEqual(pulisciImpianto({ nome: "  Caldaia   murale ", installato_il: "2024-3-1", garanzia_fino: "2026-03-01", dismesso: 1 }),
    { nome: "Caldaia murale", marca: "", modello: "", matricola: "", installato_il: null, garanzia_fino: "2026-03-01", posizione: "", note: "", dismesso: true });
  assert.deepEqual(erroriImpianto({ nome: "" }), ["Indica che impianto è (es. Caldaia murale)."]);
  assert.equal(erroriImpianto({ nome: "X", installato_il: "2025-01-01", garanzia_fino: "2024-01-01" }).length, 1);
  assert.deepEqual(statoGaranzia("2026-12-10", "2026-11-28"), { stato: "in_scadenza", giorni: 12 });
  assert.deepEqual(statoGaranzia("2026-11-27", "2026-11-28"), { stato: "scaduta", giorni: -1 });
  assert.equal(statoGaranzia("2027-06-01", "2026-11-28").stato, "attiva");
  assert.equal(statoGaranzia(null, "2026-11-28").stato, "nessuna");
  const voci = [
    { tipo: "rapportino", id: "a", descrizione: "Pulizia caldaia matr. VX-123", materiali: [] },
    { tipo: "rapportino", id: "b", descrizione: "Sostituito ugello", materiali: [{ a: "Ricambio Vaillant ecoTEC" }] },
    { tipo: "rapportino", id: "c", descrizione: "Vaillant altro modello" },
    { tipo: "intervento", id: "d", descrizione: "VX-123" },
  ];
  assert.deepEqual(manutenzioniImpianto({ matricola: "vx-123", marca: "Vaillant", modello: "ecoTEC" }, voci).map(v=>v.id), ["a", "b"]);
  assert.deepEqual(manutenzioniImpianto({ matricola: "12" }, voci).map(v=>v.id), [], "matricola troppo corta: nessuna ricerca");
});

test("azioni rapide e documenti", ()=>{
  assert.equal(linkTelefono("+39 333 12.34"), "tel:+393331234");
  assert.equal(linkTelefono(""), "");
  assert.equal(linkEmail("a@b.it"), "mailto:a@b.it");
  assert.equal(linkEmail("non valida"), "");
  assert.equal(linkMappe("Via Roma 1, Milano"), "https://www.google.com/maps/search/?api=1&query=Via%20Roma%201%2C%20Milano");
  assert.equal(linkMappe("  "), "");
  assert.equal(controllaDocumento({ type: "application/pdf", size: 1000 }), "");
  assert.match(controllaDocumento({ type: "text/html", size: 10 }), /Formato non ammesso/);
  assert.match(controllaDocumento({ type: "image/png", size: 11 * 1024 * 1024 }), /troppo grande/);
  assert.equal(percorsoDocumento("c1", "d1", "image/jpeg"), "c1/d1.jpg");
});
