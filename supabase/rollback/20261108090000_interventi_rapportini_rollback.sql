-- ROLLBACK di 20261108090000_interventi_rapportini.sql
-- ATTENZIONE: elimina le tabelle nuove e quindi gli interventi e i rapportini scritti con la nuova app.
-- Prima esportarli (procedura nel rapporto). Non tocca "rapporti", "profili" ne' le loro policy.
begin;
drop function if exists public.salva_rapportino(jsonb, jsonb, boolean);
drop function if exists public.operai_attivi();
-- insieme, in un'unica istruzione: CASCADE porta via solo le policy, i trigger e le chiavi
-- di queste cinque tabelle (nessun altro oggetto dipende da loro)
drop table if exists public.allegati, public.rapportino_operai, public.rapportini,
  public.intervento_operai, public.interventi cascade;
drop function if exists public.aggiorna_stato_intervento();
drop function if exists public.controlla_allegato();
drop function if exists public.controlla_ore_operaio();
drop function if exists public.controlla_ore_rapportino();
drop function if exists public.controlla_rapportino();
drop function if exists public.controlla_assegnazione();
drop function if exists public.controlla_intervento();
drop function if exists public.vede_rapportino(uuid);
drop function if exists public.modifica_rapportino(uuid);
drop function if exists public.assegnato_a(uuid);
drop function if exists public.e_admin();
drop function if exists public.pianifica();
drop function if exists public.compila();
commit;
