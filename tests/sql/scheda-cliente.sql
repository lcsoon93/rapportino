-- Scheda cliente evoluta (migrazione 20261128090000): campi nuovi dell'anagrafica, compatibilita' con
-- le schede e le chiamate gia' esistenti, impianti e documenti con RLS per ruolo, Storage.
-- Ogni controllo fallito interrompe lo script. Database locale usa e getta (tests/sql/esegui.sh).
\set ON_ERROR_STOP 1
\o /dev/null
insert into auth.users (id) values ('a1000000-0000-4000-8000-000000000001'),('a1000000-0000-4000-8000-000000000002'),
  ('a1000000-0000-4000-8000-000000000003'),('a1000000-0000-4000-8000-000000000004'),('a1000000-0000-4000-8000-000000000005');
insert into public.profili (id, username, nome, ruolo, deve_cambiare_password, attivo) values
 ('a1000000-0000-4000-8000-000000000001','sc_admin','Admin','admin',false,true),
 ('a1000000-0000-4000-8000-000000000002','sc_mario','Mario','worker',false,true),
 ('a1000000-0000-4000-8000-000000000003','sc_anna','Anna','worker',false,true),
 ('a1000000-0000-4000-8000-000000000004','sc_comp','Comp','company',false,true),
 ('a1000000-0000-4000-8000-000000000005','sc_ex','Ex','worker',false,false);
-- lo stub di Storage non ha metadati ne' RLS: come su Supabase
alter table storage.objects add column if not exists metadata jsonb;
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
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
exception when insufficient_privilege or check_violation or raise_exception or no_data_found or foreign_key_violation then
  reset role; return true;
end $$;

do $$
declare
  admin text := 'a1000000-0000-4000-8000-000000000001'; mario text := 'a1000000-0000-4000-8000-000000000002';
  anna text := 'a1000000-0000-4000-8000-000000000003'; comp text := 'a1000000-0000-4000-8000-000000000004';
  ex text := 'a1000000-0000-4000-8000-000000000005';
  cli uuid := 'b1000000-0000-4000-8000-000000000001'; vecchio uuid := 'b1000000-0000-4000-8000-000000000002';
  imp1 uuid := 'b2000000-0000-4000-8000-000000000001'; imp2 uuid := 'b2000000-0000-4000-8000-000000000002';
  doc1 uuid := 'b3000000-0000-4000-8000-000000000001'; doc2 uuid := 'b3000000-0000-4000-8000-000000000002';
  r jsonb; n integer;
begin
  -- 1) compatibilita': una scheda salvata con i soli campi vecchi riceve i valori predefiniti
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","nome":"Cliente Vecchio","indirizzo":"Via A 1"}')$q$, vecchio));
  if r->>'esito' <> 'ok' or r->'cliente'->>'stato' <> 'attivo' or r->'cliente'->>'tipologia' <> '' or r->'cliente'->'sedi' <> '[]'::jsonb then
    raise exception '1: valori predefiniti %', r;
  end if;
  -- 2) creazione con tutti i campi nuovi (anche dall'operaio)
  r := pg_temp.come(mario, format($q$select public.salva_cliente('{"id":"%s","nome":"Condominio Aurora","tipologia":"condominio","referente":"Amm. Neri",
      "codice_fiscale":"80012345678","codice_sdi":"ABC1234","pec":"aurora@pec.it","stato":"potenziale",
      "sedi":[{"nome":"Centrale termica","indirizzo":"Via B 2"}]}')$q$, cli));
  if r->>'esito' <> 'ok' or r->'cliente'->>'stato' <> 'potenziale' or r->'cliente'->'sedi'->0->>'nome' <> 'Centrale termica' then
    raise exception '2: creazione %', r;
  end if;
  -- 3) modifica parziale (app vecchia, senza i campi nuovi): i campi nuovi restano
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","telefono":"0211"}', 1)$q$, cli));
  if r->>'esito' <> 'ok' or r->'cliente'->>'pec' <> 'aurora@pec.it' or r->'cliente'->>'stato' <> 'potenziale' or jsonb_array_length(r->'cliente'->'sedi') <> 1 then
    raise exception '3: modifica parziale %', r;
  end if;
  r := pg_temp.come(admin, format($q$select public.salva_cliente('{"id":"%s","stato":"attivo","sedi":[]}', 2)$q$, cli));
  if r->'cliente'->>'stato' <> 'attivo' or jsonb_array_length(r->'cliente'->'sedi') <> 0 then raise exception '3b: %', r; end if;
  -- 4) valori non ammessi rifiutati; l'operaio non modifica l'anagrafica
  if not pg_temp.negato(comp, format($q$select public.salva_cliente('{"id":"%s","tipologia":"altro"}', 3)$q$, cli)) then raise exception '4: tipologia non valida accettata'; end if;
  if not pg_temp.negato(comp, format($q$select public.salva_cliente('{"id":"%s","stato":"chiuso"}', 3)$q$, cli)) then raise exception '4: stato non valido accettato'; end if;
  if not pg_temp.negato(mario, format($q$select public.salva_cliente('{"id":"%s","referente":"x"}', 3)$q$, cli)) then raise exception '4: operaio modifica'; end if;
  -- 5) conflitto: versione superata, niente sovrascritto
  r := pg_temp.come(comp, format($q$select public.salva_cliente('{"id":"%s","referente":"Altro"}', 1)$q$, cli));
  if r->>'esito' <> 'conflitto' or r->'cliente'->>'referente' <> 'Amm. Neri' then raise exception '5: conflitto %', r; end if;

  -- 6) impianti: l'operaio aggiunge e corregge i propri; non quelli degli altri; company e admin si'
  r := pg_temp.come(mario, format($q$insert into public.impianti_cliente (id, cliente_id, nome, marca, modello, matricola, installato_il, garanzia_fino)
      values ('%s','%s',' Caldaia murale ','Vaillant','ecoTEC','VX123','2024-03-01','2026-03-01') returning to_jsonb(impianti_cliente.*)$q$, imp1, cli));
  if r->>'nome' <> 'Caldaia murale' or r->>'creato_da' <> mario or (r->>'versione')::int <> 1 then raise exception '6: inserimento %', r; end if;
  r := pg_temp.come(anna, format($q$insert into public.impianti_cliente (id, cliente_id, nome) values ('%s','%s','Condizionatore') returning to_jsonb(impianti_cliente.*)$q$, imp2, cli));
  r := pg_temp.come(mario, format($q$with u as (update public.impianti_cliente set note = 'ok' where id = '%s' returning 1) select jsonb_build_object('n', count(*)) from u$q$, imp1));
  if (r->>'n')::int <> 1 then raise exception '6: l''operaio non corregge il proprio impianto'; end if;
  r := pg_temp.come(mario, format($q$with u as (update public.impianti_cliente set note = 'no' where id = '%s' returning 1) select jsonb_build_object('n', count(*)) from u$q$, imp2));
  if (r->>'n')::int <> 0 then raise exception '6: l''operaio modifica l''impianto di un altro'; end if;
  r := pg_temp.come(comp, format($q$with u as (update public.impianti_cliente set posizione = 'Locale caldaia', cliente_id = '%s' where id = '%s' returning cliente_id, versione) select jsonb_agg(u) from u$q$, vecchio, imp2));
  if (r->0->>'cliente_id')::uuid <> cli or (r->0->>'versione')::int <> 2 then raise exception '6: company / cambio cliente %', r; end if;
  r := pg_temp.come(mario, format($q$with u as (delete from public.impianti_cliente where id = '%s' returning 1) select jsonb_build_object('n', count(*)) from u$q$, imp1));
  if (r->>'n')::int <> 0 then raise exception '6: l''operaio elimina un impianto'; end if;
  -- utente disattivato: non vede nulla, non aggiunge
  r := pg_temp.come(ex, 'select jsonb_build_object(''n'', count(*)) from public.impianti_cliente');
  if (r->>'n')::int <> 0 then raise exception '6: utente disattivato legge gli impianti'; end if;
  if not pg_temp.negato(ex, format($q$insert into public.impianti_cliente (cliente_id, nome) values ('%s','X')$q$, cli)) then raise exception '6: utente disattivato inserisce'; end if;

  -- 7) documenti: registrazione solo con il file nello Storage, percorso coerente, stessa dimensione
  if not pg_temp.negato(mario, format($q$insert into public.documenti_cliente (id, cliente_id, nome, percorso, mime, dimensione)
      values ('%s','%s','Libretto','%s/%s.pdf','application/pdf',1000)$q$, doc1, cli, cli, doc1)) then raise exception '7: registrato senza file'; end if;
  -- caricamento nello Storage: percorso non valido o cliente inesistente rifiutati
  if not pg_temp.negato(mario, $q$insert into storage.objects (bucket_id, name, owner, metadata) values ('documenti-clienti','x/y.pdf',null,'{}')$q$) then raise exception '7: percorso non valido accettato'; end if;
  if not pg_temp.negato(mario, $q$insert into storage.objects (bucket_id, name, owner, metadata) values ('documenti-clienti','b1000000-0000-4000-8000-0000000000ff/b3000000-0000-4000-8000-000000000009.pdf',null,'{}')$q$) then raise exception '7: cliente inesistente accettato'; end if;
  if not pg_temp.negato(ex, format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('documenti-clienti','%s/%s.pdf',null,'{"size":1000}')$q$, cli, doc1)) then raise exception '7: utente disattivato carica'; end if;
  perform pg_temp.come(mario, format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('documenti-clienti','%s/%s.pdf','%s','{"size":1000}') returning '{}'::jsonb$q$, cli, doc1, mario));
  if not pg_temp.negato(mario, format($q$insert into public.documenti_cliente (id, cliente_id, nome, percorso, mime, dimensione)
      values ('%s','%s','Libretto','%s/%s.pdf','application/pdf',999)$q$, doc1, cli, cli, doc1)) then raise exception '7: dimensione diversa accettata'; end if;
  if not pg_temp.negato(mario, format($q$insert into public.documenti_cliente (id, cliente_id, nome, percorso, mime, dimensione)
      values ('%s','%s','Libretto','%s/%s.pdf','application/pdf',1000)$q$, doc1, vecchio, cli, doc1)) then raise exception '7: percorso di un altro cliente accettato'; end if;
  if not pg_temp.negato(mario, format($q$insert into public.documenti_cliente (id, cliente_id, nome, percorso, mime, dimensione)
      values ('%s','%s','Libretto','%s/%s.pdf','text/html',1000)$q$, doc1, cli, cli, doc1)) then raise exception '7: tipo non consentito accettato'; end if;
  r := pg_temp.come(mario, format($q$insert into public.documenti_cliente (id, cliente_id, nome, percorso, mime, dimensione)
      values ('%s','%s',' Libretto caldaia ','%s/%s.pdf','application/pdf',1000) returning to_jsonb(documenti_cliente.*)$q$, doc1, cli, cli, doc1));
  if r->>'nome' <> 'Libretto caldaia' or r->>'caricato_da' <> mario then raise exception '7: registrazione %', r; end if;
  -- non si modifica; tutti gli attivi leggono; il disattivato no
  if not pg_temp.negato(admin, format($q$update public.documenti_cliente set nome = 'x' where id = '%s'$q$, doc1)) then raise exception '7: documento modificato'; end if;
  r := pg_temp.come(anna, 'select jsonb_build_object(''n'', count(*)) from public.documenti_cliente');
  if (r->>'n')::int <> 1 then raise exception '7: lettura operaio'; end if;
  r := pg_temp.come(ex, 'select jsonb_build_object(''n'', count(*)) from public.documenti_cliente');
  if (r->>'n')::int <> 0 then raise exception '7: lettura utente disattivato'; end if;
  r := pg_temp.come(ex, $q$select jsonb_build_object('n', count(*)) from storage.objects where bucket_id = 'documenti-clienti'$q$);
  if (r->>'n')::int <> 0 then raise exception '7: file letti dall''utente disattivato'; end if;
  -- eliminazione: un altro operaio no, company si'
  r := pg_temp.come(anna, format($q$with u as (delete from public.documenti_cliente where id = '%s' returning 1) select jsonb_build_object('n', count(*)) from u$q$, doc1));
  if (r->>'n')::int <> 0 then raise exception '7: un altro operaio elimina il documento'; end if;
  r := pg_temp.come(anna, format($q$with u as (delete from storage.objects where name = '%s/%s.pdf' returning 1) select jsonb_build_object('n', count(*)) from u$q$, cli, doc1));
  if (r->>'n')::int <> 0 then raise exception '7: un altro operaio elimina il file'; end if;

  -- 8) un cliente con impianti o documenti non si elimina (si archivia)
  if not pg_temp.negato(admin, format($q$delete from public.clienti where id = '%s'$q$, cli)) then raise exception '8: cliente con impianti eliminato'; end if;
  r := pg_temp.come(comp, format($q$with u as (delete from public.documenti_cliente where id = '%s' returning 1) select jsonb_build_object('n', count(*)) from u$q$, doc1));
  if (r->>'n')::int <> 1 then raise exception '8: company non elimina il documento'; end if;
  r := pg_temp.come(admin, format($q$with u as (delete from public.impianti_cliente where cliente_id = '%s' returning 1) select jsonb_build_object('n', count(*)) from u$q$, cli));
  if (r->>'n')::int <> 2 then raise exception '8: admin non elimina gli impianti'; end if;
  r := pg_temp.come(admin, format($q$with u as (delete from public.clienti where id = '%s' returning 1) select jsonb_build_object('n', count(*)) from u$q$, cli));
  if (r->>'n')::int <> 1 then raise exception '8: cliente senza documenti non eliminato'; end if;
end $$;
select 'scheda cliente: tutti i controlli superati';
