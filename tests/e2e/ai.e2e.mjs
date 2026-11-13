// Test end-to-end dell'assistente AI nell'app (Playwright, Chromium), SENZA il server vero:
// tutte le richieste a *.supabase.co sono servite da un finto Supabase qui sotto; ogni altra richiesta
// esterna e' bloccata. Esecuzione: node tests/e2e/ai.e2e.mjs (vedi tests/LEGGIMI.md).
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const RADICE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TIPI = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

// ---------------------------------------------------------------- server statico locale
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
  worker:  { id: "b0000000-0000-4000-8000-000000000002", username: "mario", nome: "Mario", cognome: "Bianchi", ruolo: "worker", ruoli: ["worker"] },
  admin:   { id: "b0000000-0000-4000-8000-000000000001", username: "luca", nome: "Luca", cognome: "", ruolo: "admin", ruoli: ["admin", "worker"] },
  company: { id: "b0000000-0000-4000-8000-000000000004", username: "comphas", nome: "Comphas", cognome: "", ruolo: "company", ruoli: ["company"] },
};
const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".firma-finta";

function nuovoSupabase(ruolo){
  const u = UTENTI[ruolo];
  const stato = { ai: [], scritture: [], richieste: 0, aiRisposta: null };
  const json = (route, corpo, status = 200, headers = {})=>route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range", ...headers }, body: JSON.stringify(corpo) });
  async function gestisci(route){
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    stato.richieste++;
    if(m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const p = url.pathname;
    if(p === "/functions/v1/accesso") return json(route, { sessione: { access_token: jwt(u.id), refresh_token: "r-finto", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: u.id, aud: "authenticated", role: "authenticated" } } });
    if(p === "/auth/v1/user") return json(route, { id: u.id, aud: "authenticated", role: "authenticated", email: "x@utenti.rapportino.invalid" });
    if(p.startsWith("/auth/v1/")) return json(route, {});
    if(p === "/functions/v1/notifiche") return json(route, { ok: true, inviate: 0 });
    if(p === "/functions/v1/ai"){
      const corpo = JSON.parse(req.postData() || "{}");
      stato.ai.push({ corpo, auth: req.headers()["authorization"] });
      const r = typeof stato.aiRisposta === "function" ? await stato.aiRisposta(corpo) : stato.aiRisposta;
      if(r && r.grezzo !== undefined) return route.fulfill({ status: r.status || 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: r.grezzo });
      return json(route, (r && r.corpo) || { ok: true }, (r && r.status) || 200);
    }
    if(p.startsWith("/storage/")) return json(route, { error: "non disponibile nel test" }, 503);
    if(p === "/rest/v1/profili"){
      const prof = { ...u, attivo: true, deve_cambiare_password: false };
      return json(route, /vnd\.pgrst\.object/.test(req.headers()["accept"] || "") ? prof : [prof]);
    }
    if(p === "/rest/v1/rpc/operai_attivi" || p === "/rest/v1/rpc/nomi_utenti") return json(route, [{ id: UTENTI.worker.id, username: "mario", nome: "Mario Bianchi", attivo: true }]);
    if(p.startsWith("/rest/v1/rpc/")){ if(/notifiche_/.test(p)) stato.scritture.push(m + " " + p); return json(route, null); }
    if(p.startsWith("/rest/v1/")){
      if(m !== "GET" && m !== "HEAD"){ stato.scritture.push(m + " " + p); return json(route, [], 201); }
      if(/vnd\.pgrst\.object/.test(req.headers()["accept"] || "")) return json(route, null, 406);
      return json(route, [], 200, { "content-range": "*/0" });
    }
    return json(route, {}, 404);
  }
  return { stato, gestisci };
}

// ---------------------------------------------------------------- avvio di una sessione dell'app
async function apri(browser, base, ruolo){
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 420, height: 900 } });
  const sb = nuovoSupabase(ruolo);
  const esterne = [];
  await ctx.route(/^https?:\/\//, route=>{
    const url = route.request().url();
    if(url.startsWith(base)) return route.continue();
    if(/\.supabase\.co\//.test(url)) return sb.gestisci(route);
    if(/cdnjs\.cloudflare\.com/.test(url)) return route.fulfill({ status: 200, contentType: "text/javascript", body: "window.jspdf = window.jspdf || {};" });
    esterne.push(url);
    return route.fulfill({ status: 204, body: "" });           // font e altro: nessuna rete
  });
  const page = await ctx.newPage();
  const errori = [];
  page.on("pageerror", e=>errori.push(String(e)));
  await page.goto(base + "/index.html");
  await page.fill("#acc-username", UTENTI[ruolo].username);
  await page.fill("#acc-password", "password-di-prova");
  await page.click("#acc-invia");
  await page.waitForFunction(()=>document.body.dataset.ruolo && document.body.dataset.ruolo !== "", null, { timeout: 15000 });
  return { ctx, page, sb, errori, esterne };
}
const visibile = (page, sel)=>page.$eval(sel, el=>!!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).display !== "none").catch(()=>false);
const bozzaLocale = (page, id)=>page.evaluate(id=>new Promise(ok=>{
  const r = indexedDB.open("rapportino-foto");
  r.onsuccess = ()=>{ const g = r.result.transaction("bozze").objectStore("bozze").get(id); g.onsuccess = ()=>ok(g.result || null); g.onerror = ()=>ok(null); };
  r.onerror = ()=>ok(null);
}), id);
const idCorrente = page=>page.evaluate(()=>import("./js/modules/modulo-rapportino.js").then(m=>m.statoRapportinoAperto() && m.statoRapportinoAperto().id));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAuQ7/Abg5tm8AAAAASUVORK5CYII=", "base64");

// SCREENSHOT=<cartella>: salva alcune schermate per un controllo visivo
const foto = async(page, nome)=>{ if(process.env.SCREENSHOT) await page.screenshot({ path: path.join(process.env.SCREENSHOT, nome + ".png") }); };
const risultati = [];
async function prova(nome, fn){
  try{ await fn(); risultati.push(["ok", nome]); console.log("ok   -", nome); }
  catch(e){ risultati.push(["FAIL", nome]); console.log("FAIL -", nome, "\n      ", e && e.message); }
}

// ---------------------------------------------------------------- test
const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
const tutteEsterne = [];
try{
  // ======================= operaio
  const w = await apri(browser, base, "worker");
  const { page, sb } = w;
  await page.evaluate(()=>window.nuovoRapportinoAutonomo());
  await page.waitForSelector("#vista-rapportino:not(.nascosto)");
  await page.fill("#rf-cliente", "Rossi Srl");
  await page.fill("#rf-indirizzo", "Via Roma 1");
  await page.fill("#rf-attivita", "cambiato filtro caldaia prova ok");

  await prova("operaio: pulsanti AI visibili nel rapportino, assistente dati nascosto", async()=>{
    for(const s of ["#rf-ai-genera", "#rf-ai-migliora", "#rf-ai-correggi", "#rf-ai-suggerimenti", "#rf-ai-controllo"]) assert.ok(await visibile(page, s), s);
    assert.equal(await page.$eval("#ai-chiedi", el=>el.classList.contains("vietato")), true);
    assert.equal(await page.$eval("#ai-tendenze", el=>el.classList.contains("vietato")), true);
    assert.equal(await page.$eval("#ai-cerca", el=>el.classList.contains("vietato")), false);
  });

  await prova("testo: anteprima modificabile, nessuna modifica senza conferma, Annulla non cambia nulla", async()=>{
    sb.stato.aiRisposta = { corpo: { ok: true, testo: "Sostituito il filtro della caldaia. Prova di funzionamento con esito positivo.", avvisi: ["Indicare il modello della caldaia"] } };
    await page.click("#rf-ai-genera");
    await page.waitForSelector("#ai-testo");
    assert.equal(await page.inputValue("#rf-attivita"), "cambiato filtro caldaia prova ok");
    const req = sb.stato.ai.at(-1);
    assert.equal(req.corpo.azione, "testo");
    assert.equal(req.corpo.modo, "genera");
    assert.equal(req.corpo.testo, "cambiato filtro caldaia prova ok");
    assert.equal(typeof req.corpo.contesto.firma, "boolean", "la firma viaggia solo come si/no");
    assert.match(req.auth, /^Bearer /);
    assert.ok(await page.isVisible("text=Indicare il modello della caldaia"));
    await foto(page, "1-anteprima-testo");
    await page.fill("#ai-testo", "Testo modificato dall'utente");
    await page.click("#ai-azioni >> text=Annulla");
    assert.ok(await page.$eval("#ai-foglio", el=>el.classList.contains("nascosto")));
    assert.equal(await page.inputValue("#rf-attivita"), "cambiato filtro caldaia prova ok");
  });

  await prova("testo: Applica usa il testo modificato e la bozza resta sul telefono (offline-first)", async()=>{
    await page.click("#rf-ai-migliora");
    await page.waitForSelector("#ai-testo");
    await page.fill("#ai-testo", "Sostituito il filtro. Prova positiva (verificato).");
    await page.click("#ai-applica");
    assert.equal(await page.inputValue("#rf-attivita"), "Sostituito il filtro. Prova positiva (verificato).");
    assert.match(await page.textContent("#rap-msg"), /Proposta dell'AI applicata/);
    await page.waitForTimeout(600);
    const b = await bozzaLocale(page, await idCorrente(page));
    assert.ok(b, "bozza nel database locale");
    assert.equal(b.rapportino.attivita, "Sostituito il filtro. Prova positiva (verificato).");
    assert.equal(sb.stato.scritture.filter(s=>/rapportini|salva_rapportino/.test(s)).length, 0, "nessun invio al server senza Salva");
  });

  await prova("errori API: limite (429), risposta non valida, errore server -> messaggio, Riprova, campo invariato", async()=>{
    const prima = await page.inputValue("#rf-attivita");
    sb.stato.aiRisposta = { status: 429, corpo: { errore: "Troppe richieste all'assistente: aspetta un minuto.", codice: "limite" } };
    await page.click("#rf-ai-correggi");
    await page.waitForSelector("#ai-msg.err");
    assert.match(await page.textContent("#ai-msg"), /Troppe richieste/);
    assert.ok(await page.isVisible("#ai-azioni >> text=Riprova"));
    sb.stato.aiRisposta = { grezzo: "<html>proxy</html>", status: 200 };
    await page.click("#ai-azioni >> text=Riprova");
    await page.waitForFunction(()=>/non valida/.test(document.getElementById("ai-msg").textContent));
    sb.stato.aiRisposta = { status: 503, corpo: { errore: "L'assistente AI non è ancora configurato sul server.", codice: "non_configurata" } };
    await page.click("#ai-azioni >> text=Riprova");
    await page.waitForFunction(()=>/configurato/.test(document.getElementById("ai-msg").textContent));
    assert.equal(await page.isVisible("#ai-azioni >> text=Riprova"), false, "configurazione mancante: niente Riprova");
    await page.click("#ai-azioni >> text=Chiudi");
    assert.equal(await page.inputValue("#rf-attivita"), prima);
  });

  await prova("suggerimenti: si applicano solo le voci scelte (materiale con quantita' modificata)", async()=>{
    sb.stato.aiRisposta = { corpo: { ok: true, attivita: ["Analisi dei fumi", "Pulizia bruciatore"], materiali: [{ a: "Guarnizione", q: "1" }], controlli: ["Verifica tiraggio"], storico: 3 } };
    await page.click("#rf-ai-suggerimenti");
    await page.waitForSelector("[data-att='0']");
    await page.click("#ai-applica");
    assert.match(await page.textContent("#ai-msg"), /Seleziona almeno/);
    await page.check("[data-att='0']");
    await page.check("[data-mat='0']");
    await page.fill("[data-qta='0']", "2");
    await page.click("#ai-applica");
    assert.match(await page.inputValue("#rf-attivita"), /\n- Analisi dei fumi$/);
    assert.doesNotMatch(await page.inputValue("#rf-attivita"), /Pulizia bruciatore/);
    const mat = await page.$$eval("#rf-materiali .mat-riga", rr=>rr.map(r=>[r.querySelector(".m-art").value, r.querySelector(".m-qta").value]));
    assert.deepEqual(mat, [["Guarnizione", "2"]]);
  });

  await prova("controllo automatico: segnalazioni senza rete AI; coerenza AI su richiesta", async()=>{
    const prima = sb.stato.ai.length;
    await page.click("#rf-ai-controllo");
    await page.waitForSelector("#ai-segn-base");
    const t = await page.textContent("#ai-segn-base");
    assert.match(t, /Manca la firma del cliente/);
    assert.match(t, /Mancano le ore lavorate/);
    assert.equal(sb.stato.ai.length, prima, "il controllo base non chiama l'AI");
    sb.stato.aiRisposta = { corpo: { ok: true, segnalazioni: [{ livello: "attenzione", campo: "materiali", messaggio: "Guarnizione non citata nelle attività", origine: "ai" }] } };
    await page.click("#ai-coerenza");
    await page.waitForSelector("#ai-segn-ai .ai-segn");
    assert.match(await page.textContent("#ai-segn-ai"), /Guarnizione non citata/);
    await foto(page, "2-controllo");
    assert.equal(sb.stato.ai.at(-1).corpo.azione, "controllo");
    await page.click("#ai-azioni >> text=Chiudi");
  });

  await prova("Completa: la conferma elenca le dimenticanze; rifiutando non parte nulla", async()=>{
    await page.fill("#rf-ore .rf-dalle", "08:00");
    await page.fill("#rf-ore .rf-alle", "10:00");
    let testo = "";
    page.once("dialog", d=>{ testo = d.message(); d.dismiss(); });
    await page.click("#rf-completa");
    await page.waitForTimeout(300);
    assert.match(testo, /Prima di completare controlla/);
    assert.match(testo, /Manca la firma del cliente/);
    assert.equal(sb.stato.scritture.filter(s=>/salva_rapportino/.test(s)).length, 0);
  });

  await prova("offline: l'AI non parte (nessuna richiesta), il controllo e la bozza locale funzionano", async()=>{
    await w.ctx.setOffline(true);
    const prima = sb.stato.ai.length;
    await page.click("#rf-ai-migliora");
    await page.waitForSelector("#ai-msg.err");
    assert.match(await page.textContent("#ai-msg"), /Nessuna connessione/);
    assert.equal(sb.stato.ai.length, prima);
    await page.click("#ai-azioni >> text=Chiudi");
    await page.click("#rf-ai-controllo");
    await page.waitForSelector("#ai-segn-base");
    await page.click("#ai-coerenza");
    assert.match(await page.textContent("#ai-msg"), /Internet/);
    await page.click("#ai-azioni >> text=Chiudi");
    await page.fill("#rf-note", "Scritto offline");
    await page.waitForTimeout(600);
    const b = await bozzaLocale(page, await idCorrente(page));
    assert.equal(b.rapportino.note, "Scritto offline");
    await w.ctx.setOffline(false);
  });

  await prova("foto: scelta, riduzione JPEG prima dell'invio, materiali aggiunti solo se spuntati", async()=>{
    await page.setInputFiles("#rf-foto-file", { name: "quadro.png", mimeType: "image/png", buffer: PNG });
    await page.waitForFunction(()=>document.querySelectorAll("#rf-foto .foto-item img").length >= 1, null, { timeout: 10000 });
    sb.stato.aiRisposta = { corpo: { ok: true, descrizione: "Quadro elettrico con interruttori differenziali.", elementi: ["quadro"], materiali: ["Raccordo"], incertezze: ["marca non leggibile"] } };
    await page.click("#rf-ai-foto");
    await page.waitForSelector("#ai-analizza");
    await foto(page, "3-scelta-foto");
    await page.click("#ai-analizza");
    await page.waitForSelector("#ai-testo");
    const req = sb.stato.ai.at(-1).corpo;
    assert.equal(req.azione, "foto");
    assert.equal(req.immagini.length, 1);
    assert.match(req.immagini[0], /^data:image\/jpeg;base64,/);
    assert.ok(req.immagini[0].length < 1400000);
    await page.check("[data-mat='0']");
    await page.click("#ai-applica");
    assert.match(await page.inputValue("#rf-attivita"), /Quadro elettrico con interruttori differenziali\.$/);
    const mat = await page.$$eval("#rf-materiali .m-art", rr=>rr.map(r=>r.value));
    assert.ok(mat.includes("Raccordo"));
  });

  await prova("ricerca dell'operaio: risultati con testo dal server sempre scappato (niente HTML eseguito)", async()=>{
    await page.evaluate(()=>window.mostraVista("altro"));
    await page.fill("#ai-domanda", "i miei lavori da Rossi");
    sb.stato.aiRisposta = { corpo: { ok: true, filtri: { tipo: "tutti", dal: "2026-10-01", al: "2026-11-13", cliente: "", operaio: "", stato: "", parole: [], spiegazione: "Lavori da Rossi" },
      interventi: [], rapportini: [{ id: "c0000000-0000-4000-8000-000000000001", data: "2026-11-02", cliente: "<img src=x onerror=\"window.__xss=1\">", stato: "bozza", attivita: "x", operai: ["Mario"] }], nota: "" } };
    await page.click("#ai-cerca");
    await page.waitForSelector("#ai-esito .ai-ris");
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.__xss), undefined);
    assert.match(await page.textContent("#ai-esito"), /<img src=x/);
  });
  await prova("notifiche: Disattiva e Attiva funzionano; iscrizione con chiave sconosciuta (iOS) rifatta", async()=>{
    const esito = await page.evaluate(async()=>{
      const log = [];
      let attuale = { endpoint: "https://web.push.apple.com/vecchia", options: {},             // come iOS: chiave non leggibile
        unsubscribe: async()=>{ log.push("unsubscribe vecchia"); attuale = null; return true; } };
      const reg = { pushManager: {
        getSubscription: async()=>attuale,
        subscribe: async()=>{ log.push("subscribe"); attuale = { endpoint: "https://web.push.apple.com/nuova", options: {},
          toJSON: ()=>({ endpoint: "https://web.push.apple.com/nuova", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } }),
          unsubscribe: async()=>{ log.push("unsubscribe nuova"); attuale = null; return true; } }; return attuale; } } };
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(reg), register: async()=>reg, getRegistration: async()=>reg, addEventListener(){} } });
      Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted", requestPermission: async()=>"granted" } });
      if(!("PushManager" in window)) window.PushManager = function(){};
      try{ localStorage.removeItem("rapportino-vapid-iscrizione"); }catch(e){}
      const m = await import("./js/services/notifiche.js");
      const prima = await m.statoNotifiche();
      await m.attivaNotifiche();
      const dopo = await m.statoNotifiche();
      await m.disattivaNotifiche();
      const spente = await m.statoNotifiche();
      return { log, prima, dopo, spente, chiave: localStorage.getItem("rapportino-vapid-iscrizione") };
    });
    assert.equal(esito.prima, "spente", "chiave sconosciuta: da riattivare");
    assert.deepEqual(esito.log, ["unsubscribe vecchia", "subscribe", "unsubscribe nuova"]);
    assert.equal(esito.dopo, "attive");
    assert.equal(esito.spente, "spente");
    assert.equal(esito.chiave, null);
    const rpc = sb.stato.scritture.filter(x=>/notifiche_/.test(x));
    assert.ok(rpc.includes("POST /rest/v1/rpc/notifiche_disiscrivi") && rpc.includes("POST /rest/v1/rpc/notifiche_iscrivi"), rpc.join(", "));
  });
  tutteEsterne.push(...w.esterne);
  assert.deepEqual(w.errori, [], "errori JavaScript: " + w.errori.join("; "));
  await w.ctx.close();

  // ======================= company
  const c = await apri(browser, base, "company");
  await prova("company: assistente dati sì, AI nel rapportino no, verifica modelli no", async()=>{
    await c.page.evaluate(()=>window.mostraVista("altro"));
    assert.equal(await c.page.$eval("#ai-chiedi", el=>el.classList.contains("vietato")), false);
    assert.equal(await c.page.$eval("#ai-modelli", el=>el.classList.contains("vietato")), true);
    assert.equal(await c.page.$eval(".ai-barra", el=>el.classList.contains("vietato")), true);
    assert.equal(await c.page.$eval("#rf-ai-foto", el=>el.classList.contains("vietato")), true);
    assert.equal(await c.page.$eval("#rf-ai-controllo", el=>el.classList.contains("vietato")), false);
  });
  await prova("company: risposta alla domanda mostrata come testo, con periodo inviato", async()=>{
    c.sb.stato.aiRisposta = { corpo: { ok: true, risposta: "Ottobre: 12 ore per Rossi.\n<b>non html</b>", dati_usati: ["PER CLIENTE"], limiti: "", periodo: { dal: "2026-08-15", al: "2026-11-13" }, righe: { interventi: 3, rapportini: 4 } } };
    await c.page.fill("#ai-domanda", "quante ore per Rossi?");
    await c.page.click("#ai-chiedi");
    await c.page.waitForSelector("#ai-esito .ai-risposta");
    assert.equal(await c.page.$eval("#ai-esito .ai-risposta", el=>el.querySelector("b")), null);
    assert.match(await c.page.textContent("#ai-esito .ai-risposta"), /12 ore per Rossi/);
    await c.page.$eval("#ai-esito", el=>el.scrollIntoView());
    await foto(c.page, "4-domanda-company");
    const req = c.sb.stato.ai.at(-1).corpo;
    assert.equal(req.azione, "domanda");
    assert.match(req.dal, /^\d{4}-\d{2}-\d{2}$/);
  });
  tutteEsterne.push(...c.esterne);
  assert.deepEqual(c.errori, []);
  await c.ctx.close();

  // ======================= admin
  const a = await apri(browser, base, "admin");
  await prova("admin: tendenze -> 'Prepara intervento' compila il modulo senza salvare", async()=>{
    await a.page.evaluate(()=>window.mostraVista("altro"));
    for(const s of ["#ai-chiedi", "#ai-cerca", "#ai-tendenze", "#ai-modelli"]) assert.equal(await a.page.$eval(s, el=>el.classList.contains("vietato")), false, s);
    a.sb.stato.aiRisposta = { corpo: { ok: true, sufficienti: true, commento: { sintesi: "Manutenzioni regolari.", suggerimenti: ["Pianificare Verdi"] },
      statistiche: { periodo: { dal: "2025-11-14", al: "2026-11-13" }, rapportini: 10, interventi: 1, insufficienti: [], tendenze: null, anomalie: [],
        ricorrenze: [{ cliente: "Condominio Verdi", volte: 3, ogniGiorni: 60, regolare: true, ultima: "2026-09-01", prossimaStimata: "2026-12-30" }] } } };
    await a.page.click("#ai-tendenze");
    await a.page.waitForSelector("text=Prepara intervento");
    await a.page.$eval("#ai-esito", el=>el.scrollIntoView());
    await foto(a.page, "5-tendenze-admin");
    const scrittePrima = a.sb.stato.scritture.length;
    await a.page.click("text=Prepara intervento");
    await a.page.waitForSelector("#int-form:not(.nascosto)");
    assert.equal(await a.page.inputValue("#int-cliente"), "Condominio Verdi");
    assert.equal(await a.page.inputValue("#int-data"), "2026-12-30");
    assert.match(await a.page.inputValue("#int-descrizione"), /verifica prima di salvare/);
    await a.page.waitForTimeout(300);
    assert.equal(a.sb.stato.scritture.length, scrittePrima, "nessuna scrittura senza Salva");
  });
  await prova("admin: ricerca intelligente nello Storico imposta i filtri modificabili", async()=>{
    await a.page.evaluate(()=>window.mostraVista("storico"));
    a.sb.stato.aiRisposta = { corpo: { ok: true, filtri: { tipo: "tutti", dal: "2026-10-01", al: "2026-10-31", cliente: "Rossi", operaio: "", stato: "completato", parole: ["caldaia"], spiegazione: "Caldaie Rossi a ottobre" }, interventi: [], rapportini: [], nota: "" } };
    await a.page.fill("#st-ai", "caldaie Rossi a ottobre");
    await a.page.click("#st-ai-vai");
    await a.page.waitForFunction(()=>/Ricerca AI/.test(document.getElementById("st-stato-msg").textContent));
    assert.equal(await a.page.inputValue("#st-dal"), "2026-10-01");
    assert.equal(await a.page.inputValue("#st-al"), "2026-10-31");
    assert.equal(await a.page.inputValue("#st-stato"), "completato");
    assert.equal(await a.page.inputValue("#st-cerca"), "Rossi caldaia");   // cliente non in elenco: diventa parola chiave
  });
  tutteEsterne.push(...a.esterne);
  assert.deepEqual(a.errori, []);
  await a.ctx.close();

  await prova("nessuna richiesta verso servizi esterni reali (Groq, Supabase vero)", async()=>{
    assert.equal(tutteEsterne.filter(u=>/groq|supabase/.test(u)).length, 0, tutteEsterne.join(", "));
  });
}finally{
  await browser.close();
  srv.close();
}
const falliti = risultati.filter(r=>r[0] !== "ok");
console.log("\n" + (risultati.length - falliti.length) + "/" + risultati.length + " test superati");
process.exit(falliti.length ? 1 : 0);
