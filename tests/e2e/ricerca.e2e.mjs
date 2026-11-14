// Ricerca dal computer (search.html): accesso, permessi, riepilogo, filtri, dettaglio con stampa,
// esportazione materiali in CSV e PDF. Playwright + Chromium con un finto Supabase: nessuna richiesta
// esterna reale (ogni URL esterno e' intercettato; si verifica che nessuna risposta arrivi dalla rete).
// Esecuzione: JSPDF=<percorso di jspdf.umd.min.js 2.5.1> node tests/e2e/ricerca.e2e.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RADICE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const JSPDF = process.env.JSPDF;
if(!JSPDF || !fs.existsSync(JSPDF)){ console.error("Serve JSPDF=<percorso di jspdf.umd.min.js 2.5.1>"); process.exit(2); }
const TIPI = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
function avviaServer(){
  const srv = http.createServer((req, res)=>{
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(RADICE, p.endsWith("/") ? p + "index.html" : p);
    if(!file.startsWith(RADICE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TIPI[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok=>srv.listen(0, "127.0.0.1", ()=>ok(srv)));
}

const oggi = new Date(), MESE = oggi.getFullYear() + "-" + String(oggi.getMonth() + 1).padStart(2, "0");
const G = d=>MESE + "-" + String(d).padStart(2, "0");
const UTENTI = {
  admin:  { id: "b0000000-0000-4000-8000-000000000001", username: "luca", nome: "Luca Admin", cognome: "", ruolo: "admin", ruoli: ["admin", "worker"] },
  worker: { id: "b0000000-0000-4000-8000-000000000002", username: "mario", nome: "Mario Bianchi", cognome: "", ruolo: "worker", ruoli: ["worker"] },
};
const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";

const RAPPORTINI = [
  { id: "r1", intervento_id: "i1", autore_id: UTENTI.worker.id, data: G(3), cliente: "Rossi Srl", indirizzo: "Via Roma 10", telefono: "02 1234", tipologia: "Manutenzione ordinaria",
    attivita: "Pulizia bruciatore", materiali: [{ a: "Ugello 0.6", q: "1" }, { a: "Guarnizione", q: "2" }], note: "", esito: "Completato", firmatario: "ROSSI",
    stato: "completato", rapportino_operai: [{ operaio_id: UTENTI.worker.id, dalle: "08:00:00", alle: "10:30:00" }],
    interventi: { id: "i1", cliente: "Rossi Srl", descrizione: "Caldaia in blocco", priorita: "urgente", data: G(3), ora: "08:00:00" } },
  { id: "r2", intervento_id: null, autore_id: UTENTI.worker.id, data: G(4), cliente: "Città Nuova", indirizzo: "Via Po 2", tipologia: "", attivita: "Verifica impianto",
    materiali: [], note: "Da ricontrollare", esito: "", firmatario: "", stato: "bozza", rapportino_operai: [{ operaio_id: UTENTI.admin.id, dalle: "14:00", alle: "15:00" }], interventi: null },
];
const GIORNATE = [
  { data: G(2), dati: { tecnici: "Mario", spese: [{ d: "Gasolio", i: 40 }], clienti: [{ nome: "Bar Centrale", indirizzo: "Piazza 1", dettagli: "Cambio rubinetto", materiali: [{ a: "Rubinetto", q: "1" }] }] } },
];
const STORICO = { data: "2024-03-15", dati: { tecnici: "Mario", clienti: [{ nome: "Cliente Antico", dettagli: "Vecchio lavoro" }] } };

function nuovoSupabase(ruolo){
  const u = UTENTI[ruolo];
  const stato = { richieste: [] };
  const json = (route, corpo, status = 200)=>route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(corpo) });
  const nelPeriodo = (q, d)=>{
    const dal = (q.getAll("data").find(x=>x.startsWith("gte.")) || "").slice(4), al = (q.getAll("data").find(x=>x.startsWith("lte.")) || "").slice(4);
    return (!dal || d >= dal) && (!al || d <= al);
  };
  async function gestisci(route){
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname, q = url.searchParams;
    if(m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    stato.richieste.push(m + " " + p + url.search);
    // scritture: tutto cio' che non e' GET su tabelle e Storage (le RPC operai_attivi/nomi_utenti sono letture in POST)
    if(m !== "GET" && m !== "HEAD" && (/^\/rest\/v1\/(?!rpc\/(operai_attivi|nomi_utenti)$)/.test(p) || p.startsWith("/storage/"))) stato.scritture = (stato.scritture || 0) + 1;
    if(p === "/functions/v1/accesso") return json(route, { sessione: { access_token: jwt(u.id), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: u.id } } });
    if(p === "/auth/v1/user") return json(route, { id: u.id, aud: "authenticated", role: "authenticated" });
    if(p.startsWith("/auth/v1/")) return json(route, {});
    if(p === "/rest/v1/profili"){ const prof = { ...u, attivo: true, deve_cambiare_password: false }; return json(route, /object/.test(req.headers()["accept"] || "") ? prof : [prof]); }
    if(p === "/rest/v1/rpc/operai_attivi" || p === "/rest/v1/rpc/nomi_utenti")
      return json(route, Object.values(UTENTI).map(x=>({ id: x.id, username: x.username, nome: x.nome, attivo: true })));
    if(p === "/rest/v1/rapportini") return json(route, RAPPORTINI.filter(r=>nelPeriodo(q, r.data)));
    if(p === "/rest/v1/rapporti") return json(route, GIORNATE.concat([STORICO]).filter(g=>nelPeriodo(q, g.data)));
    if(p === "/rest/v1/interventi") return json(route, [{ id: "i1", stato: "completato" }, { id: "i2", stato: "pianificato" }].filter(()=>nelPeriodo(q, G(3))));
    return json(route, []);
  }
  return { stato, gestisci };
}

async function apri(browser, base, ruolo){
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  // in headless la stampa vera non esiste: si conta la richiesta di stampa della cornice
  await ctx.addInitScript(()=>{
    window.__stampe = [];
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get(){
      const w = d.get.call(this);
      if(!w || !this.classList.contains("cornice-stampa")) return w;
      const src = this.src;
      return { focus(){}, print(){ window.__stampe.push(src); } };
    } });
  });
  const sb = nuovoSupabase(ruolo);
  const esterne = [];
  await ctx.route(/^https?:\/\//, route=>{
    const url = route.request().url();
    if(url.startsWith(base)) return route.continue();
    if(/\.supabase\.co\//.test(url)) return sb.gestisci(route);
    if(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/2\.5\.1\//.test(url)) return route.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(JSPDF) });
    esterne.push(url);
    return route.fulfill({ status: 204, body: "" });
  });
  const page = await ctx.newPage();
  const errori = [], dallaRete = [];
  page.on("pageerror", e=>errori.push(String(e)));
  page.on("response", r=>{ if(/supabase\.co/.test(r.url()) && !r.fromServiceWorker() && r.request().failure()) dallaRete.push(r.url()); });
  return { ctx, page, sb, errori, esterne, dallaRete };
}
async function entra(page, base, username){
  await page.goto(base + "/search.html");
  await page.waitForSelector("#schermo-accesso:not([hidden])");
  await page.fill("#acc-username", username);
  await page.fill("#acc-password", "password-di-prova");
  await page.click("#acc-invia");
}
const risultati = [];
async function prova(nome, fn){
  try{ await fn(); risultati.push(["ok", nome]); console.log("ok   -", nome); }
  catch(e){ risultati.push(["FAIL", nome]); console.log("FAIL -", nome, "\n      ", e && String(e.message).split("\n").slice(0, 4).join(" | ")); }
}
const nomiRisultati = page=>page.$$eval("#risultati .voce-cliente", e=>e.map(x=>x.textContent));

const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch({ channel: "chromium" });
try{
  const a = await apri(browser, base, "admin");

  await prova("accesso dalla pagina: riepilogo del mese con rapportini nuovi e foglio giornaliero", async()=>{
    await entra(a.page, base, "luca");
    await a.page.waitForSelector("#schermo-ricerca:not([hidden]) #risultati .voce", { timeout: 15000 });
    assert.match(await a.page.textContent("#utente"), /Luca Admin/);
    assert.deepEqual(await nomiRisultati(a.page), ["Città Nuova", "Rossi Srl", "Bar Centrale"]);
    const riep = await a.page.textContent("#riepilogo");
    for(const t of ["Rapportini completati1", "1 bozza da completare", "2h 30m", "Interventi programmati2", "1 completati", "Clienti3", "40,00 €"])
      assert.ok(riep.replace(/\s+/g, " ").includes(t) || riep.includes(t), "manca nel riepilogo: " + t);
    assert.match(await a.page.textContent("#risultati"), /Mario Bianchi 08:00-10:30/);
    if(process.env.SCREENSHOT) await a.page.screenshot({ path: path.join(process.env.SCREENSHOT, "ricerca.png") });
  });

  await prova("filtri: testo (anche materiali, senza accenti), stato, operaio", async()=>{
    await a.page.fill("#cerca-input", "ugello");
    await a.page.waitForFunction(()=>document.querySelectorAll("#risultati .voce").length === 1);
    assert.deepEqual(await nomiRisultati(a.page), ["Rossi Srl"]);
    await a.page.fill("#cerca-input", "citta");
    await a.page.waitForFunction(()=>document.querySelector("#risultati .voce-cliente")?.textContent === "Città Nuova");
    await a.page.click("#btn-reset");
    await a.page.selectOption("#cerca-stato", "foglio");
    assert.deepEqual(await nomiRisultati(a.page), ["Bar Centrale"]);
    await a.page.selectOption("#cerca-stato", "");
    await a.page.selectOption("#cerca-operaio", UTENTI.worker.id);
    assert.deepEqual(await nomiRisultati(a.page), ["Rossi Srl", "Bar Centrale"], "Mario: per id nei rapportini, per nome nel foglio");
    await a.page.click("#btn-reset");
  });

  await prova("dettaglio: dati completi e 'Stampa PDF' apre la stampa con un PDF vero", async()=>{
    await a.page.click("#risultati .voce:has-text('Rossi Srl') .voce-corpo");
    await a.page.waitForSelector("#dettaglio[open]");
    const t = await a.page.textContent("#dettaglio");
    for(const x of ["Rossi Srl", "Urgente", "Completato", "Caldaia in blocco", "Pulizia bruciatore", "Ugello 0.6", "ROSSI", "02 1234"]) assert.ok(t.includes(x), "manca: " + x);
    await a.page.click("#btn-stampa-voce");
    await a.page.waitForFunction(()=>window.__stampe.length === 1);
    const pdf = await a.page.evaluate(async()=>{ const b = await (await fetch(window.__stampe[0])).arrayBuffer(); return String.fromCharCode(...new Uint8Array(b).slice(0, 5)); });
    assert.equal(pdf, "%PDF-");
    const [dl] = await Promise.all([a.page.waitForEvent("download"), a.page.click("#btn-scarica-voce")]);
    assert.match(dl.suggestedFilename(), /^Intervento_Rossi_Srl_\d{4}-\d\d-03\.pdf$/);
    const testo = fs.readFileSync(await dl.path()).toString("latin1");
    for(const x of ["RAPPORTINO DI INTERVENTO", "Rossi Srl", "Pulizia bruciatore", "Ugello 0.6", "08:00-10:30", "URGENTE"]) assert.ok(testo.includes(x), "manca nel PDF: " + x);
    assert.ok(!/2h 30m/.test(testo), "nel PDF gli intervalli, non il totale ore");
    await a.page.click("#btn-chiudi");
  });

  await prova("selezione: Excel (CSV) e PDF materiali solo delle voci spuntate", async()=>{
    assert.equal(await a.page.isDisabled("#btn-csv"), true);
    await a.page.check("#risultati .voce:has-text('Rossi Srl') .chk");
    await a.page.check("#risultati .voce:has-text('Bar Centrale') .chk");
    assert.match(await a.page.textContent("#conta-selezione"), /2 selezionati/);
    assert.equal(await a.page.isVisible("#dettaglio[open]"), false, "la spunta non apre il dettaglio");
    const [dl] = await Promise.all([a.page.waitForEvent("download"), a.page.click("#btn-csv")]);
    assert.match(dl.suggestedFilename(), /^Materiali_.+\.csv$/);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    assert.ok(csv.startsWith("﻿Data;Origine;Cliente"));
    assert.ok(csv.includes(";Rapportino;Rossi Srl;Via Roma 10;Mario Bianchi 08:00-10:30;Ugello 0.6;1"));
    assert.ok(csv.includes(";Foglio giornaliero;Bar Centrale;Piazza 1;Mario;Rubinetto;1"));
    assert.ok(!csv.includes("Città Nuova"));
    await a.page.click("#btn-pdf-materiali");
    await a.page.waitForFunction(()=>window.__stampe.length === 2);
    await a.page.click("#btn-tutti");
    assert.match(await a.page.textContent("#conta-selezione"), /3 selezionati/);
    assert.equal(await a.page.textContent("#btn-tutti"), "Deseleziona tutti");
  });

  await prova("tutto lo storico: compaiono anche gli anni precedenti", async()=>{
    await a.page.click("#btn-storico");
    await a.page.waitForFunction(()=>[...document.querySelectorAll("#risultati .voce-cliente")].some(x=>x.textContent === "Cliente Antico"));
    assert.equal(await a.page.textContent("#titolo-periodo"), "Intero storico");
    assert.equal(await a.page.isVisible("#btn-storico"), false);
    const q = a.sb.stato.richieste.filter(r=>/rest\/v1\/rapporti\?/.test(r));
    assert.ok(q.some(r=>/gte/.test(r)) && q.some(r=>!/gte/.test(r)), "prima il mese, poi senza limiti");
  });

  await prova("sessione condivisa con l'app: ricaricando non chiede di nuovo l'accesso; solo letture", async()=>{
    await a.page.reload();
    await a.page.waitForSelector("#schermo-ricerca:not([hidden]) #risultati .voce", { timeout: 15000 });
    assert.equal(a.sb.stato.scritture || 0, 0, "nessuna scrittura sul database");
  });

  await prova("esci: torna la schermata di accesso", async()=>{
    await a.page.click("#btn-esci");
    await a.page.waitForSelector("#schermo-accesso:not([hidden])");
    assert.deepEqual(a.errori, []);
    assert.deepEqual(a.dallaRete, []);
  });
  await a.ctx.close();

  const w = await apri(browser, base, "worker");
  await prova("operaio: pagina riservata, nessun dato caricato", async()=>{
    await entra(w.page, base, "mario");
    await w.page.waitForSelector("#schermo-negato:not([hidden])");
    assert.match(await w.page.textContent("#negato-testo"), /riservata ad amministratore e ufficio/);
    assert.ok(!w.sb.stato.richieste.some(r=>/rapportini|rapporti|interventi/.test(r)), "nessuna lettura dei dati");
    assert.deepEqual(w.errori, []);
  });
  await w.ctx.close();
}finally{
  await browser.close();
  srv.close();
}
const ko = risultati.filter(r=>r[0] !== "ok").length;
console.log("\n" + (risultati.length - ko) + "/" + risultati.length + " superati");
process.exit(ko ? 1 : 0);
