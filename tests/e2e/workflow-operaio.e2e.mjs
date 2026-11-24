// Test end-to-end del flusso operaio (Playwright, Chromium) con un finto Supabase in memoria e guasti
// simulati: più interventi, intervento con due operai, imprevisti "Da ultimare" con ritorno (subito,
// risposta persa, errore nelle assegnazioni), ore sovrapposte, fine giornata. Non è Supabase reale.
// Esecuzione: node tests/e2e/workflow-operaio.e2e.mjs
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
const OPERAIO = { id: "b0000000-0000-4000-8000-000000000002", username: "marco", nome: "Marco", cognome: "", ruolo: "worker", ruoli: ["worker"] };
const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 }) + ".x";
// finto database: interventi, assegnazioni, rapportini; guasti iniettabili
const DB = { interventi: new Map(), ass: [], rapportini: new Map() };
const GUASTI = { perdiRispostaIntervento: 0, erroreAssegnazioni: 0 };
const int = (id, ora, cliente, operai)=>{ DB.interventi.set(id, { id, data: OGGI, ora, cliente, indirizzo: "", descrizione: "", priorita: "normale", tipologia: "", stato: "pianificato" });
  operai.forEach(o=>DB.ass.push({ intervento_id: id, operaio_id: o, rimosso_il: null })); };
int("i1", "09:00:00", "Condominio Alfa", [ADMIN.id, OPERAIO.id]);
int("i2", "11:00:00", "Negozio Beta", [ADMIN.id]);
int("i3", "14:00:00", "Villa Gamma", [OPERAIO.id]);
const assegnati = id=>DB.ass.filter(a=>a.intervento_id === id && !a.rimosso_il).map(a=>a.operaio_id);
const ritorni = ()=>[...DB.interventi.values()].filter(i=>!["i1", "i2", "i3"].includes(i.id));

function supabase(utente){
  const admin = utente.ruolo === "admin";
  const json = (route, corpo, status = 200)=>route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range" }, body: JSON.stringify(corpo) });
  const oggetto = req=>/vnd\.pgrst\.object/.test(req.headers()["accept"] || "");
  const eq = (url, k)=>{ const v = url.searchParams.get(k); return v && v.startsWith("eq.") ? v.slice(3) : null; };
  const lista = (url, k)=>{ const v = url.searchParams.get(k); return v && v.startsWith("in.(") ? v.slice(4, -1).split(",").map(x=>x.replace(/"/g, "")) : null; };
  const nelPeriodo = (url, d)=>url.searchParams.getAll("data").every(f=>{
    const [op, v] = [f.slice(0, f.indexOf(".")), f.slice(f.indexOf(".") + 1)];
    return op === "eq" ? d === v : op === "gte" ? d >= v : op === "lte" ? d <= v : true;
  });
  const visibileRap = r=>admin || r.autore_id === utente.id;
  const nidificato = i=>({ ...i, intervento_operai: DB.ass.filter(a=>a.intervento_id === i.id).map(a=>({ operaio_id: a.operaio_id, rimosso_il: a.rimosso_il })),
    rapportini: [...DB.rapportini.values()].filter(r=>r.intervento_id === i.id && visibileRap(r)).map(r=>({ id: r.id, autore_id: r.autore_id, stato: r.stato, data: r.data, completato_il: r.completato_il })) });
  return async route=>{
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname;
    if(m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const corpo = ()=>JSON.parse(req.postData() || "null");
    if(p === "/functions/v1/accesso") return json(route, { sessione: { access_token: jwt(utente.id), refresh_token: "r", expires_in: 3600, expires_at: 4102444800, token_type: "bearer", user: { id: utente.id, aud: "authenticated", role: "authenticated" } } });
    if(p === "/auth/v1/user") return json(route, { id: utente.id, aud: "authenticated", role: "authenticated" });
    if(p.startsWith("/auth/v1/") || p.startsWith("/functions/v1/")) return json(route, {});
    if(p.startsWith("/storage/")) return json(route, { error: "x" }, 503);
    if(p === "/rest/v1/profili"){ const prof = { ...utente, attivo: true, deve_cambiare_password: false }; return json(route, oggetto(req) ? prof : [prof]); }
    if(p === "/rest/v1/rpc/operai_attivi" || p === "/rest/v1/rpc/nomi_utenti") return json(route, [ADMIN, OPERAIO].map(u=>({ id: u.id, username: u.username, nome: u.nome, attivo: true })));
    if(p === "/rest/v1/rpc/salva_rapportino"){
      const b = corpo();
      const prima = DB.rapportini.get(b.p_rapportino.id);
      const r = { ...b.p_rapportino, versione: (prima ? prima.versione : 0) + 1, stato: b.p_completa ? "completato" : "bozza", autore_id: utente.id,
        completato_il: b.p_completa ? new Date().toISOString() : null, aggiornato_il: new Date().toISOString(), rapportino_operai: b.p_ore };
      DB.rapportini.set(r.id, r);
      return json(route, { esito: "ok", rapportino: r });
    }
    if(p.startsWith("/rest/v1/rpc/")) return json(route, null);
    if(p === "/rest/v1/interventi"){
      const id = eq(url, "id");
      if(m === "GET"){
        const elenco = [...DB.interventi.values()].filter(i=>(!id || i.id === id) && nelPeriodo(url, i.data) && (admin || assegnati(i.id).includes(utente.id))).map(nidificato);
        return json(route, oggetto(req) ? (elenco[0] || null) : elenco);
      }
      const b = corpo();
      if(m === "POST"){
        if(b.id && DB.interventi.has(b.id)) return json(route, { code: "23505", message: "duplicate key value violates unique constraint", details: null, hint: null }, 409);
        const i = { id: b.id || crypto.randomUUID(), stato: "pianificato", ...b };
        DB.interventi.set(i.id, i);
        if(GUASTI.perdiRispostaIntervento > 0){ GUASTI.perdiRispostaIntervento--; return route.abort("connectionreset"); }   // salvato, risposta persa
        return json(route, oggetto(req) ? { id: i.id } : [{ id: i.id }], 201);
      }
      if(m === "PATCH"){ const i = DB.interventi.get(id); Object.assign(i, b); return json(route, oggetto(req) ? { id } : [{ id }]); }
    }
    if(p === "/rest/v1/intervento_operai"){
      const iid = eq(url, "intervento_id");
      if(m === "GET") return json(route, assegnati(iid).map(o=>({ operaio_id: o })));
      if(m === "POST"){
        if(GUASTI.erroreAssegnazioni > 0){ GUASTI.erroreAssegnazioni--; return json(route, { code: "XX000", message: "errore temporaneo del server" }, 500); }
        corpo().forEach(a=>DB.ass.push({ intervento_id: a.intervento_id, operaio_id: a.operaio_id, rimosso_il: null }));
        return json(route, [], 201);
      }
      if(m === "DELETE"){ const tolti = lista(url, "operaio_id") || []; DB.ass = DB.ass.filter(a=>!(a.intervento_id === iid && tolti.includes(a.operaio_id))); return json(route, []); }
    }
    if(p === "/rest/v1/rapportini" && m === "GET"){
      const f = { id: eq(url, "id"), stato: eq(url, "stato"), autore_id: eq(url, "autore_id"), intervento_id: eq(url, "intervento_id") };
      const elenco = [...DB.rapportini.values()].filter(r=>visibileRap(r) && Object.entries(f).every(([k, v])=>!v || r[k] === v) && nelPeriodo(url, r.data))
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
async function apri(browser, base, oraUtc, utente){
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, timezoneId: "Europe/Rome", locale: "it-IT" });
  const gestisci = supabase(utente);
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
  await page.fill("#acc-username", utente.username);
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


const ore = async (page, dalle, alle)=>{ await page.fill("#rf-ore .rf-ore-riga:first-child .rf-dalle", dalle); await page.fill("#rf-ore .rf-ore-riga:first-child .rf-alle", alle); };
const rapDi = (iid, autore)=>[...DB.rapportini.values()].filter(r=>r.intervento_id === iid && (!autore || r.autore_id === autore));
async function imprevistoDaUltimare(page, cliente, dalle, alle){
  await tornaAllaGiornata(page);
  await page.click("#mg-imprevisto");
  await page.waitForSelector("#vista-rapportino:not(.nascosto)");
  await page.fill("#rf-cliente", cliente);
  await page.fill("#rf-attivita", "Lavoro parziale");
  await ore(page, dalle, alle);
  await page.selectOption("#rf-esito", "Da ultimare");
  await page.fill("#rf-followup-desc", "Finire il lavoro");
  await page.fill("#rf-followup-data", DOMANI);
  risposte.push(true, true);                         // completa: sì; crea ritorno ora: sì
  await page.click("#rf-completa");
}

const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
try{
  const { page, errori } = await apri(browser, base, "2026-11-24T09:00:00Z", ADMIN);   // 10:00 a Roma

  await prova("giornata con più interventi programmati (vista admin)", async()=>{
    await attendiTesto(page, "#mg-lista-oggi", "Villa Gamma");
    const t = await testo(page, "#mg-lista-oggi");
    assert.match(t, /Condominio Alfa/); assert.match(t, /Negozio Beta/);
    assert.equal(await testo(page, "#mg-tot"), "3");
  });

  await prova("intervento con più operai: bozza, riapertura, completamento, riapertura senza duplicati", async()=>{
    await page.evaluate(()=>compilaRapportinoIntervento("i1"));
    await page.waitForSelector("#vista-rapportino:not(.nascosto)");
    await caricato(page);
    await page.fill("#rf-attivita", "Controllo impianto");
    await ore(page, "08:00", "10:00");
    await page.click("#rf-salva");
    await attendiTesto(page, "#rap-msg", "Bozza salvata sul server");
    await page.click("#vista-rapportino .indietro");
    await page.evaluate(()=>compilaRapportinoIntervento("i1"));
    await page.waitForFunction(()=>document.querySelector("#rf-attivita").value === "Controllo impianto");
    await caricato(page);
    assert.equal(rapDi("i1").length, 1, "riaperta la stessa bozza");
    risposte.push(true);
    await page.click("#rf-completa");
    await attendiTesto(page, "#rap-msg", "completato");
    assert.equal(rapDi("i1")[0].stato, "completato");
    await page.click("#vista-rapportino .indietro");
    await page.evaluate(()=>compilaRapportinoIntervento("i1"));
    await page.waitForFunction(()=>document.querySelector("#rf-attivita").value === "Controllo impianto");
    assert.equal(rapDi("i1").length, 1, "nessun secondo rapportino dopo il completamento");
  });

  await prova("imprevisto da ultimare: ritorno programmato subito, una volta", async()=>{
    await imprevistoDaUltimare(page, "Officina Bianchi", "09:30", "11:00");
    await attendiTesto(page, "#rap-msg", "Intervento di ritorno creato");
    assert.equal(ritorni().length, 1);
    assert.deepEqual(assegnati(ritorni()[0].id), [ADMIN.id]);
    const f = (await followup(page)).find(x=>x.cliente === "Officina Bianchi");
    assert.equal(f.stato, "programmato");
  });

  await prova("errore di rete dopo la creazione del ritorno: follow-up conservato, nuovo tentativo senza doppione", async()=>{
    GUASTI.perdiRispostaIntervento = 1;
    await imprevistoDaUltimare(page, "Studio Verdi", "14:00", "15:00");
    await attendiTesto(page, "#rap-msg", "non è stato creato");
    assert.equal(ritorni().length, 2, "il server l'ha creato (risposta persa)");
    const creato = ritorni().find(i=>i.cliente === "Studio Verdi");
    assert.deepEqual(assegnati(creato.id), [], "assegnazioni non ancora fatte");
    const f = (await followup(page)).find(x=>x.cliente === "Studio Verdi");
    assert.deepEqual([f.stato, f.intervento_previsto], ["da_programmare", creato.id]);
    await tornaAllaGiornata(page);
    await attendiTesto(page, "#mg-lista-followup", "operai da assegnare");
    await page.click("#mg-lista-followup .card:has-text('Studio Verdi') .btn-primario");
    await page.waitForSelector("#int-form:not(.nascosto)");
    await page.click("#int-salva");
    await page.waitForFunction(()=>document.querySelector("#int-form").classList.contains("nascosto"));
    assert.equal(ritorni().length, 2, "nessun secondo intervento");
    assert.deepEqual(assegnati(creato.id), [ADMIN.id]);
    assert.equal((await followup(page)).find(x=>x.cliente === "Studio Verdi").stato, "programmato");
  });

  await prova("errore nel salvataggio delle assegnazioni: nuovo tentativo dalla dashboard senza doppione", async()=>{
    GUASTI.erroreAssegnazioni = 1;
    await imprevistoDaUltimare(page, "Ferramenta Neri", "14:30", "15:30");
    await attendiTesto(page, "#rap-msg", "non è stato creato");
    const creato = ritorni().find(i=>i.cliente === "Ferramenta Neri");
    assert.ok(creato); assert.deepEqual(assegnati(creato.id), []);
    // nuovo tentativo diretto (stesso id previsto), come "Programma" dalla dashboard
    await tornaAllaGiornata(page);
    const f = (await followup(page)).find(x=>x.cliente === "Ferramenta Neri");
    await page.evaluate(id=>programmaFollowup(id), f.id);
    await page.waitForSelector("#int-form:not(.nascosto)");
    await page.click("#int-salva");
    await page.waitForFunction(()=>document.querySelector("#int-form").classList.contains("nascosto"));
    assert.equal(ritorni().length, 3);
    assert.deepEqual(assegnati(creato.id), [ADMIN.id]);
    assert.equal((await followup(page)).filter(x=>x.stato !== "programmato").length, 0);
  });

  await prova("ore della giornata: intervalli sovrapposti contati una volta (08-10, 09:30-11, 14-15, 14:30-15:30 = 4h 30m)", async()=>{
    await tornaAllaGiornata(page);
    await attendiTesto(page, "#mg-ore", "4h 30m");
  });

  await prova("nessun errore JavaScript (admin)", async()=>{ assert.deepEqual(errori, []); });

  const op = await apri(browser, base, "2026-11-24T09:30:00Z", OPERAIO);
  await prova("operaio: vede solo i suoi interventi, stato proprio (non quello del collega)", async()=>{
    await attendiTesto(op.page, "#mg-lista-oggi", "Villa Gamma");
    assert.doesNotMatch(await testo(op.page, "#mg-lista-oggi"), /Negozio Beta/);
    assert.equal(await testo(op.page, "#mg-tot"), "2");
    assert.equal(await testo(op.page, "#mg-completati"), "0", "il completamento del collega non conta per lui");
  });
  await prova("operaio: proprio rapportino sullo stesso intervento, separato e senza duplicati", async()=>{
    await op.page.evaluate(()=>compilaRapportinoIntervento("i1"));
    await op.page.waitForSelector("#vista-rapportino:not(.nascosto)");
    await caricato(op.page);
    assert.equal(await op.page.$eval("#rf-attivita", el=>el.value), "", "non apre il rapportino del collega");
    await op.page.fill("#rf-attivita", "Aiuto al collega");
    await ore(op.page, "08:00", "10:00");
    risposte.push(true);
    await op.page.click("#rf-completa");
    await attendiTesto(op.page, "#rap-msg", "completato");
    await op.page.click("#vista-rapportino .indietro");
    await op.page.evaluate(()=>compilaRapportinoIntervento("i1"));
    await op.page.waitForFunction(()=>document.querySelector("#rf-attivita").value === "Aiuto al collega");
    assert.equal(rapDi("i1").length, 2);
    assert.equal(rapDi("i1", OPERAIO.id).length, 1);
    await tornaAllaGiornata(op.page);
    await attendiTesto(op.page, "#mg-completati", "1");
    assert.equal(await testo(op.page, "#mg-ore"), "2h");
    assert.deepEqual(op.errori, []);
  });

  const sera = await apri(browser, base, "2026-11-24T16:00:00Z", ADMIN);          // 17:00 a Roma
  await prova("fine giornata (admin): conteggi e ore coerenti", async()=>{
    await sera.page.waitForSelector("#mg-fine-giornata:not(.nascosto)", { timeout: 8000 });
    const t = await testo(sera.page, "#mg-fine-contenuto");
    // 3 interventi (i1 completato; i2 da iniziare; i3 di Marco, nessun suo rapportino) + 3 imprevisti completati da ultimare
    assert.equal(await testo(sera.page, "#mg-tot"), "6");
    assert.match(t, /4\s*Completati/);
    assert.match(t, /2\s*Da completare/);
    assert.match(t, /3\s*Da ultimare/);
    assert.match(t, /4h 30m\s*Ore lavorate/);
    assert.doesNotMatch(t, /ritorn/i, "nessun ritorno ancora da programmare");
    assert.deepEqual(sera.errori, []);
  });
}finally{
  await browser.close();
  srv.close();
}
const ko = risultati.filter(r=>r !== "ok").length;
console.log(`\n${risultati.length - ko}/${risultati.length} superati`);
process.exit(ko ? 1 : 0);
