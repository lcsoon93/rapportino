-- ROLLBACK di 20261107120000_utenti_ruoli.sql: torna al comportamento della vecchia app
-- (accesso con la sola chiave pubblica). NON cancella giornate, profili o account:
-- le colonne nuove di "rapporti" restano (la vecchia app le ignora).
-- Da usare solo insieme al ripristino del frontend precedente su main.
begin;
drop trigger if exists rapporti_controllo on public.rapporti;
drop function if exists public.controlla_rapporto();
drop function if exists public.operai_assegnabili();
drop policy if exists rapporti_lettura on public.rapporti;
drop policy if exists rapporti_inserimento on public.rapporti;
drop policy if exists rapporti_modifica on public.rapporti;
drop policy if exists rapporti_eliminazione on public.rapporti;
grant select, insert, update, delete on public.rapporti to anon;
create policy "accesso app" on public.rapporti for all to public using (true) with check (true);
commit;
