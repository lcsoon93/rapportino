# Briefing progetto COMP.HAS Rapportino (passaggio a nuova chat)

Rispondi sempre in italiano. Lavora in modo sintetico: leggi solo i file che servono al compito.

## Progetto
- App web per rapportini di intervento di COMP.HAS assistance SRL.
- Repo GitHub `lcsoon93/rapportino`. GitHub Pages pubblica dal ramo `main` (https://lcsoon93.github.io/rapportino/).
- Backend Supabase, progetto `kdzgtvnimqvxfweomxdo`.
- Frontend: moduli ES vanilla, nessun bundler. PDF con jsPDF 2.5.1 (Helvetica).
- Stato attuale: `main` = `47fb369`. Tutto quanto descritto sotto è già in produzione.

## Struttura essenziale
- `js/modules/`: schermate dell'app.
  - `modulo-rapportino.js`, `rapportini.js`, `interventi.js`, `utenti.js`, `accesso.js`…
- `js/services/pdf/comune.js`: stile COMP.HAS condiviso.
  - Colori, `intestazionePDF`, `intestazioneCompatta`, `filigranaPDF`, `titoloSezione`, `sottotitolo`, `etichetteStato`, `aggiungiPiePagina`, `righeConSeparatori`, `misureFirmaPDF`.
- `js/services/pdf/giornata.js`: motore PDF. Un solo `impaginatore` con cornice `{x0, x1, limite(), nuovaArea()}`. Tre layout:
  - `rapportinoSingolo`: A4 verticale, un cliente.
  - `generaPDFFoglioUnico`: A4, giornata intera con lavori numerati e riepiloghi.
  - `multiCliente`: A4 **orizzontale** con due rapportini A5 verticali affiancati e linea tratteggiata verticale "TAGLIA QUI".
    - Più di 2 clienti → più fogli.
    - Se il contenuto non sta, continua nella colonna o pagina successiva.
  - `generaPDFPerCliente(dati, iso)` usa `multiCliente` se i clienti sono più di 1, altrimenti `rapportinoSingolo`.
- `js/services/pdf/report.js`: report PDF.
- `supabase/migrations/`: tutte già applicate in produzione (dall'utente, tramite SQL Editor).
  - Ultime: `20261112090000_utenti_pin_ruoli.sql`, `20261113090000_recupero_accesso.sql`.
- `supabase/functions/`: Edge Functions (Deno) `accesso`, `pin`, `utenti`, `cambia-password`, `inizializza`, più `_shared/comune.ts`. Tutte deployate e allineate a `main`.
  - `verify_jwt` è `false` per `accesso` e `inizializza`, `true` per le altre.
- Documentazione: `README.md` e `docs/interventi-rapportini.md` (sezioni Fasi G/H/H2/H4 e layout PDF).

## Funzioni già realizzate
- Fasi A–F: interventi, rapportini, più operai, allegati su Storage, privilegi.
- Fase G: gestione utenti, PIN, doppio ruolo admin+operaio.
  - Combinazioni di ruoli ammesse: `{admin}`, `{admin,worker}`, `{company}`, `{worker}`.
  - PIN: hash PBKDF2 nella tabella `pin_accesso`.
  - Limiti PIN: 5 tentativi e blocco di 15 minuti; dopo 10 errori consecutivi il PIN viene cancellato; limite per IP di 30 tentativi ogni 15 minuti.
- Recupero accesso: l'admin imposta una password temporanea valida 72 ore; il reset resta tracciato (audit).
- Fase H/H2: PDF impaginati e restyling COMP.HAS.
- Fase H4: multi-cliente su A4 orizzontale.

## Regole vincolanti
- **Non** modificare `main`, non fare merge, PR o deploy (Pages o Edge Functions) senza una richiesta esplicita dell'utente.
  - Lavora su un ramo dedicato; fai commit e push solo lì.
- **Non** eseguire SQL o migrazioni sul database di produzione senza autorizzazione.
  - Le migrazioni le esegue l'utente nell'SQL Editor di Supabase (lo strumento `apply_migration` va in timeout).
  - Le verifiche in sola lettura sono ammesse quando servono.
- Non modificare file di migrazione già rilasciati: crea una nuova migrazione.
- Non eliminare dati storici. Non allargare le policy RLS senza motivazione.
- Non esporre token o chiavi. Niente `service_role` nel frontend. Niente credenziali reali nei test.
- I test non toccano mai la produzione: Playwright devia `supabase.co` verso lo stack locale oppure lo blocca.
- Non dichiarare allegati o file generati se non esistono davvero.
- Chiedi conferma prima di ogni azione verso l'esterno.
- Nessun identificativo di modello nei commit o nei file.

## Note tecniche utili
- Lo storico `supabase_migrations` in produzione contiene solo la voce di backup.
  - Prima di usare la CLI Supabase servirebbe `supabase migration repair`, che scrive in produzione: serve autorizzazione.
- Per verificare i PDF senza backend:
  1. Servi la cartella del repo con un server statico.
  2. Con Playwright, fai `import('/js/services/pdf/giornata.js')` nella pagina.
  3. Chiama `generaPDFPerCliente` o `generaPDFFoglioUnico` con dati finti, che includano foto da canvas e firma.
  4. Salva il risultato di `output('datauristring')`.
- Chromium e Playwright sono preinstallati nell'ambiente cloud.

## Attività aperte (facoltative, non richieste ora)
- Prova reale di stampa e taglio del PDF multi-cliente: scala 100%, orientamento automatico.
- Test del login con PIN su un telefono vero.
- Password più robuste per gli utenti Luca e comphas.
- Pulizia dei rami già uniti.
