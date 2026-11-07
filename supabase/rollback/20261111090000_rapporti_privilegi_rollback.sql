-- ROLLBACK di 20261111090000_rapporti_privilegi.sql: rimette i privilegi di default di authenticated.
-- (anon non aveva privilegi su rapporti nemmeno prima: dalla migrazione utenti_ruoli.)
grant truncate, references, trigger on public.rapporti to authenticated;
