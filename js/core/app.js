// Punto di ingresso dell'app (caricato da index.html come modulo ES).
// Flusso: sessione salvata o login -> cambio password se richiesto -> archivio dell'utente -> app per ruolo.
import "./azioni-html.js";
import { LOGO_B64 } from "../../assets/logo/logo.js";
import { SINC_ATTIVA } from "./config.js";
import { costruisciNav, mostraVista } from "./navigation.js";
import { applicaPermessi, puo, vistaIniziale } from "./permessi.js";
import { SPUNTE_ORE_CLIENTE, leggiPrefExtra, leggiPrefFoglioUnico, leggiPrefNascondiOre, leggiPrefNascondiOreMese, aggiornaSpunteOreCliente } from "./preferenze.js";
import { caricaImpostazioni } from "../services/impostazioni.js";
import { inviaNotificheInCoda, registraServiceWorker, ricollegaNotifiche } from "../services/notifiche.js";
import { apriDettaglioIntervento } from "../modules/agenda.js";
import { apriRapportino } from "../modules/modulo-rapportino.js";
import { caricaArchivio, impostaProprietarioArchivio, leggiDB, leggiMappa, proprietarioArchivio, svuotaArchivioLocale } from "./storage.js";
import { su } from "./eventi.js";
import { haRuolo, nomeCompleto, profilo, ripristina } from "./sessione.js";
import { chiediAccesso, chiediCambioPassword, nascondiSchermate } from "../modules/accesso.js";
import { aggiornaClientiNoti } from "../modules/clienti.js";
import { caricaGiornata } from "../modules/rapportini.js";
import { esportaBackup } from "../services/backup.js";
import { sincronizza } from "../services/sync.js";
import { oggiIso } from "../utils/dates.js";
import { avviaSincronizzazione, fermaSincronizzazione } from "../services/sinc-rapportini.js";
// moduli che si registrano da soli (viste, eventi, pad della firma)
import "../modules/dashboard.js";
import "../modules/calendario.js";
import "../modules/agenda.js";
import "../modules/storico.js";
import "../modules/altro.js";
import "../modules/lavoro.js";
import "../modules/gestione-interventi.js";
import "../modules/modulo-rapportino.js";
import "../modules/consultazione.js";
import "../modules/utenti.js";
import "../services/signature.js";

document.getElementById("logoimg").src = LOGO_B64;
document.querySelectorAll(".logo-dinamico").forEach(img=>{ img.src = LOGO_B64; });
const oggi = oggiIso();     // data locale (toISOString dava il giorno prima tra mezzanotte e le 2)
document.getElementById("data").value = oggi;
document.getElementById("settdata").value = oggi;
document.getElementById("cg-data").value = oggi;
document.getElementById("mesedata").value = oggi.slice(0,7);
const prefExtra = leggiPrefExtra();
["stampa-extra","stampa-extra-sett","stampa-extra-mese"].forEach(id=>{
  document.getElementById(id).checked = prefExtra;
});
document.getElementById("pdf-foglio-unico").checked = leggiPrefFoglioUnico();
document.getElementById("nascondi-ore-giorno").checked = leggiPrefNascondiOre();
document.getElementById("nascondi-ore-mese").checked = leggiPrefNascondiOreMese();
aggiornaSpunteOreCliente();                     // ultimo valore noto; poi si aggiorna dal server
function aggiornaImpostazioni(){
  caricaImpostazioni().then(aggiornaSpunteOreCliente).catch(e=>console.warn("Impostazioni non lette:", e.message));
}
// tornando sull'app si rilegge (l'admin puo' averla cambiata nel frattempo)
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && profilo) aggiornaImpostazioni(); });

const NOMI_RUOLO = { admin: "Amministratore", company: "Company", worker: "Operaio" };
let archivioPronto = null;
let ascoltoSincronizzazione = false;

// l'archivio sul telefono appartiene a un utente: se entra qualcun altro si ricomincia dal server
// (i dati non ancora inviati del precedente vengono prima salvati in un file di backup)
async function preparaArchivio(p){
  if(!archivioPronto) archivioPronto = caricaArchivio();
  await archivioPronto;
  const proprietario = proprietarioArchivio();
  if(proprietario && proprietario !== p.id){
    const sospesi = Object.keys(leggiMappa("inSospeso")).filter(k=>leggiDB()[k]);
    if(sospesi.length){
      esportaBackup();
      alert("Su questo telefono c'erano " + sospesi.length + " giornate non ancora inviate al server da un altro utente: " +
            "le ho salvate nel file di backup appena scaricato. Consegnalo all'amministratore.");
    }
    svuotaArchivioLocale();
  }
  // primo accesso su un telefono che aveva gia' rapporti (versione senza login): restano
  impostaProprietarioArchivio(p.id);
}

async function entra(p){
  if(p.deve_cambiare_password){
    const ok = await chiediCambioPassword(true);
    if(!ok) return;            // ha scelto "Esci": l'evento "uscita" riporta al login
  }
  await preparaArchivio(p);
  nascondiSchermate();
  document.getElementById("app-utente").textContent = nomeCompleto(p) + " · " + NOMI_RUOLO[p.ruolo] + (p.ruolo === "admin" && haRuolo("worker", p) ? " e operaio" : "");
  costruisciNav();
  applicaPermessi();
  aggiornaImpostazioni();
  aggiornaClientiNoti();
  document.getElementById("data").value = oggi;
  caricaGiornata(oggi);
  mostraVista(vistaIniziale());
  // notifiche: il telefono gia' iscritto resta collegato a questo utente; si inviano quelle in coda
  ricollegaNotifiche();
  inviaNotificheInCoda();
  apriDaLink(location.href);
  // rapportini rimasti sul telefono: invio automatico (all'avvio, al ritorno della rete e nell'app)
  if(puo("rapportini.compila")) avviaSincronizzazione().catch(e=>console.error(e));
  if(SINC_ATTIVA()){
    sincronizza();
    if(!ascoltoSincronizzazione){
      ascoltoSincronizzazione = true;
      document.addEventListener("visibilitychange", ()=>{
        if(!document.hidden && profilo) sincronizza(true);
      });
      window.addEventListener("online", ()=>{ if(profilo) sincronizza(true); });
    }
  }
}

// uscita volontaria, sessione scaduta o account disattivato: di nuovo il login
su("uscita", async motivo=>{
  fermaSincronizzazione();
  const p = await chiediAccesso(motivo === "scaduta" ? "Sessione scaduta: accedi di nuovo." : "");
  await entra(p);
});

// apertura da una notifica: ./?intervento=<id> oppure ./?rapportino=<id>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function apriDaLink(indirizzo){
  let q;
  try{ q = new URL(indirizzo).searchParams; }catch(e){ return; }
  const int = q.get("intervento"), rap = q.get("rapportino");
  if(int || rap) history.replaceState(null, "", location.pathname);      // non si riapre a ogni ricarica
  if(!profilo) return;
  if(int && UUID.test(int)) apriDettaglioIntervento(int);
  else if(rap && UUID.test(rap)) apriRapportino(rap);
}
registraServiceWorker();
if("serviceWorker" in navigator){
  // notifica toccata con l'app gia' aperta
  navigator.serviceWorker.addEventListener("message", e=>{
    if(e.data && e.data.tipo === "apri") apriDaLink(e.data.url);
  });
}

window.__appAvviata = true;     // l'avviso di avvio in index.html non serve piu'
(async function avvio(){
  let p = null;
  try{ p = await ripristina(); }catch(e){ console.error(e); }
  if(!p) p = await chiediAccesso();
  await entra(p);
})();
