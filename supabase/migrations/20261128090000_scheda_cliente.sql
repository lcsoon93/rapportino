-- =====================================================================
-- Scheda cliente evoluta (richiede 20261116090000_anagrafica_clienti).
--
-- * clienti: nuovi campi FACOLTATIVI (tipologia, referente, codice fiscale, SDI, PEC, stato
--   commerciale, sedi operative). I clienti gia' salvati restano validi: valori vuoti / "attivo".
--   "archiviato" resta com'e' (nascosto dai suggerimenti); "stato" e' un'informazione in piu'.
-- * salva_cliente: stessa firma e stesso comportamento (versione, conflitti, creazione idempotente),
--   con i campi nuovi. Chi usa ancora l'app vecchia non li invia: restano invariati.
-- * impianti_cliente: impianti / attrezzature del cliente (marca, modello, matricola, installazione,
--   garanzia, posizione, note). Leggono tutti gli utenti attivi; aggiungono tutti gli utenti attivi
--   (l'operaio sul posto); modificano admin, company o chi l'ha inserito; elimina solo l'admin.
-- * documenti_cliente + bucket PRIVATO "documenti-clienti": file del cliente (PDF e immagini, max 10 MB)
--   in <id cliente>/<id documento>.<pdf|jpg|png|webp>. Nella tabella solo i metadati; un documento si
--   registra solo se il file e' davvero nello Storage con la stessa dimensione.
--   Leggono tutti gli utenti attivi; caricano tutti gli utenti attivi; eliminano admin, company o chi
--   l'ha caricato.
-- Un cliente con impianti o documenti non si elimina (on delete restrict): si archivia, come gia' per
-- interventi e rapportini.
--
-- Solo aggiunte: nessun dato esistente modificato o cancellato. Ripetibile.
-- Annullamento: supabase/rollback/20261128090000_scheda_cliente_rollback.sql
-- =====================================================================

-- ---------------------------------------------------------------- clienti: campi nuovi
alter table public.clienti
  add column if not exists tipologia text not null default '',
  add column if not exists referente text not null default '',
  add column if not exists codice_fiscale text not null default '',
  add column if not exists codice_sdi text not null default '',
  add column if not exists pec text not null default '',
  add column if not exists stato text not null default 'attivo',
  add column if not exists sedi jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clienti_campi_scheda') then
    alter table public.clienti add constraint clienti_campi_scheda check (
      tipologia in ('', 'privato', 'azienda', 'amministratore', 'condominio')
      and length(referente) <= 200 and length(codice_fiscale) <= 20 and length(codice_sdi) <= 10
      and length(pec) <= 200 and stato in ('attivo', 'inattivo', 'potenziale')
      and jsonb_typeof(sedi) = 'array' and jsonb_array_length(sedi) <= 20 and length(sedi::text) <= 8000);
  end if;
end $$;

-- ---------------------------------------------------------------- salva_cliente (con i campi nuovi)
-- p_cliente: { id, nome, indirizzo, telefono, email, partita_iva, note, archiviato,
--              tipologia, referente, codice_fiscale, codice_sdi, pec, stato, sedi }
-- Un campo assente resta com'e' (modifica) o vuoto (creazione).
create or replace function public.salva_cliente(p_cliente jsonb, p_versione integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.clienti%rowtype;
  v_id uuid := coalesce(nullif(p_cliente->>'id', '')::uuid, gen_random_uuid());
  v_sedi jsonb := case when jsonb_typeof(p_cliente->'sedi') = 'array' then p_cliente->'sedi' end;
begin
  if p_versione is null then
    -- creazione idempotente: lo stesso id inviato di nuovo (risposta persa) non crea un doppione
    insert into public.clienti (id, nome, indirizzo, telefono, email, partita_iva, note,
        tipologia, referente, codice_fiscale, codice_sdi, pec, stato, sedi)
    values (v_id, coalesce(p_cliente->>'nome', ''), coalesce(p_cliente->>'indirizzo', ''), coalesce(p_cliente->>'telefono', ''),
            coalesce(p_cliente->>'email', ''), coalesce(p_cliente->>'partita_iva', ''), coalesce(p_cliente->>'note', ''),
            coalesce(p_cliente->>'tipologia', ''), coalesce(p_cliente->>'referente', ''), coalesce(p_cliente->>'codice_fiscale', ''),
            coalesce(p_cliente->>'codice_sdi', ''), coalesce(p_cliente->>'pec', ''), coalesce(nullif(p_cliente->>'stato', ''), 'attivo'),
            coalesce(v_sedi, '[]'::jsonb))
    on conflict (id) do nothing
    returning * into c;
    if found then return jsonb_build_object('esito', 'ok', 'cliente', to_jsonb(c)); end if;
  else
    -- modifica: solo admin e company (senza questo controllo RLS la ignorerebbe in silenzio)
    if not public.pianifica() then
      raise exception 'Solo amministratore e company possono modificare l''anagrafica' using errcode = '42501';
    end if;
    update public.clienti set
      nome = coalesce(p_cliente->>'nome', nome), indirizzo = coalesce(p_cliente->>'indirizzo', indirizzo),
      telefono = coalesce(p_cliente->>'telefono', telefono), email = coalesce(p_cliente->>'email', email),
      partita_iva = coalesce(p_cliente->>'partita_iva', partita_iva), note = coalesce(p_cliente->>'note', note),
      archiviato = coalesce((p_cliente->>'archiviato')::boolean, archiviato),
      tipologia = coalesce(p_cliente->>'tipologia', tipologia), referente = coalesce(p_cliente->>'referente', referente),
      codice_fiscale = coalesce(p_cliente->>'codice_fiscale', codice_fiscale), codice_sdi = coalesce(p_cliente->>'codice_sdi', codice_sdi),
      pec = coalesce(p_cliente->>'pec', pec), stato = coalesce(nullif(p_cliente->>'stato', ''), stato),
      sedi = coalesce(v_sedi, sedi)
    where id = v_id and versione = p_versione
    returning * into c;
    if found then return jsonb_build_object('esito', 'ok', 'cliente', to_jsonb(c)); end if;
  end if;
  -- gia' esistente (creazione ripetuta) o versione superata: si restituisce la copia del server
  select * into c from public.clienti where id = v_id;
  if not found then
    raise exception 'Cliente non trovato o non modificabile' using errcode = '42501';
  end if;
  return jsonb_build_object('esito', 'conflitto', 'cliente', to_jsonb(c));
end $$;
revoke execute on function public.salva_cliente(jsonb, integer) from public, anon;
grant execute on function public.salva_cliente(jsonb, integer) to authenticated;

-- ---------------------------------------------------------------- impianti del cliente
create table if not exists public.impianti_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete restrict,
  nome text not null check (length(btrim(nome)) between 1 and 200),       -- es. "Caldaia murale"
  marca text not null default '' check (length(marca) <= 100),
  modello text not null default '' check (length(modello) <= 100),
  matricola text not null default '' check (length(matricola) <= 100),
  installato_il date,
  garanzia_fino date,
  posizione text not null default '' check (length(posizione) <= 200),  -- sede / locale
  note text not null default '' check (length(note) <= 2000),
  dismesso boolean not null default false,
  versione integer not null default 1,
  creato_da uuid references public.profili(id) on delete set null,
  creato_il timestamptz not null default now(),
  aggiornato_da uuid references public.profili(id) on delete set null,
  aggiornato_il timestamptz not null default now()
);
create index if not exists impianti_cliente_cliente on public.impianti_cliente (cliente_id);

create or replace function public.controlla_impianto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.creato_da := coalesce(auth.uid(), new.creato_da);
    new.creato_il := now();
    new.versione := 1;
  else
    new.id := old.id;
    new.cliente_id := old.cliente_id;          -- un impianto non cambia cliente
    new.creato_da := old.creato_da;
    new.creato_il := old.creato_il;
    new.versione := old.versione + 1;
  end if;
  new.nome := btrim(new.nome);
  new.aggiornato_da := coalesce(auth.uid(), new.aggiornato_da);
  new.aggiornato_il := now();
  return new;
end $$;
revoke execute on function public.controlla_impianto() from public, anon, authenticated;
drop trigger if exists impianti_cliente_controllo on public.impianti_cliente;
create trigger impianti_cliente_controllo before insert or update on public.impianti_cliente
  for each row execute function public.controlla_impianto();

alter table public.impianti_cliente enable row level security;
revoke all on public.impianti_cliente from anon;
grant select, insert, update, delete on public.impianti_cliente to authenticated;
revoke truncate, references, trigger on public.impianti_cliente from authenticated;
drop policy if exists impianti_lettura on public.impianti_cliente;
drop policy if exists impianti_inserimento on public.impianti_cliente;
drop policy if exists impianti_modifica on public.impianti_cliente;
drop policy if exists impianti_eliminazione on public.impianti_cliente;
create policy impianti_lettura on public.impianti_cliente for select to authenticated
  using ((select public.mio_ruolo()) is not null);
create policy impianti_inserimento on public.impianti_cliente for insert to authenticated
  with check ((select public.mio_ruolo()) is not null);
create policy impianti_modifica on public.impianti_cliente for update to authenticated
  using ((select public.pianifica()) or ((select public.mio_ruolo()) is not null and creato_da = (select auth.uid())))
  with check ((select public.pianifica()) or ((select public.mio_ruolo()) is not null and creato_da = (select auth.uid())));
create policy impianti_eliminazione on public.impianti_cliente for delete to authenticated
  using ((select public.e_admin()));

-- ---------------------------------------------------------------- documenti del cliente
-- 10 MB, PDF e immagini. Nessun URL pubblico: si leggono con la sessione dell'utente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documenti-clienti', 'documenti-clienti', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.documenti_cliente (
  id uuid primary key,                                   -- generato dal telefono (nome del file)
  cliente_id uuid not null references public.clienti(id) on delete restrict,
  nome text not null check (length(btrim(nome)) between 1 and 200),
  percorso text not null unique,
  mime text not null,
  dimensione integer not null check (dimensione > 0),
  note text not null default '' check (length(note) <= 500),
  caricato_da uuid references public.profili(id) on delete set null,
  creato_il timestamptz not null default now()
);
create index if not exists documenti_cliente_cliente on public.documenti_cliente (cliente_id);

-- cliente a cui appartiene un percorso del bucket (null se il nome non ha la forma prevista)
create or replace function public.cliente_del_percorso(p_nome text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_nome ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
    then split_part(p_nome, '/', 1)::uuid end
$$;
revoke execute on function public.cliente_del_percorso(text) from public, anon;
grant execute on function public.cliente_del_percorso(text) to authenticated;

create or replace function public.controlla_documento_cliente() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  dim bigint;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Un documento non si modifica: si elimina e si carica di nuovo' using errcode = '42501';
  end if;
  if auth.uid() is null then return new; end if;
  new.caricato_da := auth.uid();
  new.creato_il := now();
  new.nome := btrim(new.nome);
  if public.cliente_del_percorso(new.percorso) is distinct from new.cliente_id
     or split_part(split_part(new.percorso, '/', 2), '.', 1) <> new.id::text then
    raise exception 'Percorso del documento non valido' using errcode = '23514';
  end if;
  if new.mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Tipo di file non consentito' using errcode = '23514';
  end if;
  select (o.metadata->>'size')::bigint into dim from storage.objects o
    where o.bucket_id = 'documenti-clienti' and o.name = new.percorso;
  if not found then
    raise exception 'Documento non ancora caricato' using errcode = 'P0002';
  end if;
  if dim is distinct from new.dimensione::bigint then
    raise exception 'Documento caricato in modo incompleto' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.controlla_documento_cliente() from public, anon, authenticated;
drop trigger if exists documenti_cliente_controllo on public.documenti_cliente;
create trigger documenti_cliente_controllo before insert or update on public.documenti_cliente
  for each row execute function public.controlla_documento_cliente();

alter table public.documenti_cliente enable row level security;
revoke all on public.documenti_cliente from anon;
grant select, insert, delete on public.documenti_cliente to authenticated;
revoke update, truncate, references, trigger on public.documenti_cliente from authenticated;
drop policy if exists documenti_cliente_lettura on public.documenti_cliente;
drop policy if exists documenti_cliente_inserimento on public.documenti_cliente;
drop policy if exists documenti_cliente_eliminazione on public.documenti_cliente;
create policy documenti_cliente_lettura on public.documenti_cliente for select to authenticated
  using ((select public.mio_ruolo()) is not null);
create policy documenti_cliente_inserimento on public.documenti_cliente for insert to authenticated
  with check ((select public.mio_ruolo()) is not null);
create policy documenti_cliente_eliminazione on public.documenti_cliente for delete to authenticated
  using ((select public.pianifica()) or ((select public.mio_ruolo()) is not null and caricato_da = (select auth.uid())));

-- policy Storage (solo questo bucket). Nessuna policy di UPDATE: un file caricato non si sovrascrive.
drop policy if exists documenti_clienti_lettura on storage.objects;
create policy documenti_clienti_lettura on storage.objects for select to authenticated
  using (bucket_id = 'documenti-clienti' and (select public.mio_ruolo()) is not null);
drop policy if exists documenti_clienti_caricamento on storage.objects;
create policy documenti_clienti_caricamento on storage.objects for insert to authenticated
  with check (bucket_id = 'documenti-clienti' and (select public.mio_ruolo()) is not null
              and public.cliente_del_percorso(name) is not null
              and exists (select 1 from public.clienti c where c.id = public.cliente_del_percorso(name)));
drop policy if exists documenti_clienti_cancellazione on storage.objects;
create policy documenti_clienti_cancellazione on storage.objects for delete to authenticated
  using (bucket_id = 'documenti-clienti' and (select public.mio_ruolo()) is not null
         and ((select public.pianifica()) or owner = (select auth.uid())));
