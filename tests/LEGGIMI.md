# Test

Nessun test contatta il progetto Supabase di produzione o Groq: database, utenti, limiti e modello
sono finti (server) oppure serviti da un finto Supabase dentro Playwright (browser).

| Comando | Cosa prova | Requisiti |
|---|---|---|
| `node --test tests/unit/controlli.test.mjs` e `node --experimental-strip-types --test tests/server/ai.test.mts` | controllo automatico del rapportino (`tests/unit/`) e assistente AI lato server (`tests/server/`: permessi per ruolo, limiti, errori di Groq, risposte non valide, filtri della ricerca, predittiva, nessuna chiave nelle risposte o nei log) | Node 22 o successivo (usa `--experimental-strip-types` per importare i file `.ts` delle Edge Functions) |
| `node tests/e2e/ai.e2e.mjs` | app nel browser con l'assistente: anteprima, conferma, Annulla, errori API, offline, foto, permessi dei tre ruoli, testi scappati, nessuna richiesta a Groq/Supabase veri | Playwright con Chromium già installato (`require('playwright')`) |
| `bash tests/sql/esegui.sh` | migrazioni su Postgres 16 locale + limiti dell'assistente (`limite_tentativi`) + RLS per ruolo sulle letture usate dall'assistente | `pg_ctlcluster 16 main start`, utente `postgres` |

Controllo dei tipi delle Edge Functions (facoltativo, serve Deno): `cd supabase/functions && deno check */index.ts`.

Niente `package.json` alla radice: Deno (e quindi `supabase functions deploy`) lo userebbe per
risolvere gli import `npm:` delle Edge Functions.

Nel test E2E il service worker è bloccato (`serviceWorkers: "block"`), altrimenti scavalcherebbe le
regole di Playwright. In WebKit va usato lo stesso contesto; in questo ambiente è installato solo Chromium.
