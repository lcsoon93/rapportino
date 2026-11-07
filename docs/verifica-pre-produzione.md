# Rapportino — verifica pre-produzione (login, ruoli, permessi)

Data: 7 novembre 2026 · Ramo: `utenti-ruoli` · **Produzione non modificata** (solo letture di schema e statistiche).

## Raccomandazione: NON PRONTO

Motivo bloccante: **modifiche concorrenti sulla stessa giornata si perdono** (riprodotto, vedi §4).
Sicurezza, permessi, storico, PDF, account e rollback sono verificati.

## 1. Migrazioni SQL

| File | Cosa fa in produzione |
|---|---|
| `20260915000000_schema_iniziale.sql` | Nulla: descrive lo schema già esistente (idempotente). |
| `20261107120000_utenti_ruoli.sql` | Profili, ruoli, RLS, trigger. Vedi sotto. |

`20261107120000_utenti_ruoli.sql`:

- **Tabelle**: nuova `public.profili`; modificata `public.rapporti` (solo aggiunte).
- **Colonne aggiunte a `rapporti`**: `assegnati uuid[] not null default '{}'`, `creato_da uuid`, `aggiornato_da uuid`
  (FK verso `auth.users`, `on delete set null`). Default costante: in PostgreSQL ≥ 11 nessuna riscrittura delle righe.
- **Colonne modificate**: nessuna. `data`, `dati`, `aggiornato` invariate.
- **Indici**: `profili_username_unico` (unico su `lower(username)`), `rapporti_assegnati` (GIN).
- **Funzioni**: `mio_ruolo()`, `scheda_compilata(jsonb)`, `controlla_rapporto()` (trigger), `operai_assegnabili()`.
- **Trigger**: `rapporti_controllo` BEFORE INSERT OR UPDATE su `rapporti`.
- **Policy**: rimossa `"accesso app"` (tutto a tutti); nuove `profili_lettura`, `rapporti_lettura/inserimento/modifica/eliminazione`.
- **Permessi**: `revoke all on rapporti from anon`; su `profili` nessuna scrittura per anon/authenticated.
- **Dati esistenti**: nessun UPDATE/DELETE. Verificato su 51 giornate sintetiche con la struttura reale:
  MD5 di `data|dati|aggiornato` identico prima e dopo.

### SQL completo — schema iniziale
```sql
-- Schema gia' presente in produzione prima dell'introduzione degli utenti (riferimento).
-- Idempotente: in produzione non cambia nulla.
create table if not exists public.rapporti (
  data text primary key,                 -- "AAAA-MM-GG"
  dati jsonb not null,                   -- la giornata, stesso formato del backup dell'app
  aggiornato timestamptz not null default now()   -- ultima modifica (decisa dal telefono che ha scritto)
);
alter table public.rapporti enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rapporti' and policyname = 'accesso app') then
    create policy "accesso app" on public.rapporti for all to public using (true) with check (true);
  end if;
end $$;
```

### SQL completo — utenti e ruoli
```sql
-- =====================================================================
-- Utenti, ruoli e permessi (RLS) per Rapportino
--
-- Ruoli:  admin   (Luca)     tutto, anche come operaio
--         company (comphas)  pianifica: crea giornate e schede cliente, assegna operai,
--                            consulta; non tocca ore, firme e dati compilati, non cancella
--         worker  (operai)   legge e compila solo le giornate a cui e' assegnato
--
-- Le password NON stanno qui: le gestisce Supabase Auth. Gli account si creano solo
-- dalle Edge Functions (service_role), mai dal browser.
-- =====================================================================

-- ---------------------------------------------------------------- profili
create table public.profili (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  nome text not null default '',
  ruolo text not null check (ruolo in ('admin', 'company', 'worker')),
  attivo boolean not null default true,
  deve_cambiare_password boolean not null default true,
  tentativi_falliti integer not null default 0,     -- protezione contro i tentativi ripetuti
  bloccato_fino timestamptz,
  creato_il timestamptz not null default now(),
  creato_da uuid references auth.users(id) on delete set null,
  constraint username_formato check (username ~ '^[A-Za-z0-9._-]{3,30}$')
);
create unique index profili_username_unico on public.profili (lower(username));
alter table public.profili enable row level security;

-- nessuno scrive i profili dal browser: solo le Edge Functions (service_role)
revoke all on public.profili from anon, authenticated;
grant select (id, username, nome, ruolo, attivo, deve_cambiare_password, creato_il) on public.profili to authenticated;

-- ruolo dell'utente collegato, solo se l'account e' attivo (null = nessun permesso)
create or replace function public.mio_ruolo() returns text
language sql stable security definer set search_path = '' as $$
  select ruolo from public.profili where id = auth.uid() and attivo
$$;
revoke execute on function public.mio_ruolo() from public, anon;
grant execute on function public.mio_ruolo() to authenticated;

-- il proprio profilo; l'admin vede tutti; company vede gli operai attivi (per assegnarli)
create policy profili_lettura on public.profili for select to authenticated using (
  id = (select auth.uid())
  or (select public.mio_ruolo()) = 'admin'
  or ((select public.mio_ruolo()) = 'company' and ruolo = 'worker' and attivo)
);

-- ---------------------------------------------------------------- rapporti
alter table public.rapporti
  add column if not exists assegnati uuid[] not null default '{}',   -- operai che possono vedere e compilare la giornata
  add column if not exists creato_da uuid references auth.users(id) on delete set null,
  add column if not exists aggiornato_da uuid references auth.users(id) on delete set null;
create index if not exists rapporti_assegnati on public.rapporti using gin (assegnati);

-- via l'accesso aperto a tutti
drop policy if exists "accesso app" on public.rapporti;
revoke all on public.rapporti from anon;
grant select, insert, update, delete on public.rapporti to authenticated;

create policy rapporti_lettura on public.rapporti for select to authenticated using (
  (select public.mio_ruolo()) in ('admin', 'company')
  or ((select public.mio_ruolo()) = 'worker' and (select auth.uid()) = any (assegnati))
);
create policy rapporti_inserimento on public.rapporti for insert to authenticated with check (
  (select public.mio_ruolo()) in ('admin', 'company')
  or ((select public.mio_ruolo()) = 'worker' and (select auth.uid()) = any (assegnati))
);
create policy rapporti_modifica on public.rapporti for update to authenticated using (
  (select public.mio_ruolo()) in ('admin', 'company')
  or ((select public.mio_ruolo()) = 'worker' and (select auth.uid()) = any (assegnati))
) with check (
  (select public.mio_ruolo()) in ('admin', 'company')
  or ((select public.mio_ruolo()) = 'worker' and (select auth.uid()) = any (assegnati))
);
create policy rapporti_eliminazione on public.rapporti for delete to authenticated using (
  (select public.mio_ruolo()) = 'admin'
);

-- una scheda cliente e' "compilata" quando contiene dati dell'operaio
create or replace function public.scheda_compilata(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(c->>'dettagli', '') <> ''
      or coalesce(c->>'firma', '') <> ''
      or coalesce(c->>'firmatario', '') <> ''
      or coalesce(jsonb_array_length(case when jsonb_typeof(c->'materiali') = 'array' then c->'materiali' end), 0) > 0
      or coalesce(jsonb_array_length(case when jsonb_typeof(c->'foto') = 'array' then c->'foto' end), 0) > 0
$$;

-- regole che le policy da sole non possono esprimere
create or replace function public.controlla_rapporto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r text := public.mio_ruolo();
  c jsonb;
  vecchia jsonb;
begin
  -- service_role (Edge Functions, pannello Supabase) non passa di qui con un utente: nessun controllo
  if auth.uid() is null then
    return new;
  end if;
  if r is null then
    raise exception 'Account non attivo o senza ruolo' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.creato_da := auth.uid();
    -- un operaio che crea una giornata (es. urgenza) ne e' l'unico assegnatario: non assegna altri
    if r = 'worker' then
      new.assegnati := array[auth.uid()];
    end if;
  else
    new.creato_da := old.creato_da;
    -- la data e' la chiave della giornata: spostarla equivale a cancellarla, quindi solo l'admin
    if new.data is distinct from old.data and r <> 'admin' then
      raise exception 'Solo l''amministratore puo'' cambiare la data di una giornata' using errcode = '42501';
    end if;
    -- solo admin e company decidono chi e' assegnato
    if r = 'worker' and new.assegnati is distinct from old.assegnati then
      raise exception 'Un operaio non puo'' cambiare le assegnazioni' using errcode = '42501';
    end if;
  end if;

  if r = 'company' then
    -- niente ore, spese ed esclusione dal monte ore
    if tg_op = 'INSERT' then
      if coalesce(jsonb_array_length(new.dati->'operai'), 0) > 0 or coalesce(jsonb_array_length(new.dati->'spese'), 0) > 0 then
        raise exception 'Il ruolo company non inserisce ore o spese' using errcode = '42501';
      end if;
    elsif (new.dati->'operai') is distinct from (old.dati->'operai')
       or (new.dati->'spese') is distinct from (old.dati->'spese')
       or (new.dati->'escludi') is distinct from (old.dati->'escludi') then
      raise exception 'Il ruolo company non modifica ore, spese o monte ore' using errcode = '42501';
    end if;
    -- le schede gia' compilate dagli operai restano identiche e non si tolgono
    if tg_op = 'UPDATE' then
      for vecchia in select value from jsonb_array_elements(coalesce(old.dati->'clienti', '[]'::jsonb)) loop
        if public.scheda_compilata(vecchia) and not exists (
          select 1 from jsonb_array_elements(coalesce(new.dati->'clienti', '[]'::jsonb)) n where n.value = vecchia
        ) then
          raise exception 'Il ruolo company non modifica le schede compilate dagli operai' using errcode = '42501';
        end if;
      end loop;
    end if;
    -- schede nuove o modificate: solo dati di pianificazione (niente lavoro, materiale, foto, firme)
    for c in select value from jsonb_array_elements(coalesce(new.dati->'clienti', '[]'::jsonb)) loop
      if public.scheda_compilata(c) and (tg_op = 'INSERT' or not exists (
        select 1 from jsonb_array_elements(coalesce(old.dati->'clienti', '[]'::jsonb)) o where o.value = c
      )) then
        raise exception 'Il ruolo company non compila lavoro, materiale, foto o firme' using errcode = '42501';
      end if;
    end loop;
  end if;

  -- la data di modifica la propone il telefono (serve alla sincronizzazione), ma non puo' essere
  -- nel futuro: altrimenti quella versione "vincerebbe" su tutte le modifiche successive
  if new.aggiornato is null or new.aggiornato > now() + interval '5 minutes' then
    new.aggiornato := now();
  end if;
  new.aggiornato_da := auth.uid();
  return new;
end $$;
revoke execute on function public.controlla_rapporto() from public, anon, authenticated;

create trigger rapporti_controllo before insert or update on public.rapporti
  for each row execute function public.controlla_rapporto();

-- ---------------------------------------------------------------- elenco operai per l'assegnazione
-- (company e admin; restituisce solo id, username e nome degli operai attivi)
create or replace function public.operai_assegnabili() returns table (id uuid, username text, nome text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.nome from public.profili p
  where p.attivo and p.ruolo in ('worker', 'admin') and public.mio_ruolo() in ('admin', 'company')
  order by lower(p.nome), lower(p.username)
$$;
revoke execute on function public.operai_assegnabili() from public, anon;
grant execute on function public.operai_assegnabili() to authenticated;
```

## 2. Policy e regole

| Tabella | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `rapporti` | admin, company: tutto · worker: solo se è in `assegnati` · anon: niente | admin · company (trigger: niente ore, spese, lavoro, foto, firme) · worker (diventa unico assegnatario) | admin · company: solo schede non compilate e assegnazioni · worker: solo giornate assegnate, non `assegnati` · solo admin cambia `data` | solo admin |
| `profili` | sé stessi · admin tutti · company solo operai attivi; colonne interne (tentativi, blocco, creato_da) non leggibili | nessuno (solo Edge Functions) | nessuno | nessuno |

Account disattivato: `mio_ruolo()` restituisce null → nessuna lettura o scrittura, anche con sessione aperta.
Data di modifica nel futuro (> 5 min) → riportata all'ora del server.

## 3. Edge Functions

| Funzione | JWT | Chi | Note |
|---|---|---|---|
| `accesso` | no | chiunque | username → account; password verificata da Supabase Auth; stesso messaggio per username/password errati; blocco 15 min dopo 5 errori; email interna mai restituita |
| `cambia-password` | sì | l'utente per sé | richiede la password attuale; regole robustezza; restituisce una nuova sessione (Supabase chiude le altre) |
| `utenti` | sì | solo admin attivo | elenco, crea (sempre `worker`), disattiva/riattiva e reset solo su operai, mai su sé stessi; compensazione se la creazione fallisce a metà |
| `inizializza` | no | una volta | crea Luca (admin) e comphas (company) dai segreti `CODICE_INIZIALE_*`; 409 se esiste un admin; non restituisce i codici |

## 4. Test eseguiti (stack Supabase locale, credenziali di prova)

- **Backend** 73/73 · **E2E browser** 46/46 · **Verifica pre-produzione** 42/46 (i 4 falliti sono la concorrenza).
- Migrazione su 51 giornate sintetiche (151 schede, 97 senza id, 13 non compilate, 1 firmata, 1 formato vecchio): storico intatto.
- Storico: admin e company vedono 51 giornate; operaio non assegnato 0; Clienti elenca 151 clienti; PDF di tutte le 51 giornate (anche foglio unico e formato vecchio) senza errori; aprire e fare PDF non modifica il server.
- Tentativi di aggiramento respinti: cambio data, assegnazioni da operaio, data nel futuro, rimozione schede compilate da company, cambio ruolo (operaio e company), token contraffatto, token con ruolo alterato, admin che crea admin, company che reimposta password.
- Account: inizializzazione una sola volta (anche con 3 chiamate in parallelo: 2 profili, 2 account, nessun orfano); codici non restituiti; password solo bcrypt in `auth.users`; nessuna colonna password applicativa.
- Telefoni (Chromium): sessione dopo ricarica, logout anche offline, login, cambio password, cambio utente con dati non inviati (backup scaricato), GitHub Pages in sottocartella `/rapportino/`.
- Rollback provato: dati identici, la vecchia app torna a leggere e scrivere.

**Concorrenza (falliti):**
- C1 due operai su schede diverse della stessa giornata: vince l'ultimo salvataggio, il lavoro dell'altro sparisce.
- C2 company aggiunge una scheda mentre l'operaio ha la giornata aperta: al salvataggio dell'operaio la scheda sparisce.
- C3 firma mentre un altro salva: si perde la modifica dell'altro.
- C4 senza rete: la modifica arriva al server al ritorno della rete (ok), ma si perdono le modifiche altrui nel frattempo.

Causa: il telefono salva l'intera giornata ("vince l'ultimo"). Esisteva già prima (due telefoni sulla stessa giornata),
ma con company e più operai diventa lo scenario normale.

## 5. Test non eseguiti

- iPhone/Safari reali (in questo ambiente c'è solo Chromium, niente WebKit).
- Edge Functions nel runtime di Supabase: in locale girano con Deno 2.9 fuori dal container (il container non accettava il certificato del proxy di questo ambiente).
- Supabase Auth di produzione: limiti di frequenza, accettazione dell'email interna `.invalid`, impostazione "sign up" (va disattivata a mano).
- Scadenza reale del token dopo 1 ora (il rinnovo automatico è di supabase-js, non provato con attese reali).
- Accesso reale con i codici del proprietario.

## 6. Problemi residui

1. **Bloccante** — concorrenza (sopra).
2. Un operaio assegnato può modificare tutte le schede della giornata, anche firmate da un collega (sarà coperto dal flusso degli stati).
3. Il blocco dopo 5 errori rivela che uno username esiste e permette a qualcuno di bloccare un account per 15 minuti.
4. Tutti i login passano dall'IP della Edge Function: i limiti di Supabase Auth sono condivisi.
5. Le 51 giornate storiche non sono assegnate: gli operai non le vedono finché admin/company non le assegnano.
6. I dati già presenti sul telefono di un operaio prima del login restano su quel telefono (non vengono cancellati).
7. Le schede storiche senza id non sono modificabili dalla pianificazione (restano intatte di proposito).
8. La sessione è salvata nel browser (token, non password), come previsto da Supabase.

## 7. Rischi per i dati esistenti

- Migrazione: nessuna modifica alle righe (verificato). Rischio basso.
- Finestra tra migrazione e pubblicazione della nuova app: la vecchia app non sincronizza (nessuna perdita, i dati restano sul telefono).
- Dopo il rilascio: perdita di modifiche concorrenti (residuo 1).
- **Già oggi**: la chiave pubblica è nel repository e la policy `"accesso app"` permette a chiunque di leggere, modificare e cancellare le 51 giornate.

## 8. Backup (prima del rilascio)

1. Dall'app: Altro → Esporta backup (JSON completo) sul telefono di Luca; conservarlo fuori dal telefono.
2. Pannello Supabase → Table Editor → `rapporti` → Export CSV.
3. In fase di rilascio (con approvazione): `create table public.rapporti_backup_20261107 as select * from public.rapporti;`
   e confronto conteggio + MD5 con la tabella originale.

## 9. Rollback

1. Frontend: ripubblicare su `main` il commit precedente (`5136423`) con `git revert` del merge.
2. Database: `supabase/rollback/20261107120000_utenti_ruoli_rollback.sql` (provato in locale: dati identici, vecchia app funzionante).
   Non cancella profili, account né colonne nuove.
3. Se servisse: ripristino dei dati dalla tabella `rapporti_backup_20261107` o dal backup JSON.

### SQL di rollback
```sql
-- ROLLBACK di 20261107120000_utenti_ruoli.sql: torna al comportamento della vecchia app
-- (accesso con la sola chiave pubblica). NON cancella giornate, profili o account:
-- le colonne nuove di "rapporti" restano (la vecchia app le ignora).
-- Da usare solo insieme al ripristino del frontend precedente su main.
begin;
drop trigger if exists rapporti_controllo on public.rapporti;
drop function if exists public.controlla_rapporto();
drop function if exists public.operai_assegnabili();
drop policy if exists rapporti_lettura on public.rapporti;
drop policy if exists rapporti_inserimento on public.rapporti;
drop policy if exists rapporti_modifica on public.rapporti;
drop policy if exists rapporti_eliminazione on public.rapporti;
grant select, insert, update, delete on public.rapporti to anon;
create policy "accesso app" on public.rapporti for all to public using (true) with check (true);
commit;
```

## 10. Sequenza di rilascio (dopo la correzione della concorrenza e la tua approvazione)

0. Tu: backup (§8.1–8.2), disattivi "Allow new users to sign up", imposti i segreti `CODICE_INIZIALE_LUCA` e `CODICE_INIZIALE_COMPHAS`.
1. Copia `rapporti_backup_20261107` + verifica conteggio/MD5.
2. Pubblicazione delle 4 Edge Functions (`accesso` e `inizializza` senza verify_jwt).
3. Migrazione `20261107120000_utenti_ruoli.sql`; verifica 51 righe e MD5 invariati; advisor di sicurezza.
4. `inizializza` → `["Luca","comphas"]`; seconda chiamata → 409.
5. Merge di `utenti-ruoli` su `main` (GitHub Pages, ~1 minuto). Finestra senza sincronizzazione: pochi minuti tra 3 e 5.
6. Tu accedi come Luca dall'iPhone e scegli la password; poi comphas. Verifica su telefono reale.
7. Cancellazione dei segreti e (facoltativa) della funzione `inizializza`.
