-- =====================================================================
-- Fase F: privilegi della tabella storica "rapporti".
-- Il default di Supabase concede anche TRUNCATE, REFERENCES e TRIGGER al ruolo authenticated.
-- TRUNCATE non passa dalle policy RLS: se fosse raggiungibile svuoterebbe tutte le giornate.
-- L'app non lo usa (via API non e' esposto), quindi si toglie, come gia' fatto per le tabelle nuove
-- (20261108090000). SELECT/INSERT/UPDATE/DELETE restano, sempre filtrati da RLS: nessuna policy cambia.
-- Ripetibile (REVOKE di un privilegio gia' assente non da' errore). Dati non toccati.
-- =====================================================================
revoke truncate, references, trigger on public.rapporti from authenticated;
revoke all on public.rapporti from anon;
