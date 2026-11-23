# Flussi ricorrenti: proposte di manutenzione e interventi periodici

Stato: **progetto** (nessuna parte è ancora nel database né nell'interfaccia).
Principio: il sistema **propone**, l'amministratore **approva**. Nessun intervento viene creato
senza una decisione esplicita di un amministratore.

## 1. Cosa esiste già

- **Statistiche deterministiche** (`supabase/functions/_shared/ai-logica.ts`, `statistiche()`): per ogni
  cliente (scheda `cliente_id`, o nome + indirizzo se manca) calcola le date di lavoro distinte, la
  media dei giorni tra una visita e l'altra, se la cadenza è regolare (coefficiente di variazione ≤ 0.35)
  e la prossima data stimata. Soglie: almeno 3 visite e 2 intervalli.
- **Predittiva** (Home/Altro → Assistente): mostra le ricorrenze e il pulsante "Prepara intervento",
  che apre il modulo intervento già compilato con la scheda giusta (dal 2026-11, vedi test
  `omonimi nelle tendenze`). Oggi la proposta esiste solo come pulsante: nulla viene salvato da solo.
- **Interventi** (`interventi`, `intervento_operai`) con `cliente_id`, assegnazione agli operai e stato.
- **Notifiche** (`notifiche_coda`, Edge Function `notifiche`): già usate per assegnazioni e rapportini.

## 2. Cosa aggiungere

### 2.1 Tabella delle proposte

```
proposte_ricorrenti
  id uuid pk
  cliente_id uuid references clienti(id)           -- la scheda, sempre
  indirizzo text                                    -- copia alla data della proposta
  tipologia text                                    -- solo tipologie di manutenzione (vedi 2.3)
  frequenza_giorni int                              -- media osservata
  visite_osservate int                              -- quante date hanno generato la stima
  ultima_visita date
  prossima_data date                                -- stimata: ultima + frequenza
  motivazione text                                  -- testo generato dal server, es. "5 visite, ogni ~60 giorni"
  stato text check (stato in ('proposta','approvata','rifiutata','scaduta','superata'))
  intervento_id uuid null references interventi(id)
  creata_il timestamptz default now()
  decisa_da uuid null, decisa_il timestamptz null, motivo_rifiuto text null
  rifiuto_fino date null                            -- non riproporre prima di questa data
```

Vincoli: una sola proposta `proposta` per cliente. RLS: lettura e scrittura solo per `admin`
(`company` in sola lettura, se utile); nessun accesso per gli operai.

### 2.2 Calcolo (senza modello)

Una funzione `calcola_proposte_ricorrenti()` (o la Edge Function `ricorrenze`, pianificata una volta
a settimana) riusa la stessa logica di `statistiche()`: il calcolo è deterministico e spiegabile.
Il modello può solo commentare, come oggi: non decide date né clienti.

Regole per creare una proposta:

1. almeno 3 visite e cadenza regolare;
2. ultima visita non più vecchia di 2 volte la frequenza (cliente attivo);
3. nessun intervento già pianificato per quel cliente nei 14 giorni intorno alla data stimata;
4. nessuna proposta aperta per lo stesso cliente;
5. se una proposta è stata rifiutata, non ricrearla prima di `rifiuto_fino` (proposta: 90 giorni);
6. se la proposta è aperta e la data è passata da 30 giorni senza decisione → `scaduta`.

Quando un rapportino viene completato, le proposte del cliente vengono ricalcolate: se un intervento
manuale ha già coperto la visita, la proposta diventa `superata`.

### 2.3 Quali visite contano

Solo tipologie di **manutenzione programmata** (es. "Manutenzione ordinaria"). Guasti, interventi
straordinari e garanzie non generano proposte: non sono periodici. La lista è una costante nel
server, non un testo libero.

### 2.4 Approvazione (interfaccia)

Card "Proposte da approvare" in Home, solo per admin, con per ogni proposta:

- cliente (nome e indirizzo, mai solo il nome), frequenza, ultima visita, prossima data stimata;
- **Approva**: crea l'intervento con `cliente_id`, data = prossima data (o quella modificata),
  operai facoltativi (per default quelli dell'ultima visita, se ancora attivi); scrive
  `proposte_ricorrenti.intervento_id` e `stato = 'approvata'`;
- **Modifica e approva**: stessa cosa con data o operai scelti dall'amministratore;
- **Rifiuta**: motivo facoltativo, `rifiuto_fino = oggi + 90 giorni`;
- **Più tardi**: nessuna modifica, resta in elenco.

Approvazione e rifiuto passano dalla stessa funzione server che il modulo intervento già usa
(`salvaIntervento`), così valgono le stesse regole di permessi e di conflitto.

### 2.5 Notifiche

Una notifica all'amministratore quando compaiono nuove proposte (al massimo una al giorno, con il
conteggio). Nessuna notifica agli operai finché l'intervento non viene approvato: poi lo ricevono
come un normale intervento assegnato.

### 2.6 Controllo e registro

- ogni decisione salva chi, quando e cosa (`decisa_da`, `decisa_il`, stato precedente);
- nella scheda del cliente compare la cronologia delle proposte;
- l'elenco delle proposte rifiutate è consultabile per capire perché una cadenza non è stata seguita.

## 3. Cosa il progetto NON fa

- non crea interventi, assegnazioni o rapportini senza approvazione;
- non cambia date di interventi già pianificati;
- non usa il modello per decidere quando o cosa proporre;
- non propone per clienti senza scheda `cliente_id` (sono troppo ambigui con gli omonimi);
- non genera serie future di interventi: ogni proposta è una sola visita; la successiva nasce quando
  quella viene completata.

## 4. Fasi di realizzazione

1. **Tabella, RLS e calcolo** senza interfaccia (solo lettura via SQL), con test sugli omonimi e sulle
   regole 1–6 (estensione di `tests/server/ai.test.mts` e di `tests/unit/giornate.test.mts`).
2. **Card in Home per l'amministratore**: approva, modifica, rifiuta, più tardi. Test E2E con il finto
   Supabase (stile `tests/e2e/ai.e2e.mjs`): nessuna scrittura senza clic, scheda giusta con omonimi.
3. **Notifica giornaliera** e cronologia nella scheda cliente.
4. **Revisione con il responsabile** dopo un mese: quante proposte approvate, rifiutate, scadute;
   se le soglie (3 visite, 2×, 14 giorni, 90 giorni) vanno cambiate.

## 5. Domande aperte per il responsabile

- Quali tipologie sono "manutenzione programmata"? (proposta: solo "Manutenzione ordinaria".)
- Gli interventi approvati vanno assegnati di default agli stessi operai dell'ultima visita?
- Una proposta rifiutata deve restare sospesa 90 giorni, o per sempre finché cambia la cadenza?
- Serve un promemoria al cliente (fuori dall'app)? Non incluso: richiederebbe il consenso per i contatti.
