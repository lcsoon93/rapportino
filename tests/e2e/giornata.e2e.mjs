// Test end-to-end di "La mia giornata" (Playwright, Chromium) con un finto Supabase in memoria:
// dashboard, imprevisto autonomo, modalità Veloce/Completo sulla stessa bozza, follow-up "Da ultimare"
// (rimandato, annullato, programmato una sola volta), bozza offline recuperata, date locali, conteggi.
// Orologio fisso: 00:30 ora italiana (in UTC è ancora il giorno prima). Esecuzione: node tests/e2e/giornata.e2e.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RADICE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TIPI = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const OGGI = "2026-11-24", DOMANI = "2026-11-25";

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

const ADMIN = { id: "b0000000-0000-4000-8000-000000000001", username: "luca", nome: "Luca", cognome: "", ruolo: "admin", ruoli: ["admin", "worker"] };
const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 }) + ".x";
const DB = { interventi: new Map(), rapportini: new Map(), salvaRapportino: [] };
DB.interventi.set("i-oggi", { id: "i-oggi", data: OGGI, ora: "09:00:00", cliente: "Rossi Spa", indirizzo: "Via Roma 1", descrizione: "Caldaia",
  priorita: "normale", tipologia: "", stato: "pianificato" });
const nidificato = i=>({ ...i, intervento_operai: i.id === "i-oggi" ? [{ operaio_id: ADMIN.id, rimosso_il: null }] : [],
  rapportini: [...DB.rapportini.values()].filter(r=>r.intervento_id === i.id).map(r=>({ id: r.id, autore_id: r.autore_id, stato: r.stato, data: r.data, completato_il: r.completato_il })) });

function supabase(){
  const json = (route, corpo, status = 200)=>route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range" }, body: JSON.stringify(corpo) });
  const oggetto = req=>/vnd\.pgrst\.object/.test(req.headers()["accept"] || "");
  const eq = (url, k)=>{ const v = url.searchParams.get(k); return v && v.startsWith("eq.") ? v.slice(3) : null; };
  const nelPeriodo = (url, d)=>url.searchParams.getAll("data").every(f=>{
    const [op, v] = [f.slice(0, f.indexOf(".")), f.slice(f.indexOf(".") + 1)];
    return op === "eq" ? d === v : op === "gte" ? d >= v : op === "lte" ? d <= v : true;
  });
  return async route=>{
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname;
    if(m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const corpo = ()=>JSON.parse(req.postData() || "null");
    if(p === "/functions/v1/accesso") return json(route, { sessione: { access_token: jwt(ADMIN.id), refresh_token: "r", expires_in: 3600, expires_at: 4102444800, token_type: "bearer", user: { id: ADMIN.id, aud: "authenticated", role: "authenticated" } } });
    if(p === "/auth/v1/user") return json(route, { id: ADMIN.id, aud: "authenticated", role: "authenticated" });
    if(p.startsWith("/auth/v1/") || p.startsWith("/functions/v1/")) return json(route, {});
    if(p.startsWith("/storage/")) return json(route, { error: "x" }, 503);
    if(p === "/rest/v1/profili"){ const prof = { ...ADMIN, attivo: true, deve_cambiare_password: false }; return json(route, oggetto(req) ? prof : [prof]); }
    if(p === "/rest/v1/rpc/operai_attivi" || p === "/rest/v1/rpc/nomi_utenti") return json(route, [{ id: ADMIN.id, username: "luca", nome: "Luca", attivo: true }]);
    if(p === "/rest/v1/rpc/salva_rapportino"){
      const b = corpo(); DB.salvaRapportino.push(b);
      const prima = DB.rapportini.get(b.p_rapportino.id);
      const r = { ...b.p_rapportino, versione: (prima ? prima.versione : 0) + 1, stato: b.p_completa ? "completato" : "bozza", autore_id: ADMIN.id,
        completato_il: b.p_completa ? new Date().toISOString() : null, aggiornato_il: new Date().toISOString(), rapportino_operai: b.p_ore };
      DB.rapportini.set(r.id, r);
      return json(route, { esito: "ok", rapportino: r });
    }
    if(p.startsWith("/rest/v1/rpc/")) return json(route, null);
    if(p === "/rest/v1/interventi"){
      if(m === "GET"){
        const id = eq(url, "id");
        const elenco = [...DB.interventi.values()].filter(i=>(!id || i.id === id) && nelPeriodo(url, i.data)).map(nidificato);
        return json(route, oggetto(req) ? (elenco[0] || null) : elenco);
      }
      const b = corpo();
      if(m === "POST"){ const i = { id: crypto.randomUUID(), stato: "pianificato", ...b }; DB.interventi.set(i.id, i); return json(route, oggetto(req) ? { id: i.id } : [{ id: i.id }], 201); }
    }
    if(p === "/rest/v1/rapportini" && m === "GET"){
      const f = { id: eq(url, "id"), stato: eq(url, "stato"), autore_id: eq(url, "autore_id"), intervento_id: eq(url, "intervento_id") };
      const elenco = [...DB.rapportini.values()].filter(r=>Object.entries(f).every(([k, v])=>!v || r[k] === v) && nelPeriodo(url, r.data))
        .map(r=>({ ...r, interventi: r.intervento_id ? DB.interventi.get(r.intervento_id) || null : null }));
      return json(route, oggetto(req) ? (elenco[0] || null) : elenco);
    }
    if(p.startsWith("/rest/v1/")){
      if(m !== "GET" && m !== "HEAD") return json(route, [], 201);
      return oggetto(req) ? json(route, null, 406) : json(route, []);
    }
    return json(route, {}, 404);
  };
}

const dialoghi = [], risposte = [];
async function apri(browser, base, oraUtc){
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Europe/Rome", locale: "it-IT" });
  const gestisci = supabase();
  await ctx.route(/^https?:\/\//, route=>{
    const url = route.request().url();
    if(url.startsWith(base)) return route.continue();
    if(/\.supabase\.co\//.test(url)) return gestisci(route);
    if(/cdnjs\.cloudflare\.com/.test(url)) return route.fulfill({ status: 200, contentType: "text/javascript", body: "window.jspdf = window.jspdf || {};" });
    return route.fulfill({ status: 204, body: "" });
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(oraUtc));
  const errori = [];
  page.on("pageerror", e=>errori.push(String(e)));
  page.on("dialog", d=>{ dialoghi.push(d.message()); const r = risposte.length ? risposte.shift() : true; return r ? d.accept() : d.dismiss(); });
  await page.goto(base + "/index.html");
  await page.fill("#acc-username", "luca");
  await page.fill("#acc-password", "password-di-prova");
  await page.click("#acc-invia");
  await page.waitForSelector("#vista-giornata:not(.nascosto)", { timeout: 15000 });
  return { ctx, page, errori };
}
const risultati = [];
async function prova(nome, fn){
  try{ await fn(); risultati.push("ok"); console.log("ok   -", nome); }
  catch(e){ risultati.push("FAIL"); console.log("FAIL -", nome, "\n      ", String(e && e.message).split("\n").slice(0, 4).join(" | ")); }
}
const testo = (page, sel)=>page.$eval(sel, el=>el.textContent.trim());
const visibile = (page, sel)=>page.$eval(sel, el=>!!el.offsetParent);
const attendiTesto = (page, sel, atteso)=>page.waitForFunction(([s, t])=>{ const el = document.querySelector(s); return el && el.textContent.includes(t); }, [sel, atteso], { timeout: 8000 });
const followup = page=>page.evaluate(()=>{ const k = Object.keys(localStorage).find(x=>x.startsWith("followup:")); return k ? JSON.parse(localStorage.getItem(k)) : []; });
// apriRapportino rilegge anche la copia del telefono: si interagisce solo a caricamento finito
const caricato = async page=>{ await page.waitForFunction(()=>!/Caricamento/.test(document.querySelector("#rap-msg").textContent)); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400); };
const tornaAllaGiornata = async page=>{ await page.evaluate(()=>mostraVista("giornata")); await page.waitForSelector("#vista-giornata:not(.nascosto)"); await page.waitForTimeout(400); };

const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
let idImprevisto = null;
try{
  const { page, errori } = await apri(browser, base, "2026-11-23T23:30:00Z");     // 00:30 del 24 a Roma

  await prova("dashboard aperta con data locale (non UTC) e intervento di oggi", async()=>{
    await attendiTesto(page, "#mg-lista-oggi", "Rossi Spa");
    assert.match(await testo(page, "#mg-data-oggi"), /24 novembre/);
    assert.equal(await testo(page, "#mg-tot"), "1");
    assert.equal(await testo(page, "#mg-completati"), "0");
  });

  await prova("imprevisto autonomo: Veloce/Completo sulla stessa bozza, nessun intervento creato", async()=>{
    await page.click("#mg-imprevisto");
    await page.waitForSelector("#vista-rapportino:not(.nascosto)");
    assert.equal(await page.$eval("#rf-data", el=>el.value), OGGI, "data del rapportino = giorno locale");
    assert.ok(await page.$eval("#rf-modo-rapido", el=>el.classList.contains("attivo")));
    assert.equal(await visibile(page, "#rf-note"), false, "in Veloce le note sono nascoste");
    await page.fill("#rf-cliente", "Bar Centrale");
    await page.fill("#rf-attivita", "Perdita sotto il lavello");
    await page.click("#rf-modo-completo");
    assert.equal(await visibile(page, "#rf-note"), true);
    await page.fill("#rf-note", "Nota dal modo completo");
    await page.click("#rf-modo-rapido");
    await page.click("#rf-modo-completo");
    assert.equal(await page.$eval("#rf-note", el=>el.value), "Nota dal modo completo");
    await page.click("#rf-salva");
    await attendiTesto(page, "#rap-msg", "Bozza salvata");
    assert.equal(DB.rapportini.size, 1, "un solo rapportino");
    const r = [...DB.rapportini.values()][0];
    idImprevisto = r.id;
    assert.equal(r.intervento_id, null);
    assert.equal(r.note, "Nota dal modo completo");
    assert.equal(r.attivita, "Perdita sotto il lavello");
    assert.equal(DB.interventi.size, 1, "nessun intervento creato per l'imprevisto");
  });

  await prova("dashboard: imprevisto distinto, nei conteggi, riapribile", async()=>{
    await page.click("#vista-rapportino .indietro");
    await attendiTesto(page, "#mg-lista-imprevisti", "Bar Centrale");
    assert.match(await testo(page, "#mg-lista-imprevisti"), /Imprevisto.*Bozza da completare/s);
    assert.equal(await testo(page, "#mg-tot"), "2");
    assert.equal(await testo(page, "#mg-incorso"), "1");
    assert.equal(await page.$$eval("#mg-lista-bozze .card", l=>l.length), 0, "non ripetuto tra le bozze");
    await page.click("#mg-lista-imprevisti .btn-primario");
    await page.waitForFunction(()=>document.querySelector("#rf-cliente").value === "Bar Centrale");
    await caricato(page);
    assert.equal(await page.$eval("#rf-note", el=>el.value), "Nota dal modo completo");
    assert.ok(await page.$eval("#rf-modo-completo", el=>el.classList.contains("attivo")), "bozza esistente si apre in Completo");
  });

  await prova("Da ultimare: completamento, ritorno rimandato (conferma rifiutata), follow-up conservato", async()=>{
    await page.selectOption("#rf-esito", "Da ultimare");
    assert.equal(await visibile(page, "#rf-followup"), true);
    await page.fill("#rf-followup-desc", "Sostituire il sifone");
    await page.fill("#rf-followup-data", DOMANI);
    dialoghi.length = 0;
    risposte.push(true, false);                      // completa: sì; crea ritorno ora: no
    await page.click("#rf-completa");
    await attendiTesto(page, "#rap-msg", "resta nella dashboard");
    assert.ok(dialoghi.some(t=>/Creare ora l'intervento di ritorno/.test(t)), "conferma esplicita richiesta");
    assert.equal(DB.interventi.size, 1, "nessun intervento senza conferma");
    assert.equal(DB.rapportini.get(idImprevisto).stato, "completato");
    const f = await followup(page);
    assert.equal(f.length, 1);
    assert.deepEqual([f[0].rapportino_id, f[0].stato, f[0].data, f[0].desc], [idImprevisto, "da_programmare", DOMANI, "Sostituire il sifone"]);
  });

  await prova("dashboard: ritorno da programmare e conteggi aggiornati", async()=>{
    await tornaAllaGiornata(page);
    await attendiTesto(page, "#mg-lista-followup", "Bar Centrale");
    assert.equal(await testo(page, "#mg-conta-followup"), "1");
    assert.equal(await testo(page, "#mg-completati"), "1");
    assert.match(await testo(page, "#mg-lista-imprevisti"), /Da ultimare/);
  });

  await prova("programma → annulla: il follow-up resta", async()=>{
    await page.click("#mg-lista-followup .btn-primario");
    await page.waitForSelector("#int-form:not(.nascosto)");
    assert.equal(await page.$eval("#int-data", el=>el.value), DOMANI);
    assert.equal(await page.$eval("#int-cliente", el=>el.value), "Bar Centrale");
    assert.match(await page.$eval("#int-descrizione", el=>el.value), /Sostituire il sifone/);
    await page.click("#int-form button[onclick='chiudiModuloIntervento()']");
    await tornaAllaGiornata(page);
    assert.equal((await followup(page))[0].stato, "da_programmare");
    assert.equal(await testo(page, "#mg-conta-followup"), "1");
    assert.equal(DB.interventi.size, 1);
  });

  await prova("programma → salva: intervento creato una volta, follow-up programmato e non riproponibile", async()=>{
    await page.click("#mg-lista-followup .btn-primario");
    await page.waitForSelector("#int-form:not(.nascosto)");
    await page.click("#int-salva");
    await page.waitForFunction(()=>document.querySelector("#int-form").classList.contains("nascosto"));
    assert.equal(DB.interventi.size, 2);
    const nuovo = [...DB.interventi.values()].find(i=>i.id !== "i-oggi");
    assert.equal(nuovo.data, DOMANI);
    const f = (await followup(page))[0];
    assert.deepEqual([f.stato, f.intervento_id], ["programmato", nuovo.id]);
    dialoghi.length = 0;
    await page.evaluate(id=>programmaFollowup(id), f.id);
    assert.ok(dialoghi.some(t=>/già stato programmato/.test(t)));
    await page.waitForTimeout(300);
    assert.equal(DB.interventi.size, 2, "nessun doppione");
    await tornaAllaGiornata(page);
    assert.equal(await visibile(page, "#mg-sez-followup-head"), false);
  });

  await prova("bozza offline: resta sul telefono, visibile in dashboard e recuperabile", async()=>{
    await page.context().setOffline(true);
    await page.click("#mg-imprevisto");
    await page.waitForSelector("#vista-rapportino:not(.nascosto)");
    await page.fill("#rf-cliente", "Cliente Offline");
    await page.fill("#rf-attivita", "Appunti senza rete");
    await page.waitForTimeout(600);                 // scrittura della bozza sul telefono (300 ms)
    risposte.push(true);                            // "uscire?"
    await page.click("#vista-rapportino .indietro");
    await attendiTesto(page, "#mg-lista-imprevisti", "Cliente Offline");
    assert.match(await testo(page, "#mg-lista-imprevisti"), /non ancora inviate/);
    const n = DB.rapportini.size;
    await page.click("#mg-lista-imprevisti .card:has-text('Cliente Offline') .btn-primario");
    await page.waitForFunction(()=>document.querySelector("#rf-cliente").value === "Cliente Offline", null, { timeout: 8000 });
    assert.equal(await page.$eval("#rf-attivita", el=>el.value), "Appunti senza rete");
    assert.equal(DB.rapportini.size, n, "nulla inviato senza rete");
    // un rapportino aperto nel modulo non si invia mentre lo si modifica: si chiude, poi torna la rete
    risposte.push(true);
    await page.click("#vista-rapportino .indietro");
    await page.context().setOffline(false);
    // orologio fermo: l'attesa tra i tentativi automatici non scade mai -> invio manuale ("Invia ora")
    await page.evaluate(()=>sincronizzaOra());
    for(let t = 0; t < 40 && ![...DB.rapportini.values()].some(r=>r.cliente === "Cliente Offline"); t++) await page.waitForTimeout(250);
    assert.equal([...DB.rapportini.values()].filter(r=>r.cliente === "Cliente Offline").length, 1);
  });

  await prova("nessun errore JavaScript nella pagina", async()=>{ assert.deepEqual(errori, []); });

  const sera = await apri(browser, base, "2026-11-24T16:00:00Z");                 // 17:00 a Roma
  await prova("riepilogo di fine giornata (17:00) con conteggi coerenti", async()=>{
    await sera.page.waitForSelector("#mg-fine-giornata:not(.nascosto)", { timeout: 8000 });
    const t = await testo(sera.page, "#mg-fine-contenuto");
    // oggi: intervento Rossi (da iniziare) + imprevisto Bar Centrale (completato, da ultimare)
    // + imprevisto Cliente Offline (bozza inviata in automatico al ritorno della rete)
    const offline = [...DB.rapportini.values()].find(r=>r.cliente === "Cliente Offline");
    assert.ok(offline && offline.stato === "bozza", "bozza offline sincronizzata al ritorno della rete");
    assert.equal(await testo(sera.page, "#mg-tot"), "3");
    assert.match(t, /1\s*Completati/);
    assert.match(t, /2\s*Da completare/);
    assert.match(t, /1\s*Da ultimare/);
    assert.match(t, /Rossi Spa/);
    assert.match(t, /Cliente Offline \(imprevisto\)/);
    assert.deepEqual(sera.errori, []);
  });
}finally{
  await browser.close();
  srv.close();
}
const ko = risultati.filter(r=>r !== "ok").length;
console.log(`\n${risultati.length - ko}/${risultati.length} superati`);
process.exit(ko ? 1 : 0);
