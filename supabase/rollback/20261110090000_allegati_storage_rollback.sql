-- ROLLBACK di 20261110090000_allegati_storage.sql (torna alla Fase B).
-- Non cancella nessuna foto:
--  * i metadati delle foto nello Storage vengono COPIATI in backup.allegati_storage e solo poi tolti
--    da public.allegati (la tabella della Fase B richiede il contenuto base64, che queste righe non hanno);
--  * i file restano nel bucket "allegati-rapportini" (non cancellabili via SQL; senza le policy li vede
--    solo il pannello / service role). Riapplicando la migrazione si possono rimettere con:
--      insert into public.allegati (id, rapportino_id, tipo, nome, larghezza, altezza, caricato_da, creato_il,
--        percorso, mime, dimensione, impronta)
--      select id, rapportino_id, tipo, nome, larghezza, altezza, caricato_da, creato_il, percorso, mime, dimensione, impronta
--      from backup.allegati_storage on conflict do nothing;   -- (eseguito come pannello: il trigger non scatta)
-- Le foto in base64 (righe con contenuto) non vengono toccate.
begin;
drop policy if exists allegati_rapportini_lettura on storage.objects;
drop policy if exists allegati_rapportini_caricamento on storage.objects;
drop policy if exists allegati_rapportini_cancellazione on storage.objects;
drop function if exists public.registra_allegato(jsonb);

create schema if not exists backup;
create table if not exists backup.allegati_storage as select * from public.allegati where false;
insert into backup.allegati_storage select a.* from public.allegati a
  where a.percorso is not null and not exists (select 1 from backup.allegati_storage b where b.id = a.id);
delete from public.allegati where percorso is not null and contenuto is null;

-- funzione della Fase A, testo originale
create or replace function public.controlla_allegato() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  new.caricato_da := auth.uid();
  new.creato_il := now();
  return new;
end $$;
revoke execute on function public.controlla_allegato() from public, anon, authenticated;

alter table public.allegati drop constraint if exists allegati_contenuto_o_percorso;
drop index if exists public.allegati_impronta;
drop index if exists public.allegati_percorso;
alter table public.allegati drop column if exists impronta;
alter table public.allegati drop column if exists dimensione;
alter table public.allegati drop column if exists mime;
alter table public.allegati drop column if exists percorso;
alter table public.allegati alter column contenuto set not null;
drop function if exists public.rapportino_del_percorso(text);
-- il bucket resta (privato) con i file: eliminarlo solo dopo averli scaricati, dal pannello Storage
commit;
