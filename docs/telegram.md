# Bot Telegram per i rapportini

Bot **privato**: solo il proprietario (un account Telegram) crea rapportini scrivendo o mandando vocali.
Il bot prepara una bozza, la mostra e crea il rapportino **solo dopo «Conferma»**. Il rapportino viene
salvato nella tabella `rapportini` con `salva_rapportino` e la sessione dell'utente dell'app collegato al bot:
compare in Rapportini, nella scheda del cliente, nei PDF e nelle statistiche come uno creato dall'app
(autore = quell'utente, regole RLS e notifiche invariate). Firma e foto si aggiungono dall'app se servono.

## Come funziona

- **Messaggio scritto o vocale** → (vocale: trascrizione Groq Whisper `whisper-large-v3-turbo`, italiano) →
  AI esistente (Groq, stesso client `_shared/groq.ts` dell'assistente) che restituisce solo i campi detti →
  controllo dei dati sul server → anteprima con i pulsanti **Conferma e crea rapportino**, **Modifica**, **Annulla**.
- **Cliente**: cercato nell'anagrafica. Un solo cliente con quel nome → collegato. Omonimi o nomi simili →
  il bot chiede quale (pulsanti o numero) oppure «usa senza anagrafica». Senza cliente confermato,
  data e descrizione non c'è il pulsante di conferma.
- **Ore**: per tecnico, «dalle–alle» (anche «dalle 8, 3 ore»). Tecnico non detto = utente collegato al bot.
  Solo gli operai che lavorano sul campo (come nell'app). Ore non indicate: il rapportino si può creare
  senza orari (come nell'app).
- **Correzioni**: scrivi o di' cosa cambiare («dalle 9 alle 12», «togli i raccordi», «il cliente è Bianchi»,
  «da ultimare»). `/bozza` mostra la bozza, `/annulla` la cancella. Le bozze non confermate scadono dopo 24 ore.
- **Esito** predefinito «Completato» (come nell'app), «Da ultimare» se lo dici.
- **Interventi programmati**: `/interventi` (aperti da 14 giorni fa ai prossimi 7), `/interventi oggi`,
  `settimana`, `tutti`; anche «lista interventi». Mostra data, ora, cliente, urgenza, se sei assegnato e se c'è
  già un rapportino. Toccando 📝 e il numero la bozza viene collegata all'intervento (cliente, luogo, telefono e
  tipologia dell'intervento; il cliente non si cambia): il rapportino salvato ha `intervento_id`, aggiorna lo
  stato dell'intervento e non è un imprevisto. Come nell'app lo compila chi è assegnato (l'amministratore sempre);
  se hai già un rapportino per quell'intervento il bot lo dice e non ne crea un secondo.
- **Intervento riconosciuto dal cliente**: anche senza `/interventi`, appena il cliente è confermato il bot cerca
  gli interventi ancora da fare (da 30 giorni fa a 7 giorni avanti) **affidati a te**, dello stesso cliente (stessa
  scheda; omonimi con scheda diversa esclusi) e senza un tuo rapportino. Uno solo → la bozza lo completa (📌 nel
  messaggio, «affidato a te» nell'anteprima) con il pulsante «Non è questo intervento: fuori programma». Più di
  uno → scegli quale (la conferma compare solo dopo) o «Nessuno: fuori programma». Gli interventi scartati non
  vengono riproposti; se correggi il cliente, il collegamento automatico si toglie.
- **Lavoro nuovo** (scritto o detto senza scegliere un intervento): rapportino **fuori programma**
  (`rapportini.fuori_programma = true`, migrazione `20261129090000`), mostrato nell'app in «Fuori programma di
  oggi», non tra gli imprevisti.
- **Elenco**: `/rapportini` (ultimi 10), `/rapportini oggi`, `ieri`, `settimana`, `mese` o il nome di un cliente
  (anche scritto «lista rapportini Rossi»). Mostra data, cliente, stato, ore e descrizione.
- **Domande**: scritte o a voce («quante ore ho fatto questa settimana?», «quando sono stato da Rossi?»,
  «che materiali ho usato a ottobre?»). Risponde lo stesso assistente dati dell'app, sui dati che l'utente
  collegato vede (RLS), nel periodo detto (predefinito: ultimi 90 giorni; massimo 12 mesi). La bozza non cambia.
- **Vocali**: Telegram li salva come `.oga`, formato che Groq rifiuta per estensione: il bot li invia come
  `.ogg` (stesso contenuto OGG/Opus).
- **Eliminazione**: dall'elenco, pulsante 🗑 e numero → riepilogo → «Sì, elimina». Vale la regola dell'app
  (RLS): l'amministratore elimina qualsiasi rapportino, un operaio solo le proprie bozze. Con il rapportino
  spariscono ore e foto (anche i file nello Storage). Non si può annullare.

## Sicurezza

- Webhook protetto dal secret (`X-Telegram-Bot-Api-Secret-Token`): richieste senza → 401.
- Elaborati solo messaggi e pulsanti dell'utente `TELEGRAM_UTENTE_ID` in chat privata; gli altri sono
  ignorati senza risposta.
- Aggiornamenti ripetuti da Telegram elaborati una volta (`telegram_aggiornamenti`); bozza con versione
  (un pulsante di un'anteprima vecchia non conferma dati cambiati); id del rapportino deciso in anticipo
  (una conferma ripetuta o interrotta non crea doppioni).
- Token Telegram e chiave Groq solo nei secret di Supabase; nei log solo eventi ed esiti.
- Tabelle `telegram_bozze` e `telegram_aggiornamenti` accessibili solo dalla funzione (RLS senza policy).

## Attivazione (una volta)

1. **Bot**: in Telegram scrivi a **@BotFather** → `/newbot` → nome e username → copia il **token**.
   Facoltativo: `/setprivacy` → Enable; `/setjoingroups` → Disable.
2. **Il tuo ID Telegram**: scrivi a **@userinfobot** (risponde con il tuo numero «Id»).
3. **Database**: applica `supabase/migrations/20261128120000_telegram_bot.sql`.
4. **Secret** (Supabase → Edge Functions → Secrets):
   - `TELEGRAM_BOT_TOKEN` = token di BotFather
   - `TELEGRAM_WEBHOOK_SECRET` = stringa casuale lunga (almeno 16 caratteri; lettere, numeri, `_` e `-`), es. `openssl rand -hex 32`
   - `TELEGRAM_UTENTE_ID` = il tuo ID Telegram (solo cifre)
   - `TELEGRAM_PROFILO` = username dell'app a cui intestare i rapportini (es. `luca`; deve lavorare sul campo)
   - `GROQ_API_KEY` = già presente per l'assistente AI. Facoltativo `GROQ_MODELLO_AUDIO` (predefinito `whisper-large-v3-turbo`).
5. **Funzione**: `supabase functions deploy telegram --no-verify-jwt` (in `config.toml` è già `verify_jwt = false`:
   Telegram non ha una sessione Supabase; il controllo lo fa il secret del webhook).
6. **Webhook** (da un terminale, sostituendo i valori; `max_connections=1` = un aggiornamento alla volta):

   ```
   curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<progetto>.supabase.co/functions/v1/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     -d "max_connections=1" \
     -d 'allowed_updates=["message","callback_query"]' \
     -d "drop_pending_updates=true"
   ```

   Verifica: `curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.
7. Scrivi `/start` al bot.

Disattivazione: `curl -s "https://api.telegram.org/bot<TOKEN>/deleteWebhook"` (o togli i secret: senza
secret la funzione rifiuta tutto). Annullamento del database:
`supabase/rollback/20261128120000_telegram_bot_rollback.sql` (i rapportini creati restano).

## Costi

- Telegram Bot API: gratuita.
- Testo: stesso modello Groq dell'assistente AI (nessun servizio nuovo).
- Vocali: Groq Whisper `whisper-large-v3-turbo`, circa **$0,04 per ora di audio**, minimo fatturato 10 secondi
  per vocale (prezzi Groq di novembre 2026). Sul piano gratuito di Groq valgono i suoi limiti di richieste.
- Edge Function: inclusa nel piano Supabase (invocazioni).

## Test

`node --experimental-strip-types --test tests/server/telegram.test.mts` (Telegram, Groq, database e sessione
finti: testo, vocale, cliente riconosciuto/ambiguo, dati mancanti, correzioni, conferma, annullamento,
mittente non autorizzato, secret errato, duplicati, errori AI e database) e `bash tests/sql/esegui.sh`
(`tests/sql/telegram.sql`: tabelle del bot non accessibili dall'app; salvataggio con `salva_rapportino`
come l'utente collegato, visibile all'operaio e nello storico del cliente, senza doppioni).
