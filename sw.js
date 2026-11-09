// Service worker di Rapportino: app installabile, apertura anche senza rete, notifiche push.
// File dell'app: prima la rete (cosi' si vede sempre l'ultima versione pubblicata), la copia salvata
// solo se la rete manca. I dati (Supabase) non passano mai di qui.
const CACHE = "rapportino-v2";
const STESSA_ORIGINE = self.location.origin;
const ESTERNI = ["https://cdnjs.cloudflare.com/", "https://fonts.googleapis.com/", "https://fonts.gstatic.com/"];

self.addEventListener("install", ()=>self.skipWaiting());
self.addEventListener("activate", e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys()) if(k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e=>{
  const r = e.request;
  if(r.method !== "GET") return;
  const url = r.url;
  const nostro = url.startsWith(STESSA_ORIGINE + "/") && !url.includes("/sw.js");
  if(!nostro && !ESTERNI.some(p=>url.startsWith(p))) return;      // Supabase e altro: direttamente in rete
  e.respondWith((async()=>{
    const cache = await caches.open(CACHE);
    try{
      // file dell'app: sempre ricontrollati sul server (niente versioni miste tra pagina e moduli)
      const risposta = nostro ? await fetch(r.url, { cache: "no-cache", credentials: "same-origin" }) : await fetch(r);
      if(risposta && (risposta.ok || risposta.type === "opaque")) cache.put(r, risposta.clone()).catch(()=>{});
      return risposta;
    }catch(err){
      const copia = await cache.match(r, { ignoreSearch: r.mode === "navigate" });
      if(copia) return copia;
      if(r.mode === "navigate"){ const home = await cache.match("./index.html") || await cache.match("./"); if(home) return home; }
      throw err;
    }
  })());
});

// ---------------------------------------------------------------- notifiche
self.addEventListener("push", e=>{
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = { testo: e.data ? e.data.text() : "" }; }
  const titolo = d.titolo || "Rapportino";
  e.waitUntil(self.registration.showNotification(titolo, {
    body: d.testo || "",
    icon: "assets/icone/icona-192.png",
    badge: "assets/icone/badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", e=>{
  e.notification.close();
  const dest = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil((async()=>{
    const finestre = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for(const c of finestre){
      if(c.url.startsWith(self.registration.scope)){
        await c.focus();
        c.postMessage({ tipo: "apri", url: dest });
        return;
      }
    }
    await self.clients.openWindow(dest);
  })());
});
