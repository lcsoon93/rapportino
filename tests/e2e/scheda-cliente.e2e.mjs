// Test end-to-end della scheda cliente evoluta (Playwright, Chromium), SENZA il server vero: un finto
// Supabase in memoria con le regole della migrazione 20261128090000 (campi nuovi dell'anagrafica,
// impianti con versione e permessi, documenti nel bucket privato, eliminazione solo admin).
// Ogni altra richiesta esterna e' bloccata.
// Esecuzione: node tests/e2e/scheda-cliente.e2e.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RADICE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
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

// ---------------------------------------------------------------- finto Supabase
const UTENTI = {
  admin:   { id: "b0000000-0000-4000-8000-000000000001", username: "luca", nome: "Luca", cognome: "", ruolo: "admin", ruoli: ["admin", "worker"] },
  worker:  { id: "b0000000-0000-4000-8000-000000000002", username: "mario", nome: "Mario", cognome: "Bianchi", ruolo: "worker", ruoli: ["worker"] },
  company: { id: "b0000000-0000-4000-8000-000000000004", username: "comphas", nome: "Comphas", cognome: "", ruolo: "company", ruoli: ["company"] },
};
const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";
const uuid = ()=>crypto.randomUUID();
const DB = {
  clienti: new Map(), interventi: new Map(), rapportini: new Map(), impianti: new Map(), documenti: new Map(), file: new Map(),
  chiamate: [], estesa: true, senzaTabelle: false,
};
const CAMPI = ["nome", "indirizzo", "telefono", "email", "partita_iva", "note", "archiviato"];
const ESTESI = ["tipologia", "referente", "codice_fiscale", "codice_sdi", "pec", "stato", "sedi"];
const VUOTI = { tipologia: "", referente: "", codice_fiscale: "", codice_sdi: "", pec: "", stato: "attivo", sedi: [] };
function salvaCliente(u, p, versione){
  const campi = DB.estesa ? CAMPI.concat(ESTESI) : CAMPI;
  if(versione == null){
    if(DB.clienti.has(p.id)) return { esito: "conflitto", cliente: DB.clienti.get(p.id) };
    const c = { id: p.id || uuid(), versione: 1, creato_da: u.id, creato_il: new Date().toISOString(), archiviato: false, ...(DB.estesa ? VUOTI : {}) };
    campi.forEach(k=>{ if(k !== "archiviato" && p[k] !== undefined && !(k === "stato" && !p[k])) c[k] = p[k]; });
    CAMPI.forEach(k=>{ if(c[k] === undefined) c[k] = ""; });
    DB.clienti.set(c.id, c);
    return { esito: "ok", cliente: c };
  }
  if(!["admin", "company"].includes(u.ruolo)) return { errore: { code: "42501", message: "Solo amministratore e company possono modificare l'anagrafica" } };
  const c = DB.clienti.get(p.id);
  if(c && c.versione === versione){ campi.forEach(k=>{ if(p[k] !== undefined) c[k] = p[k]; }); c.versione++; return { esito: "ok", cliente: c }; }
  return c ? { esito: "conflitto", cliente: c } : { errore: { code: "42501", message: "Cliente non trovato" } };
}
// filtri PostgREST usati dall'app: eq. / is.null / ilike. (senza caratteri jolly = uguale senza maiuscole)
function filtra(url, righe){
  const f = [...url.searchParams.entries()].filter(([k])=>!["select", "order", "limit", "offset"].includes(k));
  return righe.filter(r=>f.every(([k, v])=>{
    const x = r[k];
    if(v === "is.null") return x == null;
    if(v.startsWith("eq.")) return String(x) === v.slice(3);
    if(v.startsWith("ilike.")) return String(x || "").toLowerCase() === v.slice(6).replace(/\\(.)/g, "$1").toLowerCase();
    if(v.startsWith("gte.")) return String(x) >= v.slice(4);
    if(v.startsWith("lte.")) return String(x) <= v.slice(4);
    return true;
  }));
}
const RUOLI_PIANIFICA = ["admin", "company"];
function nuovoSupabase(ruolo){
  const u = UTENTI[ruolo];
  const intestazioni = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range" };
  const json = (route, corpo, status = 200)=>route.fulfill({ status, contentType: "application/json", headers: intestazioni, body: JSON.stringify(corpo) });
  const oggetto = req=>/vnd\.pgrst\.object/.test(req.headers()["accept"] || "");
  const risposta = (route, req, elenco, status = 200)=>json(route, oggetto(req) ? (elenco[0] || null) : elenco, status);
  return async function gestisci(route){
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname;
    if(m === "OPTIONS") return route.fulfill({ status: 200, headers: { ...intestazioni, "access-control-allow-methods": "*" } });
    const corpo = ()=>JSON.parse(req.postData() || "null");
    DB.chiamate.push(m + " " + p);
    if(p === "/functions/v1/accesso") return json(route, { sessione: { access_token: jwt(u.id), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: u.id, aud: "authenticated", role: "authenticated" } } });
    if(p === "/auth/v1/user") return json(route, { id: u.id, aud: "authenticated", role: "authenticated" });
    if(p.startsWith("/auth/v1/")) return json(route, {});
    if(p.startsWith("/functions/v1/")) return json(route, { ok: true });
    // ---- Storage (bucket documenti-clienti)
    if(p.startsWith("/storage/v1/object/documenti-clienti")){
      if(DB.senzaTabelle) return json(route, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 400);
      const percorso = decodeURIComponent(p.replace(/^\/storage\/v1\/object\/documenti-clienti\/?/, ""));
      if(m === "POST"){
        // supabase-js invia il file in un multipart: si tiene solo il contenuto del file (come lo Storage)
        let dati = req.postDataBuffer();
        const tipo = req.headers()["content-type"] || "";
        const bnd = (tipo.match(/boundary=(.+)$/) || [])[1];
        if(bnd){
          const parti = dati.toString("latin1").split("--" + bnd).filter(x=>x && !x.startsWith("--"));
          const file = parti.find(x=>/filename=|Content-Type: (application|image)\//i.test(x)) || parti[parti.length - 1];
          dati = Buffer.from(file.slice(file.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""), "latin1");
        }
        DB.file.set(percorso, { dati, owner: u.id });
        return json(route, { Key: "documenti-clienti/" + percorso });
      }
      if(m === "GET"){ const f = DB.file.get(percorso); return f ? route.fulfill({ status: 200, headers: intestazioni, contentType: "application/pdf", body: f.dati }) : json(route, { error: "not found" }, 400); }
      if(m === "DELETE"){ (corpo().prefixes || []).forEach(x=>{ const f = DB.file.get(x); if(f && (RUOLI_PIANIFICA.includes(u.ruolo) || f.owner === u.id)) DB.file.delete(x); }); return json(route, []); }
    }
    if(p.startsWith("/storage/")) return json(route, { error: "x" }, 503);
    if(p === "/rest/v1/profili"){ const prof = { ...u, attivo: true, deve_cambiare_password: false }; return json(route, oggetto(req) ? prof : [prof]); }
    if(p === "/rest/v1/rpc/operai_attivi" || p === "/rest/v1/rpc/nomi_utenti") return json(route, Object.values(UTENTI).map(x=>({ id: x.id, username: x.username, nome: (x.nome + " " + x.cognome).trim(), attivo: true })));
    if(p === "/rest/v1/rpc/salva_cliente"){
      const b = corpo();
      const r = salvaCliente(u, b.p_cliente, b.p_versione);
      return r.errore ? json(route, r.errore, 403) : json(route, r);
    }
    if(p.startsWith("/rest/v1/rpc/")) return json(route, null);
    if(p === "/rest/v1/clienti" && m === "GET"){
      if(!DB.estesa && /sedi/.test(url.searchParams.get("select") || "")) return json(route, { code: "42703", message: "column clienti.sedi does not exist" }, 400);
      return json(route, [...DB.clienti.values()].map(c=>DB.estesa ? c : Object.fromEntries(Object.entries(c).filter(([k])=>!ESTESI.includes(k)))).sort((a, b)=>a.nome.localeCompare(b.nome)));
    }
    if(p === "/rest/v1/rapportini" && m === "GET")
      return risposta(route, req, filtra(url, [...DB.rapportini.values()]).map(r=>({ ...r, rapportino_operai: r.rapportino_operai || [], allegati: [{ count: 0 }], interventi: null })));
    if(p === "/rest/v1/interventi" && m === "GET")
      return risposta(route, req, filtra(url, [...DB.interventi.values()]).map(i=>({ ...i, intervento_operai: i.intervento_operai || [],
        rapportini: [...DB.rapportini.values()].filter(r=>r.intervento_id === i.id).map(r=>({ id: r.id })) })));
    // ---- impianti
    if(p === "/rest/v1/impianti_cliente" || p === "/rest/v1/documenti_cliente"){
      if(DB.senzaTabelle) return json(route, { code: "PGRST205", message: "Could not find the table 'public." + p.slice(9) + "' in the schema cache" }, 404);
    }
    if(p === "/rest/v1/impianti_cliente"){
      if(m === "GET") return risposta(route, req, filtra(url, [...DB.impianti.values()]).sort((a, b)=>a.dismesso - b.dismesso || a.nome.localeCompare(b.nome)));
      if(m === "POST"){ const b = corpo(); const i = { ...b, nome: b.nome.trim(), versione: 1, creato_da: u.id }; DB.impianti.set(i.id, i); return risposta(route, req, [i], 201); }
      if(m === "PATCH"){
        const b = corpo();
        const trovati = filtra(url, [...DB.impianti.values()]).filter(i=>RUOLI_PIANIFICA.includes(u.ruolo) || i.creato_da === u.id);
        trovati.forEach(i=>{ Object.assign(i, b, { id: i.id, cliente_id: i.cliente_id, creato_da: i.creato_da }); i.versione++; });
        return risposta(route, req, trovati);
      }
      if(m === "DELETE"){
        const trovati = u.ruolo === "admin" ? filtra(url, [...DB.impianti.values()]) : [];
        trovati.forEach(i=>DB.impianti.delete(i.id));
        return risposta(route, req, trovati.map(i=>({ id: i.id })));
      }
    }
    // ---- documenti
    if(p === "/rest/v1/documenti_cliente"){
      if(m === "GET") return risposta(route, req, filtra(url, [...DB.documenti.values()]));
      if(m === "POST"){
        const b = corpo();
        const f = DB.file.get(b.percorso);
        if(!f) return json(route, { code: "P0002", message: "Documento non ancora caricato" }, 400);
        if(f.dati.length !== b.dimensione) return json(route, { code: "23514", message: "Documento caricato in modo incompleto" }, 400);
        const d = { ...b, nome: b.nome.trim(), caricato_da: u.id, creato_il: new Date().toISOString() };
        DB.documenti.set(d.id, d);
        return risposta(route, req, [d], 201);
      }
      if(m === "DELETE"){
        const trovati = filtra(url, [...DB.documenti.values()]).filter(d=>RUOLI_PIANIFICA.includes(u.ruolo) || d.caricato_da === u.id);
        trovati.forEach(d=>DB.documenti.delete(d.id));
        return risposta(route, req, trovati.map(d=>({ id: d.id })));
      }
    }
    if(p.startsWith("/rest/v1/")){
      if(m !== "GET" && m !== "HEAD") return json(route, [], 201);
      if(oggetto(req)) return json(route, null, 406);
      return json(route, []);
    }
    return json(route, {}, 404);
  };
}

async function apri(browser, base, ruolo){
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const gestisci = nuovoSupabase(ruolo);
  const esterne = [];
  await ctx.route(/^https?:\/\//, route=>{
    const url = route.request().url();
    if(url.startsWith(base)) return route.continue();
    if(/\.supabase\.co\//.test(url)) return gestisci(route);
    if(/cdnjs\.cloudflare\.com/.test(url)) return route.fulfill({ status: 200, contentType: "text/javascript", body: "window.jspdf = window.jspdf || {};" });
    esterne.push(url);
    return route.fulfill({ status: 204, body: "" });
  });
  const page = await ctx.newPage();
  const errori = [];
  page.on("pageerror", e=>errori.push(String(e)));
  page.on("dialog", d=>d.accept());
  await page.goto(base + "/index.html");
  await page.fill("#acc-username", UTENTI[ruolo].username);
  await page.fill("#acc-password", "password-di-prova");
  await page.click("#acc-invia");
  await page.waitForFunction(()=>document.body.dataset.ruolo && document.body.dataset.ruolo !== "", null, { timeout: 15000 });
  return { ctx, page, errori, esterne };
}
const risultati = [];
async function prova(nome, fn){
  try{ await fn(); risultati.push(["ok", nome]); console.log("ok   -", nome); }
  catch(e){ risultati.push(["FAIL", nome]); console.log("FAIL -", nome, "\n      ", e && String(e.message).split("\n").slice(0, 4).join(" | ")); }
}
const foto = async(page, nome)=>{ if(process.env.SCREENSHOT) await page.screenshot({ path: path.join(process.env.SCREENSHOT, nome + ".png") }); };
async function apriScheda(page, nome){
  await page.evaluate(()=>window.mostraVista("cerca"));
  await page.evaluate(()=>{ document.getElementById("cerca-input").value = ""; window.eseguiRicerca(); });
  await page.waitForFunction(n=>[...document.querySelectorAll("#anag-elenco .cli-nome")].some(x=>x.textContent === n), nome, { timeout: 15000 });
  await page.locator("#anag-elenco .cli-riga", { hasText: nome }).first().click();
  await page.waitForSelector("#cli-foglio:not(.nascosto) .sc-tab");
}
const tab = async(page, k)=>{ await page.click('.sc-tab [data-sc-tab="' + k + '"]'); };
const testoPannello = page=>page.textContent("#sc-pannello");
// attende un testo nel pannello; se non arriva, l'errore mostra cosa c'e'
async function attendiPannello(page, re, timeout = 15000){
  try{ await page.waitForFunction(r=>new RegExp(r).test(document.getElementById("sc-pannello").textContent), re.source, { timeout }); }
  catch(e){ throw new Error("atteso " + re + " nel pannello: " + ((await page.textContent("#sc-pannello").catch(()=>"?")) || "").replace(/\s+/g, " ").slice(0, 300)); }
}
const senzaScorrimento = page=>page.evaluate(()=>{
  const pannello = document.querySelector("#cli-foglio .foglio-pannello");
  return document.documentElement.scrollWidth <= window.innerWidth && pannello.scrollWidth <= pannello.clientWidth + 1;
});

// ---------------------------------------------------------------- dati di partenza
const ID_ROSSI = "c1000000-0000-4000-8000-000000000001", ID_OMONIMO = "c1000000-0000-4000-8000-000000000002";
const W = UTENTI.worker.id, A = UTENTI.admin.id;
const R = (id, data, extra = {})=>DB.rapportini.set(id, { id, data, cliente: "Mario Rossi", cliente_id: ID_ROSSI, indirizzo: "Via Roma 1", stato: "completato", esito: "Completato",
  autore_id: W, attivita: "Lavoro " + id, materiali: [], note: "", tipologia: "", intervento_id: null, origine: null,
  rapportino_operai: [{ operaio_id: W, dalle: "08:00:00", alle: "10:00:00" }], ...extra });
DB.clienti.set(ID_ROSSI, { id: ID_ROSSI, nome: "Mario Rossi", indirizzo: "Via Roma 1, Milano", telefono: "333 1234567", email: "mario@rossi.it", partita_iva: "", note: "Citofono 3",
  archiviato: false, versione: 1, creato_da: A, creato_il: "2026-01-10T09:00:00Z", aggiornato_il: "2026-01-10T09:00:00Z", ...VUOTI, tipologia: "privato" });
DB.clienti.set(ID_OMONIMO, { id: ID_OMONIMO, nome: "Mario Rossi", indirizzo: "Via Verdi 9, Monza", telefono: "", email: "", partita_iva: "", note: "", archiviato: false, versione: 1,
  creato_da: A, creato_il: "2026-01-10T09:00:00Z", aggiornato_il: "2026-01-10T09:00:00Z", ...VUOTI });
R("r0000000-0000-4000-8000-000000000001", "2026-11-20", { tipologia: "Manutenzione", attivita: "Pulizia caldaia matricola VX-123", materiali: [{ a: "Guarnizione", q: "2" }],
  rapportino_operai: [{ operaio_id: W, dalle: "08:00:00", alle: "10:00:00" }, { operaio_id: A, dalle: "09:00:00", alle: "10:30:00" }] });
R("r0000000-0000-4000-8000-000000000002", "2026-10-02", { tipologia: "Guasto", esito: "Da ultimare", attivita: "Perdita sotto lavello" });
R("r0000000-0000-4000-8000-000000000003", "2026-11-25", { stato: "bozza", attivita: "Bozza in corso" });
R("r0000000-0000-4000-8000-000000000004", "2025-03-15", { cliente_id: null, cliente: "mario rossi", attivita: "Lavoro prima dell'anagrafica" });     // per nome
R("r0000000-0000-4000-8000-000000000005", "2026-11-21", { cliente_id: ID_OMONIMO, attivita: "Lavoro dell'omonimo" });                               // altra scheda
DB.interventi.set("i0000000-0000-4000-8000-000000000001", { id: "i0000000-0000-4000-8000-000000000001", data: "2026-12-03", ora: "09:00:00", cliente: "Mario Rossi", cliente_id: ID_ROSSI,
  indirizzo: "Via Roma 1", descrizione: "Controllo annuale", tipologia: "Manutenzione", stato: "pianificato", intervento_operai: [{ operaio_id: W, rimosso_il: null }] });

// ---------------------------------------------------------------- test
const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
const esterne = [];
try{
  // ======================= company
  const c = await apri(browser, base, "company");

  await prova("anagrafica estesa: creazione con tipologia, stato, referente, sedi e dati fiscali (campi non obbligatori)", async()=>{
    await c.page.evaluate(()=>window.mostraVista("cerca"));
    await c.page.click("#anag-nuovo");
    await c.page.waitForSelector("#cli-form");
    await c.page.fill("#cli-nome", "Condominio Aurora");
    await c.page.selectOption("#cli-tipologia", "condominio");
    await c.page.selectOption("#cli-stato", "potenziale");
    await c.page.fill("#cli-referente", "Amm. Neri");
    await c.page.fill("#cli-telefono", "02 555 1234");
    await c.page.fill("#cli-pec", "aurora@pec.it");
    await c.page.fill("#cli-indirizzo", "Via Aurora 5, Milano");
    await c.page.click("#cli-sede-agg");
    await c.page.fill("#cli-sedi .sc-sede:nth-child(1) .sc-sede-nome", "Centrale termica");
    await c.page.fill("#cli-sedi .sc-sede:nth-child(1) .sc-sede-ind", "Via Aurora 5 interno 2");
    await c.page.click("#cli-sede-agg");                                     // riga vuota: scartata
    await c.page.fill("#cli-codice_fiscale", "80012345678");
    assert.ok(await senzaScorrimento(c.page), "modulo largo quanto il telefono");
    await foto(c.page, "scheda-modulo");
    await c.page.click("#cli-salva");
    await c.page.waitForSelector("#cli-foglio .sc-tab");
    const x = [...DB.clienti.values()].find(k=>k.nome === "Condominio Aurora");
    assert.deepEqual([x.tipologia, x.stato, x.referente, x.pec, x.codice_fiscale, x.sedi], ["condominio", "potenziale", "Amm. Neri", "aurora@pec.it", "80012345678",
      [{ nome: "Centrale termica", indirizzo: "Via Aurora 5 interno 2" }]]);
    const t = await testoPannello(c.page);
    for(const s of ["Referente: Amm. Neri", "Centrale termica", "Via Aurora 5 interno 2", "aurora@pec.it", "80012345678"]) assert.ok(t.includes(s), "manca nella scheda: " + s);
    assert.match(await c.page.textContent("#cli-corpo .sc-badge"), /Condominio.*Potenziale/);
  });

  await prova("modifica: stato e sedi; un solo salvataggio con la versione, campi non toccati invariati", async()=>{
    await c.page.click('#cli-azioni [data-az="modifica"]');
    await c.page.waitForSelector("#cli-form");
    await c.page.selectOption("#cli-stato", "attivo");
    await c.page.click("#cli-sedi .sc-sede [data-sede-togli]");
    await c.page.click("#cli-salva");
    await c.page.waitForSelector("#cli-foglio .sc-tab");
    await c.page.waitForFunction(()=>!document.querySelector("#cli-corpo .msg-info.att"), null, { timeout: 10000 }).catch(()=>{});
    const x = [...DB.clienti.values()].find(k=>k.nome === "Condominio Aurora");
    assert.deepEqual([x.stato, x.sedi, x.referente, x.versione], ["attivo", [], "Amm. Neri", 2]);
    await c.page.click("#cli-chiudi");
  });

  await prova("azioni rapide: chiama, email, mappe; rapportino e intervento", async()=>{
    await apriScheda(c.page, "Mario Rossi");
    const href = await c.page.$$eval(".sc-rapide a", aa=>aa.map(a=>a.getAttribute("href")));
    assert.ok(href.includes("tel:3331234567") || href.includes("tel:3331234567"), href.join(" "));
    assert.ok(href.includes("mailto:mario@rossi.it"));
    assert.ok(href.some(h=>h.startsWith("https://www.google.com/maps/search/?api=1&query=") && h.includes("Via%20Roma%201")));
    assert.equal(await c.page.locator('.sc-rapide [data-az="intervento"]').count(), 1, "company: nuovo intervento");
    assert.equal(await c.page.locator('.sc-rapide [data-az="rapportino"]').count(), 0, "company non compila rapportini");
  });

  await prova("lavori: collegati alla scheda e per nome (non quelli dell'omonimo), ore, materiali, tecnici, stati, intervento programmato", async()=>{
    await tab(c.page, "lavori");
    await c.page.waitForSelector("#sc-pannello .sc-voce");
    const voci = await c.page.$$eval("#sc-pannello .sc-voce", vv=>vv.map(v=>v.dataset.voce));
    assert.deepEqual(voci, ["i0000000-0000-4000-8000-000000000001", "r0000000-0000-4000-8000-000000000003", "r0000000-0000-4000-8000-000000000001",
      "r0000000-0000-4000-8000-000000000002", "r0000000-0000-4000-8000-000000000004"]);
    const t = await testoPannello(c.page);
    assert.ok(!t.includes("Lavoro dell'omonimo"));
    const r1 = await c.page.textContent('[data-voce="r0000000-0000-4000-8000-000000000001"]');
    for(const s of ["20/11/2026", "Completato", "Manutenzione", "Pulizia caldaia", "Mario Bianchi", "Luca", "3 ore 30 m", "Guarnizione (2)"])
      assert.ok(r1.replace(/\s+/g, " ").includes(s) || (s === "3 ore 30 m" && /3h 30m|3 ore 30/.test(r1)), "manca nel rapportino: " + s + " in " + r1);
    assert.match(await c.page.textContent('[data-voce="r0000000-0000-4000-8000-000000000004"]'), /trovato per nome/);
    assert.match(await c.page.textContent('[data-voce="r0000000-0000-4000-8000-000000000002"]'), /Da ultimare/);
    assert.match(await c.page.textContent('[data-voce="i0000000-0000-4000-8000-000000000001"]'), /Programmato.*Controllo annuale/s);
    assert.match(await c.page.textContent(".sc-riepilogo"), /4 lavori.*prossimo intervento il 03\/12\/2026/);
    assert.ok(await senzaScorrimento(c.page));
    await foto(c.page, "scheda-lavori");
  });

  await prova("filtri: stato, tipologia, periodo; nessun risultato con messaggio", async()=>{
    await c.page.selectOption("#sc-f-stato", "da_ultimare");
    assert.deepEqual(await c.page.$$eval("#sc-pannello .sc-voce", vv=>vv.map(v=>v.dataset.voce)), ["r0000000-0000-4000-8000-000000000002"]);
    await c.page.selectOption("#sc-f-stato", "");
    await c.page.selectOption("#sc-f-tipologia", "Manutenzione");
    assert.equal(await c.page.locator("#sc-pannello .sc-voce").count(), 2);
    await c.page.selectOption("#sc-f-tipologia", "");
    await c.page.selectOption("#sc-f-periodo", "2025");
    assert.deepEqual(await c.page.$$eval("#sc-pannello .sc-voce", vv=>vv.map(v=>v.dataset.voce)), ["r0000000-0000-4000-8000-000000000004"]);
    await c.page.selectOption("#sc-f-stato", "bozza");
    assert.match(await testoPannello(c.page), /Nessun lavoro con questi filtri/);
    await c.page.selectOption("#sc-f-stato", "");
    await c.page.selectOption("#sc-f-periodo", "tutto");
  });

  await prova("apri il rapportino originale (con il suo PDF) dalla scheda", async()=>{
    await c.page.click('[data-voce="r0000000-0000-4000-8000-000000000001"] [data-sc-rap]');
    await c.page.waitForSelector("#vista-rapportino:not(.nascosto)");
    assert.ok(await c.page.isHidden("#cli-foglio"));
    await c.page.waitForFunction(()=>/Mario Rossi/.test(document.getElementById("vista-rapportino").textContent) ||
      [...document.querySelectorAll("#vista-rapportino input")].some(i=>i.value === "Mario Rossi"), null, { timeout: 10000 });
  });

  await prova("impianti: aggiunta con garanzia, lavori che citano la matricola, modifica, conflitto di versione", async()=>{
    await apriScheda(c.page, "Mario Rossi");
    await tab(c.page, "impianti");
    await c.page.waitForSelector("[data-sc-imp-nuovo]");
    assert.match(await testoPannello(c.page), /Nessun impianto/);
    await c.page.click("[data-sc-imp-nuovo]");
    await c.page.click("[data-sc-imp-salva]");
    assert.match(await c.page.textContent("#sc-imp-msg"), /Indica che impianto/);
    await c.page.fill("#sc-imp-nome", "Caldaia murale");
    await c.page.fill("#sc-imp-marca", "Vaillant");
    await c.page.fill("#sc-imp-modello", "ecoTEC");
    await c.page.fill("#sc-imp-matricola", "VX-123");
    await c.page.fill("#sc-imp-installato_il", "2024-03-01");
    await c.page.fill("#sc-imp-garanzia_fino", "2030-03-01");
    await c.page.click("[data-sc-imp-salva]");
    await c.page.waitForSelector("#sc-pannello .sc-impianto");
    const imp = [...DB.impianti.values()][0];
    assert.deepEqual([imp.cliente_id, imp.matricola, imp.garanzia_fino, imp.creato_da], [ID_ROSSI, "VX-123", "2030-03-01", UTENTI.company.id]);
    await c.page.waitForFunction(()=>/1 lavoro cita questo impianto/.test(document.getElementById("sc-pannello").textContent), null, { timeout: 10000 });
    assert.match(await testoPannello(c.page), /Garanzia fino al 01\/03\/2030/);
    await foto(c.page, "scheda-impianti");
    // modifica
    await c.page.click("[data-sc-imp-mod]");
    await c.page.fill("#sc-imp-posizione", "Locale caldaia");
    await c.page.click("[data-sc-imp-salva]");
    await attendiPannello(c.page, /Locale caldaia/);
    assert.equal(imp.versione, 2);
    // un altro utente lo modifica nel frattempo: la mia modifica non sovrascrive
    await c.page.click("[data-sc-imp-mod]");
    imp.versione = 5; imp.note = "dell'altro";
    await c.page.fill("#sc-imp-note", "mia");
    await c.page.click("[data-sc-imp-salva]");
    await c.page.waitForFunction(()=>/modificato da un altro utente/.test(document.getElementById("sc-imp-msg").textContent));
    assert.equal(imp.note, "dell'altro");
    await c.page.click("[data-sc-imp-annulla]");
    assert.equal(await c.page.locator("[data-sc-imp-del]").count(), 0, "company non elimina gli impianti");
  });

  await prova("documenti: carica un PDF, compare in elenco, si apre, si elimina; formato non ammesso rifiutato", async()=>{
    await tab(c.page, "documenti");
    await c.page.waitForSelector("[data-sc-doc-carica]");
    assert.match(await testoPannello(c.page), /Nessun documento/);
    await c.page.setInputFiles("#sc-doc-file", { name: "pagina.html", mimeType: "text/html", buffer: Buffer.from("<b>x</b>") });
    await c.page.waitForFunction(()=>/Formato non ammesso/.test(document.getElementById("sc-doc-msg").textContent));
    await c.page.fill("#sc-doc-nome", "Libretto impianto");
    await c.page.setInputFiles("#sc-doc-file", { name: "libretto.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 prova") });
    await c.page.waitForSelector("#sc-pannello .sc-doc", { timeout: 8000 }).catch(async e=>{ console.log("DEBUG", await c.page.textContent("#sc-doc-msg").catch(()=>"?"), DB.chiamate.slice(-6).join(" ; ")); throw e; });
    const d = [...DB.documenti.values()][0];
    assert.equal(d.nome, "Libretto impianto");
    assert.match(d.percorso, new RegExp("^" + ID_ROSSI + "/" + d.id + "\\.pdf$"));
    assert.ok(DB.file.has(d.percorso));
    assert.match(await testoPannello(c.page), /Libretto impianto.*Comphas/s);
    const [popup] = await Promise.all([c.page.waitForEvent("popup"), c.page.click("[data-sc-doc-apri]")]);
    // il file si scarica con la sessione e si apre nella nuova scheda (in Chromium senza interfaccia la
    // navigazione verso un PDF diventa un download e la scheda resta vuota: si controlla la lettura)
    for(let k = 0; k < 50 && !DB.chiamate.includes("GET /storage/v1/object/documenti-clienti/" + d.percorso); k++) await new Promise(r=>setTimeout(r, 100));
    assert.ok(DB.chiamate.includes("GET /storage/v1/object/documenti-clienti/" + d.percorso), "file letto dallo Storage");
    await popup.close().catch(()=>{});
    await c.page.click("[data-sc-doc-del]");
    await attendiPannello(c.page, /Nessun documento/);
    assert.equal(DB.documenti.size, 0);
    assert.equal(DB.file.size, 0, "file tolto dal bucket");
    await c.page.click("#cli-chiudi");
  });

  await prova("molti lavori: 30 alla volta, «Mostra altri»", async()=>{
    for(let k = 0; k < 35; k++) R("r1000000-0000-4000-8000-0000000000" + String(k).padStart(2, "0"), "2024-0" + (1 + k % 9) + "-1" + (k % 9), { attivita: "Lavoro numero " + k });
    await apriScheda(c.page, "Mario Rossi");
    await tab(c.page, "lavori");
    await c.page.waitForSelector("#sc-pannello .sc-voce");
    assert.equal(await c.page.locator("#sc-pannello .sc-voce").count(), 30);
    await c.page.click("[data-sc-altri]");
    assert.equal(await c.page.locator("#sc-pannello .sc-voce").count(), 40);
    assert.equal(await c.page.locator("[data-sc-altri]").count(), 0);
  });

  await prova("offline: dati della scheda consultabili; lavori, impianti e documenti con messaggio chiaro", async()=>{
    await c.page.click("#cli-chiudi");
    await c.ctx.setOffline(true);
    await apriScheda(c.page, "Mario Rossi");
    assert.match(await testoPannello(c.page), /Via Roma 1, Milano/);
    await tab(c.page, "lavori");
    await attendiPannello(c.page, /Senza rete/);
    await tab(c.page, "impianti");
    await attendiPannello(c.page, /Serve la connessione/);
    await tab(c.page, "documenti");
    await attendiPannello(c.page, /Serve la connessione/);
    await c.ctx.setOffline(false);
    await c.page.click("[data-sc-riprova]");
    await attendiPannello(c.page, /Nessun documento/);
    await c.page.click("#cli-chiudi");
  });
  assert.deepEqual(c.errori, [], c.errori.join("; "));
  esterne.push(...c.esterne);
  await c.ctx.close();

  // ======================= operaio
  const w = await apri(browser, base, "worker");
  await prova("operaio: consulta la scheda, rapportino rapido, aggiunge impianti, elimina solo i propri documenti", async()=>{
    await apriScheda(w.page, "Mario Rossi");
    assert.equal(await w.page.locator('.sc-rapide [data-az="rapportino"]').count(), 1);
    assert.equal(await w.page.locator('.sc-rapide [data-az="intervento"]').count(), 0);
    assert.equal(await w.page.locator('#cli-azioni [data-az="modifica"]').count(), 0);
    await tab(w.page, "impianti");
    await w.page.waitForSelector("#sc-pannello .sc-impianto");
    assert.equal(await w.page.locator("[data-sc-imp-mod]").count(), 0, "impianto di un altro: non modificabile");
    await w.page.click("[data-sc-imp-nuovo]");
    await w.page.fill("#sc-imp-nome", "Condizionatore");
    await w.page.click("[data-sc-imp-salva]");
    await w.page.waitForFunction(()=>document.querySelectorAll("#sc-pannello .sc-impianto").length === 2);
    assert.equal(await w.page.locator("[data-sc-imp-mod]").count(), 1, "il proprio impianto si corregge");
    // documento di un altro: senza pulsante elimina
    DB.file.set(ID_ROSSI + "/d0000000-0000-4000-8000-000000000001.pdf", { dati: Buffer.from("x"), owner: A });
    DB.documenti.set("d0000000-0000-4000-8000-000000000001", { id: "d0000000-0000-4000-8000-000000000001", cliente_id: ID_ROSSI, nome: "Contratto", percorso: ID_ROSSI + "/d0000000-0000-4000-8000-000000000001.pdf",
      mime: "application/pdf", dimensione: 1, caricato_da: A, creato_il: "2026-11-01T10:00:00Z" });
    await tab(w.page, "documenti");
    await w.page.waitForSelector("#sc-pannello .sc-doc");
    assert.equal(await w.page.locator("[data-sc-doc-del]").count(), 0);
    await w.page.click("#cli-chiudi");
    await apriScheda(w.page, "Mario Rossi");
    await w.page.click('.sc-rapide [data-az="rapportino"]');
    await w.page.waitForSelector("#vista-rapportino:not(.nascosto)");
    await w.page.waitForFunction(()=>[...document.querySelectorAll("#vista-rapportino input")].some(i=>i.value === "Mario Rossi"));
  });
  assert.deepEqual(w.errori, [], w.errori.join("; "));
  esterne.push(...w.esterne);
  await w.ctx.close();

  // ======================= database non ancora aggiornato (migrazione non applicata)
  DB.estesa = false; DB.senzaTabelle = true;
  const a = await apri(browser, base, "admin");
  await prova("database senza la migrazione: scheda e salvataggio come prima, campi nuovi nascosti, impianti/documenti non attivi", async()=>{
    await a.page.evaluate(()=>window.mostraVista("cerca"));
    await a.page.waitForFunction(()=>document.querySelectorAll("#anag-elenco .cli-riga").length >= 3, null, { timeout: 15000 });
    await a.page.click("#anag-nuovo");
    await a.page.waitForSelector("#cli-form");
    assert.equal(await a.page.locator("#cli-tipologia").count(), 0);
    assert.equal(await a.page.locator("#cli-sedi").count(), 0);
    assert.match(await a.page.textContent("#cli-form"), /dopo l'aggiornamento del database/);
    await a.page.fill("#cli-nome", "Cliente Vecchio Server");
    await a.page.fill("#cli-partita_iva", "01234567890");
    await a.page.click("#cli-salva");
    await a.page.waitForSelector("#cli-foglio .sc-tab");
    await a.page.waitForFunction(()=>[...document.querySelectorAll("#cli-corpo .msg-info")].every(m=>!/Salvato sul telefono/.test(m.textContent)), null, { timeout: 10000 })
      .catch(async e=>{ console.log("DEBUG", await a.page.textContent("#cli-corpo"), DB.chiamate.filter(x=>/salva_cliente|clienti/.test(x)).slice(-5)); throw e; });
    const x = [...DB.clienti.values()].find(k=>k.nome === "Cliente Vecchio Server");
    assert.equal(x.partita_iva, "01234567890");
    await tab(a.page, "impianti");
    await attendiPannello(a.page, /non ancora attiva sul server/);
    await tab(a.page, "documenti");
    await attendiPannello(a.page, /non ancora attiva sul server/);
    await tab(a.page, "lavori");
    await a.page.waitForSelector("#sc-pannello .card");
  });
  assert.deepEqual(a.errori, [], a.errori.join("; "));
  esterne.push(...a.esterne);
  await a.ctx.close();

  await prova("nessuna richiesta verso servizi esterni reali", async()=>{
    assert.equal(esterne.filter(u=>/supabase|groq/.test(u)).length, 0, esterne.join(", "));
  });
}finally{
  await browser.close();
  srv.close();
}
const falliti = risultati.filter(r=>r[0] !== "ok");
console.log("\n" + (risultati.length - falliti.length) + "/" + risultati.length + " test superati");
process.exit(falliti.length ? 1 : 0);
