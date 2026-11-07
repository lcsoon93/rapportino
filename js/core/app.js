// Punto di ingresso dell'app (caricato da index.html come modulo ES).
// Flusso: sessione salvata o login -> cambio password se richiesto -> archivio dell'utente -> app per ruolo.
import "./azioni-html.js";
import { LOGO_B64 } from "../../assets/logo/logo.js";
import { SINC_ATTIVA } from "./config.js";
import { costruisciNav, mostraVista } from "./navigation.js";
import { applicaPermessi, puo, vistaIniziale } from "./permessi.js";
import { leggiPrefExtra, leggiPrefFoglioUnico, leggiPrefNascondiOre, leggiPrefNascondiOreMese } from "./preferenze.js";
import { caricaArchivio, impostaProprietarioArchivio, leggiDB, leggiMappa, proprietarioArchivio, svuotaArchivioLocale } from "./storage.js";
import { su } from "./eventi.js";
import { profilo, ripristina } from "./sessione.js";
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
  document.getElementById("app-utente").textContent = (p.nome || p.username) + " · " + NOMI_RUOLO[p.ruolo];
  costruisciNav();
  applicaPermessi();
  aggiornaClientiNoti();
  document.getElementById("data").value = oggi;
  caricaGiornata(oggi);
  mostraVista(vistaIniziale());
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

(async function avvio(){
  let p = null;
  try{ p = await ripristina(); }catch(e){ console.error(e); }
  if(!p) p = await chiediAccesso();
  await entra(p);
})();
