# Rapportino — COMP.HAS assistance SRL

Web app per i rapporti di lavoro: interventi, rapportini con orari, materiali, foto e firma, PDF,
anagrafica clienti, notifiche e assistente AI. Pensata per iPhone, usabile anche dal computer.
Pubblicata con GitHub Pages: https://lcsoon93.github.io/rapportino/

- **Tecnologia**: HTML, CSS e JavaScript a moduli ES, senza framework né build. jsPDF 2.5.1,
  supabase-js (copia in `js/vendor/`). Backend: Supabase (database con RLS, Auth, Storage, Edge Functions).
- **Accesso**: username e password, oppure PIN di 6 cifre. Nessuna registrazione pubblica.
- **Ruoli**: `admin` (anche operaio), `company` (ufficio), `worker` (operai).

## Cosa fa

| Funzione | Dove | Chi |
|---|---|---|
| Interventi: crea, assegna agli operai, stato | Interventi, Calendario | admin, company |
| Rapportini: bozza, ore dalle–alle, materiali, foto, firma, completa (anche senza rete) | Lavoro, Rapportino | operai, admin |
| Home: giorno scelto (vale anche per Calendario e PDF), lavori del giorno, **orario della giornata** 8–17 salvo inserimento, "escludi dal monte ore" | Home | admin |
| Giornata: da eseguire, eseguiti, non programmati; pulsante "Invia PDF" (computer: "Stampa PDF") | Home → Apri giornata | tutti |
| PDF della giornata: rapportini completati con orario e ore passate dal cliente; in fondo il riepilogo con le ore della giornata | Home, Apri giornata, Rapportini | tutti |
| Report mensile: ore per operaio, giornate e clienti, PDF (le giornate escluse non si sommano) | Calendario → Mese, Altro | admin |
| Anagrafica clienti con omonimi, suggerimenti e uso offline | Clienti, campo Cliente | tutti (modifica admin/company) |
| Storico e ricerca | Storico | admin, company |
| Notifiche push (assegnazioni, modifiche, rapportini) | Altro → Account | tutti |
| Assistente AI (Groq): testo, foto, controlli, ricerca, domande, tendenze | Rapportino, Storico, Altro | secondo il ruolo |
| **Computer**: menu esteso, rapportino su due colonne; i pulsanti PDF aprono la stampa | stesso indirizzo | tutti |
| **Ricerca dal computer** (`search.html`): riepilogo del mese, filtri, dettaglio con stampa, export materiali in Excel e PDF | `/search.html` | admin, company |

## Ore: una regola sola

- **Dal cliente**: l'orario segnato nel rapportino (dalle–alle) e la durata, stampati nella pagina del cliente.
- **Giornata**: 08:00–17:00 = 9 ore, uguale per tutti gli operai che hanno lavorato quel giorno. Si cambia
  solo dalla Home ("Orario della giornata"), giorno per giorno; lì c'è anche "Escludi dal monte ore".
- Il rapportino si completa anche senza ore: il controllo mostra solo un'attenzione. Un operaio senza orario
  non compare negli orari del cliente; nella giornata conta solo se è indicato nel rapportino.
- Nessuna spunta di stampa: PDF e report hanno un formato unico. Il vecchio foglio giornaliero resta
  consultabile in Altro → "Archivio della vecchia app" e i suoi dati entrano nel report mensile.

## Sicurezza in breve

- La protezione vera è nel database (RLS e trigger); l'interfaccia nasconde solo ciò che il ruolo non usa
  (`js/core/permessi.js`).
- Nessuna password o chiave segreta nel codice: la service_role e la chiave Groq stanno solo nei secret
  di Supabase. Nel frontend c'è solo la chiave pubblica "anon".
- Account disattivati e password temporanee scadute non entrano.

## Dove mettere le mani

- Nuova sezione → `js/modules/`; servizio usato da più sezioni → `js/services/`; funzione pura → `js/utils/`.
- Funzioni chiamate da `onclick` → esporle in `js/core/azioni-html.js`.
- PDF → `js/services/pdf/` (stile comune in `comune.js`); stampa sul computer → `js/services/stampa.js`.
- Stili: `css/variables.css` (colori), `components.css`, `responsive.css`.

## Eseguire e pubblicare

```
python3 -m http.server 8000      # poi http://localhost:8000/ (serve un server: i moduli non vanno da file://)
```

Pubblicazione: push su `main` (GitHub Pages, aggiornamento in circa 10 minuti).
Migrazioni del database: dal SQL Editor di Supabase, in ordine, prima del frontend che le usa.

## Documentazione

| File | Contenuto |
|---|---|
| `docs/tecnico.md` | struttura dei file, dipendenze ed eventi, formato dei dati, sicurezza, notifiche, computer e `search.html`, anagrafica, AI, messa in produzione |
| `docs/interventi-rapportini.md` | modello dati, regole del database, migrazioni e rollback con SQL completo |
| `tests/LEGGIMI.md` | come eseguire i test (nessuno tocca la produzione) |

La versione precedente in un unico file è nel ramo `versione-monolitica` e in `backup.html`.
