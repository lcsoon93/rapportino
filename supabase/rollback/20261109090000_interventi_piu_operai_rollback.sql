-- ROLLBACK di 20261109090000_interventi_piu_operai.sql (torna esattamente alla Fase A).
-- ATTENZIONE: le assegnazioni "rimosse" (storico) vengono eliminate, perche' senza la colonna
-- rimosso_il tornerebbero attive e ridarebbero accesso all'intervento. Prima esportarle:
--   select * from public.intervento_operai where rimosso_il is not null;   -> Export CSV
-- Interventi, rapportini, ore e foto NON vengono toccati. Non tocca "rapporti" ne' "profili".
begin;
drop trigger if exists intervento_operai_rimozione on public.intervento_operai;
drop trigger if exists intervento_operai_stato on public.intervento_operai;

-- funzioni della Fase A, testo originale
create or replace function public.assegnato_a(p_intervento uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mio_ruolo() is not null and exists (select 1 from public.intervento_operai
                 where intervento_id = p_intervento and operaio_id = auth.uid())
$$;

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

revoke execute on function public.controlla_intervento(), public.controlla_assegnazione(),
  public.aggiorna_stato_intervento() from public, anon, authenticated;

drop function if exists public.rimuovi_assegnazione();
drop function if exists public.ricalcola_stato_intervento(uuid);
drop function if exists public.stato_intervento_calcolato(uuid);

-- storico delle assegnazioni rimosse (vedi avvertenza sopra), poi le colonne
delete from public.intervento_operai where rimosso_il is not null;
drop index if exists public.intervento_operai_attivi;
alter table public.intervento_operai drop column if exists rimosso_da;
alter table public.intervento_operai drop column if exists rimosso_il;

-- stati riallineati alla regola della Fase A
update public.interventi i set stato = case
    when exists (select 1 from public.rapportini r where r.intervento_id = i.id and r.stato = 'completato') then 'completato'
    when exists (select 1 from public.rapportini r where r.intervento_id = i.id) then 'in_corso'
    else 'pianificato' end
  where i.stato <> 'annullato';
commit;
