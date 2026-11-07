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

-- ---------------------------------------------------------------- salvataggio con controllo di concorrenza
-- Il telefono indica la versione ("aggiornato") da cui e' partito. Se nel frattempo qualcuno ha salvato,
-- non sovrascrive: restituisce la versione attuale e il telefono unisce le modifiche e riprova.
-- SECURITY INVOKER: valgono RLS e trigger dell'utente che chiama. La versione la decide il server.
create or replace function public.salva_giornata(p_data text, p_dati jsonb, p_base timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  attuale public.rapporti%rowtype;
begin
  select * into attuale from public.rapporti where data = p_data for update;
  if not found then
    -- nuova giornata (se esiste ma l'utente non la vede, l'inserimento fallisce: chiave duplicata)
    insert into public.rapporti (data, dati, aggiornato) values (p_data, p_dati, now()) returning * into attuale;
    return jsonb_build_object('esito', 'ok', 'aggiornato', attuale.aggiornato);
  end if;
  if p_base is null or attuale.aggiornato <> p_base then
    return jsonb_build_object('esito', 'conflitto', 'dati', attuale.dati, 'aggiornato', attuale.aggiornato);
  end if;
  update public.rapporti set dati = p_dati, aggiornato = now() where data = p_data returning * into attuale;
  return jsonb_build_object('esito', 'ok', 'aggiornato', attuale.aggiornato);
end $$;
revoke execute on function public.salva_giornata(text, jsonb, timestamptz) from public, anon;
grant execute on function public.salva_giornata(text, jsonb, timestamptz) to authenticated;
