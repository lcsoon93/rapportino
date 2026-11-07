-- Rollback della Fase G (20261112090000_utenti_pin_ruoli.sql).
-- Elimina i PIN (si torna al solo accesso con password) e le colonne cognome e ruoli.
-- ATTENZIONE: i cognomi inseriti dopo la migrazione vanno persi; prima, se servono:
--   select id, username, nome, cognome, ruoli from public.profili;  -> Export CSV
-- Account, UUID, giornate, interventi e rapportini non vengono toccati.
-- Prima del rollback ripristinare le Edge Functions precedenti (accesso, utenti, inizializza)
-- ed eliminare la funzione "pin".
begin;
drop function if exists public.pin_prenota(uuid);
drop function if exists public.pin_esito(uuid, boolean);
drop function if exists public.limite_tentativi(text, integer, integer);
drop table if exists public.pin_accesso;
drop table if exists public.tentativi_accesso;
drop function if exists public.nomi_utenti();

-- funzioni come prima della Fase G (admin sempre considerato operaio)
create or replace function public.controlla_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if not public.pianifica() then
      raise exception 'Operazione non consentita' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profili p where p.id = new.operaio_id and p.attivo and p.ruolo in ('worker', 'admin')) then
      raise exception 'Si possono assegnare solo operai attivi' using errcode = '42501';
    end if;
    if exists (select 1 from public.intervento_operai a where a.intervento_id = new.intervento_id and a.operaio_id = new.operaio_id) then
      update public.intervento_operai set rimosso_il = null, rimosso_da = null, assegnato_da = auth.uid(), assegnato_il = now()
        where intervento_id = new.intervento_id and operaio_id = new.operaio_id and rimosso_il is not null;
      return null;
    end if;
    new.assegnato_da := auth.uid();
    new.assegnato_il := now();
    new.rimosso_il := null;
    new.rimosso_da := null;
    return new;
  end if;
  new.intervento_id := old.intervento_id;
  new.operaio_id := old.operaio_id;
  return new;
end $$;
create or replace function public.controlla_ore_operaio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if not exists (select 1 from public.profili p where p.id = new.operaio_id and p.attivo and p.ruolo in ('worker', 'admin')) then
    raise exception 'Operaio non valido' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.controlla_assegnazione(), public.controlla_ore_operaio() from public, anon, authenticated;
create or replace function public.operai_attivi() returns table (id uuid, username text, nome text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.nome from public.profili p
  where p.attivo and p.ruolo in ('worker', 'admin') and public.mio_ruolo() is not null
  order by lower(p.nome), lower(p.username)
$$;
create or replace function public.operai_assegnabili() returns table (id uuid, username text, nome text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.nome from public.profili p
  where p.attivo and p.ruolo in ('worker', 'admin') and public.mio_ruolo() in ('admin', 'company')
  order by lower(p.nome), lower(p.username)
$$;
drop function if exists public.lavora_sul_campo(uuid);
drop function if exists public.ha_ruolo(text);

drop trigger if exists profili_ruoli on public.profili;
drop function if exists public.profili_ruoli_predefiniti();
alter table public.profili drop constraint if exists profili_ruoli_validi;
alter table public.profili drop constraint if exists profili_cognome_lunghezza;
alter table public.profili drop column if exists ruoli, drop column if exists cognome,
  drop column if exists password_temporanea_scade, drop column if exists password_reimpostata_il,
  drop column if exists password_reimpostata_da;
commit;
