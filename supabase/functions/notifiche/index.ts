// Notifiche push. La chiama l'app (utente collegato e attivo) dopo ogni salvataggio.
// Azioni:
//   invia (predefinita)  svuota la coda notifiche_coda (scritta dai trigger del database) e invia
//                        i messaggi ai telefoni iscritti dei destinatari
//   prova                invia una notifica di prova ai telefoni di chi chiama
// Chi chiama non sceglie destinatari ne' testi: li decide il database.
// Secret richiesti: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (es. mailto:...).
import { chiamante, clientAdmin, corpoJson, CORS, errore, risposta } from "../_shared/comune.ts";
import { ChiaviVapid, inviaPush } from "../_shared/webpush.ts";

type Messaggio = {
  id: number; destinatario: string; tipo: string; priorita: number; argomento: string;
  titolo: string; testo: string; url: string;
};
type Iscrizione = { endpoint: string; utente_id: string; p256dh: string; auth: string };

const SERVIZI = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)\//;

function chiaviVapid(): ChiaviVapid | null {
  const pubblica = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privata = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const soggetto = Deno.env.get("VAPID_SUBJECT") || "";
  return pubblica && privata && soggetto ? { pubblica, privata, soggetto } : null;
}

// invia un messaggio a tutte le iscrizioni dell'utente; elimina quelle scadute (404/410)
async function aUtente(admin: ReturnType<typeof clientAdmin>, iscrizioni: Iscrizione[], m: Omit<Messaggio, "id" | "destinatario" | "priorita">, v: ChiaviVapid) {
  let consegnate = 0;
  const errori: string[] = [];
  for (const isc of iscrizioni) {
    if (!SERVIZI.test(isc.endpoint)) continue;
    try {
      const r = await inviaPush(isc, { titolo: m.titolo, testo: m.testo, url: m.url, tag: m.argomento, tipo: m.tipo }, v,
        { argomento: m.argomento, ttl: 3 * 86400 });
      if (r.stato >= 200 && r.stato < 300) consegnate++;
      else if (r.stato === 404 || r.stato === 410) await admin.from("notifiche_iscrizioni").delete().eq("endpoint", isc.endpoint);
      else errori.push(r.stato + " " + r.testo);
      // nei log solo il servizio e lo stato (mai l'endpoint completo ne' le chiavi)
      console.log("push", new URL(isc.endpoint).host, r.stato, r.testo);
    } catch (e) {
      errori.push(String((e as Error).message || e));
      console.warn("push", new URL(isc.endpoint).host, "eccezione", String((e as Error).message || e));
    }
  }
  return { consegnate, errori };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return errore("Metodo non consentito", 405);
  const admin = clientAdmin();
  const io = await chiamante(req, admin);
  if (!io || !io.profilo.attivo) return errore("Sessione non valida. Accedi di nuovo.", 401);
  const v = chiaviVapid();
  if (!v) return errore("Notifiche non configurate sul server.", 503);
  const corpo = await corpoJson(req);

  if (corpo.azione === "prova") {
    const { data: isc } = await admin.from("notifiche_iscrizioni").select("endpoint, utente_id, p256dh, auth").eq("utente_id", io.profilo.id);
    if (!isc || !isc.length) return errore("Nessun telefono iscritto alle notifiche.", 404);
    const r = await aUtente(admin, isc as Iscrizione[], {
      tipo: "prova", argomento: "prova", titolo: "Notifiche attive", testo: "Da ora ricevi qui gli avvisi di Rapportino.", url: "./",
    }, v);
    return risposta({ ok: r.consegnate > 0, consegnate: r.consegnate, errori: r.errori });
  }

  // ---------------------------------------------------------------- svuota la coda
  const { data: coda, error } = await admin.rpc("notifiche_preleva", { p_limite: 200 });
  if (error) return errore("Errore nel leggere la coda delle notifiche.", 500);
  const messaggi = (coda || []) as Messaggio[];
  if (!messaggi.length) return risposta({ ok: true, inviate: 0 });

  // per ogni destinatario e argomento una sola notifica: vince la priorita' piu' alta, poi la piu' recente
  // (il testo e' sempre quello piu' recente: es. assegnato e poi spostato di orario = "Nuovo intervento" con l'orario nuovo)
  const scelti = new Map<string, Messaggio>();
  const ultimoTesto = new Map<string, { id: number; testo: string }>();
  for (const m of messaggi) {
    const k = m.destinatario + "|" + m.argomento;
    const c = scelti.get(k);
    if (!c || m.priorita > c.priorita || (m.priorita === c.priorita && m.id > c.id)) scelti.set(k, m);
    const t = ultimoTesto.get(k);
    if (!t || m.id > t.id) ultimoTesto.set(k, { id: m.id, testo: m.testo });
  }
  for (const [k, m] of scelti) scelti.set(k, { ...m, testo: ultimoTesto.get(k)!.testo });
  const destinatari = [...new Set([...scelti.values()].map((m) => m.destinatario))];
  const [{ data: attivi }, { data: iscrizioni }] = await Promise.all([
    admin.from("profili").select("id").in("id", destinatari).eq("attivo", true),
    admin.from("notifiche_iscrizioni").select("endpoint, utente_id, p256dh, auth").in("utente_id", destinatari),
  ]);
  const ok = new Set((attivi || []).map((p) => p.id));
  const perUtente = new Map<string, Iscrizione[]>();
  for (const i of (iscrizioni || []) as Iscrizione[]) {
    if (!perUtente.has(i.utente_id)) perUtente.set(i.utente_id, []);
    perUtente.get(i.utente_id)!.push(i);
  }

  let inviate = 0;
  const esiti = new Map<number, string>();
  const riprova: number[] = [];
  for (const m of scelti.values()) {
    const isc = perUtente.get(m.destinatario) || [];
    if (!ok.has(m.destinatario) || !isc.length) { esiti.set(m.id, "nessun telefono"); continue; }
    const r = await aUtente(admin, isc, m, v);
    if (r.consegnate) { inviate++; esiti.set(m.id, "consegnata a " + r.consegnate); }
    else if (r.errori.length) riprova.push(m.id);                 // errore del servizio push: si ritenta
    else esiti.set(m.id, "iscrizioni scadute");
  }
  // i messaggi assorbiti da un altro dello stesso argomento si chiudono insieme
  for (const m of messaggi) if (!esiti.has(m.id) && !riprova.includes(m.id)) esiti.set(m.id, "unita ad altra notifica");
  const adesso = new Date().toISOString();
  const gruppi = new Map<string, number[]>();
  for (const [id, e] of esiti) { if (!gruppi.has(e)) gruppi.set(e, []); gruppi.get(e)!.push(id); }
  for (const [e, ids] of gruppi) await admin.from("notifiche_coda").update({ inviata_il: adesso, esito: e }).in("id", ids);
  if (riprova.length) await admin.from("notifiche_coda").update({ preso_il: null, esito: "da ritentare" }).in("id", riprova);

  return risposta({ ok: true, inviate, ritentare: riprova.length });
});
