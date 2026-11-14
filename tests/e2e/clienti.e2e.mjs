// Test end-to-end dell'anagrafica clienti nell'app (Playwright, Chromium), SENZA il server vero:
// un finto Supabase in memoria (clienti, interventi, rapportini) con le stesse regole della migrazione
// 20261116090000 (salva_cliente idempotente e con versione, permessi per ruolo, eliminazione bloccata
// con documenti collegati). Ogni altra richiesta esterna e' bloccata.
// Esecuzione: node tests/e2e/clienti.e2e.mjs
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

// ---------------------------------------------------------------- finto Supabase (un solo "database" per tutti gli utenti)
const UTENTI = {
  admin:   { id: "b0000000-0000-4000-8000-000000000001", username: "luca", nome: "Luca", cognome: "", ruolo: "admin", ruoli: ["admin", "worker"] },
  worker:  { id: "b0000000-0000-4000-8000-000000000002", username: "mario", nome: "Mario", cognome: "Bianchi", ruolo: "worker", ruoli: ["worker"] },
  company: { id: "b0000000-0000-4000-8000-000000000004", username: "comphas", nome: "Comphas", cognome: "", ruolo: "company", ruoli: ["company"] },
};
const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";
const uuid = ()=>crypto.randomUUID();
const DB = {
  clienti: new Map(), interventi: new Map(), rapportini: new Map(),
  chiamateSalvaCliente: [], salvaRapportino: [], scrittureInterventi: [],
  colonneMancanti: false,            // simula il database prima della migrazione
  rispostaPersa: 0,                  // salva le prossime N creazioni di clienti ma risponde con errore 500
};
const CAMPI = ["nome", "indirizzo", "telefono", "email", "partita_iva", "note", "archiviato"];
function salvaCliente(u, p, versione){
  if(versione == null){
    if(DB.clienti.has(p.id)) return { esito: "conflitto", cliente: DB.clienti.get(p.id) };
    const c = { id: p.id || uuid(), versione: 1, creato_da: u.id, archiviato: false };
    CAMPI.forEach(k=>{ if(k !== "archiviato") c[k] = p[k] || ""; });
    DB.clienti.set(c.id, c);
    return { esito: "ok", cliente: c };
  }
  if(!["admin", "company"].includes(u.ruolo)) return { errore: { code: "42501", message: "Solo amministratore e company possono modificare l'anagrafica" } };
  const c = DB.clienti.get(p.id);
  if(c && c.versione === versione){
    CAMPI.forEach(k=>{ if(p[k] !== undefined) c[k] = p[k]; });
    c.versione++;
    return { esito: "ok", cliente: c };
  }
  if(!c) return { errore: { code: "42501", message: "Cliente non trovato" } };
  return { esito: "conflitto", cliente: c };
}
const conInterventi = i=>({ ...i, intervento_operai: [], rapportini: [] });

function nuovoSupabase(ruolo){
  const u = UTENTI[ruolo];
  const json = (route, corpo, status = 200)=>route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range" }, body: JSON.stringify(corpo) });
  const oggetto = req=>/vnd\.pgrst\.object/.test(req.headers()["accept"] || "");
  const filtroId = url=>(url.searchParams.get("id") || "").replace(/^eq\./, "");
  return async function gestisci(route){
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname;
    if(m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const corpo = ()=>JSON.parse(req.postData() || "null");
    if(p === "/functions/v1/accesso") return json(route, { sessione: { access_token: jwt(u.id), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: u.id, aud: "authenticated", role: "authenticated" } } });
    if(p === "/auth/v1/user") return json(route, { id: u.id, aud: "authenticated", role: "authenticated" });
    if(p.startsWith("/auth/v1/")) return json(route, {});
    if(p.startsWith("/functions/v1/")) return json(route, { ok: true });
    if(p.startsWith("/storage/")) return json(route, { error: "x" }, 503);
    if(p === "/rest/v1/profili"){ const prof = { ...u, attivo: true, deve_cambiare_password: false }; return json(route, oggetto(req) ? prof : [prof]); }
    if(p === "/rest/v1/rpc/operai_attivi" || p === "/rest/v1/rpc/nomi_utenti") return json(route, [{ id: UTENTI.worker.id, username: "mario", nome: "Mario Bianchi", attivo: true }]);
    if(p === "/rest/v1/rpc/salva_cliente"){
      const b = corpo();
      DB.chiamateSalvaCliente.push({ ruolo, ...b });
      const r = salvaCliente(u, b.p_cliente, b.p_versione);
      if(r.errore) return json(route, r.errore, 403);
      if(DB.rispostaPersa > 0 && b.p_versione == null){ DB.rispostaPersa--; return json(route, { message: "risposta persa" }, 500); }
      return json(route, r);
    }
    if(p === "/rest/v1/rpc/salva_rapportino"){
      const b = corpo(); DB.salvaRapportino.push(b);
      const r = { ...b.p_rapportino, versione: 1, stato: "bozza", autore_id: u.id, aggiornato_il: new Date().toISOString(), rapportino_operai: b.p_ore };
      if(r.cliente_id && !DB.clienti.has(r.cliente_id)) r.cliente_id = null;      // come il trigger del database
      DB.rapportini.set(r.id, r);
      return json(route, { esito: "ok", rapportino: r });
    }
    if(p.startsWith("/rest/v1/rpc/")) return json(route, null);
    if(p === "/rest/v1/clienti"){
      if(m === "GET") return json(route, [...DB.clienti.values()].sort((a, b)=>a.nome.localeCompare(b.nome)));
      if(m === "DELETE"){
        const id = filtroId(url);
        if(u.ruolo !== "admin") return json(route, [], 200);
        if([...DB.interventi.values(), ...DB.rapportini.values()].some(d=>d.cliente_id === id)) return json(route, { code: "23503", message: "violates foreign key constraint" }, 409);
        DB.clienti.delete(id); return json(route, [], 200);
      }
    }
    if(p === "/rest/v1/interventi"){
      const sel = url.searchParams.get("select") || "";
      if(m === "GET"){
        if(DB.colonneMancanti && /cliente_id|telefono/.test(sel)) return json(route, { code: "42703", message: "column interventi.cliente_id does not exist" }, 400);
        const id = filtroId(url);
        const elenco = [...DB.interventi.values()].filter(i=>!id || i.id === id).map(conInterventi);
        return json(route, oggetto(req) ? (elenco[0] || null) : elenco);
      }
      const b = corpo();
      if(DB.colonneMancanti && ("telefono" in b || "cliente_id" in b)) return json(route, { code: "PGRST204", message: "Could not find the 'cliente_id' column" }, 400);
      DB.scrittureInterventi.push({ m, ...b });
      if(m === "POST"){ const i = { id: uuid(), stato: "pianificato", ...b }; if(i.cliente_id && !DB.clienti.has(i.cliente_id)) i.cliente_id = null; DB.interventi.set(i.id, i); return json(route, oggetto(req) ? { id: i.id } : [{ id: i.id }], 201); }
      if(m === "PATCH"){ const i = DB.interventi.get(filtroId(url)); Object.assign(i, b); return json(route, oggetto(req) ? { id: i.id } : [{ id: i.id }]); }
    }
    if(p === "/rest/v1/rapportini" && m === "GET"){
      const sel = url.searchParams.get("select") || "";
      if(DB.colonneMancanti && /cliente_id|telefono/.test(sel)) return json(route, { code: "42703", message: "column rapportini.cliente_id does not exist" }, 400);
      const id = filtroId(url);
      const elenco = [...DB.rapportini.values()].filter(r=>!id || r.id === id).map(r=>({ ...r, rapportino_operai: r.rapportino_operai || [], interventi: null }));
      return json(route, oggetto(req) ? (elenco[0] || null) : elenco);
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
async function nuovoClienteDaVista(page, dati){
  await page.click("#anag-nuovo");
  await page.waitForSelector("#cli-form");
  for(const [k, v] of Object.entries(dati)) await page.fill("#cli-" + k, v);
  await page.click("#cli-salva");
  await page.waitForFunction(()=>!document.getElementById("cli-form"));
  await page.click("#cli-chiudi");
}
const rigaElenco = page=>page.$$eval("#anag-elenco .cli-riga", rr=>rr.map(r=>[r.querySelector(".cli-nome").textContent, r.querySelector(".cli-ind").textContent]));
const voci = (page, box)=>page.$$eval(box + " .cs-voce", vv=>vv.map(v=>v.textContent.trim()));

// ---------------------------------------------------------------- test
const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
const esterne = [];
try{
  // ======================= company: anagrafica
  const c = await apri(browser, base, "company");
  await c.page.evaluate(()=>window.mostraVista("cerca"));
  await c.page.waitForSelector("#vista-cerca:not(.nascosto)");

  await prova("1. clienti con nomi diversi", async()=>{
    await nuovoClienteDaVista(c.page, { nome: "Bianchi Srl", indirizzo: "Via Po 1, Torino", telefono: "011 555", email: "info@bianchi.it", partita_iva: "01234567890", note: "Cancello blu" });
    await nuovoClienteDaVista(c.page, { nome: "Verdi Luca", indirizzo: "Piazza Duomo 2, Milano" });
    await c.page.waitForFunction(()=>document.querySelectorAll("#anag-elenco .cli-riga").length === 2);
    assert.equal(DB.clienti.size, 2);
    const bianchi = [...DB.clienti.values()].find(x=>x.nome === "Bianchi Srl");
    assert.equal(bianchi.partita_iva, "01234567890");
    assert.equal(bianchi.note, "Cancello blu");
  });

  await prova("2-3. tre 'Mario Rossi' (due con lo stesso indirizzo): tre schede distinte, mai sovrascritte", async()=>{
    await nuovoClienteDaVista(c.page, { nome: "Mario Rossi", indirizzo: "Via Roma 10, Milano", telefono: "3331234567" });
    await nuovoClienteDaVista(c.page, { nome: "Mario Rossi", indirizzo: "Via Verdi 25, Monza", telefono: "3339999999" });
    await c.page.click("#anag-nuovo");
    await c.page.fill("#cli-nome", "Mario Rossi");
    await c.page.waitForSelector("#cli-omonimi:not(.nascosto)");
    assert.match(await c.page.textContent("#cli-omonimi"), /Esistono già 2 clienti.*Via Roma 10.*Via Verdi 25.*comunque/);
    await c.page.fill("#cli-indirizzo", "Via Verdi 25, Monza");
    await c.page.click("#cli-salva");
    await c.page.waitForFunction(()=>!document.getElementById("cli-form"));
    await c.page.click("#cli-chiudi");
    const rossi = [...DB.clienti.values()].filter(x=>x.nome === "Mario Rossi");
    assert.equal(rossi.length, 3);
    assert.equal(new Set(rossi.map(x=>x.id)).size, 3);
    assert.deepEqual(rossi.map(x=>x.telefono).sort(), ["", "3331234567", "3339999999"]);
  });

  await prova("4. ricerca: tutti gli omonimi con nome e indirizzo; ogni scheda si apre per id", async()=>{
    await c.page.fill("#cerca-input", "mario rossi");
    await c.page.waitForFunction(()=>document.querySelectorAll("#anag-elenco .cli-riga").length === 3);
    assert.match(await c.page.textContent("#anag-elenco .elenco-nota"), /3 con lo stesso nome/);
    const righe = await rigaElenco(c.page);
    assert.deepEqual(righe.map(r=>r[1].trim()).sort(), ["Via Roma 10, Milano", "Via Verdi 25, Monza", "Via Verdi 25, Monza"]);
    await foto(c.page, "c1-omonimi");
    const ids = await c.page.$$eval("#anag-elenco .cli-riga", rr=>rr.map(r=>r.dataset.cliente));
    for(const id of ids){
      await c.page.click('[data-cliente="' + id + '"]');
      await c.page.waitForSelector("#cli-foglio:not(.nascosto) .cli-id");
      assert.match(await c.page.textContent(".cli-id"), new RegExp(id));
      await c.page.click("#cli-chiudi");
    }
    // company: modifica e archivia si', elimina no
    await c.page.click('[data-cliente="' + ids[0] + '"]');
    await c.page.waitForSelector('#cli-foglio:not(.nascosto) #cli-azioni [data-az="modifica"]');
    assert.equal(await c.page.$('#cli-azioni [data-az="elimina"]'), null);
    await c.page.click("#cli-chiudi");
    await c.page.fill("#cerca-input", "");
  });

  await prova("6-7. intervento: autocompletamento, nessuna scelta automatica, telefono salvato e riaperto", async()=>{
    await c.page.evaluate(()=>window.mostraVista("interventi"));
    await c.page.evaluate(()=>window.apriModuloIntervento());
    await c.page.waitForSelector("#int-form:not(.nascosto)");
    assert.ok(await c.page.isVisible("#int-telefono"));
    await c.page.fill("#int-data", "2026-12-01");
    await c.page.fill("#int-cliente", "Mario Ro");
    await c.page.waitForSelector("#int-cliente-suggerimenti:not(.nascosto) .cs-voce");
    const v = await voci(c.page, "#int-cliente-suggerimenti");
    assert.equal(v.filter(t=>t.startsWith("Mario Rossi")).length, 3);
    assert.ok(v.some(t=>/Via Roma 10, Milano/.test(t)) && v.filter(t=>/Via Verdi 25, Monza/.test(t)).length === 2);
    assert.equal(await c.page.inputValue("#int-indirizzo"), "", "nessuna compilazione automatica");
    await c.page.fill("#int-cliente", "Mario Rossi");
    await c.page.waitForSelector("#int-cliente-suggerimenti .cs-avviso");
    assert.match(await c.page.textContent("#int-cliente-suggerimenti .cs-avviso"), /3 clienti si chiamano/);
    await foto(c.page, "c2-intervento-omonimi");
    const monza = [...DB.clienti.values()].find(x=>x.telefono === "3339999999");
    await c.page.click('#int-cliente-suggerimenti .cs-voce:has-text("3339999999")');
    assert.equal(await c.page.inputValue("#int-indirizzo"), "Via Verdi 25, Monza");
    assert.equal(await c.page.inputValue("#int-telefono"), "3339999999");
    assert.match(await c.page.textContent("#int-form .cs-stato"), /In anagrafica: Mario Rossi — Via Verdi 25, Monza/);
    // modifica manuale per questo intervento soltanto
    await c.page.fill("#int-telefono", "3330001111");
    const prima = DB.chiamateSalvaCliente.length;
    await c.page.click("#int-salva");
    await c.page.waitForFunction(()=>document.getElementById("int-form").classList.contains("nascosto"));
    const scritto = DB.scrittureInterventi.at(-1);
    assert.equal(scritto.m, "POST");
    assert.equal(scritto.cliente_id, monza.id);
    assert.equal(scritto.telefono, "3330001111");
    assert.equal(DB.clienti.get(monza.id).telefono, "3339999999", "8. l'anagrafica non cambia");
    assert.equal(DB.chiamateSalvaCliente.length, prima);
    // riapertura: il telefono dell'intervento resta quello salvato
    const id = [...DB.interventi.values()].at(-1).id;
    await c.page.evaluate(id=>window.apriModuloIntervento(id), id);
    await c.page.waitForSelector("#int-form:not(.nascosto)");
    assert.equal(await c.page.inputValue("#int-telefono"), "3330001111");
    assert.match(await c.page.textContent("#int-form .cs-stato"), /In anagrafica/);
    await c.page.fill("#int-telefono", "02 777");
    await c.page.click("#int-salva");
    await c.page.waitForFunction(()=>document.getElementById("int-form").classList.contains("nascosto"));
    assert.equal(DB.scrittureInterventi.at(-1).m, "PATCH");
    assert.equal(DB.interventi.get(id).telefono, "02 777");
  });

  await prova("9. modifica dell'anagrafica: l'intervento salvato non cambia", async()=>{
    const monza = [...DB.clienti.values()].find(x=>x.telefono === "3339999999");
    await c.page.evaluate(()=>window.mostraVista("cerca"));
    await c.page.click('[data-cliente="' + monza.id + '"]');
    await c.page.click('#cli-azioni [data-az="modifica"]');
    await c.page.fill("#cli-telefono", "3400000000");
    const scritture = DB.scrittureInterventi.length;
    await c.page.click("#cli-salva");
    await c.page.waitForFunction(()=>!document.getElementById("cli-form"));
    await c.page.waitForFunction(id=>true, monza.id);
    await c.page.waitForTimeout(300);
    assert.equal(DB.clienti.get(monza.id).telefono, "3400000000");
    assert.equal(DB.clienti.get(monza.id).versione, 2);
    assert.equal(DB.scrittureInterventi.length, scritture, "nessuna scrittura sui documenti");
    assert.equal([...DB.interventi.values()].find(i=>i.cliente_id === monza.id).telefono, "02 777");
    await c.page.click("#cli-chiudi");
  });
  esterne.push(...c.esterne);
  assert.deepEqual(c.errori, [], c.errori.join("; "));
  await c.ctx.close();

  // ======================= operaio: rapportino, offline, permessi
  const w = await apri(browser, base, "worker");
  const pw = w.page;
  await prova("11. operaio: consulta e crea, non modifica/archivia/importa", async()=>{
    await pw.evaluate(()=>window.mostraVista("cerca"));
    await pw.waitForSelector("#anag-elenco .cli-riga");
    assert.ok(await pw.isVisible("#anag-nuovo"));
    assert.ok(await pw.$eval("#anag-importa", el=>el.classList.contains("vietato")));
    await pw.click("#anag-elenco .cli-riga");
    await pw.waitForSelector("#cli-foglio:not(.nascosto) .cli-id");
    assert.equal(await pw.$('#cli-azioni [data-az="modifica"]'), null);
    assert.equal(await pw.$('#cli-azioni [data-az="archivia"]'), null);
    assert.ok(await pw.isVisible('#cli-azioni [data-az="rapportino"]'));
    await pw.click("#cli-chiudi");
  });

  await prova("5. rapportino: suggerimenti con indirizzo, scelta esplicita tra omonimi, copia e id nel salvataggio", async()=>{
    await pw.evaluate(()=>window.nuovoRapportinoAutonomo());
    await pw.waitForSelector("#vista-rapportino:not(.nascosto)");
    await pw.fill("#rf-cliente", "mario");
    await pw.waitForSelector("#rf-cliente-suggerimenti:not(.nascosto) .cs-voce");
    const v = await voci(pw, "#rf-cliente-suggerimenti");
    assert.equal(v.filter(t=>t.startsWith("Mario Rossi")).length, 3);
    assert.ok(v.some(t=>/senza anagrafica/.test(t)) && v.some(t=>/Nuovo cliente/.test(t)));
    assert.equal(await pw.inputValue("#rf-indirizzo"), "");
    await foto(pw, "w1-rapportino-suggerimenti");
    const milano = [...DB.clienti.values()].find(x=>x.indirizzo === "Via Roma 10, Milano");
    await pw.click('#rf-cliente-suggerimenti .cs-voce:has-text("Via Roma 10, Milano")');
    assert.equal(await pw.inputValue("#rf-cliente"), "Mario Rossi");
    assert.equal(await pw.inputValue("#rf-indirizzo"), "Via Roma 10, Milano");
    assert.equal(await pw.inputValue("#rf-telefono"), "3331234567");
    await pw.fill("#rf-telefono", "3331234567 (portineria)");            // 8. solo per questo documento
    await pw.fill("#rf-attivita", "Controllo impianto");
    await pw.click("#rf-salva");
    await pw.waitForFunction(()=>/salvata/i.test(document.getElementById("rap-msg").textContent), null, { timeout: 10000 });
    const r = DB.salvaRapportino.at(-1).p_rapportino;
    assert.equal(r.cliente_id, milano.id);
    assert.equal(r.cliente, "Mario Rossi");
    assert.equal(r.indirizzo, "Via Roma 10, Milano");
    assert.equal(r.telefono, "3331234567 (portineria)");
    assert.equal(DB.clienti.get(milano.id).telefono, "3331234567", "l'anagrafica non cambia");
    // scrivere un altro nome scollega il documento dalla scheda
    await pw.fill("#rf-cliente", "Mario Rossini");
    assert.match(await pw.textContent("#rap-form .cs-stato"), /non in anagrafica/);
    await pw.fill("#rf-cliente", "Mario Rossi");
  });

  await prova("5b. cliente non in anagrafica e creazione al volo senza lasciare il rapportino", async()=>{
    await pw.evaluate(()=>window.nuovoRapportinoAutonomo());
    await pw.fill("#rf-cliente", "Neri Paolo");
    await pw.waitForSelector('#rf-cliente-suggerimenti .cs-voce:has-text("senza anagrafica")');
    await pw.click('#rf-cliente-suggerimenti .cs-voce:has-text("senza anagrafica")');
    assert.match(await pw.textContent("#rap-form .cs-stato"), /Cliente non in anagrafica/);
    await pw.fill("#rf-indirizzo", "Via Nuova 5");
    await pw.click('#rap-form .cs-stato [data-az="crea"]');
    await pw.waitForSelector("#cli-form");
    assert.equal(await pw.inputValue("#cli-nome"), "Neri Paolo");
    assert.equal(await pw.inputValue("#cli-indirizzo"), "Via Nuova 5");
    await pw.fill("#cli-telefono", "347 1112223");
    await pw.click("#cli-salva");
    await pw.waitForFunction(()=>document.getElementById("cli-foglio").classList.contains("nascosto"));
    assert.ok(await pw.isVisible("#vista-rapportino:not(.nascosto)"), "resta nel rapportino");
    assert.equal(await pw.inputValue("#rf-telefono"), "347 1112223");
    assert.match(await pw.textContent("#rap-form .cs-stato"), /In anagrafica: Neri Paolo — Via Nuova 5/);
    await pw.waitForFunction(()=>true);
    const neri = [...DB.clienti.values()].find(x=>x.nome === "Neri Paolo");
    assert.ok(neri, "scheda creata dall'operaio");
  });

  await prova("10. offline: nuova scheda e rapportino sul telefono; al ritorno della rete un solo invio, nessun doppione", async()=>{
    await w.ctx.setOffline(true);
    const chiamate = DB.chiamateSalvaCliente.length, clienti = DB.clienti.size;
    await pw.evaluate(()=>window.mostraVista("cerca"));
    await nuovoClienteDaVista(pw, { nome: "Gialli Anna", indirizzo: "Strada Offline 1", telefono: "0" + "123456" });
    await pw.waitForSelector('#anag-elenco .cli-riga:has-text("Gialli Anna") .badge');
    assert.match(await pw.textContent('#anag-elenco .cli-riga:has-text("Gialli Anna")'), /Da inviare/);
    assert.equal(DB.chiamateSalvaCliente.length, chiamate, "offline: nessuna richiesta");
    // rapportino offline con il cliente appena creato (dalla copia locale)
    await pw.evaluate(()=>window.nuovoRapportinoAutonomo());
    await pw.fill("#rf-cliente", "Gialli");
    await pw.waitForSelector('#rf-cliente-suggerimenti .cs-voce:has-text("Strada Offline 1")');
    await pw.click('#rf-cliente-suggerimenti .cs-voce:has-text("Strada Offline 1")');
    assert.equal(await pw.inputValue("#rf-indirizzo"), "Strada Offline 1");
    const idRap = await pw.evaluate(()=>import("./js/modules/modulo-rapportino.js").then(m=>m.statoRapportinoAperto().id));
    await pw.fill("#rf-attivita", "Lavoro offline");
    await pw.waitForTimeout(600);
    // la prima creazione arriva al server ma la risposta si perde: il reinvio non deve duplicare
    DB.rispostaPersa = 1;
    await w.ctx.setOffline(false);
    await pw.evaluate(()=>import("./js/services/clienti-archivio.js").then(m=>m.sincronizzaClienti()));
    await pw.evaluate(()=>import("./js/services/clienti-archivio.js").then(m=>m.sincronizzaClienti()));
    const gialli = [...DB.clienti.values()].filter(x=>x.nome === "Gialli Anna");
    assert.equal(gialli.length, 1, "nessun doppione");
    assert.equal(DB.clienti.size, clienti + 1);
    const invii = DB.chiamateSalvaCliente.slice(chiamate).filter(x=>x.p_cliente.nome === "Gialli Anna");
    assert.ok(invii.length >= 2 && new Set(invii.map(x=>x.p_cliente.id)).size === 1, "stesso id a ogni tentativo");
    const coda = await pw.evaluate(()=>import("./js/services/clienti-archivio.js").then(m=>m.elencoClienti()).then(l=>l.filter(c=>c._stato).length));
    assert.equal(coda, 0, "coda vuota dopo la sincronizzazione");
    // il rapportino offline parte con il collegamento alla scheda
    await pw.click("#rf-salva");
    await pw.waitForFunction(id=>true, idRap);
    await pw.waitForFunction(()=>/salvata/i.test(document.getElementById("rap-msg").textContent), null, { timeout: 10000 });
    const r = DB.salvaRapportino.find(x=>x.p_rapportino.id === idRap).p_rapportino;
    assert.equal(r.cliente_id, gialli[0].id);
  });
  esterne.push(...w.esterne);
  assert.deepEqual(w.errori, [], w.errori.join("; "));
  await w.ctx.close();

  // ======================= admin: eliminazione e compatibilita'
  const a = await apri(browser, base, "admin");
  await prova("eliminazione: con documenti collegati no (archiviare), senza documenti si'", async()=>{
    await a.page.evaluate(()=>window.mostraVista("cerca"));
    const milano = [...DB.clienti.values()].find(x=>x.indirizzo === "Via Roma 10, Milano");
    await a.page.click('[data-cliente="' + milano.id + '"]');
    await a.page.click('#cli-azioni [data-az="elimina"]');
    await a.page.waitForSelector("#cli-msg.err");
    assert.match(await a.page.textContent("#cli-msg"), /archivialo/);
    assert.ok(DB.clienti.has(milano.id));
    await a.page.click('#cli-azioni [data-az="archivia"]');
    await a.page.waitForFunction(()=>/archiviato/i.test(document.getElementById("cli-corpo").textContent));
    assert.equal(DB.clienti.get(milano.id).archiviato, true);
    await a.page.click("#cli-chiudi");
    const verdi = [...DB.clienti.values()].find(x=>x.nome === "Verdi Luca");
    await a.page.click('[data-cliente="' + verdi.id + '"]');
    await a.page.click('#cli-azioni [data-az="elimina"]');
    await a.page.waitForFunction(()=>document.getElementById("cli-foglio").classList.contains("nascosto"));
    assert.ok(!DB.clienti.has(verdi.id));
    // archiviato: fuori dai suggerimenti
    await a.page.evaluate(()=>window.nuovoRapportinoAutonomo());
    await a.page.fill("#rf-cliente", "Mario Rossi");
    await a.page.waitForSelector("#rf-cliente-suggerimenti .cs-voce");
    assert.equal((await voci(a.page, "#rf-cliente-suggerimenti")).filter(t=>/Via Roma 10/.test(t)).length, 0);
  });

  await prova("10b. conflitto: stesso campo cambiato offline e da un altro utente -> scelta esplicita, niente perso", async()=>{
    const neri = [...DB.clienti.values()].find(x=>x.nome === "Neri Paolo");
    await a.page.evaluate(()=>window.mostraVista("cerca"));
    await a.page.waitForSelector('[data-cliente="' + neri.id + '"]');
    await a.ctx.setOffline(true);
    await a.page.click('[data-cliente="' + neri.id + '"]');
    await a.page.click('#cli-azioni [data-az="modifica"]');
    await a.page.fill("#cli-telefono", "031111");
    await a.page.fill("#cli-email", "neri@esempio.it");
    await a.page.click("#cli-salva");
    await a.page.waitForFunction(()=>!document.getElementById("cli-form"));
    // nel frattempo un altro utente cambia lo stesso telefono sul server
    neri.telefono = "031222"; neri.versione++;
    await a.ctx.setOffline(false);
    await a.page.evaluate(()=>import("./js/services/clienti-archivio.js").then(m=>m.sincronizzaClienti()));
    assert.equal(neri.telefono, "031222", "il server non viene sovrascritto alla cieca");
    await a.page.click("#cli-chiudi");
    await a.page.click('[data-cliente="' + neri.id + '"]');
    await a.page.waitForSelector("#cli-corpo .conf-box");
    const t = await a.page.textContent("#cli-corpo .conf-box");
    assert.match(t, /Telefono.*031111.*031222/);
    await foto(a.page, "a1-conflitto");
    await a.page.click('[data-conf="mia"]');
    await a.page.waitForFunction(id=>true, neri.id);
    await a.page.waitForTimeout(500);
    assert.equal(neri.telefono, "031111");
    assert.equal(neri.email, "neri@esempio.it");
    await a.page.click("#cli-chiudi");
  });

  await prova("12. compatibilita': rapportino di prima senza cliente_id/telefono; database senza le colonne nuove", async()=>{
    const id = uuid();
    DB.rapportini.set(id, { id, autore_id: UTENTI.admin.id, data: "2026-09-01", cliente: "Vecchio Cliente", indirizzo: "Via Antica 1", tipologia: "", attivita: "x",
      materiali: [], note: "", esito: "Completato", firma: "", firmatario: "", stato: "bozza", versione: 3, aggiornato_il: "2026-09-01T10:00:00Z" });
    await a.page.evaluate(id=>window.apriRapportino(id), id);
    await a.page.waitForFunction(()=>document.getElementById("rf-cliente").value === "Vecchio Cliente");
    assert.equal(await a.page.inputValue("#rf-telefono"), "");
    assert.match(await a.page.textContent("#rap-form .cs-stato"), /non in anagrafica/);
    // database prima della migrazione: le letture e le scritture riprovano senza i campi nuovi
    DB.colonneMancanti = true;
    await a.page.evaluate(()=>window.mostraVista("interventi"));
    await a.page.waitForFunction(()=>!/Caricamento/.test(document.getElementById("int-stato").textContent));
    assert.doesNotMatch(await a.page.textContent("#int-stato"), /column|errore/i);
    await a.page.evaluate(()=>window.apriModuloIntervento());
    await a.page.fill("#int-data", "2026-12-02");
    await a.page.fill("#int-cliente", "Cliente qualunque");
    await a.page.click("#int-salva");
    await a.page.waitForFunction(()=>document.getElementById("int-form").classList.contains("nascosto"));
    const ultimo = DB.scrittureInterventi.at(-1);
    assert.ok(!("telefono" in ultimo) && ultimo.cliente === "Cliente qualunque");
    DB.colonneMancanti = false;
  });
  esterne.push(...a.esterne);
  assert.deepEqual(a.errori, [], a.errori.join("; "));
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
