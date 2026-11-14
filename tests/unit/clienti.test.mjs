// Regole dell'anagrafica clienti (js/services/clienti-logica.js): omonimi, ricerca, unione delle modifiche.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidatiImportazione, cercaClienti, datiPerDocumento, differenzeDocumento, erroriCliente, etichettaCliente,
  omonimi, pulisciCliente, stessoNome, unisciModifiche,
} from "../../js/services/clienti-logica.js";

const elenco = [
  { id: "a", nome: "Mario Rossi", indirizzo: "Via Roma 10, Milano", telefono: "333 1234567" },
  { id: "b", nome: "Mario Rossi", indirizzo: "Via Verdi 25, Monza", telefono: "" },
  { id: "c", nome: "Mario Rossi", indirizzo: "Via Verdi 25, Monza", telefono: "" },      // stesso nome e stesso indirizzo
  { id: "d", nome: "Rossi Impianti Srl", indirizzo: "Via Garibaldi 8, Como", partita_iva: "01234567890" },
  { id: "e", nome: "Bianchi Luca", indirizzo: "Piazza Duomo 1", email: "luca@esempio.it" },
  { id: "f", nome: "Mario Rossi", indirizzo: "Vecchia sede", archiviato: true },
];

test("omonimi: tutte le schede con lo stesso nome, ognuna con il proprio id", ()=>{
  const o = omonimi(elenco, "  mario   ROSSI ");
  assert.deepEqual(o.map(c=>c.id), ["a", "b", "c"]);
  assert.equal(omonimi(elenco, "Mario Rossi", { archiviati: true }).length, 4);
  assert.equal(omonimi(elenco, "").length, 0);
});

test("ricerca: tutte le corrispondenze, prima chi inizia con il testo, poi per indirizzo; nessuna scelta automatica", ()=>{
  const r = cercaClienti(elenco, "mario ro");
  assert.deepEqual(r.map(c=>c.id), ["a", "b", "c"]);
  assert.deepEqual(cercaClienti(elenco, "rossi").map(c=>c.id), ["d", "a", "b", "c"]);
  assert.deepEqual(cercaClienti(elenco, "monza").map(c=>c.id), ["b", "c"]);
  assert.deepEqual(cercaClienti(elenco, "333 123").map(c=>c.id), ["a"], "telefono con spazi");
  assert.deepEqual(cercaClienti(elenco, "1234567").map(c=>c.id), ["a", "d"], "cifre in telefono e P. IVA");
  assert.deepEqual(cercaClienti(elenco, "01234567890").map(c=>c.id), ["d"], "partita IVA");
  assert.deepEqual(cercaClienti(elenco, "esempio.it").map(c=>c.id), ["e"], "email");
  assert.deepEqual(cercaClienti(elenco, "vecchia").map(c=>c.id), [], "archiviati esclusi");
  assert.deepEqual(cercaClienti(elenco, "vecchia", { archiviati: true }).map(c=>c.id), ["f"]);
  assert.equal(cercaClienti(elenco, "").length, 5, "senza testo: tutti i non archiviati");
  assert.equal(cercaClienti(elenco, "mario", { massimo: 2 }).length, 2);
});

test("etichetta sempre con l'indirizzo", ()=>{
  assert.equal(etichettaCliente(elenco[0]), "Mario Rossi — Via Roma 10, Milano");
  assert.equal(etichettaCliente({ nome: "X" }), "X — indirizzo non indicato");
});

test("validazione: solo il nome e' obbligatorio, nessun controllo di unicita'", ()=>{
  assert.deepEqual(erroriCliente({ nome: "Mario Rossi" }), []);
  assert.match(erroriCliente({ nome: "  " }).join(), /obbligatorio/);
  assert.match(erroriCliente({ nome: "A", email: "non-email" }).join(), /email/);
  assert.match(erroriCliente({ nome: "A", telefono: "abc" }).join(), /telefono/);
  assert.deepEqual(erroriCliente({ nome: "A", telefono: "+39 02/123.45-67" }), []);
  assert.deepEqual(pulisciCliente({ nome: "  Mario   Rossi ", note: " x " }), { nome: "Mario Rossi", indirizzo: "", telefono: "", email: "", partita_iva: "", note: "x", archiviato: false });
});

test("documento: copia di nome, indirizzo, telefono e id; differenze per 'Aggiorna la scheda'", ()=>{
  assert.deepEqual(datiPerDocumento(elenco[0]), { cliente_id: "a", cliente: "Mario Rossi", indirizzo: "Via Roma 10, Milano", telefono: "333 1234567" });
  assert.deepEqual(differenzeDocumento(elenco[0], { indirizzo: "Via Roma 10, Milano", telefono: "333 1234567" }), []);
  assert.deepEqual(differenzeDocumento(elenco[0], { indirizzo: "Cantiere B", telefono: "0" }), ["indirizzo", "telefono"]);
  assert.ok(stessoNome("mario  rossi", "Mario Rossi"));
  assert.ok(!stessoNome("Mario Rossini", "Mario Rossi"));
});

test("unione a tre vie: campi diversi uniti, stesso campo cambiato da entrambi = conflitto (vince il server, niente perso)", ()=>{
  const base = { nome: "Mario Rossi", indirizzo: "Via Roma 10", telefono: "1", email: "", partita_iva: "", note: "", archiviato: false };
  const mia = { ...base, telefono: "2" };
  const server = { ...base, email: "m@r.it" };
  assert.deepEqual(unisciModifiche(base, mia, server), { risultato: { ...base, telefono: "2", email: "m@r.it" }, conflitti: [] });
  const r = unisciModifiche(base, mia, { ...base, telefono: "3" });
  assert.deepEqual(r.conflitti, ["telefono"]);
  assert.equal(r.risultato.telefono, "3");
  assert.deepEqual(unisciModifiche(base, mia, { ...base, telefono: "2" }).conflitti, [], "stessa modifica: nessun conflitto");
});

test("importazione: coppie nome+indirizzo distinte, gia' presenti escluse, omonimi con indirizzi diversi separati", ()=>{
  const documenti = [
    { cliente: "Mario Rossi", indirizzo: "Via Roma 10, Milano", data: "2026-01-01" },     // ha gia' la scheda "a"
    { cliente: "Mario Rossi", indirizzo: "Via Garibaldi 8, Como", data: "2026-02-01", telefono: "031 1" },
    { cliente: "mario rossi", indirizzo: "via garibaldi 8, como", data: "2026-03-01" },
    { cliente: "Mario Rossi", indirizzo: "Via Manzoni 3", data: "2026-01-05" },
    { cliente: "(senza nome)", indirizzo: "x" }, { cliente: "" },
  ];
  const c = candidatiImportazione(documenti, elenco);
  assert.deepEqual(c.map(x=>[x.nome, x.indirizzo, x.volte]), [["Mario Rossi", "Via Garibaldi 8, Como", 2], ["Mario Rossi", "Via Manzoni 3", 1]]);
  assert.equal(c[0].telefono, "031 1");
  assert.equal(c[0].ultimo, "2026-03-01");
});
