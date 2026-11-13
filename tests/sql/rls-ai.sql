-- L'assistente AI legge i dati con il token dell'utente: valgono le policy RLS esistenti.
-- Qui si verifica che ogni ruolo veda solo cio' che gli spetta (stesse letture della Edge Function).
\set ON_ERROR_STOP 1
\o /dev/null
insert into auth.users (id) values ('a0000000-0000-4000-8000-000000000001'),('a0000000-0000-4000-8000-000000000002'),('a0000000-0000-4000-8000-000000000003'),('a0000000-0000-4000-8000-000000000004');
insert into public.profili (id, username, nome, ruolo, deve_cambiare_password) values
 ('a0000000-0000-4000-8000-000000000001','luca','Luca','admin',false),
 ('a0000000-0000-4000-8000-000000000002','mario','Mario','worker',false),
 ('a0000000-0000-4000-8000-000000000003','anna','Anna','worker',false),
 ('a0000000-0000-4000-8000-000000000004','comphas','Comphas','company',false);
select set_config('test.uid','a0000000-0000-4000-8000-000000000002', false);
insert into public.rapportini (autore_id, data, cliente, attivita) values ('a0000000-0000-4000-8000-000000000002','2026-11-01','Cliente di Mario','x');
select set_config('test.uid','a0000000-0000-4000-8000-000000000003', false);
insert into public.rapportini (autore_id, data, cliente, attivita) values ('a0000000-0000-4000-8000-000000000003','2026-11-02','Cliente di Anna','y');
insert into public.interventi (data, cliente, creato_da) values ('2026-11-03', 'Intervento non assegnato', 'a0000000-0000-4000-8000-000000000001');
\o
create or replace function pg_temp.vede(p_uid text, p_tabella text) returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute format('select count(*) from public.%I', p_tabella) into n;
  reset role;
  return n;
end $$;
do $$
declare mario text := 'a0000000-0000-4000-8000-000000000002'; anna text := 'a0000000-0000-4000-8000-000000000003';
        luca text := 'a0000000-0000-4000-8000-000000000001'; comp text := 'a0000000-0000-4000-8000-000000000004';
begin
  if pg_temp.vede(mario, 'rapportini') <> 1 then raise exception 'operaio: deve vedere solo il proprio rapportino'; end if;
  if pg_temp.vede(anna, 'rapportini') <> 1 then raise exception 'operaio: deve vedere solo il proprio rapportino'; end if;
  if pg_temp.vede(mario, 'interventi') <> 0 then raise exception 'operaio: non deve vedere interventi non assegnati'; end if;
  if pg_temp.vede(comp, 'rapportini') <> 2 or pg_temp.vede(luca, 'rapportini') <> 2 then raise exception 'admin e company devono vedere tutti i rapportini'; end if;
  if pg_temp.vede(comp, 'interventi') <> 1 then raise exception 'company deve vedere gli interventi'; end if;
  if pg_temp.vede('', 'rapportini') <> 0 then raise exception 'senza utente nessun dato'; end if;
end $$;
-- ricerca come la fa l'assistente (filtro sul cliente): Mario non trova il cliente di Anna
do $$ declare n integer; begin
  perform set_config('test.uid', 'a0000000-0000-4000-8000-000000000002', true);
  set local role authenticated;
  select count(*) into n from public.rapportini where cliente ilike '%Anna%';
  reset role;
  if n <> 0 then raise exception 'la ricerca di un operaio non deve trovare rapportini altrui'; end if;
end $$;
select 'rls-ai: ok' as esito;
