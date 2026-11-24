-- Annulla l'importazione delle giornate della vecchia app: elimina SOLO i rapportini importati
-- (origine non nulla, con ore e foto collegate) e la funzione; "rapporti" non e' mai stata toccata.
-- I rapportini importati poi modificati nella nuova app vengono eliminati anch'essi: controllare prima.
begin;
delete from public.rapportini where origine like 'rapporti:%';
drop function if exists public.importa_rapporti_vecchi(uuid, jsonb);
drop index if exists public.rapportini_origine_unica;
alter table public.rapportini drop column if exists origine;
commit;
