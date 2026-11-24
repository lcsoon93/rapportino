# Guida tecnica — Rapportino

Dettagli completi per chi modifica l'app (spostati dal README, che resta un riepilogo breve).
Interventi, rapportini, migrazioni e rollback: `docs/interventi-rapportini.md`. Test: `tests/LEGGIMI.md`.

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
    ricerca-computer.js    pagina search.html: ricerca, riepilogo, dettaglio, esportazioni (admin e company)
    dashboard.js           Home admin: riepilogo interventi pianificati, riepilogo e schede del foglio giornaliero, "Nuovo rapportino"
    rapportini.js          rapportino della giornata: carica, raccoglie, salva, cambia data
    interventi.js          schede cliente: fasce orarie, materiale, foto, urgenze, riordino
    operai.js              orario per operaio
    spese.js               spese ed extra con scontrino
    calendario.js          viste settimana e mese (interventi + report giornate per l'admin), griglia del mese
    agenda.js              interventi in Home e Calendario: righe compatte, dettaglio intervento (stato per operaio), vista Giorno
    clienti.js             sezione Clienti: anagrafica permanente (elenco, ricerca, scheda, modifica, archivio,
                           importazione dallo storico) + ricerca nei rapporti della vecchia app
    scelta-cliente.js      campo cliente con suggerimenti dall'anagrafica (rapportino e intervento)
    stampa-giornata.js     "PDF della giornata": i rapportini completati di un giorno in un solo PDF
    report.js              aggregazione settimana/mese, monte ore, testi per mail
    altro.js               sezione Altro
    accesso.js             schermate di login (password o PIN), cambio password e PIN di accesso
    lavoro.js              Home dell'operaio: i miei interventi (oggi, prossimi, da completare), da inviare, bozze, completati
    gestione-interventi.js admin/company: crea e modifica interventi, assegna operai, stato e rapportini collegati
    modulo-rapportino.js   modulo del rapportino (bozza/completa, ore, materiale, foto, firma, PDF; bozza sul telefono senza rete)
    consultazione.js       rapportini degli operai per mese (filtri) e giornate del foglio giornaliero
    utenti.js              admin: elenco con nome e cognome, ruoli, stato e PIN; crea operai; modifica nome/cognome
                           (e ruolo di operaio degli admin); rimuove PIN; disattiva/riattiva; reimposta password
    assistente-ai.js       interfaccia dell'assistente AI: pulsanti nel rapportino, ricerca nello Storico,
                           assistente dati in Altro; anteprima modificabile e conferma prima di applicare
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
    ai.js                  UNICO punto di accesso all'assistente AI (Edge Function "ai"): chiamate, limiti, errori, foto ridotte
    clienti-logica.js      regole dell'anagrafica: ricerca, omonimi, unione delle modifiche, importazione
    clienti-archivio.js    anagrafica sul telefono (IndexedDB), coda delle modifiche e sincronizzazione
    controlli.js           controllo automatico del rapportino (dati mancanti, ore, materiali, firma, foto), anche offline
    condivisione.js        invio PDF (condivisione Mail/Gmail) e testo (mailto)
    stampa.js              stampa di un PDF sul computer (cornice nascosta; Safari: nuova scheda)
    ricerca-logica.js      search.html: voci da rapportini e foglio, filtri, riepilogo, CSV (logica pura)
    pdf/comune.js          intestazione, piè di pagina (con data e numerazione), misure firma, righe di dati con separatori
    pdf/giornata.js        PDF della giornata (schede per cliente A5 o foglio unico) e del rapportino (schede, con orario dei tecnici)
    pdf/report.js          PDF settimana e mese
    pdf/cliente-mese.js    PDF riepilogo dei lavori di un cliente nel mese (dallo Storico)
    pdf/ricerca.js         PDF di search.html: scheda di una voce (con intervalli orari) e materiali selezionati
  utils/                   funzioni piccole e senza stato
    dates.js               date italiane, giorni di settimana/mese, ora corrente
    formatters.js          ore, euro, saldo, HTML sicuro, evidenziazione
    dom.js                 icone SVG, pulsante "Ora"
supabase/                  backend (Supabase Free)
  migrations/              schema in ordine di applicazione: profili e ruoli, interventi e rapportini,
                           piu' operai, foto nello Storage, privilegi di rapporti, PIN e doppio ruolo,
                           recupero dell'accesso
  rollback/                annullamento di ogni migrazione (da eseguire in ordine inverso)
  functions/               Edge Functions: accesso, cambia-password, utenti, inizializza, pin, notifiche, ai
                           (_shared/groq.ts, ai-logica.ts, ai-gestore.ts: assistente AI senza dipendenze esterne)
tests/                     test senza produzione: unit, server (Edge Function ai), e2e (Playwright), sql (Postgres locale)
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
(`push <servizio> <stato> <motivo>` per ogni invio, 201 = accettata; senza endpoint né chiavi). Apple accetta in `VAPID_SUBJECT` solo un
`mailto:` reale o un `https://`: un dominio fittizio produce `BadJwtToken`.
`VapidPkHashMismatch` (Apple) = il telefono è iscritto con una chiave pubblica diversa da quella del
server: l'app ricorda con quale chiave ha creato l'iscrizione e, se la chiave di `config.js` cambia,
la rifà al primo "Attiva notifiche" (su iOS la chiave dell'iscrizione non sempre è leggibile); se
l'errore resta, il secret `VAPID_PUBLIC_KEY` non coincide con `js/core/config.js`.

Configurazione (una volta): eseguire la migrazione; nei secret delle Edge Functions `VAPID_PUBLIC_KEY`
(la stessa di `js/core/config.js`), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...`); pubblicare la
funzione `notifiche` (verify_jwt attivo). Cambiare la coppia di chiavi obbliga tutti a riattivare le notifiche.

## Computer (desktop)

L'app si usa anche dal browser del computer (stesso indirizzo, stesso accesso):
- da 960 px menu laterale; da 1200 px menu con le voci per esteso, contenuto più largo, rapportino su due
  colonne (cliente e attività a sinistra; ore, foto e firma a destra), interventi, storico e clienti a
  griglia (tre colonne da 1600 px). Sul telefono non cambia nulla.
- **PDF = stampa**: sul computer (mouse o trackpad, nessuno schermo touch) ogni pulsante PDF apre la
  finestra di stampa del browser con il PDF (da lì anche "Salva come PDF"); le etichette diventano
  "Stampa PDF". Safari su Mac apre il PDF in una nuova scheda (poi Cmd+P). Sul telefono resta la
  condivisione. Unico punto: `condividi()` in `js/services/condivisione.js` e `stampaPDF()` in
  `js/services/stampa.js`, riconoscimento in `js/utils/dispositivo.js`.

### Ricerca dal computer (`search.html`)

Pagina a parte per amministratore e ufficio (indirizzo dell'app + `/search.html`; dall'app: stesso
browser, stessa sessione, nessun nuovo accesso). Sostituisce la vecchia dashboard che leggeva
`rapporti` con la chiave anonima (bloccata da RLS dalla migrazione utenti e ruoli).
- **Accesso** con nome utente e password (stessa Edge Function `accesso`); l'operaio vede solo
  "pagina riservata" e nessun dato viene letto. Chi deve cambiare la password è rimandato all'app.
- **Dati** (solo letture, decide RLS): rapportini nuovi (`elencoRapportini`), schede del vecchio foglio
  giornaliero (`rapporti`) e numero di interventi del periodo. Periodo: un mese oppure "Tutto lo storico".
- **Riepilogo**: rapportini completati (e bozze), ore dei soli completati, interventi programmati e
  completati, clienti distinti, spese anticipate del foglio giornaliero.
- **Ricerca**: parole in qualsiasi ordine, senza accenti, su cliente, indirizzo, telefono, lavoro,
  richiesta, note, materiali e operai; filtri giorno, operaio (per id nei rapportini, per nome nel
  foglio) e stato (completati, bozze, foglio).
- **Dettaglio** con "Stampa PDF" (finestra di stampa) e "Scarica PDF": nel PDF gli intervalli orari,
  non il totale delle ore.
- **Esportazione** delle voci spuntate: materiali in Excel (CSV con `;`, accenti corretti, celle che
  iniziano con `=`/`+`/`-`/`@` neutralizzate) e PDF dei materiali (stampa).
- File: `search.html`, `js/modules/ricerca-computer.js` (pagina), `js/services/ricerca-logica.js`
  (logica pura), `js/services/pdf/ricerca.js` (PDF). La vecchia copia `ricerca.html` è stata eliminata.

## Ore e giornate (ristrutturazione di novembre 2026)

Un solo modello, senza opzioni di stampa:
- **Ore dal cliente**: intervalli di `rapportino_operai` (dalle–alle) di quel rapportino; nei PDF dei
  rapportini ogni tecnico ha intervallo e durata ("08:00–10:30 · 2h 30m").
- **Orario della giornata**: 08:00–17:00 (9 ore) per tutti gli operai del giorno. L'amministratore può
  inserirne uno diverso e spuntare "Escludi dal monte ore" dalla Home. Si salva nella tabella
  `impostazioni` già esistente, chiave `giornata:AAAA-MM-GG`, valore `{ dalle, alle, escludi }`
  (legge chiunque, scrive solo l'admin: policy invariate, **nessuna migrazione**).
  Precedenza: orario inserito > orario del vecchio foglio di quel giorno (dati storici) > 8–17.
- **Giornata unita** (`js/services/giornate-logica.js`, logica pura con test): rapportini + vecchio foglio
  + orario inserito, nella forma del vecchio foglio, così report e PDF usano gli stessi dati. Un giorno
  conta se ha almeno un rapportino, oppure schede con nome o spese nel vecchio foglio. Operai del giorno:
  quelli delle ore dei rapportini (o l'autore) e quelli del vecchio foglio (nomi liberi ricondotti agli utenti).
- **Report mensile** (Calendario → Mese; `caricaMese`/`datiMese` in `js/modules/report.js`): per giorno
  orario, ore per operaio e clienti con le ore dal cliente; conteggio per operaio; le giornate escluse
  restano in elenco ma non si sommano. Unica opzione: confronto con il monte ore. Report settimanale tolto
  (la vista Settimana mostra solo gli interventi).
- **PDF della giornata**: ultima colonna (o pagina) "Riepilogo della giornata" con orario della giornata,
  tecnici e ore passate da ogni cliente.
- **Giorno scelto**: quello della Home vale anche per Calendario → Giorno e "PDF della giornata"
  (eventi `giornata-caricata` e `giorno-scelto`).
- **Menu Altro**: tolte le voci del vecchio foglio, del report settimanale, del testo e delle opzioni PDF;
  il vecchio foglio e il suo backup sono in "Archivio della vecchia app".
- File: `js/services/giornate-logica.js`, `js/services/orario-giornata.js`, Home in `js/modules/dashboard.js`.

## Giornata: interventi e lavori del giorno

Home → "Apri giornata" (e Calendario → Giorno) mostra il lavoro del giorno scelto, diviso in:
**Da eseguire** (interventi pianificati o in corso), **Eseguiti** (completati), **Lavori non programmati**
(rapportini creati senza intervento, di tutti gli operai per admin e company, i propri per l'operaio),
**Foglio giornaliero** (schede registrate quel giorno con il foglio della vecchia app: toccando si apre il
foglio) e **Annullati**. Ogni voce apre il dettaglio dell'intervento o il rapportino.
In alto, **Invia PDF** (sul computer **Stampa PDF**) prepara il PDF della giornata per il giorno aperto
(stessa scheda di Rapportini → "PDF della giornata"; `apriPDFGiornata(giorno)`).

La Home dell'admin usa gli stessi dati (non più il foglio giornaliero della vecchia app): "Riepilogo
giornata" con Lavori, Ore di lavoro (dal primo inizio all'ultima fine degli orari segnati nei rapportini
del giorno: unione, non somma), Eseguiti e Da eseguire; sotto, "Lavori di oggi" con le stesse sezioni.
"Nuovo rapportino" apre un rapportino normale (anagrafica clienti, telefono, sincronizzazione).
Il foglio giornaliero della vecchia app resta solo in Altro → "Rapportino della giornata".

## PDF della giornata (rapportini completati)

Rapportini → "PDF della giornata" (oppure Altro → "Invia PDF della giornata" e "Invia PDF" in Home, che
aprono questa scheda già preparata sul giorno del foglio giornaliero; "Invia PDF" in Apri giornata, sul giorno aperto): scegli il giorno (admin e company anche l'operaio, altrimenti tutti),
tocca **Prepara il PDF**, poi **Condividi PDF** (stampa, mail, salva).
- Comprende anche le schede compilate del foglio giornaliero della vecchia app per quel giorno (con i
  tecnici e gli orari della giornata), solo senza filtro operaio.
- Nel PDF solo i rapportini **completati** sul server, in ordine di orario (ora dell'intervento o primo
  orario dei tecnici). Bozze e rapportini rimasti sul telefono (non inviati, anche se completati offline)
  restano fuori e sono elencati sotto "Non inclusi".
- Impaginazione del foglio giornaliero: un rapportino = A4; più rapportini = due A5 per foglio A4
  orizzontale con "TAGLIA QUI". Ogni scheda ha i propri tecnici e orari, attività, materiali, foto e
  firma; il telefono del cliente accanto all'indirizzo.
- **Orari, non ore**: nei PDF dei rapportini (singolo e della giornata) si stampa per ogni tecnico solo
  l'intervallo segnato ("08:00–10:30", "dalle 14:00", "fino alle 17:00"); chi non l'ha segnato compare
  solo tra i tecnici. Mai il totale delle ore, anche con "Nelle stampe solo le ore per cliente" attiva
  (che resta valida per il foglio giornaliero e i report).
- L'operaio stampa i propri rapportini. Serve la connessione (dati e foto dal server, con i permessi
  dell'utente). Due passi perché su iPhone la condivisione deve partire subito dal tocco.

## Anagrafica clienti

Rubrica permanente condivisa dagli utenti attivi del progetto (tabella `clienti`, migrazione
`20261116090000_anagrafica_clienti.sql`). Ogni scheda: nome e cognome o ragione sociale (obbligatorio),
indirizzo, telefono, email, partita IVA, note, archiviato, **ID univoco** (uuid).

- **Omonimi**: il nome non è una chiave. Si possono creare più clienti con lo stesso nome, anche con lo
  stesso indirizzo; nessun vincolo di unicità, nessuna scheda sovrascritta perché il nome coincide.
  Elenco, ricerca e suggerimenti mostrano sempre nome + indirizzo (+ telefono); con più omonimi
  l'app lo dice e chiede di scegliere la scheda giusta, senza mai scegliere da sola.
- **Rapportino e intervento**: il campo Cliente suggerisce le schede mentre si scrive. Scegliendone una
  si **copiano** nome, indirizzo e telefono nel documento e si salva `cliente_id`. I campi restano
  modificabili per il singolo documento. Si può usare un cliente non in anagrafica o crearne uno al volo
  ("Nuovo cliente" / "Aggiungi all'anagrafica") senza lasciare il documento. Nuovo campo **Telefono**
  nell'intervento e nel rapportino (salvato, mostrato nel dettaglio, in "Il mio lavoro" e alla riapertura);
  il rapportino nato da un intervento ne copia cliente, indirizzo, telefono e collegamento.
- **Copia indipendente (snapshot)**: modificare la scheda non cambia i documenti già salvati; modificare
  il documento non cambia la scheda. Solo il pulsante esplicito "Aggiorna la scheda" (admin e company)
  copia indirizzo e telefono del documento nell'anagrafica, dopo conferma. Riscrivendo il nome nel
  documento il collegamento si toglie.
- **Permessi** (RLS): leggono tutti gli utenti attivi; creano tutti (l'operaio anche dal rapportino);
  modificano e archiviano admin e company; elimina solo l'admin e solo senza documenti collegati
  (altrimenti si archivia: gli archiviati spariscono dai suggerimenti, i documenti restano collegati).
  Isolamento: un progetto Supabase = un'azienda; chi non ha un profilo attivo non vede nulla.
- **Offline**: copia dell'anagrafica sul telefono (IndexedDB `rapportino-clienti`, per utente), ricerca e
  suggerimenti offline, nuove schede e modifiche in coda con l'id generato sul telefono (`salva_cliente`
  è idempotente: un reinvio non crea doppioni). Modifiche su una versione superata: unione campo per
  campo; se lo stesso campo è cambiato da entrambi la scheda mostra il confronto e si sceglie
  ("Tieni la mia" / "Tieni quella del server"). Le schede partono prima dei rapportini che le usano.
  Gli interventi, come prima, si salvano solo con la rete.
- **Dati esistenti**: rapportini e interventi di prima restano invariati (senza collegamento). In Clienti,
  "Importa dallo storico" (admin e company) propone le coppie nome + indirizzo dei lavori senza scheda:
  si creano solo quelle spuntate, i documenti non vengono modificati.

Rilascio (in quest'ordine):
1. SQL Editor: eseguire `supabase/migrations/20261116090000_anagrafica_clienti.sql` (solo aggiunte,
   ripetibile; rollback in `supabase/rollback/`).
2. Pubblicare il frontend (merge su `main`). Nessuna Edge Function da pubblicare.
Se il frontend arriva prima della migrazione l'app funziona come prima: le letture e le scritture di
interventi e rapportini riprovano senza i campi nuovi e la sezione Clienti avvisa che l'anagrafica non
è ancora attiva.

## Assistente AI (Groq)

Funzioni (tutte propongono, nessuna salva o modifica dati senza conferma dell'utente):

| Funzione | Dove | Ruoli |
|---|---|---|
| Assistente rapportini: "Da appunti", "Migliora", "Correggi" | Rapportino → Attività svolte | admin, operaio |
| Descrizione dalle foto (fino a 3, ridotte a 1024 px) | Rapportino → Foto → "Descrivi dalle foto" | admin, operaio |
| Controllo automatico: dati mancanti, ore, materiali, firma, foto (senza rete); coerenza del testo con l'AI | Rapportino → "Controlla rapportino"; anche nella conferma di "Completa" | tutti (company in sola lettura) |
| Automazioni: attività, materiali già usati per il cliente, controlli consigliati | Rapportino → "Suggerimenti" | admin, operaio |
| Ricerca intelligente in linguaggio naturale | Storico (diventa filtri modificabili) e Altro → Assistente AI → "Cerca" | tutti (l'operaio trova solo i propri dati) |
| Assistente dati: domande su interventi e rapportini di un periodo | Altro → Assistente AI → "Chiedi" | admin, company |
| Predittiva: ricorrenze per cliente, anomalie, tendenze mensili; "Prepara intervento" compila il modulo senza salvarlo | Altro → "Ricorrenze e tendenze" | admin, company |
| Verifica dei modelli Groq configurati | Altro → "Verifica modelli" | admin |

Come funziona: il browser chiama solo la Edge Function `ai` (`js/services/ai.js`, unico punto).
La funzione controlla sessione e ruolo, applica i limiti, legge i dati **con il token dell'utente**
(quindi con le policy RLS: nessun dato in più di quelli che l'utente vede già) e chiama Groq con
`GROQ_API_KEY`, che esiste solo nei secret di Supabase. Le risposte del modello vengono validate e
ripulite; i filtri della ricerca diventano query parametrizzate. La parte predittiva calcola ricorrenze,
anomalie e tendenze con regole fisse e soglie minime (almeno 3 lavori per cliente, 8 rapportini con ore,
4 mesi di dati): se i dati non bastano lo dice e non chiama il modello; il modello commenta solo i numeri.
Al modello non vanno mai la firma (solo "presente/assente") né identificativi tecnici; le foto solo su
richiesta, ridotte. Nei log della funzione: azione, ruolo, esito, durata, modello e token, mai i contenuti.

Limiti (in `supabase/functions/_shared/ai-logica.ts`): 10 richieste al minuto per utente; al giorno 200
(admin), 150 (company), 80 (operaio); testo 4000 caratteri, domanda 500, ricerca 300, 3 foto da 1,5 MB;
periodo massimo 12 mesi, 400 righe lette, 24.000 caratteri di dati per domanda; risposte con
`max_completion_tokens` da 500 a 1500; tempi massimi 25 s (testo) e 45 s (foto). I limiti per utente
usano la funzione già esistente `limite_tentativi` (migrazione `20261112090000`, solo service_role):
**nessuna migrazione nuova**. Se il limite non è verificabile la richiesta viene rifiutata.

Modelli (verificati sulla documentazione Groq a novembre 2026; si cambiano con i secret, senza codice):

| Uso | Modello predefinito | Secret per cambiarlo |
|---|---|---|
| Testo, ricerca, domande, controllo, suggerimenti | `openai/gpt-oss-120b` (produzione, JSON mode) | `GROQ_MODELLO_TESTO` |
| Riserva se il primo non è disponibile | `openai/gpt-oss-20b` (produzione; `llama-3.3-70b-versatile` non è più nell'elenco Groq) | `GROQ_MODELLO_RISERVA` |
| Foto | `qwen/qwen3.8-27b` (immagini, max 3 per richiesta; su Groq è in anteprima) | `GROQ_MODELLO_VISIONE` |

"Verifica modelli" (admin) confronta i modelli configurati con quelli attivi sull'account Groq.

Offline: i pulsanti AI rispondono "serve la connessione" senza inviare nulla; il controllo automatico,
le bozze sul telefono e la sincronizzazione funzionano come prima. "Applica" scrive solo nei campi del
modulo: la bozza va subito sul telefono e al server con Salva o con l'invio automatico.

Attivazione in produzione (da fare dal proprietario):
1. Creare una chiave su console.groq.com (API Keys).
2. Supabase → Edge Functions → Secrets: `GROQ_API_KEY` = la chiave (mai nel codice o nel frontend).
   Facoltativi: `GROQ_MODELLO_TESTO`, `GROQ_MODELLO_RISERVA`, `GROQ_MODELLO_VISIONE`.
3. Pubblicare la funzione `ai` con verify_jwt attivo (`supabase functions deploy ai`, oppure dal
   pannello: file `ai/index.ts` più `_shared/comune.ts`, `_shared/groq.ts`, `_shared/ai-logica.ts`,
   `_shared/ai-gestore.ts`). Nessuna migrazione da eseguire.
4. Pubblicare il frontend (merge su `main`).
5. Da admin: Altro → Assistente AI → "Verifica modelli".
Senza la chiave l'app funziona come prima e i pulsanti AI rispondono "assistente non configurato".

Privacy: i testi (e le foto scelte) vengono inviati a Groq solo per generare la risposta; l'app non li
salva. Valutare l'informativa per clienti e dipendenti prima dell'uso.

Test: vedi `tests/LEGGIMI.md` (Node per unit/server, Playwright per e2e, Postgres locale per SQL).

## Supabase: messa in produzione

Stato al 08/11/2026: tutte le migrazioni fino a `20261113090000` sono applicate in produzione e le
cinque Edge Functions pubblicate. La procedura serve per un progetto nuovo o per ricostruirlo.

1. Backup (`create schema if not exists backup;` + copia di `rapporti` e `profili`).
2. Migrazioni, **in quest'ordine** (SQL Editor; il file `…schema_iniziale.sql` descrive solo lo schema
   già esistente):
   `20261107120000_utenti_ruoli` → `20261108090000_interventi_rapportini` →
   `20261109090000_interventi_piu_operai` → `20261110090000_allegati_storage` →
   `20261111090000_rapporti_privilegi` → `20261112090000_utenti_pin_ruoli` →
   `20261113090000_recupero_accesso` → `20261114090000_impostazioni` → `20261115090000_notifiche` →
   `20261116090000_anagrafica_clienti`.
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

## Importazione delle giornate della vecchia app

Migrazione `20261125090000_importa_rapporti_vecchi.sql` (incrementale; annullabile con
`supabase/rollback/20261125090000_importa_rapporti_vecchi_rollback.sql`):
- colonna facoltativa `rapportini.origine` (scheda della vecchia app da cui viene il rapportino) con indice univoco;
- funzione `public.importa_rapporti_vecchi(autore, operai)` eseguibile solo dal pannello/SQL: ogni scheda cliente
  con nome di `rapporti` diventa un rapportino **completato** dell'autore indicato, con id deterministici (si puo'
  rieseguire senza doppioni) e senza notifiche. `rapporti` non viene modificata.
- Ore: per gli operai con account (`{"luca": "<uuid>"}`) fascia oraria della scheda; se la giornata ha un solo
  cliente, l'orario della giornata; altrimenti nessun orario (la vecchia app segnava le ore per giornata). Gli
  operai senza account e l'orario della giornata finiscono nelle note. Un operaio aggiunto dopo si collega
  rieseguendo la funzione con il suo uuid.
- Nell'app le schede importate non si ripetono: report mensile, PDF della giornata, storico, ricerca, agenda e
  ricerca clienti mostrano il rapportino e saltano la scheda del foglio (orari della giornata invariati).

