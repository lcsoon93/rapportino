// Controllo automatico del rapportino (js/services/controlli.js): regole fisse, nessuna rete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { controllaRapportino, elencoTesto } from "../../js/services/controlli.js";

const OGGI = "2026-11-13";
const completo = {
  rapportino: { data: OGGI, cliente: "Rossi", indirizzo: "Via Roma 1", tipologia: "Manutenzione ordinaria", attivita: "Pulizia bruciatore e analisi fumi: esito regolare.",
    note: "", esito: "Completato", materiali: [{ a: "Ugello", q: "1" }], firma: "data:image/png;base64,AAA", firmatario: "ROSSI" },
  ore: [{ operaio_id: "u1", nome: "Mario", dalle: "08:00", alle: "10:00" }], foto: { totali: 1, nonInviate: 0, nonDisponibili: 0 }, oggi: OGGI,
};
const msg = s=>s.map(x=>x.livello + ": " + x.messaggio);

test("rapportino completo: nessuna segnalazione", ()=>{
  assert.deepEqual(controllaRapportino(completo), []);
});
test("dati mancanti: errori bloccanti prima delle attenzioni", ()=>{
  const s = controllaRapportino({ rapportino: {}, ore: [], foto: {}, oggi: OGGI });
  assert.equal(s[0].livello, "errore");
  const m = msg(s).join("\n");
  for(const t of ["Manca la data", "Manca il cliente", "Mancano le attività", "Mancano le ore", "Manca la firma", "Manca l'indirizzo"]) assert.match(m, new RegExp(t));
});
test("ore: fine prima dell'inizio, sovrapposte, oltre 12 ore, incomplete, notturne", ()=>{
  const ore = (o)=>controllaRapportino({ ...completo, ore: o });
  assert.match(msg(ore([{ nome: "Mario", dalle: "10:00", alle: "09:00" }])).join(), /errore: Per Mario l'orario di fine/);
  assert.match(msg(ore([{ operaio_id: "u1", nome: "Mario", dalle: "08:00", alle: "11:00" }, { operaio_id: "u1", nome: "Mario", dalle: "10:00", alle: "12:00" }])).join(), /Orari sovrapposti per Mario/);
  assert.match(msg(ore([{ nome: "Anna", dalle: "06:00", alle: "19:30" }])).join(), /più di 12 ore/);
  assert.match(msg(ore([{ nome: "Anna", dalle: "08:00", alle: "" }, { nome: "Mario", dalle: "08:00", alle: "09:00" }])).join(), /Orario incompleto per Anna/);
  assert.match(msg(ore([{ nome: "Anna", dalle: "21:00", alle: "23:00" }])).join(), /info: Orario notturno/);
});
test("materiali, firma, esito, foto e date", ()=>{
  const r = (x, extra = {})=>msg(controllaRapportino({ ...completo, ...extra, rapportino: { ...completo.rapportino, ...x } })).join("\n");
  assert.match(r({ materiali: [{ a: "Tubo", q: "" }] }), /Quantità mancante per "Tubo"/);
  assert.match(r({ materiali: [{ a: "Tubo", q: "0" }] }), /Quantità non valida/);
  assert.equal(r({ materiali: [{ a: "Tubo", q: "2,5 m" }] }), "");
  assert.match(r({ materiali: [{ a: "Tubo", q: "qualche" }] }), /info: Quantità non numerica/);
  assert.match(r({ firmatario: "" }), /manca il nome del firmatario/);
  assert.match(r({ firma: "" }), /manca la firma/);
  assert.match(r({ esito: "Da ultimare" }), /cosa resta da fare/);
  assert.match(r({ tipologia: "Guasto / straordinaria" }, { foto: { totali: 0 } }), /attenzione: Nessuna foto/);
  assert.match(r({}, { foto: { totali: 2, nonInviate: 2 } }), /2 foto non ancora inviate/);
  assert.match(r({ data: "2026-12-01" }), /nel futuro/);
  assert.match(r({ data: "2026-09-01" }), /più di 30 giorni/);
});
test("elencoTesto: solo i livelli richiesti", ()=>{
  const s = controllaRapportino({ ...completo, rapportino: { ...completo.rapportino, firma: "", firmatario: "", data: "2026-09-01" } });
  assert.equal(elencoTesto(s), "• Manca la firma del cliente.");
});
test("frontend: nessuna chiave Groq, nessuna chiamata diretta a Groq, niente service_role", ()=>{
  const file = [];
  const giro = d=>readdirSync(d).forEach(n=>{ const p = join(d, n); statSync(p).isDirectory() ? (n !== "vendor" && giro(p)) : /\.(js|html)$/.test(n) && file.push(p); });
  giro("js"); file.push("index.html", "sw.js");
  for(const f of file){
    const t = readFileSync(f, "utf8");
    assert.doesNotMatch(t, /gsk_[A-Za-z0-9]{10,}/, f);
    assert.doesNotMatch(t, /api\.groq\.com/, f);
    assert.doesNotMatch(t, /GROQ_API_KEY/, f);
    assert.doesNotMatch(t, /service_role/i, f);
  }
});
