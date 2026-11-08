# Interventi e rapportini multiutente

Ramo `interventi-rapportini` · SQL **non ancora applicato** a Supabase (il frontend è già su `main` e mostra "non ancora attivi" finché manca).

## Modello dati (tabelle nuove; `rapporti` storica intatta)

| Tabella | Contenuto | Chi legge | Chi scrive |
|---|---|---|---|
| `interventi` | data, ora, cliente, indirizzo, descrizione, priorità (bassa/normale/alta/urgente), tipologia, stato (pianificato/in_corso/completato/annullato), creato_da | admin, company; operaio solo se assegnato | admin, company (elimina solo admin, solo senza rapportini) |
| `intervento_operai` | assegnazioni (uno o più operai); dalla Fase B `rimosso_il`/`rimosso_da` = storico delle assegnazioni tolte | admin, company; operaio per i propri interventi (solo assegnazione attiva) | admin, company (togliere = rimozione logica) |
| `rapportini` | collegato a un intervento o autonomo; attività, materiali, note, esito, firma, stato bozza/completato, versione | admin, company; operaio se autore o indicato nelle ore | autore (operaio o admin) finché è bozza; admin sempre (anche riapre) |
| `rapportino_operai` | ore (dalle/alle) per operaio | come il rapportino | come il rapportino |
| `allegati` | metadati delle foto (Fase C: file nel bucket privato `allegati-rapportini`; righe vecchie con `contenuto` base64 ancora leggibili) | come il rapportino | come il rapportino |

Regole imposte dal database (non falsificabili dal browser): `creato_da`, `assegnato_da`, `autore_id`,
`caricato_da` = `auth.uid()`; un operaio scrive rapportini solo per interventi a cui è assegnato (o autonomi);
completare richiede attività e ore; un rapportino completato non si modifica (solo l'admin lo riapre);
si assegnano solo account attivi `worker`/`admin`; account disattivati: nessun accesso, anche con sessione aperta;
lo stato dell'intervento lo calcola il database (Fase B, sotto).
Salvataggio atomico con `salva_rapportino` (testata + ore in una transazione, controllo di versione).
L'id del rapportino lo genera il telefono. `salva_rapportino` crea un rapportino solo se quell'id non
esiste ancora sul server; un rapportino esistente si modifica solo indicando la versione letta: se la
versione manca o è diversa risponde "conflitto" (con la versione e le ore del server) senza sovrascrivere.
Due creazioni contemporanee con lo stesso id: una crea, l'altra riceve "conflitto" (nessun errore).
Se il contenuto in conflitto è identico a quello inviato (secondo invio dopo una risposta persa) l'app
reinvia con la versione del server o lo considera già salvato; altrimenti tiene le modifiche nel modulo
e si sostituisce solo premendo di nuovo Salva. I rapportini
salvati solo sul telefono (senza rete) compaiono in Lavoro → "Da inviare".

## Home e Calendario (Fase A)

Solo frontend: nessuna modifica a SQL, policy o salvataggio dei rapportini. I dati sono quelli delle
tabelle `interventi`, `intervento_operai`, `rapportini` letti con la sessione dell'utente (RLS);
lo stato mostrato è sempre quello restituito dal database.

- **Home amministratore** (`dashboard.js`): riepilogo "Interventi pianificati" con sei numeri e le
  liste Oggi / Prossimi giorni; sotto resta il foglio giornaliero. Definizioni (periodo letto: ultimi
  30 giorni + prossimi 7, una richiesta, più il conteggio dei rapportini in bozza):
  Oggi e Prossimi 7 giorni = interventi non annullati con quella data; In corso = stato `in_corso`;
  Completati (30 gg) = stato `completato` con data fino a oggi; Senza rapportino completato = non
  annullati, data fino a oggi, nessun rapportino completato collegato; Rapportini in bozza = rapportini
  con stato `bozza` (più l'avviso di quelli salvati solo sul telefono).
- **Home operaio** (`lavoro.js`, "I miei interventi"): Oggi (prima gli urgenti), Prossimi giorni,
  Da completare · giorni precedenti; ogni scheda: cliente, descrizione, data e ora, indirizzo,
  stato, priorità se alta/urgente, "Compila / Riprendi bozza" e "Dettagli". "Da inviare" (rapportini
  solo sul telefono) compare anche senza rete.
- **Calendario** (`calendario.js` + `agenda.js`): Giorno / Settimana / Mese per admin, operaio e
  azienda. Giorno: interventi con ora, luogo, operai, stato; tocco = dettaglio. Settimana: interventi
  giorno per giorno. Mese: numero di interventi (non annullati) per giorno, evidenziato da 4 in su, e
  "giorno più carico"; tocco su un giorno = vista Giorno (l'admin da lì apre anche il foglio
  giornaliero). Il report delle giornate (ore, saldi, PDF) resta solo all'admin (permesso `report`).
- **Dettaglio intervento** (foglio dal basso): dati, operai assegnati, rapportini visibili;
  "Compila rapportino / Riprendi bozza" (usa `rapportinoPerIntervento`) per chi è assegnato e per
  l'admin; "Modifica o riassegna" (usa `apriModuloIntervento`) per chi ha già `interventi.gestisci`.
- **Ruoli**: l'operaio vede solo ciò che la policy `interventi_lettura` gli restituisce (assegnati);
  l'azienda consulta e mantiene i permessi di prima (nessuna compilazione); nuove voci di menu
  "Calendario" per operaio e azienda (solo viste, nessun nuovo permesso sui dati).
- **Aggiornamento dati**: aprendo Home, Lavoro o Calendario da un'altra schermata si rilegge dal
  database; spostandosi dentro il Calendario si riusa per 30 s quanto già letto (una richiesta per
  mese o settimana). Ogni scrittura (intervento, assegnazione, rapportino) svuota questa memoria.
- **Errori**: rete assente, sessione scaduta ("Sessione scaduta: accedi di nuovo.") e migrazione non
  applicata ("non sono ancora attivi") mostrano un messaggio nella sezione; il resto della Home
  (foglio giornaliero) continua a funzionare.
- **Non presente nel modello dati**: un campo "note" dell'intervento (si mostra la descrizione).

## Interventi con più operai (Fase B)

Migrazione incrementale `supabase/migrations/20261109090000_interventi_piu_operai.sql`
(rollback: `supabase/rollback/20261109090000_interventi_piu_operai_rollback.sql`). Serve perché la
struttura precedente non distingueva assegnazioni attive e tolte (togliere un operaio cancellava la riga)
e completava l'intervento al primo rapportino completato. Non cambia `salva_rapportino`, non cambia
nessuna policy RLS, non aggiunge stati.

- **Ogni operaio il proprio rapportino**: già garantito dalla Fase A (autore imposto dal database,
  solo l'autore modifica la bozza, l'operaio non legge i rapportini dei colleghi). Ore e foto stanno
  nel rapportino del loro autore.
- **Stato complessivo** (funzione `stato_intervento_calcolato`, stessi quattro stati):
  `annullato` lo decide chi pianifica; `completato` solo se **ogni operaio assegnato (attivo) ha un
  proprio rapportino completato** — senza assegnati non è mai completato, le ore di un collega nel
  rapportino di un altro e il rapportino di chi non è assegnato (es. admin) non bastano;
  `in_corso` se esiste almeno un rapportino collegato; altrimenti `pianificato`.
- **Ricalcolo atomico**: trigger su `rapportini` e su `intervento_operai` → `ricalcola_stato_intervento`,
  che prima blocca la riga dell'intervento (`FOR UPDATE`) e poi calcola con un'istruzione successiva:
  completamenti e cambi di assegnazione contemporanei vengono messi in fila e l'ultimo vede i dati
  dell'altro. Idempotente (scrive solo se lo stato cambia). Verificato che senza il blocco il test
  "due operai completano nello stesso istante" fallisce (3 casi su 6), con il blocco 6 su 6 corretti.
- **Stato non scrivibile a mano**: un inserimento parte da `pianificato`; un aggiornamento può solo
  annullare; ripristinare (o qualsiasi altro valore) rimette lo stato calcolato.
- **Operaio tolto** (DELETE dall'app): la riga resta con `rimosso_il`/`rimosso_da` (trigger
  `rimuovi_assegnazione`); rapportini, ore e foto non vengono mai toccati. L'operaio non vede più
  l'intervento e non può crearne nuovi rapportini; il suo rapportino resta suo e visibile all'admin
  (nel dettaglio: "rimosso dall'intervento, rapportino conservato"). Lo stato si ricalcola senza di lui.
  L'app chiede conferma se si toglie qualcuno che ha già un rapportino.
- **Operaio aggiunto** (anche a intervento iniziato o completato): entra tra chi deve completare →
  lo stato torna `in_corso`, salvo che abbia già un proprio rapportino completato per quell'intervento.
  Riassegnare chi era stato tolto riattiva la stessa riga (nessun doppione); riassegnare chi è già
  assegnato non dà errore. Solo admin/company possono farlo (controllo ripetuto nel trigger, perché
  la riattivazione non passa dal controllo RLS dell'inserimento).
- **Dettaglio intervento**: sezione "Operai" con nome, stato del lavoro (Da iniziare / In corso /
  Completato), stato del rapportino, ore, data di completamento, "n di m completati" e "Mancano: …".
  L'operaio vede il proprio stato e solo i nomi dei colleghi; company in sola consultazione.
- **Home / Calendario / Interventi**: "n di m completati" e "manca: …" sugli interventi in corso
  (admin, company); "Tuo rapportino: bozza/completato/da compilare" per l'operaio; in Home admin
  "Con rapportini mancanti" (non annullati, data fino a oggi, stato ≠ completato) e la lista
  "Rapportini mancanti · giorni precedenti".
- **Ordine**: applicare la Fase B dopo `20261108090000`; per tornare indietro eseguire prima il
  rollback della Fase B e poi, se serve, quello della Fase A. Il rollback della Fase B elimina le
  righe di assegnazione "rimosse" (altrimenti tornerebbero attive): esportarle prima.
- **Compatibilità**: il frontend della Fase B legge `rimosso_il`, quindi va pubblicato insieme alla
  migrazione (senza migrazione mostra "non ancora attivi", come per la Fase A).

## Foto nello Storage (Fase C)

Migrazione `supabase/migrations/20261110090000_allegati_storage.sql`
(rollback `supabase/rollback/20261110090000_allegati_storage_rollback.sql`). Riusa la tabella
`allegati` (nessun sistema parallelo); non cambia `salva_rapportino` né le policy delle altre tabelle.

- **Bucket** `allegati-rapportini`: **privato** (nessun URL pubblico), limite 3 MB per file (come il
  limite già previsto per una foto: `contenuto` ≤ 3.000.000 caratteri), tipi `image/jpeg`, `image/png`,
  `image/webp`. Percorso `<id rapportino>/<id allegato>.jpg`: l'id dell'allegato è un UUID casuale
  generato dal telefono (non prevedibile); nomi di altra forma sono rifiutati.
- **Policy Storage** (su `storage.objects`, solo questo bucket), coerenti con quelle RLS di `allegati`:
  lettura = `vede_rapportino(rapportino del percorso)` (autore, operaio indicato nelle ore, admin,
  company); caricamento e cancellazione = `modifica_rapportino(...)` (autore con rapportino in bozza,
  oppure admin); **nessuna policy di UPDATE**: un file caricato non si sovrascrive (neanche con upsert).
  Utente non autenticato: niente. La service role key non è mai nel frontend.
- **Metadati** in `allegati`: `percorso`, `nome` (nome originale ripulito), `mime`, `dimensione`,
  `larghezza`, `altezza`, `impronta` (SHA-256 del file originale), `caricato_da`, `creato_il` (questi due
  imposti dal database). Indici unici su `percorso` e su (`rapportino_id`, `impronta`).
- **Controlli del database** (trigger `controlla_allegato`): una nuova foto in base64 è rifiutata; il
  percorso deve corrispondere a rapportino e id; tipo consentito; **il file deve esistere nello Storage
  con la stessa dimensione** dichiarata → nessun riferimento a file non caricati o caricati a metà.
- **Registrazione idempotente** `registra_allegato(jsonb)` (SECURITY INVOKER): stesso id già registrato
  → `ok` (nuovo tentativo dopo una risposta persa); stessa foto già presente nel rapportino con un altro
  id → `duplicato` (l'app toglie il file appena caricato). Nessun doppione.
- **App** (`services/coda-foto.js`, `modules/modulo-rapportino.js`, `services/immagini.js`):
  1. foto scelta → controllo tipo (JPEG/PNG/WebP/HEIC…), massimo 25 MB in ingresso, immagine
     leggibile; impronta; compressione a 1600 px JPEG 0,78 (come prima; se superasse 3 MB qualità
     minore); nome ripulito;
  2. la foto va nella **coda del telefono** (IndexedDB `rapportino-foto`, sopravvive alla chiusura
     dell'app) e compare con "Da inviare";
  3. se il rapportino non è ancora sul server si salva la bozza; poi per ogni foto: upload (file già
     presente = ok) → registrazione dei metadati → **solo allora** esce dalla coda;
  4. errori (rete, Storage, metadati, autorizzazione): la foto resta in coda con l'errore, messaggio
     chiaro, pulsante "Invia foto" per riprovare; stesso id a ogni tentativo → nessun doppione;
  5. **"Completa" solo con tutte le foto confermate**: prima bozza + invio foto; se ne resta anche una
     il rapportino rimane in bozza ("Rapportino NON completato") e nulla è dichiarato inviato.
- **Senza rete**: si compila e si aggiungono foto; testo e firma restano nella bozza del telefono, le
  foto nella coda; il rapportino è in Lavoro → "Da inviare" (con "N foto da inviare"), anche dopo aver
  chiuso e riaperto l'app; riaprendolo si riprendono testo, firma e foto; con la rete "Salva" o "Invia
  foto" riprendono l'invio. Nessun invio automatico in background (come per il resto dell'app).
  Aprire un rapportino già sul server senza rete usa la copia del telefono, se c'è.
- **Visualizzazione**: le foto del rapportino aperto si scaricano con la sessione dell'utente (3 alla
  volta) e si mostrano da memoria: **nessun URL** (né pubblico né firmato) viene creato o salvato, quindi
  niente URL scaduti; gli elenchi non scaricano foto. Foto mancante / non autorizzata / offline: riquadro
  con il motivo (tocco = riprova). Tocco su una foto: schermo intero; altro tocco: ingrandimento.
- **PDF** (`generaPDFPerCliente`; impaginazione rivista nella Fase H): riceve le foto già scaricate (server), quelle in base64 e
  quelle ancora sul telefono; le foto non disponibili vengono saltate e segnalate ("PDF creato senza N
  foto non disponibili"); nessun URL nel PDF.
- **Cancellazione**: si tolgono prima i metadati, poi il file (il rapportino non punta mai a un file
  mancante). Se il file non si riesce a togliere resta orfano nel bucket, senza riferimenti; eliminando
  un rapportino l'app toglie prima i suoi file. Per trovare file orfani (sola lettura):
  `select o.name from storage.objects o where o.bucket_id = 'allegati-rapportini' and not exists (select 1 from public.allegati a where a.percorso = o.name);`
- **Compatibilità**: le righe `allegati` con `contenuto` (base64, formato Fase A) restano leggibili, nel
  modulo e nel PDF. Con il frontend nuovo su un database **senza** questa migrazione: le foto vecchie si
  vedono, le nuove restano sul telefono con un errore (nessuna perdita) → pubblicare il frontend solo
  dopo aver applicato la migrazione.
- **Foto storiche**: in produzione la tabella `allegati` non esiste ancora (Fasi A–C non applicate),
  quindi non ci sono foto di rapportini in base64 da migrare. Le foto del **foglio giornaliero** (le 51
  giornate) stanno nel JSON della giornata (`rapporti.dati → clienti[].foto`, `{src: data URL, w, h}` o
  solo data URL; scontrini in `spese[].allegato`) e fanno parte del meccanismo di sincronizzazione e
  unione del foglio giornaliero e del suo PDF: **non vengono migrate in questa fase** (rischio di toccare
  lo storico); restano dove sono e funzionano come prima. Conteggio da eseguire (sola lettura) quando
  autorizzato:
  ```sql
  select count(*) as foto, count(distinct r.data) as giornate,
         round(sum(length(coalesce(f->>'src', f #>> '{}')))/1048576.0, 1) as mb_base64,
         count(*) filter (where coalesce(f->>'src', f #>> '{}') not like 'data:image/%') as non_valide
  from public.rapporti r, jsonb_array_elements(coalesce(r.dati->'clienti', '[]')) c,
       jsonb_array_elements(coalesce(c->'foto', '[]')) f;
  ```
  Una migrazione futura dovrebbe: copiare le foto nello Storage lasciando il base64, aggiungere i
  riferimenti nel JSON, verificare conteggi e dimensioni e il PDF di ogni giornata; il base64 si potrà
  eliminare solo dopo un periodo di verifica e con un backup.
- **Rollback della Fase C**: toglie policy e funzione; copia i metadati delle foto nello Storage in
  `backup.allegati_storage` e poi li toglie da `allegati` (la tabella della Fase B richiede il base64);
  i file restano nel bucket. Ordine: rollback C, poi B, poi A.

## Sincronizzazione offline (Fase D)

Solo frontend: **nessuna modifica SQL** (si usano `salva_rapportino`, il controllo di versione e la
registrazione delle foto già esistenti). File: `services/coda-locale.js` (archivio locale),
`services/sinc-rapportini.js` (coda e invio), `modules/modulo-rapportino.js`, `modules/lavoro.js`
("Da inviare"), `core/sessione.js` (tempo massimo delle richieste, riapertura senza rete).

- **Persistenza** (IndexedDB `rapportino-foto`, versione 2): tabella `bozze` (un record per rapportino:
  id stabile generato dal telefono, intervento, autore, contenuto con attività, materiale, **ore e
  firma**, richiesta di completamento, versione del server conosciuta, ultima modifica, stato, tentativi,
  ultimo/prossimo tentativo, errore, copia del server in caso di conflitto, ultimo contenuto inviato) e
  tabella `foto` (Fase C). Niente bozze né immagini in localStorage (le bozze del formato precedente
  vengono spostate in IndexedDB all'avvio); nessun token nella coda. Sopravvive a cambio schermata,
  refresh, chiusura della scheda e riapertura. Si chiede al browser la persistenza
  (`navigator.storage.persist`, dove esiste). **Limite iPhone/Safari**: un sito non usato per 7 giorni
  può perdere i dati locali se l'app non è aggiunta alla schermata Home; IndexedDB in navigazione privata
  può non essere disponibile (l'app lo segnala).
- **Stati**: `locale` (dati incompleti), `in_attesa`, `in_sincronizzazione`, `allegati_in_attesa`
  (foto ancora da trasferire), `conflitto`, `errore`, `inviato` (confermato dal server: resta solo un
  riepilogo senza contenuto per il conteggio delle ultime 24 ore). Un rapportino risulta inviato solo
  dopo la conferma del server; un errore di rete non è mai un errore definitivo.
- **Quando parte**: dopo l'accesso / alla riapertura dell'app, all'evento `online`, al ritorno nell'app
  (`visibilitychange`) e ogni 60 s mentre l'app è aperta e visibile, solo se c'è qualcosa da inviare.
  Prima di inviare si verifica davvero il server (non basta `navigator.onLine`): `/auth/v1/health` con
  8 s di tempo massimo, poi la sessione (`getSession` + `getUser`). Ogni richiesta a Supabase ha un tempo
  massimo (30 s; 120 s per i file), così una rete "appesa" non blocca la coda. Indicatore in "Da inviare":
  online / offline / server non raggiungibile / sessione scaduta.
- **Coda**: un rapportino alla volta, in ordine; blocco per rapportino (Web Locks, anche tra due schede;
  altrimenti in memoria) e un solo giro di sincronizzazione alla volta → mai due invii contemporanei
  dello stesso rapportino. Errore su un rapportino: si passa al successivo. Errori temporanei (rete,
  server 5xx, migrazione mancante): nuovo tentativo dopo 30 s, 1, 2, 4… minuti (massimo 30), poi dopo 8
  tentativi l'invio automatico si sospende ("Riprova"). Al ritorno della rete gli errori di rete si
  riprovano subito. Errori di autorizzazione (non più assegnato, non modificabile, già completato) e di
  dati: stato `errore`, nessun nuovo tentativo automatico. Sessione scaduta: la coda si ferma e riparte
  dopo l'accesso.
- **Invio di un rapportino**: 1) testo e ore (`salva_rapportino` con la versione conosciuta; se c'è da
  completare e ci sono foto, prima in bozza); 2) foto (upload → metadati → fuori dalla coda); 3)
  completamento, solo con tutte le foto confermate; 4) `inviato`. "Completa" premuto senza rete viene
  ricordato e fatto all'invio. Se durante l'invio l'operaio modifica il rapportino, le nuove modifiche
  restano da inviare (non vengono sovrascritte dalla risposta).
- **Risposte perse e idempotenza**: l'id del rapportino è del telefono e il telefono ricorda l'ultimo
  contenuto inviato (salvato prima della richiesta). Al tentativo successivo il server risponde
  `conflitto`: se la sua versione è uguale alla copia del telefono → già sincronizzato; se è uguale
  all'ultimo invio del telefono (la sua scrittura, di cui si era persa la risposta) → si invia con la
  versione del server; nessun nuovo rapportino, ore sostituite in blocco (mai duplicate), foto con id
  fisso (mai duplicate).
- **Conflitti** (contenuto diverso da entrambe): stato `conflitto`, nulla viene sovrascritto; restano
  la copia del telefono e quella del server. Aprendo il rapportino: confronto campo per campo (telefono /
  server) e scelta esplicita "Invia la mia versione" (non disponibile all'operaio se il rapportino è già
  completato) o "Usa la versione del server" (le modifiche del telefono si perdono, con conferma). La
  sincronizzazione automatica non risolve mai un conflitto da sola.
- **"Da inviare"** (Lavoro): indicatore di connessione, conteggi (in attesa, in sincronizzazione, inviati
  nelle ultime 24 ore, conflitti, non riusciti), elenco degli inviati nelle ultime 24 ore, "Sincronizza ora"; per ogni rapportino cliente, intervento, data, stato,
  ultimo e prossimo tentativo, errore, foto da inviare; "Apri", "Riprova", "Vedi conflitto", "Elimina"
  (solo bozze mai inviate, con conferma: un rapportino già sul server non si elimina da qui).
- **In background**: nessun service worker né Background Sync (non supportato da Safari): ad app chiusa
  l'invio NON continua, su iPhone non è garantito. Riaprendo l'app si riprende da dove si era rimasti.
- **Riapertura senza rete**: la sessione non viene più chiusa se il server non risponde (prima l'app
  tornava al login); si usa il profilo dell'ultimo accesso dello stesso utente (id, nome, ruolo: niente
  token) solo per l'interfaccia; i dati restano protetti da RLS. Effetto collaterale corretto: anche la
  sincronizzazione del foglio giornaliero non esce più dall'account quando manca la rete.
- **Sicurezza**: la coda invia solo i rapportini dell'utente collegato (campo `autore`); cambiando
  account i rapportini del precedente restano sul telefono, non vengono mostrati né inviati, e partono
  quando lui accede di nuovo. Tutto passa da RLS, trigger e policy Storage; nessuna service role key.

## Storico (Fase E)

Solo frontend, nessuna modifica SQL. Altro → Consultazione → **Storico** (admin e company; l'operaio
non ha la voce né la schermata e, anche chiamando le API, RLS gli restituisce solo i propri dati).
Interventi del periodo (`elencoInterventi`) e rapportini del periodo o collegati a quegli interventi
(`storicoRapportini`: ore e numero di foto), un'unica lettura per periodo; cliente, operaio, stato e
ricerca (cliente, indirizzo, descrizione/attività, senza maiuscole e accenti) filtrano in memoria.
Periodo predefinito: ultimi 30 giorni; risultati dal più recente; "Azzera i filtri". Per ogni intervento:
stato, avanzamento, ore totali e un rapportino per operaio con le sue ore e le foto; tocco = dettaglio
dell'intervento o rapportino (foto e PDF dalle schermate esistenti). Rapportini autonomi e rapportini
di interventi fuori periodo compaiono come voci a sé.

## Rifiniture di sicurezza (Fase F)

- Migrazione `supabase/migrations/20261111090000_rapporti_privilegi.sql` (rollback
  `supabase/rollback/20261111090000_rapporti_privilegi_rollback.sql`): toglie a `authenticated`
  TRUNCATE, REFERENCES e TRIGGER sulla tabella storica `rapporti` (TRUNCATE ignora RLS). Restano
  SELECT/INSERT/UPDATE/DELETE filtrati dalle policy, che non cambiano; i dati non vengono toccati.
  Verificato in locale: con il ruolo `authenticated` TRUNCATE → "permission denied", 51 giornate intatte.
- Le chiamate alle Edge Function (accesso, cambio password, gestione utenti) hanno lo stesso tempo
  massimo delle altre richieste (30 s): su una rete senza risposta compare "Nessuna connessione".

## Utenti, PIN e doppio ruolo (Fase G)

Migrazioni `supabase/migrations/20261112090000_utenti_pin_ruoli.sql` e
`supabase/migrations/20261113090000_recupero_accesso.sql` (rollback in `supabase/rollback/`, in ordine inverso). Non cancella account o dati:
UUID, giornate, interventi e rapportini restano identici.

- **Nome e cognome.** `profili.cognome` (nuova, vuota per gli account esistenti, che hanno già nome
  e cognome nel campo `nome`: quello che si vede non cambia). L'app mostra sempre "nome cognome",
  mai un identificativo: `nomi_utenti()` restituisce i nomi di chi compare nei dati che l'utente può
  già vedere, anche degli operai disattivati (admin e company: tutti; operaio: se stesso, gli operai
  attivi e i colleghi dei propri interventi e rapportini). Nuovi operai: nome e cognome obbligatori.
- **Più ruoli.** `profili.ruoli` affianca `ruolo`, che resta il ruolo principale (menu e permessi
  amministrativi come prima). Combinazioni ammesse dal database: `{admin}`, `{admin,worker}`,
  `{company}`, `{worker}`. Con `worker` si compare tra gli operai, si viene assegnati agli
  interventi e si indicano le proprie ore (`operai_attivi`, `operai_assegnabili`, trigger di
  assegnazione e ore usano ora `lavora_sul_campo`). Finora ogni admin era trattato da operaio
  d'ufficio: la migrazione dà quindi `{admin,worker}` agli admin esistenti (Luca), così nulla
  cambia. Da Gestione utenti → Modifica l'admin può togliere o ridare il ruolo di operaio a un
  amministratore; assegnazioni e rapportini già fatti restano. Company e operai non cambiano ruolo.
- **PIN di 6 cifre.** Si attiva da Altro → PIN di accesso, con la password attuale; si cambia con la
  password o con il PIN attuale; si disattiva da lì. Il login propone il PIN per l'ultimo utente che
  l'ha attivato su quel telefono (nel browser c'è solo lo username, mai il PIN).
  - Il PIN NON è la password di Supabase Auth: nella tabella `pin_accesso` (nessun permesso per
    `anon`/`authenticated`, solo le Edge Functions) c'è solo l'impronta PBKDF2-SHA256 con sale
    casuale. Se il PIN è giusto, la funzione `accesso` crea la sessione standard con un link
    monouso generato e consumato sul server (non arriva al browser, nessuna email).
  - Tentativi: 5 PIN sbagliati → blocco di 15 minuti; 10 errori consecutivi → PIN eliminato (si
    rientra con la password). Il conteggio è atomico nel database (`pin_prenota`/`pin_esito`): anche
    con richieste in parallelo non si superano 5 verifiche. In più al massimo 30 tentativi PIN ogni
    15 minuti dalla stessa rete (`tentativi_accesso`, solo impronta dell'IP).
  - PIN deboli rifiutati (sei cifre uguali, sequenze, ripetizioni comuni). Username inesistente e
    utente senza PIN ricevono la stessa risposta.
  - Il PIN viene eliminato quando l'admin reimposta la password o disattiva l'account; l'admin
    può anche rimuoverlo dall'elenco utenti ("PIN attivo").
- **Recupero dell'accesso (PIN e password dimenticati).** Procedura per l'admin:
  1. verificare che la richiesta venga davvero dall'operaio (di persona o con una telefonata al suo
     numero noto: mai su richiesta arrivata da un canale non verificato);
  2. Altro → Gestione utenti → riga dell'operaio → **Reimposta password**;
  3. comunicare di persona o per telefono la password temporanea mostrata (una sola volta, con
     "Copia"). Vale **72 ore**: poi scade e serve un nuovo reset;
  4. l'operaio accede con username e password temporanea, sceglie la sua password e, se vuole,
     attiva un nuovo PIN da Altro → PIN di accesso.

  Il reset elimina il PIN, toglie i blocchi per tentativi, chiude le sessioni aperte (il vecchio
  telefono non rinnova più la sessione; un token già emesso resta valido al massimo fino alla sua
  scadenza, 1 ora) e registra data e autore (visibili all'admin nell'elenco: "Password reimpostata
  il … da …"). Interventi, rapportini e foto già sul server non vengono toccati.
  Il reset dall'app vale solo per gli operai (non per company né per se stessi).

  **Emergenza** (l'unico amministratore, o company, ha dimenticato password e PIN): nel pannello
  Supabase → SQL Editor, sostituendo USERNAME e la password temporanea (almeno 10 caratteri, lettere e
  numeri, senza lo username). Provata sul database locale:
  ```sql
  begin;
  update auth.users set encrypted_password = extensions.crypt('Temporanea-2026x', extensions.gen_salt('bf'))
    where id = (select id from public.profili where lower(username) = lower('USERNAME'));
  delete from auth.sessions where user_id = (select id from public.profili where lower(username) = lower('USERNAME'));
  delete from public.pin_accesso where utente_id = (select id from public.profili where lower(username) = lower('USERNAME'));
  update public.profili set deve_cambiare_password = true, tentativi_falliti = 0, bloccato_fino = null,
    password_temporanea_scade = now() + interval '72 hours', password_reimpostata_il = now(), password_reimpostata_da = null
    where lower(username) = lower('USERNAME');
  commit;
  ```
  Poi si accede con la password temporanea e se ne sceglie una nuova. Lo SQL Editor tiene la
  cronologia delle query: dopo l'uso cancellare la query salvata.
- **Edge Functions:** `accesso` (PIN, password temporanea scaduta), `cambia-password`, nuova `pin`, `utenti` (azioni `modifica` e `rimuovi_pin`,
  elenco con cognome, ruoli e PIN), `inizializza` (ruoli). L'app funziona anche se il database non
  ha ancora la migrazione (profilo letto senza cognome/ruoli), ma le Edge Functions nuove la
  richiedono: **prima la migrazione, poi le funzioni, poi il frontend**.

## Impaginazione dei PDF (Fase H)

Solo frontend (`js/services/pdf/giornata.js`, `js/services/pdf/comune.js`, una riga in
`js/modules/modulo-rapportino.js`): nessun dato, schema o permesso cambia; i report settimanali e
mensili sono invariati.

- **Foglio unico** ("RAPPORTO DI LAVORO GIORNALIERO", `generaPDFFoglioUnico(dati?, iso?)`):
  - dalla seconda pagina intestazione compatta (logo, titolo, data "segue"); piede su ogni pagina con
    riga sottile, "COMP.HAS assistance SRL", "Rapporto del gg/mm/aaaa" e "Pagina x di N";
  - data e tecnici in testa, seguiti dalla tabella **Orario** di ogni tecnico (dalle, alle, ore; con la
    nota se la giornata è esclusa dal monte ore). Prima l'orario stava in fondo e poteva finire da solo
    su un'ultima pagina;
  - lavori numerati; nome del cliente, indirizzo, tipologia e "Fatturare a" vanno a capo (prima
    potevano uscire dal margine o sovrapporsi a "DA ULTIMARE"); "URGENZA" e "DA ULTIMARE" a destra;
  - descrizioni, materiali e spese si spezzano riga per riga tra le pagine: niente testo oltre il fondo
    pagina e niente pagine lasciate a metà per spostare un blocco intero. Il titolo di un lavoro resta
    con l'inizio del suo contenuto; se il lavoro continua, la pagina dopo lo ricorda
    ("3) Cliente (segue)"); "Materiale:" resta con almeno due voci; separatore tra i lavori;
  - foto con proporzioni reali e mai tagliate: una sola foto più grande, altrimenti due per riga, con
    l'altezza della riga pari alla foto più alta (prima riquadri fissi da 68 mm con spazio vuoto); una
    riga che non entra per poco viene ridotta in proporzione (non sotto il 60% e un minimo leggibile)
    invece di passare alla pagina dopo; "Foto (segue):" se le foto continuano;
  - firma del cliente sempre sulla pagina dell'ultima riga di foto del suo lavoro (accanto all'ultima
    foto con un numero dispari di foto, altrimenti sotto); nessuna sezione foto o firma se vuota.
- **Schede per cliente** (`generaPDFPerCliente`, usata anche per il PDF del rapportino): testi e
  materiali lunghi continuano nella mezza pagina successiva invece di superare la linea di taglio; il
  richiamo "(segue)" va a capo; una riga di foto che non entra per poco viene rimpicciolita (fino a
  32 mm di altezza) invece di passare alla mezza pagina dopo; il PDF del rapportino riporta
  l'**orario di ogni tecnico** (prima mancava).
- In entrambi i formati indirizzo, tipologia e "Fatturare a" vanno a capo solo tra un dato e l'altro.

## Stile dei PDF (Fase H2)

Solo `js/services/pdf/` (più due campi passati da `pdfRapportino`): dati e funzionamento invariati.
- Stile corporate: bianco, blu scuro (`COLORI.blu`) per titoli e filetti, grigi chiari per separatori
  e riquadri; carattere Helvetica (incluso in jsPDF, nessun font esterno).
- Elementi comuni in `pdf/comune.js`: intestazione (logo contenuto, titolo, "N. … · Data …"),
  intestazione compatta delle pagine successive, filigrana, titoli di sezione, etichette di stato
  (URGENZA, DA ULTIMARE), piede con riferimento e "Pagina x di N". Anche i report settimanale e mensile
  usano la nuova intestazione e il nuovo piede (il resto dei report è invariato).
- Titoli: "RAPPORTINO DI INTERVENTO" (PDF del rapportino e schede per cliente), "RAPPORTO DI LAVORO
  GIORNALIERO" (foglio unico con tutti i lavori della giornata).
- Riferimento: il rapportino non ha un numero progressivo nei dati, quindi il PDF usa
  `RAP-AAAAMMGG-XXXX` (data + prime 4 cifre del suo identificativo); la giornata usa `RG-AAAAMMGG`
  (schede per cliente: `RG-AAAAMMGG-n`).
- Ordine: intestazione; riquadro con data, riferimento, tecnici e orari; cliente e sede; attività
  svolte; materiali (tabella descrizione / q.tà, intestazione ripetuta se continua); fotografie con un
  filo sottile; note (nel PDF del rapportino sono una sezione a sé) e firma del cliente.
- Filigrana: logo al 4% di opacità (trasparenza di jsPDF) dalla seconda pagina, disegnato prima dei
  contenuti; nelle schede A5 una per mezza pagina. Se la trasparenza non è disponibile non si disegna.
- Riepiloghi (da fatturare, spese): l'ultima riga resta con il totale; il riepilogo non resta con il
  solo titolo.

## Layout dei PDF: singolo, multi-cliente, giornata

`js/services/pdf/giornata.js` ha un solo motore di impaginazione (`impaginatore`) per i contenuti di un
cliente (dati, attività, materiali, importo, spese, fotografie, note, firma); cambia solo la cornice
(pagina A4 o colonna A5; il motore segue l'area corrente anche quando passa da una colonna all'altra):
- **Rapportino singolo** (un cliente: PDF del rapportino dall'app, PDF "per cliente" di una giornata con
  un solo cliente): layout normale su pagina A4 intera, titolo "RAPPORTINO DI INTERVENTO".
- **Stampa multi-cliente** (PDF "per cliente" di una giornata con più clienti): pagina **A4 orizzontale**
  (297 × 210 mm) con due rapportini **A5 verticali** affiancati (148,5 × 210 mm): cliente 1 a sinistra,
  cliente 2 a destra, poi altri fogli. Rispetto al foglio tenuto in verticale ogni rapportino è ruotato di
  90°: stampando, la stampante ruota la pagina sul foglio e dopo il taglio verticale (linea tratteggiata
  al centro, "TAGLIA QUI" scritto lungo la linea) ogni metà è un A5 verticale che si legge normalmente.
  Margini: 12 mm dal bordo del foglio, 8 mm dalla linea di taglio. Ogni colonna ha logo, intestazione
  (N., data, "Cliente i di n"), dati della giornata, piede con riferimento e pagina; ogni cliente parte da
  una colonna nuova e non sconfina nell'altra; un cliente rimasto da solo occupa una sola metà. Se non
  entra continua nella colonna successiva con "Nome (segue)" (testo non ridotto: minimo 8,5 pt).
  Riferimento per cliente `RG-AAAAMMGG-n`.
- **Foglio unico** della giornata: invariato (A4, lavori numerati, riepiloghi).

## Procedura di applicazione

**Stato (08/11/2026): procedura completata.** Le migrazioni 20261108–20261111 sono in produzione dal
7/11/2026 (sera) e il frontend delle Fasi A–F è su `main` (PR #1); la Fase G (migrazioni 20261112 e
20261113, Edge Functions) è in produzione dal 7–8/11/2026 (PR #2); la Fase H è solo frontend (PR #3).
I passi restano come riferimento per un nuovo progetto o per una ricostruzione: in quel caso eseguirli
solo con autorizzazione. Le migrazioni applicate dal SQL Editor non compaiono nello storico della CLI:
vedi il README ("Storico delle migrazioni") prima di usare `supabase db push`.

1. Backup: dall'app Altro → Esporta backup; nel pannello Supabase, SQL Editor:
   `create schema if not exists backup;`
   `create table backup.rapporti_AAAAMMGG as select * from public.rapporti;`
   (lo schema `backup` non è esposto alle API: anon/authenticated non hanno accesso)
   (la migrazione non tocca `rapporti`, ma è la stessa prudenza del rilascio precedente).
2. SQL Editor → incollare `supabase/migrations/20261108090000_interventi_rapportini.sql` → Run;
   poi, nello stesso modo, `supabase/migrations/20261109090000_interventi_piu_operai.sql` → Run
   e `supabase/migrations/20261110090000_allegati_storage.sql` → Run, infine
   `supabase/migrations/20261111090000_rapporti_privilegi.sql` → Run. Verifica del bucket:
   `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'allegati-rapportini';`
   (deve dare `public = false`, 3145728, i tre tipi) e
   `select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'allegati_rapportini_%';`
   (tre policy: lettura SELECT, caricamento INSERT, cancellazione DELETE).
3. Verifica: eseguire la prima query anche PRIMA del passo 2 e annotare il risultato; dopo deve dare
   lo stesso numero di righe e la stessa impronta (51 giornate al rilascio del 7/11/2026, 52 l'8/11);
   la seconda deve dare 5 tabelle nuove con RLS `true`:
   ```sql
   select count(*), md5(string_agg(data::text||'|'||dati::text||'|'||coalesce(aggiornato::text,''),'#' order by data)) from public.rapporti;
   select relname, relrowsecurity from pg_class where relname in ('interventi','intervento_operai','rapportini','rapportino_operai','allegati');
   ```
4. Pubblicare il frontend: merge di `interventi-rapportini` su `main` (fatto: PR #1).
5. Prova con un admin e due operai (vedi README / rapporto).

Fase G (ramo `fase-g-utenti-pin`, unito con la PR #2; tutti i passi sono stati eseguiti il 7–8/11/2026):
1. Backup dei profili: `create table backup.profili_AAAAMMGG as select * from public.profili;`
2. SQL Editor → `supabase/migrations/20261112090000_utenti_pin_ruoli.sql` → Run. Verifica:
   `select username, ruolo, ruoli from public.profili order by username;` (Luca `{admin,worker}`,
   gli altri il solo ruolo principale) e `select count(*) from public.pin_accesso;` (0).
   [applicata in produzione la sera del 7/11/2026]
   Poi `supabase/migrations/20261113090000_recupero_accesso.sql` → Run (colonne del recupero
   dell'accesso). Verifica: `select count(*) from information_schema.columns where table_name = 'profili'
   and column_name like 'password_%';` (3). [applicata in produzione il 7/11/2026]
3. Pubblicare le Edge Functions `accesso`, `cambia-password`, `utenti`, `inizializza` e la nuova `pin`
   (`supabase functions deploy accesso cambia-password utenti inizializza pin`). Prima della migrazione le funzioni
   nuove non vanno pubblicate: leggono le colonne `cognome`, `ruoli` e `password_temporanea_scade`.
   [pubblicate il 7/11/2026: `accesso` e `inizializza` con verify_jwt disattivato, le altre attivo]
4. Pubblicare il frontend (merge su `main`). [fatto: PR #2]
5. Facoltativo: completare il cognome degli account esistenti da Gestione utenti → Modifica
   (oggi nome e cognome sono insieme nel campo Nome; l'app li mostra correttamente lo stesso).
Rollback Fase G: ripristinare frontend e Edge Functions precedenti, eliminare la funzione `pin`, poi
`supabase/rollback/20261113090000_recupero_accesso_rollback.sql` e
`supabase/rollback/20261112090000_utenti_pin_ruoli_rollback.sql` (perde cognomi e PIN, non i dati).

Rollback Fasi A–F (dopo l'eventuale rollback della Fase G): ripristinare `main` al commit precedente,
poi SQL Editor → `supabase/rollback/20261111090000_rapporti_privilegi_rollback.sql` (rimette i
privilegi di prima su `rapporti`), poi `supabase/rollback/20261110090000_allegati_storage_rollback.sql`, poi
`supabase/rollback/20261109090000_interventi_piu_operai_rollback.sql` e, solo per tornare a prima
degli interventi, `supabase/rollback/20261108090000_interventi_rapportini_rollback.sql`.
Il rollback elimina interventi e rapportini scritti con la nuova app: prima esportarli
(`select * from public.rapportini` ecc. → Export CSV).

## SQL completo — migrazione
```sql
-- =====================================================================
-- Interventi e rapportini multiutente (tabelle nuove).
--
-- NON tocca la tabella storica "rapporti", le sue policy, il trigger e le funzioni esistenti:
-- il foglio giornaliero e il PDF continuano a funzionare come prima.
-- Nessun dato viene migrato.
--
--   interventi           lavoro pianificato (admin/company): cliente, data, descrizione, priorita'
--   intervento_operai    operai assegnati a un intervento (uno o piu')
--   rapportini           resoconto di un operaio: collegato a un intervento o autonomo; bozza/completato
--   rapportino_operai    ore di ogni operaio sul rapportino
--   allegati             foto/scontrini di un rapportino
--
-- Isolamento: un operaio vede gli interventi a cui e' assegnato e i rapportini che ha scritto
-- (o in cui compare tra gli operai); admin e company vedono tutto, solo l'admin modifica tutto.
-- Chi scrive non e' mai deciso dal browser: autore e creatore li impone il database (auth.uid()).
-- =====================================================================

-- ---------------------------------------------------------------- funzioni di supporto (ruoli)
-- mio_ruolo() esiste gia' (migrazione utenti_ruoli): ruolo dell'utente collegato se attivo, altrimenti null
create or replace function public.e_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.mio_ruolo() = 'admin', false)
$$;
create or replace function public.pianifica() returns boolean      -- admin o company
language sql stable security definer set search_path = '' as $$
  select coalesce(public.mio_ruolo() in ('admin', 'company'), false)
$$;
-- chi puo' lavorare sul campo: operai e admin (l'admin lavora anche come operaio)
create or replace function public.compila() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.mio_ruolo() in ('admin', 'worker'), false)
$$;
revoke execute on function public.e_admin(), public.pianifica(), public.compila() from public, anon;
grant execute on function public.e_admin(), public.pianifica(), public.compila() to authenticated;

-- ---------------------------------------------------------------- interventi
create table public.interventi (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  ora time,
  cliente text not null check (length(btrim(cliente)) between 1 and 200),
  indirizzo text not null default '',
  descrizione text not null default '',
  priorita text not null default 'normale' check (priorita in ('bassa', 'normale', 'alta', 'urgente')),
  tipologia text not null default '',
  stato text not null default 'pianificato' check (stato in ('pianificato', 'in_corso', 'completato', 'annullato')),
  creato_da uuid not null references public.profili(id),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index interventi_data on public.interventi (data);

create table public.intervento_operai (
  intervento_id uuid not null references public.interventi(id) on delete cascade,
  operaio_id uuid not null references public.profili(id),
  assegnato_da uuid not null references public.profili(id),
  assegnato_il timestamptz not null default now(),
  primary key (intervento_id, operaio_id)
);
create index intervento_operai_operaio on public.intervento_operai (operaio_id);

-- l'utente collegato (attivo) e' assegnato all'intervento? (security definer: evita ricorsioni tra policy)
create or replace function public.assegnato_a(p_intervento uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mio_ruolo() is not null and exists (select 1 from public.intervento_operai
                 where intervento_id = p_intervento and operaio_id = auth.uid())
$$;
revoke execute on function public.assegnato_a(uuid) from public, anon;
grant execute on function public.assegnato_a(uuid) to authenticated;

-- ---------------------------------------------------------------- rapportini
create table public.rapportini (
  id uuid primary key default gen_random_uuid(),
  intervento_id uuid references public.interventi(id) on delete restrict,   -- null = rapportino autonomo
  autore_id uuid not null references public.profili(id),
  data date not null,
  cliente text not null check (length(btrim(cliente)) between 1 and 200),
  indirizzo text not null default '',
  tipologia text not null default '',
  attivita text not null default '',            -- attivita' svolte
  materiali jsonb not null default '[]' check (jsonb_typeof(materiali) = 'array'),
  note text not null default '',
  esito text not null default 'Completato' check (esito in ('Completato', 'Da ultimare')),
  firma text not null default '',
  firmatario text not null default '',
  stato text not null default 'bozza' check (stato in ('bozza', 'completato')),
  completato_il timestamptz,
  versione integer not null default 1,           -- controllo delle modifiche concorrenti
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index rapportini_autore on public.rapportini (autore_id);
create index rapportini_intervento on public.rapportini (intervento_id);
create index rapportini_data on public.rapportini (data);

create table public.rapportino_operai (
  rapportino_id uuid not null references public.rapportini(id) on delete cascade,
  operaio_id uuid not null references public.profili(id),
  dalle time,
  alle time,
  primary key (rapportino_id, operaio_id),
  check (dalle is null or alle is null or alle > dalle)
);
create index rapportino_operai_operaio on public.rapportino_operai (operaio_id);

create table public.allegati (
  id uuid primary key default gen_random_uuid(),
  rapportino_id uuid not null references public.rapportini(id) on delete cascade,
  tipo text not null default 'foto' check (tipo in ('foto', 'scontrino', 'altro')),
  nome text not null default '',
  contenuto text not null check (length(contenuto) <= 3000000),   -- immagine compressa dall'app (data URL)
  larghezza integer,
  altezza integer,
  caricato_da uuid not null references public.profili(id),
  creato_il timestamptz not null default now()
);
create index allegati_rapportino on public.allegati (rapportino_id);

-- l'utente collegato puo' vedere / modificare il rapportino?
create or replace function public.vede_rapportino(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pianifica() or (public.mio_ruolo() is not null and exists (
    select 1 from public.rapportini r where r.id = p_id and (
      r.autore_id = auth.uid()
      or exists (select 1 from public.rapportino_operai o where o.rapportino_id = r.id and o.operaio_id = auth.uid()))))
$$;
create or replace function public.modifica_rapportino(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.e_admin() or exists (
    select 1 from public.rapportini r
    where r.id = p_id and r.autore_id = auth.uid() and r.stato = 'bozza' and public.compila())
$$;
revoke execute on function public.vede_rapportino(uuid), public.modifica_rapportino(uuid) from public, anon;
grant execute on function public.vede_rapportino(uuid), public.modifica_rapportino(uuid) to authenticated;

-- ---------------------------------------------------------------- trigger: identita' e regole
create or replace function public.controlla_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;          -- service_role / pannello
  if tg_op = 'INSERT' then
    new.creato_da := auth.uid();
    new.creato_il := now();
  else
    new.creato_da := old.creato_da;
    new.creato_il := old.creato_il;
  end if;
  new.aggiornato_il := now();
  return new;
end $$;
create trigger interventi_controllo before insert or update on public.interventi
  for each row execute function public.controlla_intervento();

create or replace function public.controlla_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  new.assegnato_da := auth.uid();
  new.assegnato_il := now();
  -- si assegnano solo account attivi che lavorano sul campo
  if not exists (select 1 from public.profili p where p.id = new.operaio_id and p.attivo and p.ruolo in ('worker', 'admin')) then
    raise exception 'Si possono assegnare solo operai attivi' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger intervento_operai_controllo before insert or update on public.intervento_operai
  for each row execute function public.controlla_assegnazione();

create or replace function public.controlla_rapportino() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  admin boolean := public.e_admin();
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.autore_id := auth.uid();                 -- l'autore e' sempre chi scrive
    new.creato_il := now();
    new.versione := 1;
    if new.intervento_id is not null and not admin and not public.assegnato_a(new.intervento_id) then
      raise exception 'Non sei assegnato a questo intervento' using errcode = '42501';
    end if;
  else
    if old.stato = 'completato' and not admin then
      raise exception 'Il rapportino e'' completato: solo l''amministratore puo'' riaprirlo' using errcode = '42501';
    end if;
    new.autore_id := old.autore_id;
    new.creato_il := old.creato_il;
    if new.intervento_id is distinct from old.intervento_id and not admin then
      raise exception 'Il collegamento all''intervento non si cambia' using errcode = '42501';
    end if;
    new.versione := old.versione + 1;
  end if;
  if new.stato = 'completato' and (tg_op = 'INSERT' or old.stato <> 'completato') then
    -- completamento: campi obbligatori
    if length(btrim(new.attivita)) = 0 then
      raise exception 'Per completare descrivi le attivita'' svolte' using errcode = '23514';
    end if;
    new.completato_il := now();
  elsif new.stato = 'bozza' then
    new.completato_il := null;
  end if;
  new.aggiornato_il := now();
  return new;
end $$;
create trigger rapportini_controllo before insert or update on public.rapportini
  for each row execute function public.controlla_rapportino();

-- per completare servono le ore di almeno un operaio (controllo a fine transazione)
create or replace function public.controlla_ore_rapportino() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stato = 'completato' and not exists (
    select 1 from public.rapportino_operai o where o.rapportino_id = new.id and o.dalle is not null and o.alle is not null
  ) then
    raise exception 'Per completare indica le ore lavorate di almeno un operaio' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger rapportini_ore_completamento after insert or update on public.rapportini
  deferrable initially deferred for each row execute function public.controlla_ore_rapportino();

-- le ore si inseriscono solo per account attivi che lavorano sul campo
create or replace function public.controlla_ore_operaio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if not exists (select 1 from public.profili p where p.id = new.operaio_id and p.attivo and p.ruolo in ('worker', 'admin')) then
    raise exception 'Operaio non valido' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger rapportino_operai_controllo before insert or update on public.rapportino_operai
  for each row execute function public.controlla_ore_operaio();

create or replace function public.controlla_allegato() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  new.caricato_da := auth.uid();
  new.creato_il := now();
  return new;
end $$;
create trigger allegati_controllo before insert on public.allegati
  for each row execute function public.controlla_allegato();

-- stato dell'intervento ricavato dai suoi rapportini (salvo "annullato", deciso da chi pianifica)
create or replace function public.aggiorna_stato_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  id_int uuid := coalesce(new.intervento_id, old.intervento_id);
begin
  if id_int is null then return null; end if;
  update public.interventi i set stato = case
      when exists (select 1 from public.rapportini r where r.intervento_id = id_int and r.stato = 'completato') then 'completato'
      when exists (select 1 from public.rapportini r where r.intervento_id = id_int) then 'in_corso'
      else 'pianificato' end
  where i.id = id_int and i.stato <> 'annullato';
  return null;
end $$;
create trigger rapportini_stato_intervento after insert or update or delete on public.rapportini
  for each row execute function public.aggiorna_stato_intervento();

revoke execute on function public.controlla_intervento(), public.controlla_assegnazione(), public.controlla_rapportino(),
  public.controlla_ore_rapportino(), public.controlla_ore_operaio(), public.controlla_allegato(),
  public.aggiorna_stato_intervento() from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.interventi enable row level security;
alter table public.intervento_operai enable row level security;
alter table public.rapportini enable row level security;
alter table public.rapportino_operai enable row level security;
alter table public.allegati enable row level security;

revoke all on public.interventi, public.intervento_operai, public.rapportini, public.rapportino_operai, public.allegati from anon;
grant select, insert, update, delete on public.interventi, public.intervento_operai, public.rapportini,
  public.rapportino_operai, public.allegati to authenticated;
-- Supabase concede di default anche TRUNCATE/REFERENCES/TRIGGER: TRUNCATE ignorerebbe RLS
revoke truncate, references, trigger on public.interventi, public.intervento_operai, public.rapportini,
  public.rapportino_operai, public.allegati from authenticated;

-- interventi: chi pianifica vede e gestisce; l'operaio vede solo quelli a cui e' assegnato
create policy interventi_lettura on public.interventi for select to authenticated
  using ((select public.pianifica()) or public.assegnato_a(id));
create policy interventi_inserimento on public.interventi for insert to authenticated
  with check ((select public.pianifica()));
create policy interventi_modifica on public.interventi for update to authenticated
  using ((select public.pianifica())) with check ((select public.pianifica()));
create policy interventi_eliminazione on public.interventi for delete to authenticated
  using ((select public.e_admin()));

-- assegnazioni: chi pianifica gestisce; l'operaio vede le assegnazioni dei propri interventi (i colleghi)
create policy intervento_operai_lettura on public.intervento_operai for select to authenticated
  using ((select public.pianifica()) or public.assegnato_a(intervento_id));
create policy intervento_operai_inserimento on public.intervento_operai for insert to authenticated
  with check ((select public.pianifica()));
create policy intervento_operai_eliminazione on public.intervento_operai for delete to authenticated
  using ((select public.pianifica()));

-- rapportini: autore (o operaio indicato nelle ore) e chi pianifica vedono; solo operai/admin scrivono
create policy rapportini_lettura on public.rapportini for select to authenticated
  using ((select public.pianifica()) or ((select public.mio_ruolo()) is not null and (autore_id = (select auth.uid())
         or exists (select 1 from public.rapportino_operai o where o.rapportino_id = rapportini.id and o.operaio_id = (select auth.uid())))));
create policy rapportini_inserimento on public.rapportini for insert to authenticated
  with check ((select public.compila()) and autore_id = (select auth.uid()));
create policy rapportini_modifica on public.rapportini for update to authenticated
  using ((select public.e_admin()) or (autore_id = (select auth.uid()) and (select public.compila())))
  with check ((select public.e_admin()) or (autore_id = (select auth.uid()) and (select public.compila())));
create policy rapportini_eliminazione on public.rapportini for delete to authenticated
  using ((select public.e_admin()) or (autore_id = (select auth.uid()) and stato = 'bozza' and (select public.compila())));

-- ore e allegati seguono il rapportino
create policy rapportino_operai_lettura on public.rapportino_operai for select to authenticated
  using (public.vede_rapportino(rapportino_id));
create policy rapportino_operai_scrittura on public.rapportino_operai for insert to authenticated
  with check (public.modifica_rapportino(rapportino_id));
create policy rapportino_operai_modifica on public.rapportino_operai for update to authenticated
  using (public.modifica_rapportino(rapportino_id)) with check (public.modifica_rapportino(rapportino_id));
create policy rapportino_operai_eliminazione on public.rapportino_operai for delete to authenticated
  using (public.modifica_rapportino(rapportino_id));

create policy allegati_lettura on public.allegati for select to authenticated
  using (public.vede_rapportino(rapportino_id));
create policy allegati_inserimento on public.allegati for insert to authenticated
  with check (public.modifica_rapportino(rapportino_id));
create policy allegati_eliminazione on public.allegati for delete to authenticated
  using (public.modifica_rapportino(rapportino_id));

-- ---------------------------------------------------------------- elenco operai
-- l'operaio deve poter indicare nelle ore i colleghi: nome e username degli account sul campo
create or replace function public.operai_attivi() returns table (id uuid, username text, nome text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.nome from public.profili p
  where p.attivo and p.ruolo in ('worker', 'admin') and public.mio_ruolo() is not null
  order by lower(p.nome), lower(p.username)
$$;
revoke execute on function public.operai_attivi() from public, anon;
grant execute on function public.operai_attivi() to authenticated;

-- ---------------------------------------------------------------- salvataggio atomico di un rapportino
-- Salva testata e ore in una sola transazione (SECURITY INVOKER: valgono RLS e trigger di chi chiama).
-- p_rapportino: { id, versione?, intervento_id?, data, cliente, indirizzo, tipologia, attivita,
--                 materiali, note, esito, firma, firmatario }
-- p_ore: [ { operaio_id, dalle, alle } ]   p_completa: true per completare (controlli obbligatori)
-- Regole:
--  * l'id lo genera il telefono; si CREA un rapportino solo se quell'id non esiste ancora sul server;
--  * un rapportino esistente si MODIFICA solo indicando la versione letta, e solo se e' ancora quella;
--    se la versione manca o e' diversa la funzione risponde "conflitto" (con la versione del server
--    e le sue ore) e non sovrascrive nulla. Cosi' un secondo invio dello stesso rapportino (es. dopo
--    un errore di rete) non crea doppioni e non sovrascrive alla cieca: decide l'app;
--  * due creazioni contemporanee con lo stesso id: una crea, l'altra riceve "conflitto" (nessun errore);
--  * id di un rapportino altrui che l'utente non puo' modificare: errore "Rapportino non modificabile";
--  * se una parte fallisce (es. ore non valide) non viene salvato nulla.
create or replace function public.salva_rapportino(p_rapportino jsonb, p_ore jsonb, p_completa boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.rapportini%rowtype;
  v_id uuid := coalesce(nullif(p_rapportino->>'id', '')::uuid, gen_random_uuid());
  v_versione integer := nullif(p_rapportino->>'versione', '')::integer;
  v_fatto boolean := false;
begin
  if v_versione is not null then
    -- modifica: riesce solo se la versione e' ancora quella letta (atomico anche con salvataggi contemporanei)
    update public.rapportini set
      data = (p_rapportino->>'data')::date,
      cliente = coalesce(p_rapportino->>'cliente', ''), indirizzo = coalesce(p_rapportino->>'indirizzo', ''),
      tipologia = coalesce(p_rapportino->>'tipologia', ''), attivita = coalesce(p_rapportino->>'attivita', ''),
      materiali = coalesce(p_rapportino->'materiali', '[]'::jsonb), note = coalesce(p_rapportino->>'note', ''),
      esito = coalesce(nullif(p_rapportino->>'esito', ''), 'Completato'),
      firma = coalesce(p_rapportino->>'firma', ''), firmatario = coalesce(p_rapportino->>'firmatario', '')
    where id = v_id and versione = v_versione
    returning * into r;
    v_fatto := found;
  end if;
  if not v_fatto then
    -- creazione: solo se l'id non esiste (ON CONFLICT: niente errore se un altro invio l'ha appena creato)
    if not exists (select 1 from public.rapportini where id = v_id) then
      insert into public.rapportini (id, intervento_id, data, cliente, indirizzo, tipologia, attivita, materiali, note, esito, firma, firmatario)
      values (v_id, nullif(p_rapportino->>'intervento_id', '')::uuid, (p_rapportino->>'data')::date,
              coalesce(p_rapportino->>'cliente', ''), coalesce(p_rapportino->>'indirizzo', ''), coalesce(p_rapportino->>'tipologia', ''),
              coalesce(p_rapportino->>'attivita', ''), coalesce(p_rapportino->'materiali', '[]'::jsonb), coalesce(p_rapportino->>'note', ''),
              coalesce(nullif(p_rapportino->>'esito', ''), 'Completato'), coalesce(p_rapportino->>'firma', ''), coalesce(p_rapportino->>'firmatario', ''))
      on conflict (id) do nothing
      returning * into r;
      v_fatto := found;
    end if;
  end if;
  if not v_fatto then
    -- l'id esiste gia': versione mancante o superata, oppure rapportino non dell'utente.
    -- All'autore si risponde "conflitto" anche se nel frattempo e' stato completato (cosi' l'app vede
    -- che il suo "Completa" era gia' arrivato); agli altri senza diritto di modifica: errore.
    select * into r from public.rapportini where id = v_id;
    if not found or not (public.modifica_rapportino(v_id) or r.autore_id = (select auth.uid())) then
      raise exception 'Rapportino non modificabile' using errcode = '42501';
    end if;
    return jsonb_build_object('esito', 'conflitto', 'rapportino', to_jsonb(r),
      'ore', coalesce((select jsonb_agg(jsonb_build_object('operaio_id', o.operaio_id, 'dalle', o.dalle, 'alle', o.alle) order by o.operaio_id)
                       from public.rapportino_operai o where o.rapportino_id = v_id), '[]'::jsonb));
  end if;
  delete from public.rapportino_operai where rapportino_id = r.id;
  insert into public.rapportino_operai (rapportino_id, operaio_id, dalle, alle)
    select r.id, (o->>'operaio_id')::uuid, nullif(o->>'dalle', '')::time, nullif(o->>'alle', '')::time
    from jsonb_array_elements(coalesce(p_ore, '[]'::jsonb)) o
    where nullif(o->>'operaio_id', '') is not null;
  if p_completa then
    update public.rapportini set stato = 'completato' where id = r.id returning * into r;
  end if;
  return jsonb_build_object('esito', 'ok', 'rapportino', to_jsonb(r));
end $$;
revoke execute on function public.salva_rapportino(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.salva_rapportino(jsonb, jsonb, boolean) to authenticated;
```

## SQL completo — rollback
```sql
-- ROLLBACK di 20261108090000_interventi_rapportini.sql
-- ATTENZIONE: elimina le tabelle nuove e quindi gli interventi e i rapportini scritti con la nuova app.
-- Prima esportarli (procedura nel rapporto). Non tocca "rapporti", "profili" ne' le loro policy.
begin;
drop function if exists public.salva_rapportino(jsonb, jsonb, boolean);
drop function if exists public.operai_attivi();
-- insieme, in un'unica istruzione: CASCADE porta via solo le policy, i trigger e le chiavi
-- di queste cinque tabelle (nessun altro oggetto dipende da loro)
drop table if exists public.allegati, public.rapportino_operai, public.rapportini,
  public.intervento_operai, public.interventi cascade;
drop function if exists public.aggiorna_stato_intervento();
drop function if exists public.controlla_allegato();
drop function if exists public.controlla_ore_operaio();
drop function if exists public.controlla_ore_rapportino();
drop function if exists public.controlla_rapportino();
drop function if exists public.controlla_assegnazione();
drop function if exists public.controlla_intervento();
drop function if exists public.vede_rapportino(uuid);
drop function if exists public.modifica_rapportino(uuid);
drop function if exists public.assegnato_a(uuid);
drop function if exists public.e_admin();
drop function if exists public.pianifica();
drop function if exists public.compila();
commit;
```

## SQL completo — migrazione Fase B
```sql
-- =====================================================================
-- Fase B: interventi assegnati a piu' operai (migrazione incrementale; richiede 20261108090000).
--
-- 1. Assegnazioni con storico: togliere un operaio non cancella la riga di intervento_operai ma la
--    segna "rimossa" (rimosso_il / rimosso_da). Riassegnarlo riattiva la stessa riga.
--    I rapportini, le ore e le foto non dipendono dalle assegnazioni e non vengono mai toccati.
-- 2. Stato complessivo calcolato dal database (stessi quattro stati di prima, nessuno nuovo):
--      annullato    deciso da chi pianifica (resta finche' non viene ripristinato)
--      completato   OGNI operaio assegnato (attivo) ha un proprio rapportino completato;
--                   senza operai assegnati un intervento non e' mai completato
--      in_corso     esiste almeno un rapportino (bozza o completato) collegato
--      pianificato  altrimenti
--    Il ricalcolo blocca la riga dell'intervento (SELECT ... FOR UPDATE): completamenti e modifiche
--    alle assegnazioni contemporanei vengono messi in fila e l'ultimo vede i dati dell'altro.
-- 3. Lo stato non si imposta piu' a mano: un utente puo' solo annullare o ripristinare; il valore
--    "pianificato/in_corso/completato" lo decide sempre il calcolo.
--
-- Non cambia: salva_rapportino, le policy RLS, le tabelle rapporti/profili e le 51 giornate.
-- Ripetibile: ogni istruzione si puo' rieseguire (if not exists / create or replace / drop if exists).
-- =====================================================================

-- ---------------------------------------------------------------- assegnazioni con storico
alter table public.intervento_operai add column if not exists rimosso_il timestamptz;
alter table public.intervento_operai add column if not exists rimosso_da uuid references public.profili(id);
create index if not exists intervento_operai_attivi on public.intervento_operai (intervento_id) where rimosso_il is null;

-- solo le assegnazioni attive danno accesso all'intervento (un operaio rimosso non lo vede piu';
-- i suoi rapportini restano suoi e visibili a lui come autore)
create or replace function public.assegnato_a(p_intervento uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mio_ruolo() is not null and exists (select 1 from public.intervento_operai
                 where intervento_id = p_intervento and operaio_id = auth.uid() and rimosso_il is null)
$$;

-- inserimento: un'assegnazione gia' esistente ma rimossa viene riattivata (nessun doppione, nessun errore);
-- se e' gia' attiva non succede nulla. Gli aggiornamenti arrivano solo dalle funzioni qui sotto
-- (per gli utenti non esiste una policy di UPDATE su intervento_operai).
create or replace function public.controlla_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    -- il controllo RLS dell'inserimento non scatterebbe se la riga viene riattivata: si ripete qui
    if not public.pianifica() then
      raise exception 'Operazione non consentita' using errcode = '42501';
    end if;
    -- si assegnano solo account attivi che lavorano sul campo
    if not exists (select 1 from public.profili p where p.id = new.operaio_id and p.attivo and p.ruolo in ('worker', 'admin')) then
      raise exception 'Si possono assegnare solo operai attivi' using errcode = '42501';
    end if;
    if exists (select 1 from public.intervento_operai a where a.intervento_id = new.intervento_id and a.operaio_id = new.operaio_id) then
      update public.intervento_operai set rimosso_il = null, rimosso_da = null, assegnato_da = auth.uid(), assegnato_il = now()
        where intervento_id = new.intervento_id and operaio_id = new.operaio_id and rimosso_il is not null;
      return null;
    end if;
    new.assegnato_da := auth.uid();
    new.assegnato_il := now();
    new.rimosso_il := null;
    new.rimosso_da := null;
    return new;
  end if;
  -- UPDATE: chiave invariata
  new.intervento_id := old.intervento_id;
  new.operaio_id := old.operaio_id;
  return new;
end $$;

-- eliminazione da parte di un utente = rimozione logica (lo storico resta). Le cancellazioni a cascata
-- (intervento eliminato, possibile solo senza rapportini) e quelle del pannello restano vere.
create or replace function public.rimuovi_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return old; end if;
  update public.intervento_operai set rimosso_il = now(), rimosso_da = auth.uid()
    where intervento_id = old.intervento_id and operaio_id = old.operaio_id and rimosso_il is null;
  return null;
end $$;
drop trigger if exists intervento_operai_rimozione on public.intervento_operai;
create trigger intervento_operai_rimozione before delete on public.intervento_operai
  for each row execute function public.rimuovi_assegnazione();

-- ---------------------------------------------------------------- stato complessivo
create or replace function public.stato_intervento_calcolato(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.intervento_operai a where a.intervento_id = p_id and a.rimosso_il is null)
     and not exists (
       select 1 from public.intervento_operai a
       where a.intervento_id = p_id and a.rimosso_il is null
         and not exists (select 1 from public.rapportini r
                         where r.intervento_id = p_id and r.autore_id = a.operaio_id and r.stato = 'completato'))
      then 'completato'
    when exists (select 1 from public.rapportini r where r.intervento_id = p_id) then 'in_corso'
    else 'pianificato' end
$$;

-- ricalcolo atomico: prima si blocca la riga dell'intervento, poi (istruzione successiva, quindi con
-- i dati gia' confermati da chi aveva il blocco) si calcola e si scrive lo stato. Idempotente.
create or replace function public.ricalcola_stato_intervento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null then return; end if;
  perform 1 from public.interventi where id = p_id for update;
  if not found then return; end if;
  update public.interventi set stato = public.stato_intervento_calcolato(p_id)
    where id = p_id and stato <> 'annullato' and stato is distinct from public.stato_intervento_calcolato(p_id);
end $$;

-- trigger comune a rapportini e intervento_operai (entrambe hanno la colonna intervento_id):
-- si ricalcola l'intervento nuovo e, se cambiato, quello vecchio
create or replace function public.aggiorna_stato_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  nuovo uuid := case when tg_op = 'DELETE' then null else new.intervento_id end;
  vecchio uuid := case when tg_op = 'INSERT' then null else old.intervento_id end;
begin
  perform public.ricalcola_stato_intervento(nuovo);
  if vecchio is distinct from nuovo then perform public.ricalcola_stato_intervento(vecchio); end if;
  return null;
end $$;
drop trigger if exists intervento_operai_stato on public.intervento_operai;
create trigger intervento_operai_stato after insert or update or delete on public.intervento_operai
  for each row execute function public.aggiorna_stato_intervento();

-- lo stato non si scrive a mano: inserendo si parte da "pianificato" (o "annullato");
-- aggiornando, qualsiasi valore diverso da "annullato" viene sostituito da quello calcolato
create or replace function public.controlla_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;          -- service_role / pannello
  if tg_op = 'INSERT' then
    new.creato_da := auth.uid();
    new.creato_il := now();
    if new.stato <> 'annullato' then new.stato := 'pianificato'; end if;
  else
    new.creato_da := old.creato_da;
    new.creato_il := old.creato_il;
    if new.stato is distinct from old.stato and new.stato <> 'annullato' then
      new.stato := public.stato_intervento_calcolato(new.id);
    end if;
  end if;
  new.aggiornato_il := now();
  return new;
end $$;

revoke execute on function public.rimuovi_assegnazione(), public.stato_intervento_calcolato(uuid),
  public.ricalcola_stato_intervento(uuid) from public, anon, authenticated;
revoke execute on function public.controlla_assegnazione(), public.controlla_intervento(),
  public.aggiorna_stato_intervento() from public, anon, authenticated;

-- stati gia' presenti allineati alla nuova regola (nessun dato cancellato; eseguito senza utente)
update public.interventi i set stato = public.stato_intervento_calcolato(i.id)
  where i.stato <> 'annullato' and i.stato is distinct from public.stato_intervento_calcolato(i.id);
```

## SQL completo — rollback Fase B
```sql
-- ROLLBACK di 20261109090000_interventi_piu_operai.sql (torna esattamente alla Fase A).
-- ATTENZIONE: le assegnazioni "rimosse" (storico) vengono eliminate, perche' senza la colonna
-- rimosso_il tornerebbero attive e ridarebbero accesso all'intervento. Prima esportarle:
--   select * from public.intervento_operai where rimosso_il is not null;   -> Export CSV
-- Interventi, rapportini, ore e foto NON vengono toccati. Non tocca "rapporti" ne' "profili".
begin;
drop trigger if exists intervento_operai_rimozione on public.intervento_operai;
drop trigger if exists intervento_operai_stato on public.intervento_operai;

-- funzioni della Fase A, testo originale
create or replace function public.assegnato_a(p_intervento uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mio_ruolo() is not null and exists (select 1 from public.intervento_operai
                 where intervento_id = p_intervento and operaio_id = auth.uid())
$$;

create or replace function public.controlla_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;          -- service_role / pannello
  if tg_op = 'INSERT' then
    new.creato_da := auth.uid();
    new.creato_il := now();
  else
    new.creato_da := old.creato_da;
    new.creato_il := old.creato_il;
  end if;
  new.aggiornato_il := now();
  return new;
end $$;

create or replace function public.controlla_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  new.assegnato_da := auth.uid();
  new.assegnato_il := now();
  -- si assegnano solo account attivi che lavorano sul campo
  if not exists (select 1 from public.profili p where p.id = new.operaio_id and p.attivo and p.ruolo in ('worker', 'admin')) then
    raise exception 'Si possono assegnare solo operai attivi' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.aggiorna_stato_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  id_int uuid := coalesce(new.intervento_id, old.intervento_id);
begin
  if id_int is null then return null; end if;
  update public.interventi i set stato = case
      when exists (select 1 from public.rapportini r where r.intervento_id = id_int and r.stato = 'completato') then 'completato'
      when exists (select 1 from public.rapportini r where r.intervento_id = id_int) then 'in_corso'
      else 'pianificato' end
  where i.id = id_int and i.stato <> 'annullato';
  return null;
end $$;

revoke execute on function public.controlla_intervento(), public.controlla_assegnazione(),
  public.aggiorna_stato_intervento() from public, anon, authenticated;

drop function if exists public.rimuovi_assegnazione();
drop function if exists public.ricalcola_stato_intervento(uuid);
drop function if exists public.stato_intervento_calcolato(uuid);

-- storico delle assegnazioni rimosse (vedi avvertenza sopra), poi le colonne
delete from public.intervento_operai where rimosso_il is not null;
drop index if exists public.intervento_operai_attivi;
alter table public.intervento_operai drop column if exists rimosso_da;
alter table public.intervento_operai drop column if exists rimosso_il;

-- stati riallineati alla regola della Fase A
update public.interventi i set stato = case
    when exists (select 1 from public.rapportini r where r.intervento_id = i.id and r.stato = 'completato') then 'completato'
    when exists (select 1 from public.rapportini r where r.intervento_id = i.id) then 'in_corso'
    else 'pianificato' end
  where i.stato <> 'annullato';
commit;
```

## SQL completo — migrazione Fase C
```sql
-- =====================================================================
-- Fase C: foto dei rapportini in Supabase Storage (migrazione incrementale; richiede 20261108090000).
--
-- Bucket PRIVATO "allegati-rapportini": nessun URL pubblico. Ogni file sta in
--   <id rapportino>/<id allegato>.<jpg|png|webp>      (id allegato = UUID casuale generato dal telefono)
-- e si legge/scrive solo con la sessione dell'utente: le policy Storage usano le stesse funzioni
-- delle policy RLS della tabella allegati (vede_rapportino / modifica_rapportino).
--
-- Nella tabella allegati restano solo i metadati (percorso, nome, tipo, dimensione, misure, impronta,
-- autore, data). Le nuove foto NON possono piu' essere salvate in base64 (colonna contenuto): le righe
-- gia' esistenti con contenuto restano leggibili (compatibilita').
-- Un allegato si registra solo se il file e' davvero nello Storage, con la stessa dimensione:
-- il database non puo' contenere riferimenti a file non caricati.
--
-- Non cambia: salva_rapportino, le policy delle altre tabelle, rapporti/profili e le 51 giornate.
-- Ripetibile (if not exists / on conflict / create or replace / drop ... if exists).
-- =====================================================================

-- ---------------------------------------------------------------- bucket privato
-- 3 MB: come il limite gia' previsto per una foto (contenuto <= 3.000.000 caratteri); l'app comprime
-- a 1600 px JPEG (di solito 0,3-0,8 MB). Solo immagini.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('allegati-rapportini', 'allegati-rapportini', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- metadati
alter table public.allegati alter column contenuto drop not null;
alter table public.allegati add column if not exists percorso text;
alter table public.allegati add column if not exists mime text;
alter table public.allegati add column if not exists dimensione integer;
alter table public.allegati add column if not exists impronta text;      -- SHA-256 del file originale
create unique index if not exists allegati_percorso on public.allegati (percorso) where percorso is not null;
-- la stessa foto (stessa impronta) una sola volta per rapportino
create unique index if not exists allegati_impronta on public.allegati (rapportino_id, impronta) where impronta is not null;
do $$ begin
  alter table public.allegati add constraint allegati_contenuto_o_percorso check (contenuto is not null or percorso is not null);
exception when duplicate_object then null; end $$;

-- rapportino a cui appartiene un percorso del bucket (null se il nome non ha la forma prevista)
create or replace function public.rapportino_del_percorso(p_nome text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_nome ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    then split_part(p_nome, '/', 1)::uuid end
$$;
revoke execute on function public.rapportino_del_percorso(text) from public, anon;
grant execute on function public.rapportino_del_percorso(text) to authenticated;

-- controllo dei metadati (autore e data imposti come prima, piu' i controlli sul file)
create or replace function public.controlla_allegato() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  dim bigint;
begin
  if auth.uid() is null then return new; end if;
  new.caricato_da := auth.uid();
  new.creato_il := now();
  if new.contenuto is not null then
    raise exception 'Le foto si caricano nello Storage, non nel database' using errcode = '23514';
  end if;
  if new.percorso is null or public.rapportino_del_percorso(new.percorso) is distinct from new.rapportino_id
     or split_part(split_part(new.percorso, '/', 2), '.', 1) <> new.id::text then
    raise exception 'Percorso della foto non valido' using errcode = '23514';
  end if;
  if new.mime is null or new.mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Tipo di file non consentito' using errcode = '23514';
  end if;
  select (o.metadata->>'size')::bigint into dim from storage.objects o
    where o.bucket_id = 'allegati-rapportini' and o.name = new.percorso;
  if not found then
    raise exception 'Foto non ancora caricata nello Storage' using errcode = 'P0002';
  end if;
  if new.dimensione is null or dim is distinct from new.dimensione::bigint then
    raise exception 'Foto caricata in modo incompleto' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.controlla_allegato() from public, anon, authenticated;

-- registrazione idempotente dei metadati, DOPO l'upload (SECURITY INVOKER: valgono RLS e trigger).
-- Stesso id gia' registrato (nuovo tentativo dopo una risposta persa) -> "ok" con la riga esistente.
-- Stessa foto (impronta) gia' presente nel rapportino con un altro id -> "duplicato": l'app toglie
-- il file appena caricato. Nessun errore non gestito e nessun doppione.
create or replace function public.registra_allegato(p_allegato jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.allegati%rowtype;
  v_id uuid := (p_allegato->>'id')::uuid;
  v_rapportino uuid := (p_allegato->>'rapportino_id')::uuid;
begin
  insert into public.allegati (id, rapportino_id, tipo, nome, percorso, mime, dimensione, larghezza, altezza, impronta)
  values (v_id, v_rapportino, 'foto', left(coalesce(p_allegato->>'nome', ''), 200), p_allegato->>'percorso',
          p_allegato->>'mime', nullif(p_allegato->>'dimensione', '')::integer,
          nullif(p_allegato->>'larghezza', '')::integer, nullif(p_allegato->>'altezza', '')::integer,
          nullif(p_allegato->>'impronta', ''))
  on conflict do nothing
  returning * into r;
  if found then return jsonb_build_object('esito', 'ok', 'allegato', to_jsonb(r) - 'contenuto'); end if;
  select * into r from public.allegati where id = v_id;
  if found then
    if r.rapportino_id = v_rapportino and r.percorso = p_allegato->>'percorso' then
      return jsonb_build_object('esito', 'ok', 'allegato', to_jsonb(r) - 'contenuto');
    end if;
    raise exception 'Allegato non registrato' using errcode = '42501';
  end if;
  select * into r from public.allegati where rapportino_id = v_rapportino and impronta = nullif(p_allegato->>'impronta', '');
  if found then return jsonb_build_object('esito', 'duplicato', 'allegato', to_jsonb(r) - 'contenuto'); end if;
  raise exception 'Allegato non registrato' using errcode = '42501';
end $$;
revoke execute on function public.registra_allegato(jsonb) from public, anon;
grant execute on function public.registra_allegato(jsonb) to authenticated;

-- ---------------------------------------------------------------- policy Storage (solo questo bucket)
-- lettura: chi vede il rapportino; caricamento e cancellazione: chi puo' modificarlo (autore con
-- rapportino in bozza, oppure admin). Nessuna policy di UPDATE: un file caricato non si sovrascrive.
drop policy if exists allegati_rapportini_lettura on storage.objects;
create policy allegati_rapportini_lettura on storage.objects for select to authenticated
  using (bucket_id = 'allegati-rapportini' and public.rapportino_del_percorso(name) is not null
         and public.vede_rapportino(public.rapportino_del_percorso(name)));
drop policy if exists allegati_rapportini_caricamento on storage.objects;
create policy allegati_rapportini_caricamento on storage.objects for insert to authenticated
  with check (bucket_id = 'allegati-rapportini' and public.rapportino_del_percorso(name) is not null
              and public.modifica_rapportino(public.rapportino_del_percorso(name)));
drop policy if exists allegati_rapportini_cancellazione on storage.objects;
create policy allegati_rapportini_cancellazione on storage.objects for delete to authenticated
  using (bucket_id = 'allegati-rapportini' and public.rapportino_del_percorso(name) is not null
         and public.modifica_rapportino(public.rapportino_del_percorso(name)));
```

## SQL completo — rollback Fase C
```sql
-- ROLLBACK di 20261110090000_allegati_storage.sql (torna alla Fase B).
-- Non cancella nessuna foto:
--  * i metadati delle foto nello Storage vengono COPIATI in backup.allegati_storage e solo poi tolti
--    da public.allegati (la tabella della Fase B richiede il contenuto base64, che queste righe non hanno);
--  * i file restano nel bucket "allegati-rapportini" (non cancellabili via SQL; senza le policy li vede
--    solo il pannello / service role). Riapplicando la migrazione si possono rimettere con:
--      insert into public.allegati (id, rapportino_id, tipo, nome, larghezza, altezza, caricato_da, creato_il,
--        percorso, mime, dimensione, impronta)
--      select id, rapportino_id, tipo, nome, larghezza, altezza, caricato_da, creato_il, percorso, mime, dimensione, impronta
--      from backup.allegati_storage on conflict do nothing;   -- (eseguito come pannello: il trigger non scatta)
-- Le foto in base64 (righe con contenuto) non vengono toccate.
begin;
drop policy if exists allegati_rapportini_lettura on storage.objects;
drop policy if exists allegati_rapportini_caricamento on storage.objects;
drop policy if exists allegati_rapportini_cancellazione on storage.objects;
drop function if exists public.registra_allegato(jsonb);

create schema if not exists backup;
create table if not exists backup.allegati_storage as select * from public.allegati where false;
insert into backup.allegati_storage select a.* from public.allegati a
  where a.percorso is not null and not exists (select 1 from backup.allegati_storage b where b.id = a.id);
delete from public.allegati where percorso is not null and contenuto is null;

-- funzione della Fase A, testo originale
create or replace function public.controlla_allegato() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  new.caricato_da := auth.uid();
  new.creato_il := now();
  return new;
end $$;
revoke execute on function public.controlla_allegato() from public, anon, authenticated;

alter table public.allegati drop constraint if exists allegati_contenuto_o_percorso;
drop index if exists public.allegati_impronta;
drop index if exists public.allegati_percorso;
alter table public.allegati drop column if exists impronta;
alter table public.allegati drop column if exists dimensione;
alter table public.allegati drop column if exists mime;
alter table public.allegati drop column if exists percorso;
alter table public.allegati alter column contenuto set not null;
drop function if exists public.rapportino_del_percorso(text);
-- il bucket resta (privato) con i file: eliminarlo solo dopo averli scaricati, dal pannello Storage
commit;
```
