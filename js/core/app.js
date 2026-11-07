// Punto di ingresso dell'app (caricato da index.html come modulo ES).
// Importa i moduli, espone gli handler usati dall'HTML e avvia l'app.
import "./azioni-html.js";
import { LOGO_B64 } from "../../assets/logo/logo.js";
import { SINC_ATTIVA } from "./config.js";
import { mostraVista } from "./navigation.js";
import { leggiPrefExtra, leggiPrefFoglioUnico, leggiPrefNascondiOre, leggiPrefNascondiOreMese } from "./preferenze.js";
import { caricaArchivio } from "./storage.js";
import { aggiornaClientiNoti } from "../modules/clienti.js";
import { caricaGiornata } from "../modules/rapportini.js";
import { sincronizza } from "../services/sync.js";
import { oggiIso } from "../utils/dates.js";
// moduli che si registrano da soli (viste, eventi, pad della firma)
import "../modules/dashboard.js";
import "../modules/calendario.js";
import "../modules/altro.js";
import "../services/signature.js";

document.getElementById("logoimg").src = LOGO_B64;
const oggi = oggiIso();     // data locale (toISOString dava il giorno prima tra mezzanotte e le 2)
document.getElementById("data").value = oggi;
document.getElementById("settdata").value = oggi;
document.getElementById("mesedata").value = oggi.slice(0,7);
const prefExtra = leggiPrefExtra();
["stampa-extra","stampa-extra-sett","stampa-extra-mese"].forEach(id=>{
  document.getElementById(id).checked = prefExtra;
});
document.getElementById("pdf-foglio-unico").checked = leggiPrefFoglioUnico();
document.getElementById("nascondi-ore-giorno").checked = leggiPrefNascondiOre();
document.getElementById("nascondi-ore-mese").checked = leggiPrefNascondiOreMese();
// l'archivio si legge da IndexedDB (asincrono): la giornata si disegna quando e' pronto
caricaArchivio().then(()=>{
  aggiornaClientiNoti();
  caricaGiornata(oggi);
  mostraVista("home");
  if(SINC_ATTIVA()){
    sincronizza();
    document.addEventListener("visibilitychange", ()=>{
      if(!document.hidden) sincronizza(true);
    });
    window.addEventListener("online", ()=>sincronizza(true));
  }
});
