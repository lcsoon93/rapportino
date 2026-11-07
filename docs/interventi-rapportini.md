# Interventi e rapportini multiutente

Ramo `interventi-rapportini` · **Non applicato a Supabase** · `main` invariato.

## Modello dati (tabelle nuove; `rapporti` storica intatta)

| Tabella | Contenuto | Chi legge | Chi scrive |
|---|---|---|---|
| `interventi` | data, ora, cliente, indirizzo, descrizione, priorità (bassa/normale/alta/urgente), tipologia, stato (pianificato/in_corso/completato/annullato), creato_da | admin, company; operaio solo se assegnato | admin, company (elimina solo admin, solo senza rapportini) |
| `intervento_operai` | assegnazioni (uno o più operai) | admin, company; operaio per i propri interventi | admin, company |
| `rapportini` | collegato a un intervento o autonomo; attività, materiali, note, esito, firma, stato bozza/completato, versione | admin, company; operaio se autore o indicato nelle ore | autore (operaio o admin) finché è bozza; admin sempre (anche riapre) |
| `rapportino_operai` | ore (dalle/alle) per operaio | come il rapportino | come il rapportino |
| `allegati` | foto (immagine compressa) | come il rapportino | come il rapportino |

Regole imposte dal database (non falsificabili dal browser): `creato_da`, `assegnato_da`, `autore_id`,
`caricato_da` = `auth.uid()`; un operaio scrive rapportini solo per interventi a cui è assegnato (o autonomi);
completare richiede attività e ore; un rapportino completato non si modifica (solo l'admin lo riapre);
si assegnano solo account attivi `worker`/`admin`; account disattivati: nessun accesso, anche con sessione aperta;
lo stato dell'intervento segue i rapportini (bozza → in_corso, completato → completato).
Salvataggio atomico con `salva_rapportino` (testata + ore in una transazione, controllo di versione).
L'id del rapportino lo genera il telefono. `salva_rapportino` crea un rapportino solo se quell'id non
esiste ancora sul server; un rapportino esistente si modifica solo indicando la versione letta: se la
versione manca o è diversa risponde "conflitto" (con la versione e le ore del server) senza sovrascrivere.
Due creazioni contemporanee con lo stesso id: una crea, l'altra riceve "conflitto" (nessun errore).
Se il contenuto in conflitto è identico a quello inviato (secondo invio dopo una risposta persa) l'app
reinvia con la versione del server o lo considera già salvato; altrimenti tiene le modifiche nel modulo
e si sostituisce solo premendo di nuovo Salva. I rapportini
salvati solo sul telefono (senza rete) compaiono in Lavoro → "Da inviare".

## Procedura di applicazione (da fare solo con la tua autorizzazione)

1. Backup: dall'app Altro → Esporta backup; nel pannello Supabase, SQL Editor:
   `create schema if not exists backup;`
   `create table backup.rapporti_AAAAMMGG as select * from public.rapporti;`
   (lo schema `backup` non è esposto alle API: anon/authenticated non hanno accesso)
   (la migrazione non tocca `rapporti`, ma è la stessa prudenza del rilascio precedente).
2. SQL Editor → incollare `supabase/migrations/20261108090000_interventi_rapportini.sql` → Run.
3. Verifica: eseguire la prima query anche PRIMA del passo 2 e annotare il risultato; dopo deve dare
   51 righe e la stessa impronta; la seconda deve dare 5 tabelle nuove con RLS `true`:
   ```sql
   select count(*), md5(string_agg(data::text||'|'||dati::text||'|'||coalesce(aggiornato::text,''),'#' order by data)) from public.rapporti;
   select relname, relrowsecurity from pg_class where relname in ('interventi','intervento_operai','rapportini','rapportino_operai','allegati');
   ```
4. Pubblicare il frontend: merge di `interventi-rapportini` su `main`.
5. Prova con un admin e due operai (vedi README / rapporto).

Rollback: ripristinare `main` al commit precedente, poi SQL Editor → `supabase/rollback/20261108090000_interventi_rapportini_rollback.sql`.
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
