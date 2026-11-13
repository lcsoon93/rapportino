# Rapportino — COMP.HAS assistance SRL

Web app per compilare i rapporti di lavoro giornalieri: clienti e interventi, orari degli operai,
spese, firma del cliente, PDF da inviare per mail, report settimanali e mensili.
Funziona nel browser (pensata per iPhone/Safari) ed è pubblicata con GitHub Pages.

Nessun framework e nessun sistema di build: HTML, CSS e JavaScript a **moduli ES** nativi.
Librerie: **jsPDF 2.5.1** (da cdnjs) e **supabase-js 2.45.4** (copia locale in `js/vendor/`), più il font Inter.

L'app richiede l'accesso con **username e password** oppure **username e PIN di 6 cifre** (nessuna
registrazione pubblica, nessuna email).
Ruoli: `admin` (Luca, che lavora anche come operaio: ruoli `admin` + `worker`), `company` (comphas),
`worker` (operai creati dall'amministratore).

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
    dashboard.js           Home admin: riepilogo interventi pianificati, riepilogo e schede del foglio giornaliero, "Nuovo rapportino"
    rapportini.js          rapportino della giornata: carica, raccoglie, salva, cambia data
    interventi.js          schede cliente: fasce orarie, materiale, foto, urgenze, riordino
    operai.js              orario per operaio
    spese.js               spese ed extra con scontrino
    calendario.js          viste settimana e mese (interventi + report giornate per l'admin), griglia del mese
    agenda.js              interventi in Home e Calendario: righe compatte, dettaglio intervento (stato per operaio), vista Giorno
    clienti.js             anagrafica dai rapporti, ricerca, storico, suggerimenti nome/indirizzo
    report.js              aggregazione settimana/mese, monte ore, testi per mail
    altro.js               sezione Altro
    accesso.js             schermate di login (password o PIN), cambio password e PIN di accesso
    lavoro.js              Home dell'operaio: i miei interventi (oggi, prossimi, da completare), da inviare, bozze, completati
    gestione-interventi.js admin/company: crea e modifica interventi, assegna operai, stato e rapportini collegati
    modulo-rapportino.js   modulo del rapportino (bozza/completa, ore, materiale, foto, firma, PDF; bozza sul telefono senza rete)
    consultazione.js       rapportini degli operai per mese (filtri) e giornate del foglio giornaliero
    utenti.js              admin: elenco con nome e cognome, ruoli, stato e PIN; crea operai; modifica nome/cognome
                           (e ruolo di operaio degli admin); rimuove PIN; disattiva/riattiva; reimposta password
  services/                servizi usati da più sezioni
    calculations.js        minuti lavorati, 9 ore ordinarie e straordinario, totali
    signature.js           pad firma a schermo intero, ritaglio, anteprima
    immagini.js            compressione foto (foglio giornaliero e rapportini: tipo, dimensione, impronta), schermo intero con ingrandimento
    sync.js                sincronizzazione Supabase con la sessione dell'utente
    api-lavori.js          accesso a interventi, rapportini, ore e allegati (tabelle nuove)
    avanzamento.js         chi ha completato e chi manca su un intervento con più operai (stessa regola del database)
    coda-locale.js         archivio locale (IndexedDB) dei rapportini e delle foto non ancora confermati dal server
    sinc-rapportini.js     coda di invio automatico: connessione, tentativi, risposte perse, conflitti
    stato-schede.js        stato di una scheda (da fare / compilata / firmata), uguale alla regola del database
    unione.js              unione a tre vie delle modifiche concorrenti (scheda per scheda, campo per campo)
    backup.js              esporta / importa archivio JSON
    condivisione.js        invio PDF (condivisione Mail/Gmail) e testo (mailto)
    pdf/comune.js          intestazione, piè di pagina (con data e numerazione), misure firma, righe di dati con separatori
    pdf/giornata.js        PDF della giornata (schede per cliente A5 o foglio unico) e del rapportino (schede, con orario dei tecnici)
    pdf/report.js          PDF settimana e mese
    pdf/cliente-mese.js    PDF riepilogo dei lavori di un cliente nel mese (dallo Storico)
  utils/                   funzioni piccole e senza stato
    dates.js               date italiane, giorni di settimana/mese, ora corrente
    formatters.js          ore, euro, saldo, HTML sicuro, evidenziazione
    dom.js                 icone SVG, pulsante "Ora"
supabase/                  backend (Supabase Free)
  migrations/              schema in ordine di applicazione: profili e ruoli, interventi e rapportini,
                           piu' operai, foto nello Storage, privilegi di rapporti, PIN e doppio ruolo,
                           recupero dell'accesso
  rollback/                annullamento di ogni migrazione (da eseguire in ordine inverso)
  functions/               Edge Functions: accesso, cambia-password, utenti, inizializza, pin
  config.toml              niente registrazione pubblica; verify_jwt per funzione
```

## Accesso, ruoli e sicurezza

- **Login**: la schermata chiede username e password. La Edge Function `accesso` trova l'account dallo
  username e fa verificare la password a **Supabase Auth**; il browser riceve la sessione standard.
  L'email interna (casuale, dominio riservato `.invalid`) non arriva mai al browser. Dopo 5 errori lo
  username è bloccato 15 minuti. Username inesistente e password sbagliata danno lo stesso messaggio.
- **PIN di 6 cifre** (facoltativo): si attiva da Altro → PIN di accesso con la password attuale (Edge
  Function `pin`); il login lo propone per l'ultimo utente che l'ha attivato su quel telefono, che ricorda
  solo lo username. Il PIN non è la password di Supabase Auth: la tabella `pin_accesso` (nessun accesso
  dal browser) contiene solo l'impronta PBKDF2-SHA256; se il PIN è giusto `accesso` crea la sessione
  standard sul server. 5 errori → blocco 15 minuti; 10 errori consecutivi → PIN eliminato (si rientra
  con la password); al massimo 30 tentativi ogni 15 minuti dalla stessa rete; PIN deboli rifiutati.
- **Password**: nessuna password è nel codice o nel database applicativo. Primo accesso e reset
  obbligano a sceglierne una personale (≥ 10 caratteri, lettere e numeri, senza lo username).
  Cambiare password chiude tutte le sessioni (comportamento di Supabase): il telefono ne riceve una nuova.
- **Password temporanea e recupero dell'accesso**: la password data dall'admin (nuovo operaio o
  "Reimposta password") vale **72 ore** (`profili.password_temporanea_scade`); poi l'accesso viene
  rifiutato e serve un nuovo reset. Il reset elimina il PIN, toglie i blocchi, chiude le sessioni del
  vecchio telefono e registra data e autore (`password_reimpostata_il` / `_da`, visibili solo all'admin
  nell'elenco utenti). Procedura completa e procedura di emergenza (unico amministratore) in
  `docs/interventi-rapportini.md`.
- **Ruoli**: tabella `profili` (scrivibile solo dalle Edge Functions con la service_role key, che
  resta sul server). `ruolo` è il ruolo principale (menu e permessi amministrativi); `ruoli` l'elenco
  completo: combinazioni ammesse `{admin}`, `{admin,worker}`, `{company}`, `{worker}`. Con `worker` si
  compare tra gli operai, si viene assegnati agli interventi e si compilano i propri rapportini.
  La funzione `utenti` crea **solo** operai e solo se chiamata dall'admin; il ruolo di operaio si può
  dare o togliere solo agli amministratori. L'app mostra sempre nome e cognome, mai identificativi.
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

## Interventi e rapportini

Tabelle `interventi`, `intervento_operai`, `rapportini`, `rapportino_operai`, `allegati` (vedi
`docs/interventi-rapportini.md`): l'admin (e la company) crea interventi e li assegna; l'operaio vede solo
i propri, compila rapportini collegati o autonomi, salva bozze e li completa. Il foglio giornaliero
(`rapporti`) resta com'era per l'admin, con il suo PDF.

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

## App installabile e notifiche

**App (PWA).** `manifest.webmanifest`, le icone in `assets/icone/` e il service worker `sw.js` rendono il
sito installabile: su iPhone Safari → Condividi → "Aggiungi alla schermata Home"; su Android Chrome →
"Installa app". Si apre a schermo intero. Il service worker scarica sempre i file dalla rete (si vede
l'ultima versione pubblicata) e usa la copia salvata solo senza rete; i dati di Supabase non passano da lì.

**Notifiche push** (Altro → Account → "Notifiche su questo telefono", da attivare su ogni telefono):
- operaio assegnato: intervento assegnato, modificato (data, ora, cliente, indirizzo, descrizione, priorità,
  tipologia), annullato, ripristinato, eliminato, oppure tolto dall'intervento;
- company: rapportino aggiunto (primo salvataggio sul server) o completato, da qualsiasi operaio;
- chi fa la modifica non riceve la propria notifica; toccandola si apre l'intervento o il rapportino.

Come funziona: i trigger della migrazione `20261115090000_notifiche.sql` scrivono destinatari e testi in
`notifiche_coda`; dopo ogni salvataggio l'app chiama la Edge Function `notifiche`, che svuota la coda
(una notifica per persona e argomento) e invia con Web Push (`_shared/webpush.ts`, VAPID + aes128gcm, solo
WebCrypto). Iscrizioni in `notifiche_iscrizioni`, solo verso i servizi push di Google, Apple, Mozilla e
Microsoft. Dal browser non si leggono né la coda né le iscrizioni degli altri. All'uscita il telefono
viene scollegato dall'utente.

Su iPhone servono iOS 16.4 o successivo e l'app aggiunta alla schermata Home.

Diagnosi: se Apple/Google rifiutano l'invio, la notifica di prova mostra in app lo stato e il motivo
restituiti dal servizio push (es. `403 BadJwtToken`); la funzione `notifiche` scrive lo stesso nei log
(`push <servizio> <stato> <motivo>`, senza endpoint né chiavi). Apple accetta in `VAPID_SUBJECT` solo un
`mailto:` reale o un `https://`: un dominio fittizio produce `BadJwtToken`.

Configurazione (una volta): eseguire la migrazione; nei secret delle Edge Functions `VAPID_PUBLIC_KEY`
(la stessa di `js/core/config.js`), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...`); pubblicare la
funzione `notifiche` (verify_jwt attivo). Cambiare la coppia di chiavi obbliga tutti a riattivare le notifiche.

## Supabase: messa in produzione

Stato al 08/11/2026: tutte le migrazioni fino a `20261113090000` sono applicate in produzione e le
cinque Edge Functions pubblicate. La procedura serve per un progetto nuovo o per ricostruirlo.

1. Backup (`create schema if not exists backup;` + copia di `rapporti` e `profili`).
2. Migrazioni, **in quest'ordine** (SQL Editor; il file `…schema_iniziale.sql` descrive solo lo schema
   già esistente):
   `20261107120000_utenti_ruoli` → `20261108090000_interventi_rapportini` →
   `20261109090000_interventi_piu_operai` → `20261110090000_allegati_storage` →
   `20261111090000_rapporti_privilegi` → `20261112090000_utenti_pin_ruoli` →
   `20261113090000_recupero_accesso`.
3. Edge Functions **dopo** le migrazioni (leggono colonne e funzioni create da queste):
   `accesso`, `cambia-password`, `utenti`, `inizializza`, `pin`
   (`accesso` e `inizializza` con verify_jwt disattivato, le altre attivo: vedi `supabase/config.toml`).
4. Pannello Supabase → Authentication → disattivare "Allow new users to sign up".
5. Pannello Supabase → Edge Functions → Secrets: `CODICE_INIZIALE_LUCA` e `CODICE_INIZIALE_COMPHAS`
   con i codici scelti dal proprietario; poi chiamare una volta `inizializza`
   (crea Luca/admin+operaio e comphas/company solo se non esiste ancora un admin). Per scelta del
   proprietario questi codici sono le password dei due account (si cambiano da Altro → Cambia password;
   consigliata una password di almeno 10 caratteri); gli operai devono invece cambiare la password
   al primo accesso. Dopo l'uso si possono cancellare i segreti.
6. Pubblicare il frontend (merge su `main`).

Rollback: in ordine inverso con i file di `supabase/rollback/` (dettagli e avvertenze in
`docs/interventi-rapportini.md`).

**Storico delle migrazioni**: in produzione le migrazioni sono state applicate dal SQL Editor, quindi
la tabella `supabase_migrations.schema_migrations` non le elenca. Prima di usare la CLI
(`supabase db push`) vanno segnate come già applicate, altrimenti la CLI proverebbe a rieseguirle:
`supabase migration repair --status applied 20261107120000 20261108090000 20261109090000 20261110090000 20261111090000 20261112090000 20261113090000`
(scrive in produzione: da fare solo con autorizzazione).

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
