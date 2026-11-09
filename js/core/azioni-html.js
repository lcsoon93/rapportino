// Ponte per gli attributi onclick/onchange/oninput dell'HTML.
// Con i moduli ES le funzioni non sono piu' globali: qui si espongono su window SOLO
// quelle richiamate dagli handler inline (in index.html e nell'HTML generato dai moduli).
// Se aggiungi un onclick="nuovaFunzione()" aggiungi qui anche nuovaFunzione.
import { mostraVista } from "./navigation.js";
import { vaiASezione } from "../modules/altro.js";
import { disegnaMese, disegnaSettimana, eliminaGiorno, eliminaGiornoMese, spostaMese, spostaSettimana } from "../modules/calendario.js";
import { apriCliente, eseguiRicerca, nuovoPerCliente } from "../modules/clienti.js";
import { apriGiornoHome, apriIntervento, firmaIntervento, nuovoRapportino } from "../modules/dashboard.js";
import { aggiungiCliente, aggiungiFascia, aggiungiMateriale, aggiungiUrgenza, gestisciFoto, riprendiLavoro, spostaCliente, togliCliente, togliFascia } from "../modules/interventi.js";
import { aggiungiOperaio, togliOperaio } from "../modules/operai.js";
import { apriGiorno, copiaIeri, salvaGiornata, spostaGiorno, svuotaGiornata, vaiOggi } from "../modules/rapportini.js";
import { aggiungiSpesa, calcolaSpese, gestisciAllegatoSpesa, rimuoviAllegatoSpesa } from "../modules/spese.js";
import { esportaBackup, importaBackup } from "../services/backup.js";
import { inviaPDF, inviaPDFMese, inviaPDFSettimana, inviaTesto, inviaTestoMese, inviaTestoSettimana } from "../services/condivisione.js";
import { mostraFotoIntera } from "../services/immagini.js";
import { annullaFirmaOverlay, apriFirmaOverlay, chiudiFirmaOverlay, pulisciFirma, pulisciFirmaOverlay } from "../services/signature.js";
import { sincronizza } from "../services/sync.js";
import { oraAdesso } from "../utils/dom.js";
import { apriCambioPassword, apriPin, esciDallApp } from "../modules/accesso.js";
import { annullaInterventoUI, apriModuloIntervento, chiudiModuloIntervento, disegnaInterventi, eliminaInterventoUI, spostaPeriodoInterventi } from "../modules/gestione-interventi.js";
import { aggiungiFotoRapportino, aggiungiMaterialeRapportino, aggiungiOreRapportino, apriRapportino, chiudiRapportino, completaRapportino, inviaFotoOra, nuovoRapportinoAutonomo, pdfRapportino, rapportinoPerIntervento, riapriRapportinoAperto, risolviConflitto, salvaBozzaRapportino } from "../modules/modulo-rapportino.js";
import { disegnaRapporti, pdfRapporto, spostaMeseRapporti } from "../modules/consultazione.js";
import { annullaModificaUtente, azioneUtente, generaPasswordIniziale, modificaUtente } from "../modules/utenti.js";
import { eliminaBozzaLocale, riprovaInvio, sincronizzaOra } from "../modules/lavoro.js";
import { azzeraFiltriStorico, cambiaDateStorico, cercaStorico, disegnaStorico, pdfClienteStorico, scegliMeseStorico } from "../modules/storico.js";
import { apriDettaglioIntervento, apriFoglioGiornoCal, apriGiornoCal, chiudiDettaglioIntervento, modificaDaDettaglio, rapportinoDaDettaglio, spostaGiornoCal } from "../modules/agenda.js";

Object.assign(window, {
  mostraVista,
  vaiASezione,
  disegnaMese, disegnaSettimana, eliminaGiorno, eliminaGiornoMese, spostaMese, spostaSettimana,
  apriCliente, eseguiRicerca, nuovoPerCliente,
  apriGiornoHome, apriIntervento, firmaIntervento, nuovoRapportino,
  aggiungiCliente, aggiungiFascia, aggiungiMateriale, aggiungiUrgenza, gestisciFoto, riprendiLavoro, spostaCliente, togliCliente, togliFascia,
  aggiungiOperaio, togliOperaio,
  apriGiorno, copiaIeri, salvaGiornata, spostaGiorno, svuotaGiornata, vaiOggi,
  aggiungiSpesa, calcolaSpese, gestisciAllegatoSpesa, rimuoviAllegatoSpesa,
  esportaBackup, importaBackup,
  inviaPDF, inviaPDFMese, inviaPDFSettimana, inviaTesto, inviaTestoMese, inviaTestoSettimana,
  mostraFotoIntera,
  annullaFirmaOverlay, apriFirmaOverlay, chiudiFirmaOverlay, pulisciFirma, pulisciFirmaOverlay,
  sincronizza,
  oraAdesso,
  apriCambioPassword, apriPin, esciDallApp,
  annullaInterventoUI, apriModuloIntervento, chiudiModuloIntervento, disegnaInterventi, eliminaInterventoUI, spostaPeriodoInterventi,
  aggiungiFotoRapportino, aggiungiMaterialeRapportino, aggiungiOreRapportino, apriRapportino, chiudiRapportino, completaRapportino,
  inviaFotoOra, nuovoRapportinoAutonomo, pdfRapportino, rapportinoPerIntervento, riapriRapportinoAperto, risolviConflitto, salvaBozzaRapportino,
  eliminaBozzaLocale, riprovaInvio, sincronizzaOra,
  azzeraFiltriStorico, cambiaDateStorico, cercaStorico, disegnaStorico, pdfClienteStorico, scegliMeseStorico,
  disegnaRapporti, pdfRapporto, spostaMeseRapporti,
  annullaModificaUtente, azioneUtente, generaPasswordIniziale, modificaUtente,
  apriDettaglioIntervento, apriFoglioGiornoCal, apriGiornoCal, chiudiDettaglioIntervento, modificaDaDettaglio, rapportinoDaDettaglio, spostaGiornoCal
});
