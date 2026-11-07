# Rapportino — COMP.HAS assistance SRL

Web app per compilare i rapporti di lavoro giornalieri: clienti e interventi, orari degli operai,
spese, firma del cliente, PDF da inviare per mail, report settimanali e mensili.
Funziona nel browser (pensata per iPhone/Safari) ed è pubblicata con GitHub Pages.

Nessun framework e nessun sistema di build: HTML, CSS e JavaScript a **moduli ES** nativi.
Librerie: **jsPDF 2.5.1** (da cdnjs) e **supabase-js 2.45.4** (copia locale in `js/vendor/`), più il font Inter.

L'app richiede l'accesso con **username e password** (nessuna registrazione pubblica, nessuna email).
Ruoli: `admin` (Luca), `company` (comphas), `worker` (operai creati dall'amministratore).

## Struttura

```
index.html                 struttura delle schermate, icone SVG, collegamenti a CSS e JS
css/
  variables.css            colori COMP.HAS, stati, raggi, ombre, spazi, font
  base.css                 reset, body, utilità (.nascosto, .sr), icone, focus
  layout.css               intestazione, titoli schermate, barra azioni, navigazione
  components.css           pulsanti, card, campi, home, schede cliente, calendario, clienti, firma…
  responsive.css           pad firma in orizzontale, schermi stretti, tablet, desktop
assets/logo/logo.js        logo aziendale (base64): serve all'intestazione e ai PDF
js/
  core/                    infrastruttura dell'app
    app.js                 punto di ingresso: sessione/login, archivio dell'utente, avvio per ruolo
    sessione.js            Supabase Auth: login via Edge Function, sessione, profilo, cambio password
    permessi.js            UNICA tabella dei permessi dell'interfaccia (data-permesso="…") e menu per ruolo
    azioni-html.js         espone su window le funzioni usate da onclick/onchange/oninput
    config.js              destinatario mail e progetto Supabase
    eventi.js              bus di eventi tra moduli (su / emetti / segnalaModifica)
    navigation.js          cambio schermata; i moduli registrano il proprio disegno
    preferenze.js          spunte di stampa salvate in localStorage
    storage.js             archivio: IndexedDB + copia in memoria + timbri di modifica
  modules/                 una sezione dell'app per file
    dashboard.js           Home: riepilogo giornata, elenco interventi, "Nuovo rapportino"
    rapportini.js          rapportino della giornata: carica, raccoglie, salva, cambia data
    interventi.js          schede cliente: fasce orarie, materiale, foto, urgenze, riordino
    operai.js              orario per operaio
    spese.js               spese ed extra con scontrino
    calendario.js          viste settimana e mese, griglia del mese
    clienti.js             anagrafica dai rapporti, ricerca, storico, suggerimenti nome/indirizzo
    report.js              aggregazione settimana/mese, monte ore, testi per mail
    altro.js               sezione Altro
    accesso.js             schermate di login e cambio password
    lavoro.js              dashboard dell'operaio (interventi assegnati, in lavorazione, completati, storico)
    pianificazione.js      company/admin: schede cliente, assegnazione operai, invio (con controllo concorrenza)
    consultazione.js       company/admin: rapportini compilati per mese e PDF
    utenti.js              admin: crea operai, disattiva/riattiva, reimposta password
  services/                servizi usati da più sezioni
    calculations.js        minuti lavorati, 9 ore ordinarie e straordinario, totali
    signature.js           pad firma a schermo intero, ritaglio, anteprima
    immagini.js            compressione foto, foto a schermo intero
    sync.js                sincronizzazione Supabase con la sessione dell'utente
    stato-schede.js        stato di una scheda (da fare / compilata / firmata), uguale alla regola del database
    unione.js              unione a tre vie delle modifiche concorrenti (scheda per scheda, campo per campo)
    backup.js              esporta / importa archivio JSON
    condivisione.js        invio PDF (condivisione Mail/Gmail) e testo (mailto)
    pdf/comune.js          intestazione, piè di pagina, misure firma
    pdf/giornata.js        PDF della giornata (per cliente A5 o foglio unico)
    pdf/report.js          PDF settimana e mese
  utils/                   funzioni piccole e senza stato
    dates.js               date italiane, giorni di settimana/mese, ora corrente
    formatters.js          ore, euro, saldo, HTML sicuro, evidenziazione
    dom.js                 icone SVG, pulsante "Ora"
```

supabase/                  backend (Supabase Free)
  migrations/              schema: profili, ruoli, policy RLS, trigger di controllo
  functions/               Edge Functions: accesso, cambia-password, utenti, inizializza
  config.toml              niente registrazione pubblica; verify_jwt per funzione
```

## Accesso, ruoli e sicurezza

- **Login**: la schermata chiede username e password. La Edge Function `accesso` trova l'account dallo
  username e fa verificare la password a **Supabase Auth**; il browser riceve la sessione standard.
  L'email interna (casuale, dominio riservato `.invalid`) non arriva mai al browser. Dopo 5 errori lo
  username è bloccato 15 minuti. Username inesistente e password sbagliata danno lo stesso messaggio.
- **Password**: nessuna password è nel codice o nel database applicativo. Primo accesso e reset
  obbligano a sceglierne una personale (≥ 10 caratteri, lettere e numeri, senza lo username).
  Cambiare password chiude tutte le sessioni (comportamento di Supabase): il telefono ne riceve una nuova.
- **Ruoli**: tabella `profili` (scrivibile solo dalle Edge Functions con la service_role key, che
  resta sul server). La funzione `utenti` crea **solo** operai e solo se chiamata dall'admin.
- **RLS** su `rapporti` (nessun accesso anonimo):

  | | admin | company | worker |
  |---|---|---|---|
  | leggere | tutto | tutto | solo giornate in `assegnati` |
  | creare giornate | sì | sì, senza ore/spese/lavoro/firme | sì (ne diventa assegnatario) |
  | modificare | sì | solo schede non ancora compilate e assegnazioni | giornate assegnate, non le assegnazioni |
  | eliminare | sì | no | no |

  Le regole che le policy non possono esprimere stanno nel trigger `controlla_rapporto`.
- **Modifiche concorrenti**: il salvataggio passa da `salva_giornata` (scrive solo se la giornata è ancora
  alla versione da cui si è partiti); in caso contrario il telefono unisce le modifiche (`unione.js`) e riprova.
- **Account disattivati**: non entrano, e le sessioni già aperte non leggono né scrivono più nulla.
- **Interfaccia**: `js/core/permessi.js` nasconde ciò che il ruolo non può usare; la protezione vera
  resta il database.

## Dipendenze tra moduli

Le frecce indicano "importa da". Non ci sono dipendenze circolari: quando un modulo "in basso"
deve avvisarne uno "in alto" usa un evento (`js/core/eventi.js`).

```
utils/*  ←  services/calculations  ←  core/storage, core/preferenze, services/sync
                                            ↑
modules/spese ← modules/interventi ← modules/rapportini → modules/operai
                       ↑                     ↑   ↑
               services/signature     modules/report   core/navigation
                                             ↑
modules/dashboard, modules/calendario, modules/clienti, modules/altro
services/pdf/*  ← services/condivisione
core/app.js e core/azioni-html.js importano i moduli (nessuno importa loro)
```

Eventi (chi li emette → chi ascolta):

| Evento | Emesso da | Ascoltato da |
|---|---|---|
| `giornata-modificata` | interventi, operai, spese, signature | rapportini → `salvaGiornata()` |
| `giornata-salvata` | rapportini | clienti → aggiorna i suggerimenti |
| `giornata-caricata` | rapportini | dashboard → ridisegna la Home se visibile |
| `firma-chiusa` | signature | dashboard |
| `archivio-aggiornato` | sync (`"sincronizzazione"`), backup (`"importazione"`) | rapportini, calendario, clienti (solo importazione) |
| `vista-cambiata` | navigation | clienti → chiude i suggerimenti |

## Dati (da non cambiare)

- IndexedDB `rapportino`, store `giorni`: un record per giorno, chiave `AAAA-MM-GG`.
  Il vecchio `localStorage["rapporti"]` viene migrato all'avvio e cancellato solo dopo la scrittura.
- `localStorage`: `timbri` (ultima modifica per giorno, per la sincronizzazione), preferenze
  `stampaExtra`, `pdfFoglioUnico`, `nascondiOreGiorno`, `nascondiOreMese`.
- Supabase: tabella `rapporti` (`data`, `dati`, `aggiornato`).
- Il backup è il JSON `{ "AAAA-MM-GG": giornata, … }`.

Formato di una giornata: `{ tecnici, escludi, operai:[{nome,dalle,alle}], clienti:[{id, nome, indirizzo,
fasce:[{d,a}], fatturare, importo, tipologia, stato, firmatario, dettagli, materiali:[{a,q}],
foto:[{src,w,h}], firma, urgente}], spese:[{d, i, allegato, clienteId}] }`.

## Aggiungere una funzionalità

1. Scegli dove va: una nuova sezione → nuovo file in `js/modules/`; qualcosa usato da più
   sezioni → `js/services/`; una funzione pura → `js/utils/`.
2. Esporta le funzioni con `export` e importale esplicitamente dove servono.
3. Se è una nuova schermata: aggiungi la `<section id="vista-nome">` in `index.html`, il nome in
   `VISTE` (`core/navigation.js`) e nel modulo chiama `registraVista("nome", disegna)`.
   Importa il modulo in `core/app.js`.
4. Se un modulo di livello basso deve avvisarne uno di livello alto, non importarlo: usa
   `emetti("evento")` / `su("evento", fn)`.
5. Se l'HTML usa `onclick="miaFunzione()"`, aggiungi `miaFunzione` a `core/azioni-html.js`
   (oppure, meglio, collega l'evento con `addEventListener` nel modulo).
6. Stili: colori e misure in `variables.css`, componenti in `components.css`, media query in `responsive.css`.

## Modificare una funzionalità esistente

- Clienti / ricerca / suggerimenti → `modules/clienti.js`
- Schede cliente del rapportino → `modules/interventi.js`; salvataggio e caricamento → `modules/rapportini.js`
- Calcolo ore → `services/calculations.js` (le 9 ore ordinarie sono `ORARIO_ORDINARIO`)
- PDF → `services/pdf/`; testi delle mail → `modules/report.js`
- Firma → `services/signature.js`
- Calendario e report → `modules/calendario.js` (schermate) e `modules/report.js` (dati)

Dopo una modifica prova almeno: nuovo rapportino, firma, PDF della giornata, calendario,
esporta/importa backup. Nei test non usare il server vero: blocca `supabase.co`.

## Supabase: messa in produzione

1. Applicare `supabase/migrations/20261107120000_utenti_ruoli.sql` (il file `…schema_iniziale.sql`
   descrive solo lo schema già esistente).
2. Pubblicare le Edge Functions `accesso`, `cambia-password`, `utenti`, `inizializza`
   (`accesso` e `inizializza` con verify_jwt disattivato).
3. Pannello Supabase → Authentication → disattivare "Allow new users to sign up".
4. Pannello Supabase → Edge Functions → Secrets: `CODICE_INIZIALE_LUCA` e `CODICE_INIZIALE_COMPHAS`
   con i codici iniziali scelti dal proprietario; poi chiamare una volta `inizializza`
   (crea Luca/admin e comphas/company solo se non esiste ancora un admin). Dopo l'uso si possono
   cancellare i segreti.
5. Pubblicare il frontend (push su `main`).

Test locali: stack Supabase con `supabase start` e le stesse migrazioni; le prove usano solo
credenziali di prova e non contattano il progetto di produzione.

## Eseguire e pubblicare

I moduli ES non si caricano aprendo il file con doppio clic (`file://`): serve un server.

```
cd rapportino
python3 -m http.server 8000
# poi apri http://localhost:8000/
```

Pubblicazione: basta fare push su `main`; GitHub Pages serve la cartella così com'è
(https://lcsoon93.github.io/rapportino/). Tutti i percorsi sono relativi (`./css/…`, `./js/…`),
quindi funzionano anche nella sottocartella `/rapportino/`.

La versione precedente in un unico file è nel ramo `versione-monolitica` e in `backup.html`.
