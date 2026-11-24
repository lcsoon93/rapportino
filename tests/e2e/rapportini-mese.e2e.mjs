// Rapportini: filtro per giorno (tre date diverse, combinato con stato e operaio, risposte lente) e
// PDF del mese (tutti / un operaio, più giorni, ore effettive, esclusi, cambio mese e anno, mese vuoto,
// condivisione). Playwright + Chromium con un finto Supabase; il PDF è generato davvero con jsPDF 2.5.1.
// Esecuzione: JSPDF=<percorso di jspdf.umd.min.js 2.5.1> node tests/e2e/rapportini-mese.e2e.mjs
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


const b64u = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = id=>b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: id, role: "authenticated", aud: "authenticated", exp: 4102444800 }) + ".x";
const UTENTI = {
  admin: { id: "b0000000-0000-4000-8000-000000000001", username: "luca", nome: "Luca Admin", cognome: "", ruolo: "admin", ruoli: ["admin", "worker"] },
  mario: { id: "b0000000-0000-4000-8000-000000000002", username: "mario", nome: "Mario Bianchi" },
  anna:  { id: "b0000000-0000-4000-8000-000000000003", username: "anna", nome: "Anna Verdi" },
};
const { admin: A, mario: M, anna: N } = UTENTI;
let n = 0;
const R = (data, autore, cliente, ore, extra = {})=>({ id: "r0000000-0000-4000-8000-" + String(++n).padStart(12, "0"), intervento_id: null, data, cliente, indirizzo: "Via " + cliente,
  telefono: "", tipologia: "Manutenzione", attivita: "Lavoro da " + cliente, materiali: [], note: "", esito: "Completato", firma: "", firmatario: "", stato: "completato",
  completato_il: data + "T17:00:00Z", versione: 2, aggiornato_il: data + "T17:00:00Z", autore_id: autore.id, interventi: null,
  rapportino_operai: ore.map(([op, dalle, alle])=>({ operaio_id: op.id, dalle: dalle + ":00", alle: alle + ":00" })), ...extra });
// tre giorni di novembre, più ottobre, dicembre e gennaio dell'anno dopo
const DATI = [
  R("2026-11-03", M, "Alfa Srl", [[M, "08:00", "12:00"]]),
  R("2026-11-03", M, "Beta Spa", [[M, "11:00", "13:00"]]),                         // sovrapposto ad Alfa: Mario 08-13 = 5h
  R("2026-11-03", N, "Gamma Snc", [[N, "08:00", "10:00"]]),
  R("2026-11-03", N, "Delta Sas", [[N, "10:00", "12:30"]]),                        // contiguo: Anna 4h 30m
  R("2026-11-13", M, "Epsilon Srl", [[M, "08:00", "12:30"], [N, "08:00", "12:30"]], { interventi: { id: "i1", ora: "08:00:00", descrizione: "Caldaia", cliente: "Epsilon Srl" } }),
  R("2026-11-13", N, "Zeta Spa", [[N, "13:00", "17:00"]]),
  R("2026-11-24", A, "Eta Srl", [[A, "09:00", "10:00"]]),
  R("2026-11-24", M, "Bozza Novembre", [[M, "14:00", "15:00"]], { stato: "bozza", completato_il: null }),
  R("2026-10-31", M, "Ottobre Srl", [[M, "08:00", "17:00"]]),
  R("2026-12-01", M, "Dicembre Srl", [[M, "08:00", "17:00"]]),
  R("2027-01-05", N, "Gennaio Srl", [[N, "08:00", "09:00"]]),
];
const FOTO_DI = DATI[0].id;

function nuovoSupabase(immagini){
  const u = A;
  const stato = { query: [], ritardo: 0 };
  DATI[0].firma = immagini.firma; DATI[0].firmatario = "ALFA";
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
      return json(route, [A, M, N].map(x=>({ id: x.id, username: x.username, nome: x.nome, attivo: true })));
    if(p === "/rest/v1/rapportini" && m === "GET"){
      stato.query.push(url.search);
      const eq = k=>(q.get(k) || "").replace(/^eq\./, "");
      const filtri = q.getAll("data");
      const elenco = DATI.filter(r=>(!eq("autore_id") || r.autore_id === eq("autore_id")) && (!eq("stato") || r.stato === eq("stato")) &&
        filtri.every(f=>{ const [op, v] = [f.slice(0, f.indexOf(".")), f.slice(f.indexOf(".") + 1)];
          return op === "eq" ? r.data === v : op === "gte" ? r.data >= v : op === "lte" ? r.data <= v : true; }));
      // lettura di un mese intero lenta: un filtro cambiato nel frattempo non deve essere sovrascritto
      const mese = filtri.some(f=>/^gte\.\d{4}-\d{2}-01$/.test(f)) && !filtri.some(f=>f.startsWith("eq."));
      if(mese && stato.ritardo) await new Promise(ok=>setTimeout(ok, stato.ritardo));
      return json(route, elenco);
    }
    if(p === "/rest/v1/allegati" && m === "GET"){
      const rid = (q.get("rapportino_id") || "").replace(/^eq\./, "");
      return json(route, rid === FOTO_DI ? [{ id: "a1", tipo: "foto", nome: "quadro.jpg", percorso: rid + "/a1.jpg", larghezza: 64, altezza: 48 }] : []);
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

async function apri(browser, base, immagini){
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Rome", locale: "it-IT" });
  const sb = nuovoSupabase(immagini);
  await ctx.route(/^https?:\/\//, route=>{
    const url = route.request().url();
    if(url.startsWith(base)) return route.continue();
    if(/\.supabase\.co\//.test(url)) return sb.gestisci(route);
    if(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/2\.5\.1\//.test(url)) return route.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(JSPDF) });
    return route.fulfill({ status: 204, body: "" });
  });
  const page = await ctx.newPage();
  // 23:30 del 30/11 in UTC = 00:30 dell'1/12 a Roma: mese e giorno sempre locali
  await page.clock.setFixedTime(new Date("2026-11-30T23:30:00Z"));
  const errori = [];
  page.on("pageerror", e=>errori.push(String(e)));
  page.on("dialog", d=>d.accept());
  await page.goto(base + "/index.html");
  await page.fill("#acc-username", A.username);
  await page.fill("#acc-password", "password-di-prova");
  await page.click("#acc-invia");
  await page.waitForFunction(()=>document.body.dataset.ruolo && document.body.dataset.ruolo !== "", null, { timeout: 15000 });
  return { ctx, page, sb, errori };
}
// rapportino rimasto sul telefono (completato offline, non ancora confermato dal server)
const metteSospeso = (page, autore, giorno)=>page.evaluate(({ autore, giorno })=>new Promise(ok=>{
  const r = indexedDB.open("rapportino-foto", 2);
  r.onsuccess = ()=>{ const tx = r.result.transaction("bozze", "readwrite");
    tx.objectStore("bozze").put({ id: "s0000000-0000-4000-8000-000000000001", autore, rapportino: { data: giorno, cliente: "Sospeso Snc" }, ore: [],
      stato: "in_attesa", completa: true, salvato: false, testoDaInviare: true, modificato: new Date().toISOString() });
    tx.oncomplete = ()=>ok(true); };
}), { autore, giorno });
async function scaricaMese(page){
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("#rm-condividi")]);
  const file = await dl.path();
  if(process.env.SCREENSHOT) fs.copyFileSync(file, path.join(process.env.SCREENSHOT, dl.suggestedFilename()));
  return { nome: dl.suggestedFilename(), testo: fs.readFileSync(file).toString("latin1") };
}
const risultati = [];
async function prova(nome, fn){
  try{ await fn(); risultati.push("ok"); console.log("ok   -", nome); }
  catch(e){ risultati.push("FAIL"); console.log("FAIL -", nome, "\n      ", e && String(e.message).split("\n").slice(0, 4).join(" | ")); }
}
const clientiElenco = page=>page.$$eval("#rap-nuovi .cli-nome", e=>e.map(x=>x.textContent).sort());
const attendiElenco = (page, attesi)=>page.waitForFunction(a=>{
  const v = [...document.querySelectorAll("#rap-nuovi .cli-nome")].map(x=>x.textContent).sort();
  return JSON.stringify(v) === JSON.stringify(a);
}, [...attesi].sort(), { timeout: 10000 });
const preparaMese = async (page, mese, operaio = "")=>{
  await page.click("#sb-seg-mese");
  await page.fill("#rm-mese", mese);
  await page.selectOption("#rm-operaio", operaio);
  await page.click("#rm-prepara");
  await page.waitForSelector("#rm-condividi:not(.nascosto)", { timeout: 20000 });
};

const srv = await avviaServer();
const base = "http://127.0.0.1:" + srv.address().port;
const browser = await chromium.launch();
try{
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

  const { page, sb, errori } = await apri(browser, base, immagini);
  await metteSospeso(page, A.id, "2026-11-13");
  await page.evaluate(()=>window.mostraVista("rapporti"));
  // "Stampa e report": il PDF del mese e' nella scheda "Mese"
  await page.click("#sb-seg-mese");
  await page.waitForSelector("#rm-prepara:visible");

  await prova("mese predefinito = mese locale (00:30 dell'1/12 a Roma -> dicembre, non novembre UTC)", async()=>{
    assert.equal(await page.inputValue("#rap-mese"), "2026-12");
    assert.equal(await page.inputValue("#rm-mese"), "2026-12");
    await attendiElenco(page, ["Dicembre Srl"]);
  });

  await prova("filtro giornaliero: tre date diverse, compaiono solo i rapportini del giorno scelto", async()=>{
    await page.fill("#rap-mese", "2026-11"); await page.dispatchEvent("#rap-mese", "change");
    await attendiElenco(page, ["Alfa Srl", "Beta Spa", "Bozza Novembre", "Delta Sas", "Epsilon Srl", "Eta Srl", "Gamma Snc", "Zeta Spa"]);
    // il giorno scelto nel PDF della giornata filtra anche l'elenco
    await page.click("#sb-seg-giorno");
    await page.fill("#rg-data", "2026-11-13"); await page.dispatchEvent("#rg-data", "change");
    await attendiElenco(page, ["Epsilon Srl", "Zeta Spa"]);
    assert.equal(await page.inputValue("#rap-giorno"), "2026-11-13");
    const q = sb.stato.query.at(-1);
    assert.match(q, /data=gte\.2026-11-13/); assert.match(q, /data=lte\.2026-11-13/);
    await page.fill("#rap-giorno", "2026-11-03"); await page.dispatchEvent("#rap-giorno", "change");
    await attendiElenco(page, ["Alfa Srl", "Beta Spa", "Delta Sas", "Gamma Snc"]);
    await page.fill("#rap-giorno", "2026-11-24"); await page.dispatchEvent("#rap-giorno", "change");
    await attendiElenco(page, ["Bozza Novembre", "Eta Srl"]);
    await page.fill("#rap-giorno", "2026-11-25"); await page.dispatchEvent("#rap-giorno", "change");
    await page.waitForFunction(()=>/Nessun rapportino il mercoled/.test(document.getElementById("rap-nuovi").textContent));
  });

  await prova("filtro giornaliero combinato con stato e operaio", async()=>{
    await page.fill("#rap-giorno", "2026-11-24"); await page.dispatchEvent("#rap-giorno", "change");
    await attendiElenco(page, ["Bozza Novembre", "Eta Srl"]);
    await page.selectOption("#rap-filtro-stato", "completato");
    await attendiElenco(page, ["Eta Srl"]);
    await page.selectOption("#rap-filtro-stato", "");
    await page.fill("#rap-giorno", "2026-11-03"); await page.dispatchEvent("#rap-giorno", "change");
    await page.selectOption("#rap-filtro-operaio", N.id);
    await attendiElenco(page, ["Delta Sas", "Gamma Snc"]);
    await page.selectOption("#rap-filtro-operaio", "");
    await attendiElenco(page, ["Alfa Srl", "Beta Spa", "Delta Sas", "Gamma Snc"]);
  });

  await prova("risposta lenta del mese dopo la scelta del giorno: resta solo il giorno", async()=>{
    sb.stato.ritardo = 800;
    await page.click("#rap-giorno-tutti");                         // parte la lettura (lenta) del mese
    await page.waitForTimeout(100);
    await page.fill("#rap-giorno", "2026-11-13"); await page.dispatchEvent("#rap-giorno", "change");
    await page.waitForTimeout(1300);
    assert.deepEqual(await clientiElenco(page), ["Epsilon Srl", "Zeta Spa"]);
    sb.stato.ritardo = 0;
    await page.click("#rap-giorno-tutti");
    await attendiElenco(page, ["Alfa Srl", "Beta Spa", "Bozza Novembre", "Delta Sas", "Epsilon Srl", "Eta Srl", "Gamma Snc", "Zeta Spa"]);
    assert.equal(await page.inputValue("#rap-giorno"), "");
  });

  await prova("cambio mese: il giorno scelto non resta attivo su un altro mese", async()=>{
    await page.fill("#rap-giorno", "2026-11-13"); await page.dispatchEvent("#rap-giorno", "change");
    await attendiElenco(page, ["Epsilon Srl", "Zeta Spa"]);
    await page.evaluate(()=>spostaMeseRapporti(-1));
    await attendiElenco(page, ["Ottobre Srl"]);
    assert.equal(await page.inputValue("#rap-giorno"), "");
  });

  await prova("PDF della giornata: fascia oraria distinta dalle ore effettive (sovrapposte e contigue)", async()=>{
    await page.click("#sb-seg-giorno");
    await page.fill("#rg-data", "2026-11-03"); await page.dispatchEvent("#rg-data", "change");
    await page.click("#rg-prepara");
    await page.waitForSelector("#rg-condividi:not(.nascosto)", { timeout: 15000 });
    const t = await page.textContent("#rg-orario");
    assert.match(t, /Fascia oraria della giornata: 08:00–17:00 \(9 ore\)/);
    assert.match(t, /Ore effettivamente lavorate nei rapportini: 9h 30m/);
    assert.match(t, /Mario Bianchi 5 ore/); assert.match(t, /Anna Verdi 4h 30m/);
    const nomi = await page.$$eval("#rg-esito .cli-elenco .cli-nome", e=>e.map(x=>x.textContent.replace(/^\d+\. /, "")).sort());
    assert.deepEqual(nomi, ["Alfa Srl", "Beta Spa", "Delta Sas", "Gamma Snc"], "solo il giorno scelto");
  });

  await prova("PDF del mese (tutti): più giorni e operai, ore per giorno/operaio, totale, esclusi a parte", async()=>{
    await preparaMese(page, "2026-11");
    const r = await page.textContent("#rm-esito");
    assert.match(r, /7 rapportini completati in 3 giorni/);
    // 03: Mario 5h + Anna 4h30 = 9h30; 13: Mario 4h30 + Anna 08-12:30 e 13-17 = 8h30 -> 13h; 24: Luca 1h
    assert.equal(await page.textContent("#rm-totale"), "23h 30m");
    assert.match(r, /Mario Bianchi: 9h 30m/); assert.match(r, /Anna Verdi: 13 ore/); assert.match(r, /Luca Admin: 1 ora/);
    assert.match(r, /03\/11\/2026 · 4 rapportini.*Ore lavorate: 9h 30m · fascia della giornata 08:00–17:00/s);
    assert.match(r, /13\/11\/2026 · 2 rapportini.*Ore lavorate: 13 ore/s);
    const esclusi = await page.textContent("#rm-esclusi");
    assert.match(esclusi, /24\/11\/2026 · Bozza Novembre \(Mario Bianchi\) — in bozza: non completato/);
    assert.match(esclusi, /13\/11\/2026 · Sospeso Snc \(Luca Admin\) — completato sul telefono ma non ancora inviato/);
    assert.doesNotMatch(r, /Ottobre Srl|Dicembre Srl/);
    const { nome, testo } = await scaricaMese(page);
    assert.equal(nome, "Rapportini_2026-11.pdf");
    for(const t of ["RAPPORTINI DEL MESE", "Novembre 2026", "ORE PER GIORNO", "ORE PER OPERAIO", "Totale del mese", "23h 30m", "9h 30m",
      "Alfa Srl", "Beta Spa", "Gamma Snc", "Delta Sas", "Epsilon Srl", "Zeta Spa", "Eta Srl", "Mario Bianchi", "Anna Verdi", "Luca Admin",
      "08:00", "12:30", "Intervento: 08:00 \u00b7 Caldaia", "NON INCLUSI", "Bozza Novembre", "Sospeso Snc", "08:00\x9617:00 \\(9 ore\\)"])
      assert.ok(testo.includes(t), "manca nel PDF: " + t);
    assert.ok(!testo.includes("Ottobre Srl") && !testo.includes("Dicembre Srl"), "solo il mese scelto");
    assert.ok((testo.match(/\/Subtype \/Image/g) || []).length >= 3, "logo, foto e firma");
    assert.ok(testo.indexOf("Lavoro da Alfa Srl") < testo.indexOf("Lavoro da Epsilon Srl") && testo.indexOf("Lavoro da Epsilon Srl") < testo.indexOf("Lavoro da Eta Srl"), "per giorno");
    assert.ok(!/Lavoro da Bozza Novembre/.test(testo), "la bozza non è tra i completati");
  });

  await prova("PDF del mese, singolo operaio: suoi rapportini e quelli dove compare, solo le sue ore", async()=>{
    await preparaMese(page, "2026-11", N.id);
    // Anna: Gamma 08-10 + Delta 10-12:30 (03); Epsilon 08-12:30 (rapportino di Mario) + Zeta 13-17 (13) = 13h, come con «Tutti»
    assert.equal(await page.textContent("#rm-totale"), "13 ore");
    const r = await page.textContent("#rm-esito");
    assert.match(r, /Epsilon Srl/); assert.doesNotMatch(r, /Alfa Srl|Beta Spa|Eta Srl|Bozza Novembre|Sospeso Snc/);
    assert.doesNotMatch(await page.textContent("#rm-riepilogo"), /Mario Bianchi/, "solo le ore di Anna");
    const { nome, testo } = await scaricaMese(page);
    assert.equal(nome, "Rapportini_2026-11_Anna_Verdi.pdf");
    assert.ok(testo.includes("Zeta Spa") && testo.includes("Epsilon Srl") && !testo.includes("Alfa Srl") && !testo.includes("Eta Srl"));
    assert.ok(testo.includes("Operaio: Anna Verdi"));
  });

  await prova("cambio mese e anno (dicembre 2026 -> gennaio 2027) e mese senza rapportini", async()=>{
    await preparaMese(page, "2026-12");
    assert.match(await page.textContent("#rm-esito"), /Dicembre Srl/);
    await page.evaluate(()=>spostaMesePDF(1));
    assert.equal(await page.inputValue("#rm-mese"), "2027-01");
    assert.ok(await page.isHidden("#rm-condividi"), "cambiando mese si prepara di nuovo");
    await page.click("#rm-prepara");
    await page.waitForSelector("#rm-condividi:not(.nascosto)");
    const r = await page.textContent("#rm-esito");
    assert.match(r, /Gennaio Srl/); assert.doesNotMatch(r, /Dicembre Srl/);
    await preparaMese(page, "2026-09");
    assert.match(await page.textContent("#rm-riepilogo"), /Nessun rapportino completato in Settembre 2026/);
    const { testo } = await scaricaMese(page);
    assert.ok(testo.includes("Nessun rapportino completato in questo mese."));
  });

  await prova("condivisione: il PDF del mese va al foglio di condivisione del telefono", async()=>{
    await preparaMese(page, "2026-11", M.id);
    await page.evaluate(()=>{
      window.__condivisi = [];
      navigator.canShare = d=>!!(d && d.files && d.files.length);
      navigator.share = async d=>{ window.__condivisi.push({ nome: d.files[0].name, tipo: d.files[0].type, dim: d.files[0].size }); };
    });
    await page.click("#rm-condividi");
    await page.waitForFunction(()=>window.__condivisi.length === 1, null, { timeout: 20000 });
    const c = await page.evaluate(()=>window.__condivisi[0]);
    assert.equal(c.nome, "Rapportini_2026-11_Mario_Bianchi.pdf");
    assert.equal(c.tipo, "application/pdf");
    assert.ok(c.dim > 2000);
  });

  await prova("Rapportini -> Mese -> Report ore del mese: apre il report dello stesso mese, con il ritorno a Rapportini", async()=>{
    await page.click("#sb-seg-mese");
    await page.fill("#rm-mese", "2026-11");
    await page.click("#rm-report-ore");
    await page.waitForSelector("#vista-mese:not(.nascosto)");
    assert.equal(await page.inputValue("#mesedata"), "2026-11");
    assert.ok(await page.isVisible("#vista-mese .m-sett"), "report ore visibile");
    assert.ok(await page.isVisible("#btn-pdf-mese"), "PDF report ore");
    assert.ok(await page.isHidden("#cal-testa"), "non è l'Agenda");
    await page.click("#vista-mese .solo-report-mese .indietro");
    await page.waitForSelector("#vista-rapporti:not(.nascosto)");
    // dall'Agenda la stessa vista mese mostra solo il calendario
    await page.evaluate(()=>mostraVista("mese"));
    assert.ok(await page.isVisible("#cal-testa") && await page.isHidden("#vista-mese .m-sett") && await page.isHidden("#btn-pdf-mese"));
    await page.evaluate(()=>mostraVista("rapporti"));
  });

  await prova("nessun errore JavaScript", async()=>{ assert.deepEqual(errori, []); });
}finally{
  await browser.close();
  srv.close();
}
const ko = risultati.filter(r=>r !== "ok").length;
console.log(`\n${risultati.length - ko}/${risultati.length} superati`);
process.exit(ko ? 1 : 0);
