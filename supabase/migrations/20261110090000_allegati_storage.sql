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
