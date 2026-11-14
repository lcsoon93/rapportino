-- =====================================================================
-- Anagrafica clienti permanente (richiede 20261108090000 e successive).
--
-- * clienti: una scheda per cliente con ID univoco (uuid). Il nome NON e' univoco: piu' clienti
--   possono avere lo stesso nome e anche lo stesso indirizzo (nessun vincolo unique su nome/indirizzo).
-- * interventi e rapportini: nuove colonne cliente_id (collegamento alla scheda, facoltativo) e
--   telefono. Nome, indirizzo e telefono del documento restano una COPIA (snapshot): modificare
--   l'anagrafica non cambia i documenti e modificare un documento non cambia l'anagrafica.
-- * salva_cliente: creazione/modifica atomica con controllo di versione (sincronizzazione offline:
--   lo stesso id inviato due volte non crea doppioni; una modifica su una versione superata
--   restituisce "conflitto" con la copia del server).
-- * salva_rapportino: ora salva anche cliente_id e telefono (stessa firma, stesso comportamento).
--
-- Permessi (RLS): leggono tutti gli utenti ATTIVI del progetto; creano tutti gli utenti attivi
-- (l'operaio puo' aggiungere un cliente dal rapportino); modificano e archiviano admin e company;
-- elimina solo l'admin e solo un cliente senza documenti collegati (altrimenti si archivia).
-- Un progetto Supabase = un'azienda: chi non ha un profilo attivo in questo progetto non vede nulla.
--
-- Solo aggiunte: nessun dato esistente modificato o cancellato. Ripetibile.
-- =====================================================================

-- ---------------------------------------------------------------- tabella
create table if not exists public.clienti (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 1 and 200),       -- nome e cognome o ragione sociale
  indirizzo text not null default '' check (length(indirizzo) <= 300),
  telefono text not null default '' check (length(telefono) <= 60),
  email text not null default '' check (length(email) <= 200),
  partita_iva text not null default '' check (length(partita_iva) <= 30),
  note text not null default '' check (length(note) <= 2000),
  archiviato boolean not null default false,
  versione integer not null default 1,
  creato_da uuid references public.profili(id) on delete set null,
  creato_il timestamptz not null default now(),
  aggiornato_da uuid references public.profili(id) on delete set null,
  aggiornato_il timestamptz not null default now()
);
create index if not exists clienti_nome on public.clienti (lower(nome));
create index if not exists clienti_archiviato on public.clienti (archiviato);

-- autore, date e versione li decide il database (mai il browser)
create or replace function public.controlla_cliente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.creato_da := coalesce(auth.uid(), new.creato_da);
    new.creato_il := now();
    new.versione := 1;
  else
    new.id := old.id;
    new.creato_da := old.creato_da;
    new.creato_il := old.creato_il;
    new.versione := old.versione + 1;
  end if;
  new.nome := btrim(new.nome);
  new.aggiornato_da := coalesce(auth.uid(), new.aggiornato_da);
  new.aggiornato_il := now();
  return new;
end $$;
revoke execute on function public.controlla_cliente() from public, anon, authenticated;
drop trigger if exists clienti_controllo on public.clienti;
create trigger clienti_controllo before insert or update on public.clienti
  for each row execute function public.controlla_cliente();

-- ---------------------------------------------------------------- RLS
alter table public.clienti enable row level security;
revoke all on public.clienti from anon;
grant select, insert, update, delete on public.clienti to authenticated;
revoke truncate, references, trigger on public.clienti from authenticated;

drop policy if exists clienti_lettura on public.clienti;
drop policy if exists clienti_inserimento on public.clienti;
drop policy if exists clienti_modifica on public.clienti;
drop policy if exists clienti_eliminazione on public.clienti;
create policy clienti_lettura on public.clienti for select to authenticated
  using ((select public.mio_ruolo()) is not null);
create policy clienti_inserimento on public.clienti for insert to authenticated
  with check ((select public.mio_ruolo()) is not null and not archiviato);
create policy clienti_modifica on public.clienti for update to authenticated
  using ((select public.pianifica())) with check ((select public.pianifica()));
create policy clienti_eliminazione on public.clienti for delete to authenticated
  using ((select public.e_admin()));

-- ---------------------------------------------------------------- collegamento dai documenti
-- on delete restrict: un cliente con documenti non si elimina (si archivia), lo storico resta collegato
alter table public.interventi
  add column if not exists cliente_id uuid references public.clienti(id) on delete restrict,
  add column if not exists telefono text not null default '';
alter table public.rapportini
  add column if not exists cliente_id uuid references public.clienti(id) on delete restrict,
  add column if not exists telefono text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'interventi_telefono_lunghezza') then
    alter table public.interventi add constraint interventi_telefono_lunghezza check (length(telefono) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rapportini_telefono_lunghezza') then
    alter table public.rapportini add constraint rapportini_telefono_lunghezza check (length(telefono) <= 60);
  end if;
end $$;
create index if not exists interventi_cliente on public.interventi (cliente_id);
-- un cliente_id che non esiste (scheda creata offline e non ancora arrivata) non blocca il documento:
-- resta vuoto, il documento conserva comunque nome, indirizzo e telefono copiati
create or replace function public.documento_cliente_esistente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cliente_id is not null and not exists (select 1 from public.clienti where id = new.cliente_id) then
    new.cliente_id := null;
  end if;
  return new;
end $$;
revoke execute on function public.documento_cliente_esistente() from public, anon, authenticated;
drop trigger if exists interventi_cliente_esistente on public.interventi;
create trigger interventi_cliente_esistente before insert or update of cliente_id on public.interventi
  for each row execute function public.documento_cliente_esistente();
drop trigger if exists rapportini_cliente_esistente on public.rapportini;
create trigger rapportini_cliente_esistente before insert or update of cliente_id on public.rapportini
  for each row execute function public.documento_cliente_esistente();
create index if not exists rapportini_cliente on public.rapportini (cliente_id);

-- ---------------------------------------------------------------- salva_cliente
-- p_cliente: { id, nome, indirizzo, telefono, email, partita_iva, note, archiviato }
-- p_versione: versione su cui si basa la modifica (null = creazione).
-- Esiti: ok (con la scheda salvata) | conflitto (con la copia del server: decide l'app).
-- security invoker: valgono le policy qui sopra (chi non puo' modificare riceve un errore).
create or replace function public.salva_cliente(p_cliente jsonb, p_versione integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.clienti%rowtype;
  v_id uuid := coalesce(nullif(p_cliente->>'id', '')::uuid, gen_random_uuid());
begin
  if p_versione is null then
    -- creazione idempotente: lo stesso id inviato di nuovo (risposta persa) non crea un doppione
    insert into public.clienti (id, nome, indirizzo, telefono, email, partita_iva, note)
    values (v_id, coalesce(p_cliente->>'nome', ''), coalesce(p_cliente->>'indirizzo', ''), coalesce(p_cliente->>'telefono', ''),
            coalesce(p_cliente->>'email', ''), coalesce(p_cliente->>'partita_iva', ''), coalesce(p_cliente->>'note', ''))
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
      archiviato = coalesce((p_cliente->>'archiviato')::boolean, archiviato)
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

-- ---------------------------------------------------------------- salva_rapportino (con cliente_id e telefono)
-- Uguale alla versione di 20261108090000, con in piu' cliente_id e telefono. Un cliente_id che non
-- esiste (es. scheda creata offline e non ancora arrivata) non blocca il salvataggio: resta vuoto.
create or replace function public.salva_rapportino(p_rapportino jsonb, p_ore jsonb, p_completa boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.rapportini%rowtype;
  v_id uuid := coalesce(nullif(p_rapportino->>'id', '')::uuid, gen_random_uuid());
  v_versione integer := nullif(p_rapportino->>'versione', '')::integer;
  v_cliente uuid := nullif(p_rapportino->>'cliente_id', '')::uuid;
  v_fatto boolean := false;
begin
  if v_cliente is not null and not exists (select 1 from public.clienti where id = v_cliente) then
    v_cliente := null;
  end if;
  if v_versione is not null then
    update public.rapportini set
      data = (p_rapportino->>'data')::date,
      cliente = coalesce(p_rapportino->>'cliente', ''), indirizzo = coalesce(p_rapportino->>'indirizzo', ''),
      cliente_id = v_cliente, telefono = coalesce(p_rapportino->>'telefono', ''),
      tipologia = coalesce(p_rapportino->>'tipologia', ''), attivita = coalesce(p_rapportino->>'attivita', ''),
      materiali = coalesce(p_rapportino->'materiali', '[]'::jsonb), note = coalesce(p_rapportino->>'note', ''),
      esito = coalesce(nullif(p_rapportino->>'esito', ''), 'Completato'),
      firma = coalesce(p_rapportino->>'firma', ''), firmatario = coalesce(p_rapportino->>'firmatario', '')
    where id = v_id and versione = v_versione
    returning * into r;
    v_fatto := found;
  end if;
  if not v_fatto then
    if not exists (select 1 from public.rapportini where id = v_id) then
      insert into public.rapportini (id, intervento_id, data, cliente, indirizzo, cliente_id, telefono, tipologia, attivita, materiali, note, esito, firma, firmatario)
      values (v_id, nullif(p_rapportino->>'intervento_id', '')::uuid, (p_rapportino->>'data')::date,
              coalesce(p_rapportino->>'cliente', ''), coalesce(p_rapportino->>'indirizzo', ''), v_cliente, coalesce(p_rapportino->>'telefono', ''),
              coalesce(p_rapportino->>'tipologia', ''), coalesce(p_rapportino->>'attivita', ''), coalesce(p_rapportino->'materiali', '[]'::jsonb),
              coalesce(p_rapportino->>'note', ''), coalesce(nullif(p_rapportino->>'esito', ''), 'Completato'),
              coalesce(p_rapportino->>'firma', ''), coalesce(p_rapportino->>'firmatario', ''))
      on conflict (id) do nothing
      returning * into r;
      v_fatto := found;
    end if;
  end if;
  if not v_fatto then
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
