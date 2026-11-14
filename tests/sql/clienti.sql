-- Anagrafica clienti (migrazione 20261116090000): omonimi, ID, RLS, sincronizzazione, snapshot nei
-- documenti, compatibilita' con i dati esistenti. Ogni controllo fallito interrompe lo script.
\set ON_ERROR_STOP 1
\o /dev/null
-- utenti: admin, due operai, company e un operaio disattivato
insert into auth.users (id) values ('c0000000-0000-4000-8000-000000000001'),('c0000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000003'),('c0000000-0000-4000-8000-000000000004'),('c0000000-0000-4000-8000-000000000005');
insert into public.profili (id, username, nome, ruolo, deve_cambiare_password, attivo) values
 ('c0000000-0000-4000-8000-000000000001','admin1','Admin','admin',false,true),
 ('c0000000-0000-4000-8000-000000000002','mario1','Mario','worker',false,true),
 ('c0000000-0000-4000-8000-000000000003','anna1','Anna','worker',false,true),
 ('c0000000-0000-4000-8000-000000000004','comp1','Comp','company',false,true),
 ('c0000000-0000-4000-8000-000000000005','ex1','Ex','worker',false,false);
-- documenti GIA' esistenti prima dell'anagrafica (compatibilita')
select set_config('test.uid','c0000000-0000-4000-8000-000000000002', false);
insert into public.rapportini (id, autore_id, data, cliente, indirizzo, attivita)
  values ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','2026-10-01','Vecchio Cliente','Via Antica 1','x');
select set_config('test.uid','c0000000-0000-4000-8000-000000000001', false);
insert into public.interventi (id, data, cliente, indirizzo, creato_da)
  values ('e0000000-0000-4000-8000-000000000001','2026-10-02','Vecchio Cliente','Via Antica 1','c0000000-0000-4000-8000-000000000001');
\o

-- esegue una query come un utente (ruolo authenticated + auth.uid())
create or replace function pg_temp.come(p_uid text, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;
-- true se la query come utente fallisce per permessi
create or replace function pg_temp.negato(p_uid text, p_sql text) returns boolean language plpgsql as $$
begin
  perform pg_temp.come(p_uid, p_sql);
  return false;
exception when insufficient_privilege or check_violation then
  reset role; return true;
end $$;

do $$
declare
  admin text := 'c0000000-0000-4000-8000-000000000001'; mario text := 'c0000000-0000-4000-8000-000000000002';
  anna text := 'c0000000-0000-4000-8000-000000000003'; comp text := 'c0000000-0000-4000-8000-000000000004';
  ex text := 'c0000000-0000-4000-8000-000000000005';
  r jsonb; n integer; id1 uuid := 'f0000000-0000-4000-8000-000000000001'; id2 uuid := 'f0000000-0000-4000-8000-000000000002';
  id3 uuid := 'f0000000-0000-4000-8000-000000000003'; id4 uuid := 'f0000000-0000-4000-8000-000000000004';
begin
  -- 1) nomi diversi; 2) stesso nome, indirizzi diversi; 3) stesso nome e stesso indirizzo: schede distinte
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","nome":"Bianchi Srl","indirizzo":"Via Po 1","telefono":"011111"}')$q$, id4));
  if r->>'esito' <> 'ok' then raise exception '1: creazione fallita %', r; end if;
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","nome":"Mario Rossi","indirizzo":"Via Roma 10, Milano","telefono":"3331234567"}')$q$, id1));
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","nome":"Mario Rossi","indirizzo":"Via Verdi 25, Monza"}')$q$, id2));
  r := pg_temp.come(admin, format($q$select public.salva_cliente('{"id":"%s","nome":"Mario Rossi","indirizzo":"Via Verdi 25, Monza"}')$q$, id3));
  if r->>'esito' <> 'ok' then raise exception '3: omonimo con stesso indirizzo rifiutato %', r; end if;
  select count(*) into n from public.clienti where nome = 'Mario Rossi';
  if n <> 3 then raise exception '2/3: attesi 3 Mario Rossi, trovati %', n; end if;
  -- nessun indice univoco su nome/indirizzo
  if exists (select 1 from pg_indexes where tablename = 'clienti' and indexdef ilike '%unique%' and indexdef not ilike '%(id)%') then
    raise exception 'esiste un indice univoco oltre all''id';
  end if;

  -- sincronizzazione: stessa creazione inviata due volte = nessun doppione, esito conflitto con la copia del server
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","nome":"Mario Rossi","indirizzo":"Via Roma 10, Milano"}')$q$, id1));
  if r->>'esito' <> 'conflitto' or (r->'cliente'->>'telefono') <> '3331234567' then raise exception 'creazione ripetuta: %', r; end if;
  select count(*) into n from public.clienti where id = id1;
  if n <> 1 then raise exception 'doppione creato'; end if;
  -- modifica con versione giusta, poi con versione superata (conflitto, niente sovrascritto)
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","telefono":"3330000000"}', 1)$q$, id1));
  if r->>'esito' <> 'ok' or (r->'cliente'->>'versione')::int <> 2 then raise exception 'modifica: %', r; end if;
  r := pg_temp.come(admin, format($q$select public.salva_cliente('{"id":"%s","telefono":"999"}', 1)$q$, id1));
  if r->>'esito' <> 'conflitto' or (r->'cliente'->>'telefono') <> '3330000000' then raise exception 'conflitto non rilevato: %', r; end if;
  -- la modifica non tocca le altre schede omonime
  if (select telefono from public.clienti where id = id2) <> '' then raise exception 'modificato un omonimo'; end if;

  -- permessi: l'operaio legge e crea, non modifica, non archivia, non elimina
  r := pg_temp.come(mario, 'select jsonb_build_object(''n'', count(*)) from public.clienti');
  if (r->>'n')::int <> 4 then raise exception 'operaio: lettura %', r; end if;
  r := pg_temp.come(mario, $q$select public.salva_cliente('{"id":"f0000000-0000-4000-8000-000000000009","nome":"Cliente dal cantiere"}')$q$);
  if r->>'esito' <> 'ok' or (r->'cliente'->>'creato_da') <> mario then raise exception 'operaio: creazione %', r; end if;
  if not pg_temp.negato(mario, format($q$select public.salva_cliente('{"id":"%s","telefono":"1"}', 2)$q$, id1)) then raise exception 'operaio ha modificato'; end if;
  perform pg_temp.come(mario, format('with x as (update public.clienti set archiviato = true where id = %L returning 1) select to_jsonb(count(*)) from x', id2));
  if (select archiviato from public.clienti where id = id2) then raise exception 'operaio ha archiviato'; end if;
  perform pg_temp.come(mario, format('with x as (delete from public.clienti where id = %L returning 1) select to_jsonb(count(*)) from x', id4));
  if not exists (select 1 from public.clienti where id = id4) then raise exception 'operaio ha eliminato'; end if;
  if not pg_temp.negato(mario, $q$with y as (insert into public.clienti (nome, archiviato) values ('x', true) returning 1) select to_jsonb(count(*)) from y$q$) then
    raise exception 'operaio ha creato un cliente archiviato'; end if;
  -- company archivia, non elimina
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","archiviato":true}', 1)$q$, id2));
  if not (r->'cliente'->>'archiviato')::boolean then raise exception 'archiviazione %', r; end if;
  perform pg_temp.come(comp, format('with x as (delete from public.clienti where id = %L returning 1) select to_jsonb(count(*)) from x', id4));
  if not exists (select 1 from public.clienti where id = id4) then raise exception 'company ha eliminato'; end if;
  -- utente disattivato, senza utente, anon: niente
  r := pg_temp.come(ex, 'select jsonb_build_object(''n'', count(*)) from public.clienti');
  if (r->>'n')::int <> 0 then raise exception 'utente disattivato vede clienti'; end if;
  r := pg_temp.come('', 'select jsonb_build_object(''n'', count(*)) from public.clienti');
  if (r->>'n')::int <> 0 then raise exception 'senza utente vede clienti'; end if;
  if not pg_temp.negato(ex, $q$select public.salva_cliente('{"nome":"intruso"}')$q$) then raise exception 'disattivato ha creato'; end if;

  -- documenti: cliente_id + copia (snapshot) di nome, indirizzo, telefono
  r := pg_temp.come(mario, format($q$select public.salva_rapportino('{"id":"d0000000-0000-4000-8000-000000000002","data":"2026-11-10","cliente":"Mario Rossi","indirizzo":"Via Roma 10, Milano","telefono":"3330000000","cliente_id":"%s"}', '[]')$q$, id1));
  if r->>'esito' <> 'ok' or (r->'rapportino'->>'cliente_id') <> id1::text or (r->'rapportino'->>'telefono') <> '3330000000' then raise exception 'rapportino: %', r; end if;
  -- cliente inesistente (creato offline e non ancora arrivato): il rapportino si salva lo stesso
  r := pg_temp.come(mario, $q$select public.salva_rapportino('{"id":"d0000000-0000-4000-8000-000000000003","data":"2026-11-10","cliente":"Nuovo","cliente_id":"f0000000-0000-4000-8000-0000000000aa"}', '[]')$q$);
  if r->>'esito' <> 'ok' or (r->'rapportino'->>'cliente_id') is not null then raise exception 'cliente inesistente: %', r; end if;
  r := pg_temp.come(comp, format($q$with x as (insert into public.interventi (data, cliente, indirizzo, telefono, cliente_id) values ('2026-11-11','Mario Rossi','Via Roma 10, Milano','3330000000',%L) returning id, telefono, cliente_id) select to_jsonb(x) from x$q$, id1));
  if r->>'telefono' <> '3330000000' then raise exception 'intervento: %', r; end if;
  -- 9) modifica dell'anagrafica: i documenti non cambiano
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","telefono":"3400000000","indirizzo":"Via Nuova 1"}', 2)$q$, id1));
  if (select telefono from public.rapportini where id = 'd0000000-0000-4000-8000-000000000002') <> '3330000000'
     or (select indirizzo from public.rapportini where id = 'd0000000-0000-4000-8000-000000000002') <> 'Via Roma 10, Milano'
     or (select telefono from public.interventi where cliente_id = id1) <> '3330000000' then
    raise exception 'la modifica dell''anagrafica ha cambiato un documento'; end if;
  -- 8) modifica del documento: l'anagrafica non cambia
  r := pg_temp.come(mario, $q$select public.salva_rapportino('{"id":"d0000000-0000-4000-8000-000000000002","versione":1,"data":"2026-11-10","cliente":"Mario Rossi","indirizzo":"Cantiere B","telefono":"0000","cliente_id":"f0000000-0000-4000-8000-000000000001"}', '[]')$q$);
  if (select telefono from public.clienti where id = id1) <> '3400000000' then raise exception 'la modifica del documento ha cambiato l''anagrafica'; end if;
  -- un cliente con documenti non si elimina (si archivia); senza documenti si' (solo admin)
  if not exists (select 1 from public.clienti where id = id1) then raise exception 'sparito'; end if;
  begin
    perform pg_temp.come(admin, format('with x as (delete from public.clienti where id = %L returning 1) select to_jsonb(count(*)) from x', id1));
    raise exception 'eliminato un cliente con documenti';
  exception when foreign_key_violation then reset role;
  end;
  perform pg_temp.come(admin, format('with x as (delete from public.clienti where id = %L returning 1) select to_jsonb(count(*)) from x', id4));
  if exists (select 1 from public.clienti where id = id4) then raise exception 'admin non riesce a eliminare un cliente senza documenti'; end if;

  -- 12) compatibilita': i documenti di prima restano uguali e senza collegamento
  if (select cliente_id from public.rapportini where id = 'd0000000-0000-4000-8000-000000000001') is not null
     or (select telefono from public.rapportini where id = 'd0000000-0000-4000-8000-000000000001') <> ''
     or (select cliente from public.interventi where id = 'e0000000-0000-4000-8000-000000000001') <> 'Vecchio Cliente' then
    raise exception 'dati esistenti modificati'; end if;
  -- e un rapportino salvato come prima (senza i campi nuovi) funziona
  r := pg_temp.come(mario, $q$select public.salva_rapportino('{"id":"d0000000-0000-4000-8000-000000000001","versione":1,"data":"2026-10-01","cliente":"Vecchio Cliente","indirizzo":"Via Antica 1","attivita":"x"}', '[]')$q$);
  if r->>'esito' <> 'ok' then raise exception 'salvataggio come prima: %', r; end if;

  -- autore e versione decisi dal database
  if (select creato_da::text from public.clienti where id = id2) <> comp then raise exception 'creato_da non imposto'; end if;
end $$;
select 'clienti: ok' as esito;
