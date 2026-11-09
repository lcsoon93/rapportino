-- =====================================================================
-- Notifiche push (richiede 20261109090000).
--
-- Chi riceve cosa:
--   operaio assegnato  intervento assegnato a lui, modificato (data, ora, cliente, indirizzo,
--                      descrizione, priorita', tipologia), annullato, ripristinato, eliminato,
--                      oppure quando viene tolto dall'intervento
--   company            rapportino aggiunto (primo salvataggio sul server) o completato, da qualsiasi operaio
-- Chi fa la modifica non riceve la propria notifica.
--
-- Come funziona: i trigger qui sotto scrivono le notifiche in una coda (notifiche_coda), con testo e
-- destinatari decisi dal database. L'app, dopo ogni salvataggio, chiama la Edge Function "notifiche"
-- che svuota la coda e invia i messaggi ai telefoni iscritti (notifiche_iscrizioni). Nessuno puo'
-- scrivere nella coda o leggere le iscrizioni degli altri dal browser.
--
-- Solo tabelle e trigger nuovi: nessun dato esistente modificato. Ripetibile.
-- =====================================================================

-- ---------------------------------------------------------------- iscrizioni (un telefono = una riga)
create table if not exists public.notifiche_iscrizioni (
  endpoint text primary key,
  utente_id uuid not null references public.profili(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  dispositivo text not null default '',
  creato_il timestamptz not null default now()
);
create index if not exists notifiche_iscrizioni_utente on public.notifiche_iscrizioni (utente_id);
alter table public.notifiche_iscrizioni enable row level security;
-- nessuna policy: dal browser si passa solo dalle funzioni qui sotto
revoke all on public.notifiche_iscrizioni from anon, authenticated;

-- ---------------------------------------------------------------- coda dei messaggi
create table if not exists public.notifiche_coda (
  id bigint generated always as identity primary key,
  destinatario uuid not null references public.profili(id) on delete cascade,
  mittente uuid,
  tipo text not null,
  priorita integer not null default 1,      -- piu' alta = vince sulle altre dello stesso argomento
  argomento text not null,                  -- es. "int-<uuid>": una sola notifica per argomento e destinatario
  titolo text not null,
  testo text not null,
  url text not null default './',
  creato_il timestamptz not null default now(),
  preso_il timestamptz,
  inviata_il timestamptz,
  tentativi integer not null default 0,
  esito text
);
create index if not exists notifiche_coda_da_inviare on public.notifiche_coda (id) where inviata_il is null;
alter table public.notifiche_coda enable row level security;
revoke all on public.notifiche_coda from anon, authenticated;

-- ---------------------------------------------------------------- iscrizione del telefono
-- Solo servizi push dei browser (Google, Apple, Mozilla, Microsoft): il server non invia altrove.
create or replace function public.notifiche_endpoint_valido(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(length(p) < 1000 and p ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)/', false)
$$;

create or replace function public.notifiche_iscrivi(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.mio_ruolo() is null then
    raise exception 'Operazione non consentita' using errcode = '42501';
  end if;
  if not public.notifiche_endpoint_valido(p_endpoint) then
    raise exception 'Servizio di notifica non riconosciuto' using errcode = '22023';
  end if;
  if coalesce(length(p_p256dh), 0) not between 80 and 100 or coalesce(length(p_auth), 0) not between 16 and 30 then
    raise exception 'Chiavi di notifica non valide' using errcode = '22023';
  end if;
  -- lo stesso telefono passato a un altro utente: l'iscrizione diventa sua
  delete from public.notifiche_iscrizioni where endpoint = p_endpoint;
  insert into public.notifiche_iscrizioni (endpoint, utente_id, p256dh, auth, dispositivo)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_dispositivo, ''), 120));
  -- al massimo 10 telefoni per utente: si tengono i piu' recenti
  delete from public.notifiche_iscrizioni where endpoint in (
    select endpoint from public.notifiche_iscrizioni where utente_id = auth.uid()
    order by creato_il desc offset 10);
end $$;

create or replace function public.notifiche_disiscrivi(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.notifiche_iscrizioni where endpoint = p_endpoint and utente_id = auth.uid()
$$;

-- quante iscrizioni ha l'utente collegato (per mostrare lo stato nell'app)
create or replace function public.notifiche_mie() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.notifiche_iscrizioni where utente_id = auth.uid()
$$;

revoke execute on function public.notifiche_iscrivi(text, text, text, text), public.notifiche_disiscrivi(text),
  public.notifiche_mie() from public, anon;
grant execute on function public.notifiche_iscrivi(text, text, text, text), public.notifiche_disiscrivi(text),
  public.notifiche_mie() to authenticated;
revoke execute on function public.notifiche_endpoint_valido(text) from public, anon;

-- ---------------------------------------------------------------- composizione dei messaggi
create or replace function public.notifiche_accoda(p_dest uuid, p_tipo text, p_priorita integer, p_argomento text,
  p_titolo text, p_testo text, p_url text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifiche_coda (destinatario, mittente, tipo, priorita, argomento, titolo, testo, url)
  select p_dest, auth.uid(), p_tipo, p_priorita, p_argomento, p_titolo, left(p_testo, 300), p_url
  where p_dest is distinct from auth.uid()
$$;

-- "Snav · 12/11 alle 09:00 · Via Roma 1"
create or replace function public.notifiche_riassunto(p_cliente text, p_data date, p_ora time, p_indirizzo text)
returns text language sql immutable set search_path = '' as $$
  select concat_ws(' · ', nullif(btrim(p_cliente), ''),
    to_char(p_data, 'DD/MM') || coalesce(' alle ' || to_char(p_ora, 'HH24:MI'), ''),
    nullif(btrim(p_indirizzo), ''))
$$;

-- operai attivi assegnati a un intervento
create or replace function public.notifiche_assegnati(p_intervento uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.operaio_id from public.intervento_operai a
  where a.intervento_id = p_intervento and a.rimosso_il is null
$$;

-- assegnazione / rimozione di un operaio
create or replace function public.notifiche_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i public.interventi;
  att boolean := new.rimosso_il is null;
  prima boolean := tg_op = 'UPDATE' and old.rimosso_il is null;
begin
  if att = prima then return null; end if;                     -- nessun cambio di assegnazione
  select * into i from public.interventi where id = new.intervento_id;
  if not found or i.stato = 'annullato' then return null; end if;
  if att then
    perform public.notifiche_accoda(new.operaio_id, 'assegnato', 3, 'int-' || i.id, 'Nuovo intervento',
      public.notifiche_riassunto(i.cliente, i.data, i.ora, i.indirizzo), './?intervento=' || i.id);
  else
    perform public.notifiche_accoda(new.operaio_id, 'rimosso', 5, 'int-' || i.id, 'Non sei più assegnato',
      public.notifiche_riassunto(i.cliente, i.data, i.ora, i.indirizzo), './');
  end if;
  return null;
end $$;
drop trigger if exists intervento_operai_notifiche on public.intervento_operai;
create trigger intervento_operai_notifiche after insert or update on public.intervento_operai
  for each row execute function public.notifiche_assegnazione();

-- modifica, annullamento, ripristino (i cambi di stato automatici dai rapportini non notificano)
create or replace function public.notifiche_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tipo text; tit text; prio integer; op uuid; url text := './?intervento=' || new.id;
begin
  if new.stato = 'annullato' and old.stato <> 'annullato' then
    tipo := 'annullato'; tit := 'Intervento annullato'; prio := 4; url := './';
  elsif old.stato = 'annullato' and new.stato <> 'annullato' then
    tipo := 'ripristinato'; tit := 'Intervento ripristinato'; prio := 2;
  elsif new.stato <> 'annullato' and (new.data, new.ora, new.cliente, new.indirizzo, new.descrizione, new.priorita, new.tipologia)
        is distinct from (old.data, old.ora, old.cliente, old.indirizzo, old.descrizione, old.priorita, old.tipologia) then
    tipo := 'modificato'; tit := 'Intervento modificato'; prio := 1;
  else
    return null;
  end if;
  for op in select public.notifiche_assegnati(new.id) loop
    perform public.notifiche_accoda(op, tipo, prio, 'int-' || new.id, tit,
      public.notifiche_riassunto(new.cliente, new.data, new.ora, new.indirizzo), url);
  end loop;
  return null;
end $$;
drop trigger if exists interventi_notifiche on public.interventi;
create trigger interventi_notifiche after update on public.interventi
  for each row execute function public.notifiche_intervento();

-- eliminazione (prima che la cancellazione a cascata tolga le assegnazioni)
create or replace function public.notifiche_intervento_eliminato() returns trigger
language plpgsql security definer set search_path = '' as $$
declare op uuid;
begin
  if old.stato <> 'annullato' then
    for op in select public.notifiche_assegnati(old.id) loop
      perform public.notifiche_accoda(op, 'eliminato', 5, 'int-' || old.id, 'Intervento eliminato',
        public.notifiche_riassunto(old.cliente, old.data, old.ora, old.indirizzo), './');
    end loop;
  end if;
  return old;
end $$;
drop trigger if exists interventi_notifiche_eliminato on public.interventi;
create trigger interventi_notifiche_eliminato before delete on public.interventi
  for each row execute function public.notifiche_intervento_eliminato();

-- rapportini: a tutti gli utenti company attivi
create or replace function public.notifiche_rapportino() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tipo text; tit text; prio integer; dest uuid; autore text;
begin
  if new.stato = 'completato' and (tg_op = 'INSERT' or old.stato <> 'completato') then
    tipo := 'completato'; tit := 'Rapportino completato'; prio := 2;
  elsif tg_op = 'INSERT' then
    tipo := 'nuovo'; tit := 'Nuovo rapportino'; prio := 1;
  else
    return null;
  end if;
  select coalesce(nullif(btrim(concat_ws(' ', p.nome, p.cognome)), ''), p.username) into autore
    from public.profili p where p.id = new.autore_id;
  for dest in select p.id from public.profili p
      where p.attivo and (p.ruolo = 'company' or 'company' = any(coalesce(p.ruoli, array[]::text[]))) loop
    perform public.notifiche_accoda(dest, tipo, prio, 'rap-' || new.id, tit,
      concat_ws(' · ', autore, public.notifiche_riassunto(new.cliente, new.data, null, '')), './?rapportino=' || new.id);
  end loop;
  return null;
end $$;
drop trigger if exists rapportini_notifiche on public.rapportini;
create trigger rapportini_notifiche after insert or update on public.rapportini
  for each row execute function public.notifiche_rapportino();

revoke execute on function public.notifiche_accoda(uuid, text, integer, text, text, text, text),
  public.notifiche_riassunto(text, date, time, text), public.notifiche_assegnati(uuid),
  public.notifiche_assegnazione(), public.notifiche_intervento(), public.notifiche_intervento_eliminato(),
  public.notifiche_rapportino() from public, anon, authenticated;

-- ---------------------------------------------------------------- prelievo dalla coda (solo Edge Function)
-- prende i messaggi da inviare e li segna come "presi" (due chiamate contemporanee non li inviano due volte);
-- un messaggio preso ma non confermato torna disponibile dopo 2 minuti, al massimo 5 tentativi.
create or replace function public.notifiche_preleva(p_limite integer default 200)
returns setof public.notifiche_coda language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifiche_coda where creato_il < now() - interval '30 days';
  return query
  update public.notifiche_coda c set preso_il = now(), tentativi = c.tentativi + 1
  where c.id in (
    select id from public.notifiche_coda
    where inviata_il is null and tentativi < 5 and (preso_il is null or preso_il < now() - interval '2 minutes')
      and creato_il > now() - interval '2 days'
    order by id limit p_limite
    for update skip locked)
  returning c.*;
end $$;
revoke execute on function public.notifiche_preleva(integer) from public, anon, authenticated;
grant execute on function public.notifiche_preleva(integer) to service_role;
