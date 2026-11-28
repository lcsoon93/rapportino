-- Bot Telegram (migrazione 20261128120000): tabelle del bot non accessibili dall'app; il rapportino
-- confermato si salva con salva_rapportino e la sessione dell'utente collegato, come nell'app
-- (stessi dati che prepara datiSalvataggio in supabase/functions/_shared/telegram-logica.ts).
\set ON_ERROR_STOP 1
\o /dev/null
insert into auth.users (id) values ('7e000000-0000-4000-8000-000000000001'),('7e000000-0000-4000-8000-000000000002'),('7e000000-0000-4000-8000-000000000003');
insert into public.profili (id, username, nome, ruolo, ruoli, deve_cambiare_password, attivo) values
 ('7e000000-0000-4000-8000-000000000001','tg_luca','Luca','admin','{admin,worker}',false,true),
 ('7e000000-0000-4000-8000-000000000002','tg_mario','Mario','worker','{worker}',false,true),
 ('7e000000-0000-4000-8000-000000000003','tg_comp','Comp','company','{company}',false,true);
select set_config('test.uid','7e000000-0000-4000-8000-000000000003', false);
insert into public.clienti (id, nome, indirizzo) values ('7c000000-0000-4000-8000-000000000001','Condominio Aurora','Via Aurora 5');
select set_config('test.uid','', false);
\o
create or replace function pg_temp.come(p_uid text, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;
create or replace function pg_temp.negato(p_uid text, p_sql text) returns boolean language plpgsql as $$
begin
  perform pg_temp.come(p_uid, p_sql);
  return false;
exception when insufficient_privilege or check_violation or raise_exception then
  reset role; return true;
end $$;

do $$
declare
  luca text := '7e000000-0000-4000-8000-000000000001'; mario text := '7e000000-0000-4000-8000-000000000002'; comp text := '7e000000-0000-4000-8000-000000000003';
  corpo text := $j$'{"id":"7d000000-0000-4000-8000-000000000001","intervento_id":null,"data":"2026-11-28","cliente":"Condominio Aurora","indirizzo":"Via Aurora 5",
    "cliente_id":"7c000000-0000-4000-8000-000000000001","telefono":"","tipologia":"","attivita":"Sostituita la valvola.","materiali":[{"a":"Raccordo","q":"2"}],
    "note":"","esito":"Completato","firma":"","firmatario":""}'::jsonb,
    '[{"operaio_id":"7e000000-0000-4000-8000-000000000001","dalle":"08:00","alle":"11:00"},{"operaio_id":"7e000000-0000-4000-8000-000000000002","dalle":"08:00","alle":"10:30"}]'::jsonb, true$j$;
  r jsonb;
begin
  -- tabelle del bot: nessun accesso dall'app (solo service_role)
  if not pg_temp.negato(luca, 'select jsonb_build_object(''n'', count(*)) from public.telegram_bozze') then raise exception 'bozze leggibili dall''app'; end if;
  if not pg_temp.negato(luca, 'insert into public.telegram_aggiornamenti (update_id) values (1) returning ''{}''::jsonb') then raise exception 'aggiornamenti scrivibili dall''app'; end if;
  -- conferma: rapportino completato dell'utente collegato, cliente collegato, ore dei due tecnici
  r := pg_temp.come(luca, 'select public.salva_rapportino(' || corpo || ')');
  if r->>'esito' <> 'ok' or r->'rapportino'->>'stato' <> 'completato' or r->'rapportino'->>'autore_id' <> luca
     or r->'rapportino'->>'cliente_id' <> '7c000000-0000-4000-8000-000000000001' then raise exception 'salvataggio: %', r; end if;
  -- conferma ripetuta con lo stesso id: nessun doppione
  r := pg_temp.come(luca, 'select public.salva_rapportino(' || corpo || ')');
  if r->>'esito' <> 'conflitto' or (select count(*) from public.rapportini where id = '7d000000-0000-4000-8000-000000000001') <> 1 then raise exception 'doppione: %', r; end if;
  -- visibile nell'app: all'operaio indicato nelle ore, a company (storico e scheda cliente)
  r := pg_temp.come(mario, $q$select jsonb_build_object('n', count(*)) from public.rapportini where id = '7d000000-0000-4000-8000-000000000001'$q$);
  if (r->>'n')::int <> 1 then raise exception 'non visibile all''operaio nelle ore'; end if;
  r := pg_temp.come(comp, $q$select jsonb_build_object('n', count(*)) from public.rapportini where cliente_id = '7c000000-0000-4000-8000-000000000001' and stato = 'completato'$q$);
  if (r->>'n')::int <> 1 then raise exception 'non nello storico del cliente'; end if;
  if (select count(*) from public.rapportino_operai where rapportino_id = '7d000000-0000-4000-8000-000000000001') <> 2 then raise exception 'ore non salvate'; end if;
  -- se il bot fosse collegato a un utente che non compila rapportini (company): rifiutato
  if not pg_temp.negato(comp, 'select public.salva_rapportino(' || replace(corpo, '7d000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000002') || ')') then
    raise exception 'company crea rapportini';
  end if;
  -- eliminazione dal bot (stessa regola dell'app): l'operaio non elimina un completato, l'amministratore si'
  r := pg_temp.come(mario, $q$with d as (delete from public.rapportini where id = '7d000000-0000-4000-8000-000000000001' returning id) select jsonb_build_object('n', count(*)) from d$q$);
  if (r->>'n')::int <> 0 then raise exception 'operaio elimina un completato'; end if;
  r := pg_temp.come(luca, $q$with d as (delete from public.rapportini where id = '7d000000-0000-4000-8000-000000000001' returning id) select jsonb_build_object('n', count(*)) from d$q$);
  if (r->>'n')::int <> 1 then raise exception 'amministratore non elimina'; end if;
  if (select count(*) from public.rapportino_operai where rapportino_id = '7d000000-0000-4000-8000-000000000001') <> 0 then raise exception 'ore rimaste'; end if;
end $$;
select 'telegram: tutti i controlli superati';
