// Invio di notifiche Web Push (RFC 8030) con cifratura aes128gcm (RFC 8188 / RFC 8291) e
// autenticazione VAPID (RFC 8292). Solo WebCrypto: nessuna dipendenza esterna.
// La chiave privata VAPID esiste SOLO sul server (secret della Edge Function).

export type Iscrizione = { endpoint: string; p256dh: string; auth: string };
export type ChiaviVapid = { pubblica: string; privata: string; soggetto: string };

const enc = new TextEncoder();

export function b64url(dati: Uint8Array): string {
  let s = "";
  for (const b of dati) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function daB64url(t: string): Uint8Array {
  const s = t.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Uint8Array.from(atob(s + pad), (c) => c.charCodeAt(0));
}
function unisci(...parti: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parti.reduce((t, p) => t + p.length, 0));
  let i = 0;
  for (const p of parti) { out.set(p, i); i += p.length; }
  return out;
}
async function hkdf(sale: Uint8Array, ikm: Uint8Array, info: Uint8Array, byte: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: sale as BufferSource, info: info as BufferSource }, k, byte * 8));
}

// ---------------------------------------------------------------- cifratura del contenuto (RFC 8291)
export async function cifra(contenuto: Uint8Array, p256dh: string, auth: string, sale?: Uint8Array, effimera?: CryptoKeyPair) {
  const uaPub = daB64url(p256dh);
  const segretoAuth = daB64url(auth);
  if (uaPub.length !== 65 || segretoAuth.length !== 16) throw new Error("iscrizione non valida");
  const coppia = effimera || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", coppia.publicKey));
  const chiaveUa = await crypto.subtle.importKey("raw", uaPub as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: chiaveUa }, coppia.privateKey, 256));

  const ikm = await hkdf(segretoAuth, ecdh, unisci(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const s = sale || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(s, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const chiave = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  // un solo record: contenuto + delimitatore 0x02 (ultimo record)
  const cifrato = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource }, chiave, unisci(contenuto, new Uint8Array([2])) as BufferSource));
  const rs = 4096;
  const intestazione = unisci(s, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, asPub.length]), asPub);
  return unisci(intestazione, cifrato);
}

// ---------------------------------------------------------------- VAPID (JWT ES256)
async function chiavePrivata(v: ChiaviVapid): Promise<CryptoKey> {
  const pub = daB64url(v.pubblica);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("chiave pubblica VAPID non valida");
  return crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: v.privata, ext: false,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
export async function intestazioneVapid(endpoint: string, v: ChiaviVapid, scadenza?: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const exp = scadenza || Math.floor(Date.now() / 1000) + 12 * 3600;
  const parte = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
  const dati = parte({ typ: "JWT", alg: "ES256" }) + "." + parte({ aud, exp, sub: v.soggetto });
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await chiavePrivata(v), enc.encode(dati)));
  return "vapid t=" + dati + "." + b64url(firma) + ", k=" + v.pubblica;
}

// ---------------------------------------------------------------- invio
// esito: stato HTTP del servizio push (201 = consegnata; 404/410 = iscrizione scaduta, da eliminare)
export async function inviaPush(isc: Iscrizione, contenuto: unknown, v: ChiaviVapid, opz: { ttl?: number; urgenza?: string; argomento?: string } = {}) {
  const corpo = await cifra(enc.encode(JSON.stringify(contenuto)), isc.p256dh, isc.auth);
  const intestazioni: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    "TTL": String(opz.ttl ?? 86400),
    "Urgency": opz.urgenza || "high",
    "Authorization": await intestazioneVapid(isc.endpoint, v),
  };
  // Topic: una notifica non ancora consegnata viene sostituita dalla successiva sullo stesso argomento.
  // Apple (web.push.apple.com) la rifiuta con 400 BadWebPushTopic: li' non si invia (sul telefono
  // la sostituzione la fa comunque il "tag" della notifica nel service worker).
  const apple = /(^|\.)push\.apple\.com$/.test(new URL(isc.endpoint).hostname);
  if (opz.argomento && !apple) intestazioni["Topic"] = opz.argomento.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const r = await fetch(isc.endpoint, { method: "POST", headers: intestazioni, body: corpo as BodyInit });
  const testo = r.ok ? "" : (await r.text().catch(() => "")).slice(0, 300);
  return { stato: r.status, testo };
}
