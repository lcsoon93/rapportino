// Schede della dashboard "La mia giornata": orario programmato, orario effettivo dal rapportino o riquadro
// neutro (mai un orologio), stato del rapportino invariato. Playwright + finto Supabase, nessun dato modificato.
// Esecuzione: node tests/e2e/schede-giornata.e2e.mjs
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
const DB = { interventi: new Map(), ass: [], rapportini: new Map() };
const GUASTI = { perdiRispostaIntervento: 0, erroreAssegnazioni: 0 };
const assegnati = id=>DB.ass.filter(a=>a.intervento_id === id && !a.rimosso_il).map(a=>a.operaio_id);
const int = (id, cliente, extra = {})=>{ DB.interventi.set(id, { id, data: OGGI, cliente, indirizzo: "", descrizione: "", priorita: "normale", tipologia: "", stato: "pianificato", ...extra });
  DB.ass.push({ intervento_id: id, operaio_id: ADMIN.id, rimosso_il: null }); };
const rap = (id, intervento_id, esito, stato, ore)=>DB.rapportini.set(id, { id, intervento_id, autore_id: ADMIN.id, data: OGGI, cliente: "R " + id, esito, stato,
  versione: 1, completato_il: stato === "completato" ? OGGI + "T10:00:00Z" : null, aggiornato_il: OGGI + "T10:00:00Z",
  rapportino_operai: ore.map(([dalle, alle])=>({ operaio_id: ADMIN.id, dalle, alle })) });
int("i-ora", "Ferramenta Sette", { ora: "07:00:00", stato: "completato" });           rap("r-ora", "i-ora", "Completato", "completato", [["07:10:00", "09:00:00"]]);
int("i-mega", "Megamark", { ora: null, stato: "completato" });                        rap("r-mega", "i-mega", "Completato", "completato", [["08:15:00", "10:30:00"]]);
int("i-ult", "Ultimare Spa", { ora: null, stato: "completato" });                      rap("r-ult", "i-ult", "Da ultimare", "completato", []);
int("i-riap", "Riaperto Srl", { ora: null, stato: "in_corso" });                       rap("r-riap", "i-riap", "Completato", "bozza", [["11:00:00", "12:00:00"]]);   // completato e riaperto
int("i-vecchio", "Vecchio Snc");                                                       // dato vecchio: nessun campo "ora"
DB.interventi.get("i-vecchio").ora = undefined; delete DB.interventi.get("i-vecchio").ora;
rap("r-auto", null, "Completato", "completato", [["14:00:00", "15:00:00"]]);            // rapportino autonomo (imprevisto)
const PRIMA = JSON.stringify([...DB.interventi.values()]);
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



const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
const scheda = (page, cliente)=>page.$eval(`#mg-lista-oggi .card:has(.int-cliente)`, ()=>null).then(()=>page.evaluate(c=>{
  const card = [...document.querySelectorAll("#mg-lista-oggi .card")].find(x=>x.querySelector(".int-cliente").textContent === c);
  const ora = card.querySelector(".int-ora");
  return { ora: ora.textContent.trim(), classi: ora.className, titolo: ora.title, icona: !!ora.querySelector("svg"),
    sotto: (card.querySelector(".int-desc") || {}).textContent || "", badge: card.querySelector(".int-badge").textContent };
}, cliente));
try{
  const { page, errori } = await apri(browser, base, "2026-11-24T15:00:00Z", ADMIN);
  await attendiTesto(page, "#mg-lista-oggi", "Megamark");

  await prova("intervento programmato con orario e rapportino completato: orario programmato, lavoro effettivo a parte", async()=>{
    const s = await scheda(page, "Ferramenta Sette");
    assert.equal(s.ora, "07:00"); assert.equal(s.titolo, "Orario programmato"); assert.equal(s.icona, false);
    assert.match(s.sotto, /Lavoro effettivo 07:10–09:00/); assert.doesNotMatch(s.sotto, /non programmato/);
    assert.match(s.badge, /Programmato.*Completato/);
  });
  await prova("intervento senza orario (Megamark) completato: inizio effettivo segnato come tale, nessun orologio", async()=>{
    const s = await scheda(page, "Megamark");
    assert.equal(s.ora, "08:15effettivo"); assert.match(s.classi, /effettivo/); assert.equal(s.icona, false);
    assert.match(s.sotto, /Orario non programmato · Lavoro effettivo 08:15–10:30/);
    assert.match(s.badge, /Completato/);
  });
  await prova("rapportino da ultimare senza orari: riquadro neutro, stato Da ultimare invariato", async()=>{
    const s = await scheda(page, "Ultimare Spa");
    assert.equal(s.ora, "—senza ora"); assert.equal(s.icona, false); assert.match(s.classi, /vuota/);
    assert.match(s.badge, /Da ultimare/);
  });
  await prova("intervento completato e riaperto: bozza da completare, orario effettivo", async()=>{
    const s = await scheda(page, "Riaperto Srl");
    assert.equal(s.ora, "11:00effettivo"); assert.match(s.badge, /Bozza da completare/);
  });
  await prova("dato vecchio senza campo ora e senza rapportino: neutro, da iniziare", async()=>{
    const s = await scheda(page, "Vecchio Snc");
    assert.equal(s.ora, "—senza ora"); assert.equal(s.icona, false); assert.match(s.badge, /Da iniziare/);
  });
  await prova("rapportino autonomo: tra gli imprevisti con la sua icona, non tra gli interventi", async()=>{
    await attendiTesto(page, "#mg-lista-imprevisti", "R r-auto");
    assert.match(await testo(page, "#mg-lista-imprevisti"), /Imprevisto.*Completato/s);
    assert.ok(await page.$eval("#mg-lista-imprevisti .int-ora use", el=>el.getAttribute("href")) === "#i-alert");
  });
  await prova("nessuna icona orologio tra gli interventi; conteggi e dati invariati", async()=>{
    assert.equal(await page.$$eval("#mg-lista-oggi use[href='#i-clock']", l=>l.length), 0);
    assert.equal(await testo(page, "#mg-completati"), "4", "Ferramenta, Megamark, Ultimare (da ultimare) e imprevisto: stati invariati");
  });
  await prova("nessuna modifica ai dati e nessun errore JS", async()=>{
    assert.equal(JSON.stringify([...DB.interventi.values()]), PRIMA);
    assert.deepEqual(errori, []);
  });
}finally{
  await browser.close();
  srv.close();
}
const ko = risultati.filter(r=>r !== "ok").length;
console.log(`\n${risultati.length - ko}/${risultati.length} superati`);
process.exit(ko ? 1 : 0);
