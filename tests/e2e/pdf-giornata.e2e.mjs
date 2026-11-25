// PDF della giornata (Rapportini -> "PDF della giornata"): solo i rapportini COMPLETATI del giorno.
// Playwright + Chromium con un finto Supabase; il PDF e' generato davvero con jsPDF 2.5.1 (stessa
// versione dell'app) e poi letto per controllarne il contenuto. Nessuna richiesta esterna reale.
// jsPDF: JSPDF=<percorso di jspdf.umd.min.js> (es. npm i jspdf@2.5.1 in una cartella temporanea).
// Esecuzione: JSPDF=... node tests/e2e/pdf-giornata.e2e.mjs
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

const GIORNO = "2026-11-13";
const UTENTI = {
  admin:  { id: "b0000000-0000-4000-8000-000000000001", username: "luca", nome: "Luca Admin", cognome: "", ruolo: "admin", ruoli: ["admin", "worker"] },
  worker: { id: "b0000000-0000-4000-8000-000000000002", username: "mario", nome: "Mario Bianchi", cognome: "", ruolo: "worker", ruoli: ["worker"] },
  anna:   { id: "b0000000-0000-4000-8000-000000000003", nome: "Anna Verdi" },
};
const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";

function nuovoSupabase(ruolo, immagini){
  const u = UTENTI[ruolo];
  const stato = { query: [], impostazioni: [{ chiave: "ore_per_cliente", valore: true }] };
  const R = (id, extra)=>({ id, intervento_id: null, data: GIORNO, cliente: "", indirizzo: "", telefono: "", tipologia: "Manutenzione ordinaria",
    attivita: "", materiali: [], note: "", esito: "Completato", firma: "", firmatario: "", stato: "completato", completato_il: GIORNO + "T18:00:00Z",
    versione: 2, aggiornato_il: GIORNO + "T18:00:00Z", rapportino_operai: [], interventi: null, ...extra });
  const completati = [
    R("r0000000-0000-4000-8000-000000000002", { autore_id: UTENTI.anna.id, cliente: "Condominio Verdi", indirizzo: "Via Monza 3", attivita: "Sostituzione valvola",
      rapportino_operai: [{ operaio_id: UTENTI.anna.id, dalle: "14:00:00", alle: null }, { operaio_id: UTENTI.admin.id, dalle: null, alle: null }],
      completato_il: GIORNO + "T16:40:00Z", firmatario: "VERDI" }),
    R("r0000000-0000-4000-8000-000000000001", { autore_id: UTENTI.worker.id, cliente: "Rossi Srl", indirizzo: "Via Roma 10", telefono: "02 1234", attivita: "Pulizia bruciatore",
      materiali: [{ a: "Ugello 0.6", q: "1" }], firma: immagini.firma, firmatario: "ROSSI", completato_il: GIORNO + "T11:00:00Z",
      rapportino_operai: [{ operaio_id: UTENTI.worker.id, dalle: "08:00:00", alle: "10:30:00" }], interventi: { id: "i1", ora: "08:00:00", cliente: "Rossi Srl" } }),
  ];
  const bozza = R("r0000000-0000-4000-8000-000000000009", { autore_id: UTENTI.worker.id, cliente: "Bozza Spa", stato: "bozza", completato_il: null });
  const json = (route, corpo, status = 200)=>route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "content-range" }, body: JSON.stringify(corpo) });
  async function gestisci(route){
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname, q = url.searchParams;
    if(m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if(p === "/functions/v1/accesso") return json(route, { sessione: { access_token: jwt(u.id), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: u.id } } });
    if(p === "/auth/v1/user") return json(route, { id: u.id, aud: "authenticated", role: "authenticated" });
    if(p.startsWith("/auth/v1/") || p.startsWith("/functions/v1/")) return json(route, { ok: true });
    if(p.startsWith("/storage/v1/object/")) return route.fulfill({ status: 200, contentType: "image/jpeg", headers: { "access-control-allow-origin": "*" }, body: immagini.jpeg });
    if(p === "/rest/v1/profili"){ const prof = { ...u, attivo: true, deve_cambiare_password: false }; return json(route, /object/.test(req.headers()["accept"] || "") ? prof : [prof]); }
    if(p === "/rest/v1/rpc/operai_attivi" || p === "/rest/v1/rpc/nomi_utenti")
      return json(route, [UTENTI.worker, UTENTI.anna, UTENTI.admin].map(x=>({ id: x.id, username: x.username || "anna", nome: x.nome, attivo: true })));
    if(p === "/rest/v1/rapportini" && m === "GET"){
      stato.query.push(url.search);
      const autore = (q.get("autore_id") || "").replace(/^eq\./, "");
      const st = (q.get("stato") || "").replace(/^eq\./, "");
      const f = pre=>((q.getAll("data").find(x=>x.startsWith(pre + ".")) || "").slice(pre.length + 1));
      const dal = f("eq") || f("gte"), al = f("eq") || f("lte");
      let elenco = st === "completato" ? completati : st === "bozza" ? [bozza] : completati.concat([bozza]);
      if((dal && GIORNO < dal) || (al && GIORNO > al)) elenco = [];
      if(autore) elenco = elenco.filter(r=>r.autore_id === autore);
      return json(route, elenco);
    }
    if(p === "/rest/v1/impostazioni" && m === "GET") return json(route, stato.impostazioni);
    if(p === "/rest/v1/impostazioni"){                      // upsert dell'orario della giornata (solo admin)
      if(u.ruolo !== "admin") return json(route, { code: "42501", message: "new row violates row-level security policy" }, 403);
      [].concat(req.postDataJSON()).forEach(r=>{ stato.impostazioni = stato.impostazioni.filter(x=>x.chiave !== r.chiave).concat([r]); });
      return json(route, [], 201);
    }
    if(p === "/rest/v1/allegati" && m === "GET"){
      const rid = (q.get("rapportino_id") || "").replace(/^eq\./, "");
      return json(route, rid === completati[1].id ? [{ id: "a1", tipo: "foto", nome: "quadro.jpg", percorso: rid + "/a1.jpg", larghezza: 64, altezza: 48 }] : []);
    }
    if(p.startsWith("/rest/v1/")){
      if(m !== "GET" && m !== "HEAD") return json(route, [], 201);
      if(/object/.test(req.headers()["accept"] || "")) return json(route, null, 406);
      return json(route, []);
    }
    return json(route, {}, 404);
  }
  return { stato, gestisci };
}

async function apri(browser, base, ruolo, immagini){
  // telefono (touch): i PDF si condividono/scaricano; "computer" = mouse: finestra di stampa
  const telefono = ruolo !== "computer";
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true,
    ...(telefono ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }) });
  if(!telefono){
    // in headless l'anteprima di stampa non esiste (print() farebbe cadere la pagina): si intercetta e si
    // conta la richiesta di stampa della cornice, senza aprire la stampa vera
    await ctx.addInitScript(()=>{
      window.__stampe = 0;
      const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get(){
        const w = d.get.call(this);
        if(!w || !this.classList.contains("cornice-stampa")) return w;
        return { focus(){}, print(){ window.__stampe++; } };
      } });
    });
    ruolo = "admin";
  }
  const sb = nuovoSupabase(ruolo, immagini);
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
  const errori = [];
  page.on("pageerror", e=>errori.push(String(e)));
  page.on("dialog", d=>d.accept());
  await page.goto(base + "/index.html");
  await page.fill("#acc-username", UTENTI[ruolo].username);
  await page.fill("#acc-password", "password-di-prova");
  await page.click("#acc-invia");
  await page.waitForFunction(()=>document.body.dataset.ruolo && document.body.dataset.ruolo !== "", null, { timeout: 15000 });
  return { ctx, page, sb, errori, esterne };
}
// rapportino rimasto sul telefono (completato offline, non ancora confermato dal server)
const metteSospeso = (page, autore)=>page.evaluate(({ autore, giorno })=>new Promise(ok=>{
  const r = indexedDB.open("rapportino-foto", 2);
  r.onsuccess = ()=>{ const tx = r.result.transaction("bozze", "readwrite");
    tx.objectStore("bozze").put({ id: "s0000000-0000-4000-8000-000000000001", autore, rapportino: { data: giorno, cliente: "Sospeso Snc" }, ore: [],
      stato: "in_attesa", completa: true, salvato: false, testoDaInviare: true, modificato: new Date().toISOString() });
    tx.oncomplete = ()=>ok(true); };
}), { autore, giorno: GIORNO });
let scaricati = 0;
async function scaricaPDF(page){
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click("#rg-condividi")]);
  const file = await dl.path();
  if(process.env.SCREENSHOT) fs.copyFileSync(file, path.join(process.env.SCREENSHOT, (++scaricati) + "-" + dl.suggestedFilename()));
  return { nome: dl.suggestedFilename(), testo: fs.readFileSync(file).toString("latin1") };
}
const risultati = [];
async function prova(nome, fn){
  try{ await fn(); risultati.push(["ok", nome]); console.log("ok   -", nome); }
  catch(e){ risultati.push(["FAIL", nome]); console.log("FAIL -", nome, "\n      ", e && String(e.message).split("\n").slice(0, 4).join(" | ")); }
}

const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
try{
  // immagini vere (JPEG della foto, PNG della firma) generate dal browser
  const p0 = await browser.newPage();
  const immagini = await p0.evaluate(()=>{
    const c = document.createElement("canvas"); c.width = 64; c.height = 48;
    const g = c.getContext("2d"); g.fillStyle = "#c33"; g.fillRect(0, 0, 64, 48);
    const jpeg = c.toDataURL("image/jpeg", 0.8);
    g.clearRect(0, 0, 64, 48); g.strokeStyle = "#000"; g.beginPath(); g.moveTo(4, 40); g.lineTo(60, 8); g.stroke();
    return { jpeg, firma: c.toDataURL("image/png") };
  });
  immagini.jpeg = Buffer.from(immagini.jpeg.split(",")[1], "base64");
  await p0.close();

  // ======================= admin: tutti gli operai
  const a = await apri(browser, base, "admin", immagini);
  await metteSospeso(a.page, UTENTI.admin.id);
  await a.page.evaluate(()=>window.mostraVista("rapporti"));
  await a.page.waitForSelector("#rg-prepara");

  await prova("prepara: solo i completati, in ordine di orario; bozza e sospeso elencati come esclusi", async()=>{
    await a.page.fill("#rg-data", GIORNO);
    await a.page.click("#rg-prepara");
    await a.page.waitForSelector("#rg-condividi:not(.nascosto)", { timeout: 15000 });
    const nomi = await a.page.$$eval("#rg-esito .cli-elenco .cli-nome", e=>e.map(x=>x.textContent));
    assert.deepEqual(nomi, ["1. Rossi Srl", "2. Condominio Verdi"]);
    const esito = await a.page.textContent("#rg-esito");
    assert.match(esito, /Non inclusi/);
    assert.match(esito, /Bozza Spa — in bozza: non completato/);
    assert.match(esito, /Sospeso Snc — completato sul telefono ma non ancora inviato/);
    assert.match(esito, /Mario Bianchi 08:00–10:30 · 2h 30m/, "orario e ore passate dal cliente");
    // fascia oraria della giornata distinta dalle ore effettive dei rapportini (Mario 08:00-10:30)
    assert.match(esito, /Fascia oraria della giornata: 08:00–17:00 \(9 ore\)/);
    assert.match(esito, /Ore effettivamente lavorate nei rapportini: 2h 30m/);
    assert.match(esito, /Anna Verdi dalle 14:00, Luca Admin(?! \d)/);
    assert.match(await a.page.textContent("#rg-condividi"), /Condividi PDF \(2\)/);
    const q = a.sb.stato.query.find(s=>/stato=eq.completato/.test(s));
    assert.ok(q && /data=eq.2026-11-13/.test(q) && !/autore_id=eq/.test(q), "admin senza filtro: tutti gli operai");
    if(process.env.SCREENSHOT) await a.page.screenshot({ path: path.join(process.env.SCREENSHOT, "pdf-giornata.png") });
  });

  await prova("PDF: due rapportini in un file, ognuno con i propri tecnici e orari; esclusi assenti", async()=>{
    const { nome, testo } = await scaricaPDF(a.page);
    assert.equal(nome, "Rapportini_2026-11-13.pdf");
    for(const t of ["Rossi Srl", "Condominio Verdi", "Pulizia bruciatore", "Sostituzione valvola", "Ugello 0.6", "Mario Bianchi", "Anna Verdi", "Luca Admin",
      "08:00", "10:30", "dalle 14:00", "ORARIO", "TAGLIA QUI", "Tel. 02 1234"])
      assert.ok(testo.includes(t), "manca nel PDF: " + t);
    // pagina del cliente: orario e ore passate dal cliente; nel PDF niente pagina di riepilogo della giornata
    assert.ok(testo.includes("2h 30m"), "manca nel PDF: 2h 30m");
    for(const t of ["RIEPILOGO DELLA GIORNATA", "ORARIO DELLA GIORNATA", "CLIENTI E ORE DAL CLIENTE"])
      assert.ok(!testo.includes(t), "nel PDF non deve esserci: " + t);
    assert.ok(!testo.includes("Bozza Spa") && !testo.includes("Sospeso Snc"), "nel PDF solo i completati");
    assert.ok((testo.match(/\/Subtype \/Image/g) || []).length >= 2, "foto e firma nel PDF");
    assert.ok(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/.test(testo), "due rapportini A5 su A4 orizzontale");
  });

  await prova("impostazione 'Foglio unico' (Altro): più interventi in un solo A4, ognuno con i suoi tecnici; spenta torna A5", async()=>{
    await a.page.evaluate(()=>window.mostraVista("altro"));
    assert.equal(await a.page.isChecked("#pref-pdf-foglio-unico"), false, "spenta di serie");
    await a.page.check("#pref-pdf-foglio-unico");
    assert.equal(await a.page.evaluate(()=>localStorage.getItem("pdfFoglioUnico")), "1");
    assert.equal(await a.page.isChecked("#pdf-foglio-unico"), true, "stessa preferenza del vecchio foglio");
    await a.page.evaluate(()=>window.mostraVista("rapporti"));
    await a.page.fill("#rg-data", GIORNO);
    await a.page.click("#rg-prepara");
    await a.page.waitForSelector("#rg-condividi:not(.nascosto)", { timeout: 15000 });
    assert.match(await a.page.textContent("#rg-formato"), /foglio unico A4/);
    const { nome, testo } = await scaricaPDF(a.page);
    assert.equal(nome, "Rapportini_2026-11-13.pdf");
    assert.ok(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/.test(testo), "A4 verticale");
    assert.ok(testo.includes("RAPPORTO DI LAVORO GIORNALIERO") && !testo.includes("TAGLIA QUI"), "foglio unico, niente A5 da tagliare");
    for(const t of ["Rossi Srl", "Condominio Verdi", "Pulizia bruciatore", "Sostituzione valvola", "Tecnici: Mario Bianchi 08:00", "10:30", "2h 30m", "Anna Verdi dalle 14:00"])
      assert.ok(testo.includes(t), "manca nel PDF: " + t);
    assert.ok(!testo.includes("Bozza Spa") && !testo.includes("Sospeso Snc"), "solo i completati");
    // spenta: di nuovo due rapportini A5 per foglio
    await a.page.evaluate(()=>window.mostraVista("altro"));
    await a.page.uncheck("#pref-pdf-foglio-unico");
    await a.page.evaluate(()=>window.mostraVista("rapporti"));
    assert.match(await a.page.textContent("#rg-formato"), /due per foglio/);
    const dopo = await scaricaPDF(a.page);
    assert.ok(/\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/.test(dopo.testo) && dopo.testo.includes("TAGLIA QUI"), "A5 su A4 orizzontale");
    assert.ok(!dopo.testo.includes("Tecnici: Mario"), "riga tecnici solo nel foglio unico");
  });

  await prova("filtro operaio: un solo rapportino = rapportino A4 di quell'operaio", async()=>{
    await a.page.selectOption("#rg-operaio", UTENTI.anna.id);
    assert.ok(await a.page.isHidden("#rg-condividi"), "cambiando filtro si prepara di nuovo");
    await a.page.click("#rg-prepara");
    await a.page.waitForSelector("#rg-condividi:not(.nascosto)");
    const q = a.sb.stato.query.filter(s=>/stato=eq.completato/.test(s)).at(-1);
    assert.match(q, /autore_id=eq.b0000000-0000-4000-8000-000000000003/);
    const { nome, testo } = await scaricaPDF(a.page);
    assert.equal(nome, "Rapportini_2026-11-13_Anna_Verdi.pdf");
    assert.ok(testo.includes("Condominio Verdi") && !testo.includes("Rossi Srl"));
    assert.ok(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/.test(testo), "A4 verticale");
    assert.ok(testo.includes("(ORE)") && !testo.includes("RIEPILOGO DELLA GIORNATA"), "A4: colonna ORE, senza pagina di riepilogo");
    const volte = t=>(testo.match(new RegExp("\\(" + t + "\\)", "g")) || []).length;
    assert.equal(volte("Anna Verdi"), 1, "Anna nella tabella degli orari");
    assert.ok(testo.includes("Anna Verdi / Luca Admin"), "entrambi tra i tecnici");
    assert.equal(volte("Luca Admin"), 0, "chi non ha segnato l'orario non compare nella tabella degli orari");
  });

  await prova("Agenda -> Giorno -> Invia PDF: rapportini completati + schede compilate del foglio giornaliero del giorno scelto", async()=>{
    await a.page.evaluate(giorno=>import("./js/core/storage.js").then(m=>{
      const db = m.leggiDB();
      db[giorno] = { tecnici: "Luca Admin", escludi: false, spese: [], operai: [{ nome: "Luca Admin", dalle: "11:00", alle: "12:30" }],
        clienti: [{ id: "v1", nome: "Foglio Vecchio Snc", indirizzo: "Via Antica 2", fasce: [{ d: "11:00", a: "12:30" }], dettagli: "Verifica caldaia", materiali: [], foto: [], firma: "", firmatario: "", stato: "Completato" },
                  { id: "v2", nome: "Scheda Vuota", indirizzo: "", fasce: [], dettagli: "", materiali: [], foto: [], firma: "", firmatario: "" }] };
      m.scriviDB(db);
    }), GIORNO);
    await a.page.evaluate(g=>window.apriGiornoCal(g), GIORNO);
    await a.page.waitForSelector("#vista-calgiorno:not(.nascosto) #cg-pdf");
    assert.equal(await a.page.locator('#vista-altro .voce:has-text("PDF della giornata")').count(), 0, "in Altro non c'e' piu' il doppione");
    await a.page.click("#cg-pdf");
    await a.page.waitForSelector("#vista-rapporti:not(.nascosto) #rg-condividi:not(.nascosto)", { timeout: 15000 });
    assert.equal(await a.page.inputValue("#rg-data"), GIORNO);
    const nomi = await a.page.$$eval("#rg-esito .cli-elenco .cli-nome", e=>e.map(x=>x.textContent));
    assert.deepEqual(nomi, ["1. Rossi Srl", "2. Foglio Vecchio Snc", "3. Condominio Verdi"], "in ordine di orario, senza la scheda vuota");
    assert.match(await a.page.textContent("#rg-esito"), /Foglio giornaliero/);
    const { testo } = await scaricaPDF(a.page);
    for(const t of ["Rossi Srl", "Foglio Vecchio Snc", "Verifica caldaia", "Condominio Verdi", "11:00", "12:30"]) assert.ok(testo.includes(t), "manca: " + t);
    assert.ok(!testo.includes("Scheda Vuota") && !testo.includes("Bozza Spa") && !testo.includes("Sospeso Snc"));
    assert.ok(testo.includes("1h 30m") && testo.includes("2h 30m"), "ore passate da ogni cliente");
  });

  await prova("Apri giornata -> 'Invia PDF' (telefono): PDF del giorno aperto, non di oggi", async()=>{
    await a.page.evaluate(g=>window.apriGiornoCal(g), GIORNO);
    await a.page.waitForSelector("#vista-calgiorno:not(.nascosto) #cg-pdf");
    assert.equal((await a.page.textContent("#cg-pdf")).trim(), "Invia PDF");
    await a.page.evaluate(()=>{ document.getElementById("rg-data").value = "2026-01-01"; });   // un altro giorno gia' scelto
    await a.page.click("#cg-pdf");
    await a.page.waitForSelector("#vista-rapporti:not(.nascosto) #rg-condividi:not(.nascosto)", { timeout: 15000 });
    assert.equal(await a.page.inputValue("#rg-data"), GIORNO);
    assert.match(await a.page.textContent("#rg-condividi"), /Condividi PDF \(3\)/);
  });

  await prova("Giornata: orario della giornata 8-17 salvo inserimento; escludi dal monte ore; non compare nel PDF", async()=>{
    await a.page.evaluate(()=>window.mostraVista("giornata"));
    const giorno = async iso=>{ await a.page.fill("#og-giorno", iso); await a.page.dispatchEvent("#og-giorno", "change"); };
    // giorno senza nulla di inserito: 08:00-17:00, 9 ore
    await giorno("2026-11-12");
    await a.page.waitForFunction(()=>document.getElementById("og-ore").textContent === "9 ore");
    assert.equal(await a.page.inputValue("#og-dalle"), "08:00");
    assert.equal(await a.page.inputValue("#og-alle"), "17:00");
    assert.match(await a.page.textContent("#og-nota"), /Orario fisso 8–17/);
    assert.ok(await a.page.isHidden("#og-ripristina"));
    // giorno con il vecchio foglio: propone l'orario segnato li' finche' non se ne inserisce uno
    await giorno(GIORNO);
    await a.page.waitForFunction(()=>/foglio giornaliero/.test(document.getElementById("og-nota").textContent));
    assert.equal(await a.page.inputValue("#og-dalle"), "11:00");
    // inserisco io l'orario: 08:00-13:00 = 5 ore, salvato per quel giorno (non per gli altri)
    await a.page.fill("#og-dalle", "08:00");
    await a.page.waitForFunction(()=>/Salvato/.test(document.getElementById("og-nota").textContent));
    assert.equal(await a.page.textContent("#og-ore"), "4h 30m");
    await a.page.fill("#og-alle", "13:00");
    await a.page.waitForFunction(()=>document.getElementById("og-ore").textContent === "5 ore");
    assert.deepEqual(a.sb.stato.impostazioni.find(x=>x.chiave === "giornata:" + GIORNO).valore, { escludi: false, dalle: "08:00", alle: "13:00" });
    await a.page.check("#og-escludi");
    await a.page.waitForFunction(()=>document.getElementById("og-ore").textContent === "5 ore · esclusa");
    assert.equal(a.sb.stato.impostazioni.find(x=>x.chiave === "giornata:" + GIORNO).valore.escludi, true);
    // PDF della giornata: l'orario compare nell'anteprima, non nel PDF
    await a.page.evaluate(g=>window.apriPDFGiornata(g), GIORNO);
    await a.page.waitForSelector("#vista-rapporti:not(.nascosto) #rg-condividi:not(.nascosto)", { timeout: 15000 });
    assert.match(await a.page.textContent("#rg-orario"), /08:00–13:00 \(5 ore\).*esclusa dal monte ore/);
    const { testo } = await scaricaPDF(a.page);
    assert.ok(!testo.includes("esclusa dal monte ore") && !testo.includes("RIEPILOGO DELLA GIORNATA"), "il PDF non riporta l'orario della giornata");
  });

  await prova("Report mensile: rapportini + foglio, ore per operaio, giornata esclusa non sommata", async()=>{
    await a.page.evaluate(()=>{ document.getElementById("mesedata").value = "2026-11"; window.mostraVista("reportmese"); });
    await a.page.waitForFunction(()=>/Rossi Srl/.test(document.getElementById("meseelenco").textContent), null, { timeout: 15000 });
    const riga = await a.page.textContent("#meseelenco");
    assert.match(riga, /13\/11\/2026 · 08:00–13:00/);
    assert.match(riga, /ESCLUSA/);
    for(const t of ["Luca Admin 5 ore", "Mario Bianchi 5 ore", "Anna Verdi 5 ore", "Foglio Vecchio Snc (1h 30m)", "Rossi Srl (2h 30m)", "Condominio Verdi", "Bozza Spa"])
      assert.ok(riga.includes(t), "manca nel report: " + t);
    let ricap = await a.page.textContent("#mesericap");
    assert.match(ricap, /Giorni lavorati1/);
    assert.match(ricap, /escluse dal monte ore1/);
    assert.doesNotMatch(ricap, /Luca Admin|Mario Bianchi/, "giornata esclusa: nessuna ora sommata agli operai");
    assert.ok(await a.page.isHidden("#nascondi-ore-mese") && await a.page.isHidden("#ore-cliente-mese"), "niente opzioni di stampa");
    assert.equal(await a.page.locator('#vista-altro .voce:has-text("Report settimanale")').count(), 0);
    // tolgo "escludi" in Giornata: le ore entrano nel conteggio per operaio
    await a.page.evaluate(()=>window.mostraVista("giornata"));
    await a.page.uncheck("#og-escludi");
    await a.page.waitForFunction(()=>document.getElementById("og-ore").textContent === "5 ore");
    await a.page.evaluate(()=>window.mostraVista("reportmese"));
    await a.page.waitForFunction(()=>/Mario Bianchi \(1 g\.\)/.test(document.getElementById("mesericap").textContent));
    ricap = await a.page.textContent("#mesericap");
    for(const t of ["Luca Admin (1 g.)5 ore", "Mario Bianchi (1 g.)5 ore", "Anna Verdi (1 g.)5 ore"]) assert.ok(ricap.includes(t), "manca: " + t + " in " + ricap);
    // la griglia del mese segna il giorno con una bozza
    assert.ok(await a.page.$eval('#mese-griglia [data-giorno="2026-11-13"]', el=>el.classList.contains("dafirmare")));
    const [dl] = await Promise.all([a.page.waitForEvent("download", { timeout: 20000 }), a.page.click("#btn-pdf-mese")]);
    if(process.env.SALVA_PDF_MESE) fs.copyFileSync(await dl.path(), process.env.SALVA_PDF_MESE);   // anteprima a mano
    const pdf = fs.readFileSync(await dl.path()).toString("latin1");
    // per giorno: data e nome del giorno, cliente, sintesi dell'intervento, materiale (ore per operaio in fondo)
    for(const t of ["REPORT MENSILE", "Novembre 2026", "13/11/2026 Venerd\xec", "Cliente", "Intervento", "Materiale utilizzato",
      "Rossi Srl", "Pulizia bruciatore", "Ugello 0.6 (1)", "Condominio Verdi", "Sostituzione valvola", "Foglio Vecchio Snc", "Verifica caldaia"]) assert.ok(pdf.includes(t.replace(/[()]/g, "\\$&")), "manca nel PDF del mese: " + t);   // nel PDF le parentesi sono precedute da \\
    assert.ok(!pdf.includes("Clienti \\(ore dal cliente\\)"), "niente piu' colonne di ore per giorno");
    for(const t of ["Mario Bianchi", "Giorni lavorati", "5 ore", "monte ore"]) assert.ok(!pdf.includes(t), "niente orari degli operai nel PDF del mese: " + t);
  });

  await prova("giorno senza completati e offline: messaggi chiari, niente PDF", async()=>{
    await a.page.evaluate(()=>window.mostraVista("rapporti"));
    await a.page.selectOption("#rg-operaio", "");
    await a.page.fill("#rg-data", "2026-11-10");
    await a.page.click("#rg-prepara");
    await a.page.waitForFunction(()=>/Nessun rapportino completato il 10\/11\/2026/.test(document.getElementById("rg-msg").textContent));
    assert.ok(await a.page.isHidden("#rg-condividi"));
    await a.ctx.setOffline(true);
    await a.page.click("#rg-prepara");
    assert.match(await a.page.textContent("#rg-msg"), /Serve la connessione/);
    await a.ctx.setOffline(false);
  });
  assert.deepEqual(a.errori, [], a.errori.join("; "));
  await a.ctx.close();

  // ======================= computer: stampa invece di condivisione
  // Chromium completo (con il visualizzatore PDF, come Chrome sul computer): quello headless leggero
  // non ha il visualizzatore e scaricherebbe qualsiasi PDF aperto in una cornice
  const browserPC = await chromium.launch({ channel: "chromium" });
  const pc = await apri(browserPC, base, "computer", immagini);
  await prova("computer: 'Stampa PDF' apre la finestra di stampa del browser con il PDF (niente download)", async()=>{
    // la finestra di stampa in headless non si vede: si verifica che il PDF vero sia nella cornice di
    // stampa e che non venga scaricato ne' condiviso
    await pc.page.evaluate(()=>window.mostraVista("home"));
    assert.equal((await pc.page.textContent("#btn-pdf-home")).trim(), "Stampa PDF");
    await pc.page.evaluate(g=>window.apriGiornoCal(g), GIORNO);
    await pc.page.waitForSelector("#vista-calgiorno:not(.nascosto) #cg-pdf");
    assert.equal((await pc.page.textContent("#cg-pdf")).trim(), "Stampa PDF", "Apri giornata sul computer");
    await pc.page.evaluate(()=>window.mostraVista("rapporti"));
    await pc.page.fill("#rg-data", GIORNO);
    await pc.page.click("#rg-prepara");
    await pc.page.waitForSelector("#rg-condividi:not(.nascosto)");
    assert.match(await pc.page.textContent("#rg-condividi"), /Stampa PDF \(2\)/);
    let scaricato = false;
    pc.page.on("download", ()=>{ scaricato = true; });
    await pc.page.click("#rg-condividi");
    await pc.page.waitForSelector("iframe.cornice-stampa", { state: "attached" });
    const inizio = await pc.page.evaluate(async()=>{
      const f = document.querySelector("iframe.cornice-stampa");
      const b = await (await fetch(f.src)).arrayBuffer();
      return new TextDecoder("latin1").decode(new Uint8Array(b).slice(0, 5));
    });
    assert.equal(inizio, "%PDF-");
    await pc.page.waitForFunction(()=>window.__stampe >= 1, null, { timeout: 10000 });
    assert.equal(await pc.page.evaluate(()=>window.__stampe), 1, "una richiesta di stampa");
    assert.equal(scaricato, false, "sul computer nessun download");
    assert.match(await pc.page.textContent("#rg-condividi"), /Stampa PDF/, "il pulsante torna disponibile");
  });
  assert.deepEqual(pc.errori, [], pc.errori.join("; "));
  await pc.ctx.close();
  await browserPC.close();

  // ======================= operaio: solo i propri
  const w = await apri(browser, base, "worker", immagini);
  await prova("operaio: nessun filtro operaio, solo i propri rapportini completati", async()=>{
    await w.page.evaluate(()=>window.mostraVista("rapporti"));
    assert.ok(await w.page.$eval("#rg-operaio", el=>el.closest("[data-permesso]").classList.contains("vietato")));
    await w.page.fill("#rg-data", GIORNO);
    await w.page.click("#rg-prepara");
    await w.page.waitForSelector("#rg-condividi:not(.nascosto)");
    const q = w.sb.stato.query.find(s=>/stato=eq.completato/.test(s));
    assert.match(q, /autore_id=eq.b0000000-0000-4000-8000-000000000002/);
    const nomi = await w.page.$$eval("#rg-esito .cli-elenco .cli-nome", e=>e.map(x=>x.textContent));
    assert.deepEqual(nomi, ["1. Rossi Srl"]);
    const { testo } = await scaricaPDF(w.page);
    assert.ok(testo.includes("Rossi Srl") && !testo.includes("Condominio Verdi"));
    assert.ok(testo.includes("08:00") && testo.includes("10:30") && testo.includes("2h 30m"), "rapportino A4: orario e ore dal cliente");
  });
  assert.deepEqual(w.errori, [], w.errori.join("; "));
  assert.equal(a.esterne.concat(w.esterne).filter(u=>/supabase|groq/.test(u)).length, 0);
  await w.ctx.close();
}finally{
  await browser.close();
  srv.close();
}
const falliti = risultati.filter(r=>r[0] !== "ok");
console.log("\n" + (risultati.length - falliti.length) + "/" + risultati.length + " test superati");
process.exit(falliti.length ? 1 : 0);
