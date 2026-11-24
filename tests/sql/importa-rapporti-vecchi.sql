-- Prova della migrazione 20261125090000 su un database locale con lo schema del repository.
-- Esecuzione: vedi tests/LEGGIMI.md (psql -v ON_ERROR_STOP=1 -f ...). Fallisce con un'eccezione se un controllo non torna.
\set QUIET on
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000c');
insert into public.profili(id, username, nome, ruolo, attivo) values
  ('00000000-0000-0000-0000-00000000000a', 'luca', 'Luca', 'admin', true),
  ('00000000-0000-0000-0000-00000000000c', 'comphas', 'COMPHAS', 'company', true);
insert into public.rapporti(data, dati, aggiornato) values
 ('2026-10-01', '{"tecnici":"Luca / Francesco","operai":[{"nome":"Luca","dalle":"08:00","alle":"17:00"},{"nome":"Francesco","dalle":"08:00","alle":"16:00"}],
   "clienti":[{"id":"c1","nome":"Alfa","indirizzo":"Via A","dettagli":"Caldaia","materiali":[{"a":"Valvola","q":"1"}],"fasce":[{"d":"08:30","a":"10:00"}],"stato":"Completato","firma":"data:image/png;base64,AAA","firmatario":"ROSSI","fatturare":"Beta Srl","importo":"120.5","foto":[{"src":"data:image/jpeg;base64,/9j/AA","w":640,"h":480},"data:image/jpeg;base64,/9j/BB"]},
              {"nome":"Gamma","dettagli":"","stato":"Da ultimare","richiesta":"Perdita","urgente":true},
              {"nome":"  ","dettagli":"vuota"}]}', '2026-10-01T18:00:00Z'),
 ('2026-10-02', '{"operai":[{"nome":"luca ","dalle":"07:00","alle":"12:00"}],"clienti":[{"nome":"Delta","dettagli":"Pulizia","importo":"abc"}]}', '2026-10-02T13:00:00Z'),
 ('2026-10-03', '{"operai":[{"nome":"Luca","dalle":"08:00","alle":"17:00"}],"clienti":[]}', '2026-10-03T18:00:00Z'),
 ('vecchia', '{"clienti":[{"nome":"Data non valida"}]}', '2026-10-03T18:00:00Z');

-- notifiche: nessuna durante l'importazione
create temp table conta_notifiche as select count(*) prima from public.notifiche_coda;

do $$
declare r record;
begin
  select * into r from public.importa_rapporti_vecchi('00000000-0000-0000-0000-00000000000a', '{"luca":"00000000-0000-0000-0000-00000000000a"}');
  if (r.giornate, r.rapportini, r.ore, r.foto, r.gia_presenti) is distinct from (2, 3, 3, 2, 0) then raise exception 'conteggi prima importazione: %', r; end if;
  -- rieseguita: nessun doppione
  select * into r from public.importa_rapporti_vecchi('00000000-0000-0000-0000-00000000000a', '{"luca":"00000000-0000-0000-0000-00000000000a"}');
  if (r.rapportini, r.ore, r.foto, r.gia_presenti) is distinct from (0, 0, 0, 3) then raise exception 'conteggi seconda importazione: %', r; end if;
end $$;

do $$
declare a record; g record; d record; n integer;
begin
  select * into a from public.rapportini where origine = 'rapporti:2026-10-01:id:c1';
  if a.cliente <> 'Alfa' or a.stato <> 'completato' or a.esito <> 'Completato' or a.attivita <> 'Caldaia' or a.firmatario <> 'ROSSI'
     or a.firma = '' or a.materiali <> '[{"a":"Valvola","q":"1"}]'::jsonb or a.autore_id <> '00000000-0000-0000-0000-00000000000a'
     or a.completato_il <> '2026-10-01T18:00:00Z' or a.intervento_id is not null then raise exception 'Alfa: %', row_to_json(a); end if;
  if a.note not like '%Fatturare a: Beta Srl%' or a.note not like '%Importo: € 120,50%' or a.note not like '%Francesco (orario della giornata 08:00–16:00)%'
     or a.note like '%Altri tecnici%Luca%' then raise exception 'note Alfa: %', a.note; end if;
  -- ore: fascia della scheda per Luca; Francesco (senza account) solo nelle note
  select count(*) into n from public.rapportino_operai where rapportino_id = a.id and operaio_id = '00000000-0000-0000-0000-00000000000a' and dalle = '08:30' and alle = '10:00';
  if n <> 1 or (select count(*) from public.rapportino_operai where rapportino_id = a.id) <> 1 then raise exception 'ore Alfa'; end if;
  if (select count(*) from public.allegati where rapportino_id = a.id and contenuto like 'data:image/jpeg%' and percorso is null) <> 2 then raise exception 'foto Alfa'; end if;
  if (select larghezza from public.allegati where rapportino_id = a.id and nome = 'foto-1.jpg') <> 640 then raise exception 'misure foto'; end if;

  select * into g from public.rapportini where origine = 'rapporti:2026-10-01:n:2';
  if g.esito <> 'Da ultimare' or g.attivita <> 'Attività non indicata nella vecchia app.' or g.note not like '%Richiesta: Perdita%' or g.note not like '%Urgente.%' then raise exception 'Gamma: %', row_to_json(g); end if;
  -- piu' schede senza fascia: presenza senza orario (nessuna ripartizione inventata)
  if (select count(*) from public.rapportino_operai where rapportino_id = g.id and dalle is null and alle is null) <> 1 then raise exception 'ore Gamma'; end if;

  select * into d from public.rapportini where origine = 'rapporti:2026-10-02:n:1';
  -- giornata con una sola scheda: orario della giornata dell'operaio; nome con spazi e maiuscole riconosciuto
  if (select count(*) from public.rapportino_operai where rapportino_id = d.id and dalle = '07:00' and alle = '12:00') <> 1 then raise exception 'ore Delta'; end if;
  if d.note like '%Importo%' or d.note like '%Altri tecnici%' then raise exception 'note Delta: %', d.note; end if;

  if exists (select 1 from public.rapportini where cliente in ('Data non valida') or btrim(cliente) = '') then raise exception 'schede da non importare'; end if;
  if (select count(*) from public.rapporti) <> 4 then raise exception 'rapporti modificata'; end if;
  if (select prima from conta_notifiche) <> (select count(*) from public.notifiche_coda) then raise exception 'notifiche inviate'; end if;
  -- il trigger delle notifiche torna attivo
  if (select tgenabled from pg_trigger where tgname = 'rapportini_notifiche') <> 'O' then raise exception 'trigger notifiche non riattivato'; end if;
end $$;

-- un operaio mappato dopo (es. Francesco con un account) si aggiunge senza doppioni
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000f');
insert into public.profili(id, username, nome, ruolo, attivo) values ('00000000-0000-0000-0000-00000000000f', 'francesco', 'Francesco', 'worker', true);
do $$
declare r record;
begin
  select * into r from public.importa_rapporti_vecchi('00000000-0000-0000-0000-00000000000a',
    '{"luca":"00000000-0000-0000-0000-00000000000a","francesco":"00000000-0000-0000-0000-00000000000f"}');
  if (r.rapportini, r.ore) is distinct from (0, 2) then raise exception 'operaio aggiunto: %', r; end if;
  if (select count(*) from public.rapportino_operai ro join public.rapportini x on x.id = ro.rapportino_id
      where x.origine = 'rapporti:2026-10-01:id:c1' and ro.operaio_id = '00000000-0000-0000-0000-00000000000f' and ro.dalle = '08:30') <> 1 then raise exception 'ore Francesco'; end if;
  -- parametri non validi: nessuna scrittura
  begin
    perform public.importa_rapporti_vecchi('00000000-0000-0000-0000-0000000000ff', '{}');
    raise exception 'autore inesistente accettato';
  exception when raise_exception then
    if sqlerrm not like 'Autore non trovato%' then raise; end if;
  end;
end $$;

-- l'app non puo' chiamarla
set role authenticated;
do $$ begin
  perform public.importa_rapporti_vecchi('00000000-0000-0000-0000-00000000000a', '{}');
  raise exception 'eseguibile da authenticated';
exception when insufficient_privilege then null; end $$;
reset role;
select 'OK: importazione verificata' esito;
