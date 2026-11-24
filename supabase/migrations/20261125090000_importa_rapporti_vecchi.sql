-- Importazione delle giornate della vecchia app (tabella "rapporti", foglio giornaliero) nei rapportini.
-- Incrementale e non distruttiva:
--   - "rapporti" non viene toccata (resta l'archivio originale; orari della giornata e report invariati);
--   - rapportini.origine (nuova colonna facoltativa) indica da quale scheda viene un rapportino importato
--     ("rapporti:AAAA-MM-GG:id:<id scheda>" oppure "...:n:<posizione>" per le schede senza id);
--   - ogni scheda cliente con nome diventa un rapportino COMPLETATO dell'autore indicato; id deterministici:
--     la funzione si puo' rieseguire (nuove giornate o nuovi operai mappati) senza creare doppioni;
--   - nessuna notifica durante l'importazione.
-- Ore: per ogni operaio della giornata presente in p_operai ({"nome in minuscolo": uuid profilo}):
--   fascia oraria della scheda, se indicata; altrimenti, se la giornata ha una sola scheda, il suo orario
--   della giornata; altrimenti nessun orario (non si inventano ripartizioni). Gli operai senza account
--   restano nelle note, con il loro orario della giornata.
-- Uso (una volta, come amministratore del database):
--   select * from public.importa_rapporti_vecchi('<uuid autore>', '{"luca": "<uuid>"}');

alter table public.rapportini add column if not exists origine text;
create unique index if not exists rapportini_origine_unica on public.rapportini (origine) where origine is not null;
comment on column public.rapportini.origine is 'Scheda della vecchia app da cui e'' stato importato (null = rapportino nato nella nuova app)';

create or replace function public.importa_rapporti_vecchi(p_autore uuid, p_operai jsonb default '{}'::jsonb)
returns table (giornate integer, rapportini integer, ore integer, foto integer, gia_presenti integer)
language plpgsql security definer set search_path = '' as $$
declare
  g record; s record; op record; f record;
  n_giornate integer := 0; n_rap integer := 0; n_ore integer := 0; n_foto integer := 0; n_gia integer := 0;
  v_origine text; v_id uuid; v_schede integer; v_note text[]; v_altri text[]; v_giornata text[];
  v_dalle time; v_alle time; v_quando timestamptz; v_src text; k integer;
  hhmm constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if not exists (select 1 from public.profili where id = p_autore) then
    raise exception 'Autore non trovato tra i profili';
  end if;
  if exists (select 1 from jsonb_each_text(coalesce(p_operai, '{}'::jsonb)) m
             where not exists (select 1 from public.profili p where p.id::text = m.value)) then
    raise exception 'Operaio indicato non trovato tra i profili';
  end if;
  alter table public.rapportini disable trigger rapportini_notifiche;

  for g in select r.data, r.dati, r.aggiornato from public.rapporti r
           where r.data ~ '^\d{4}-\d{2}-\d{2}$' order by r.data loop
    select count(*) into v_schede from jsonb_array_elements(coalesce(g.dati->'clienti', '[]'::jsonb)) c
      where coalesce(btrim(c->>'nome'), '') not in ('', '(senza nome)');
    if v_schede = 0 then continue; end if;
    n_giornate := n_giornate + 1;
    v_quando := coalesce(g.aggiornato, (g.data || ' 18:00')::timestamptz);
    -- orario della giornata di ciascun operaio (per le note)
    select coalesce(array_agg(btrim(o->>'nome') || coalesce(' ' || nullif(o->>'dalle', '') || '–' || nullif(o->>'alle', ''), '')), '{}')
      into v_giornata from jsonb_array_elements(coalesce(g.dati->'operai', '[]'::jsonb)) o where coalesce(btrim(o->>'nome'), '') <> '';
    select coalesce(array_agg(btrim(o->>'nome') || coalesce(' (orario della giornata ' || nullif(o->>'dalle', '') || '–' || nullif(o->>'alle', '') || ')', '')), '{}')
      into v_altri from jsonb_array_elements(coalesce(g.dati->'operai', '[]'::jsonb)) o
      where coalesce(btrim(o->>'nome'), '') <> '' and not (coalesce(p_operai, '{}'::jsonb) ? lower(btrim(o->>'nome')));

    for s in select c, n from jsonb_array_elements(coalesce(g.dati->'clienti', '[]'::jsonb)) with ordinality t(c, n)
             where coalesce(btrim(c->>'nome'), '') not in ('', '(senza nome)') loop
      v_origine := 'rapporti:' || g.data || ':' || case when coalesce(s.c->>'id', '') <> '' then 'id:' || (s.c->>'id') else 'n:' || s.n end;
      v_id := (md5(v_origine))::uuid;
      if exists (select 1 from public.rapportini where origine = v_origine or id = v_id) then
        n_gia := n_gia + 1;
      else
        v_note := array_remove(array[
          'Importato dalla vecchia app (foglio giornaliero del ' || to_char(g.data::date, 'DD/MM/YYYY') || ').',
          case when coalesce(btrim(s.c->>'richiesta'), '') <> '' then 'Richiesta: ' || btrim(s.c->>'richiesta') end,
          case when coalesce(btrim(s.c->>'fatturare'), '') <> '' then 'Fatturare a: ' || btrim(s.c->>'fatturare') end,
          case when coalesce(s.c->>'importo', '') ~ '^[0-9]+([.][0-9]+)?$' and (s.c->>'importo')::numeric <> 0 then 'Importo: € ' || replace(to_char((s.c->>'importo')::numeric, 'FM999999990.00'), '.', ',') end,
          case when coalesce(s.c->>'urgente', '') = 'true' then 'Urgente.' end,
          case when coalesce(array_length(v_giornata, 1), 0) > 0 then 'Orario della giornata: ' || array_to_string(v_giornata, ', ') || '.' end,
          case when coalesce(array_length(v_altri, 1), 0) > 0 then 'Altri tecnici (senza account nella nuova app): ' || array_to_string(v_altri, ', ') || '.' end
        ], null);
        insert into public.rapportini (id, origine, intervento_id, autore_id, data, cliente, indirizzo, telefono, tipologia, attivita,
            materiali, note, esito, firma, firmatario, stato, completato_il, versione, creato_il, aggiornato_il)
        values (v_id, v_origine, null, p_autore, g.data::date, left(btrim(s.c->>'nome'), 200), coalesce(s.c->>'indirizzo', ''), '',
            coalesce(s.c->>'tipologia', ''),
            coalesce(nullif(btrim(s.c->>'dettagli'), ''), 'Attività non indicata nella vecchia app.'),
            case when jsonb_typeof(s.c->'materiali') = 'array' then s.c->'materiali' else '[]'::jsonb end,
            array_to_string(v_note, E'\n'),
            case when s.c->>'stato' = 'Da ultimare' then 'Da ultimare' else 'Completato' end,
            coalesce(s.c->>'firma', ''), coalesce(s.c->>'firmatario', ''), 'completato', v_quando, 1, v_quando, v_quando);
        n_rap := n_rap + 1;
        -- foto (data URL nel documento della giornata): copiate come allegati nel database
        k := 0;
        for f in select e from jsonb_array_elements(coalesce(s.c->'foto', '[]'::jsonb)) e loop
          k := k + 1;
          v_src := case when jsonb_typeof(f.e) = 'string' then f.e #>> '{}' else f.e->>'src' end;
          if v_src like 'data:image/%' and length(v_src) <= 3000000 then
            insert into public.allegati (id, rapportino_id, tipo, nome, contenuto, larghezza, altezza, caricato_da, creato_il, mime, dimensione)
            values ((md5(v_origine || ':foto:' || k))::uuid, v_id, 'foto', 'foto-' || k || '.jpg', v_src,
              case when jsonb_typeof(f.e) = 'object' then nullif(f.e->>'w', '')::numeric::integer end,
              case when jsonb_typeof(f.e) = 'object' then nullif(f.e->>'h', '')::numeric::integer end,
              p_autore, v_quando, split_part(substr(v_src, 6), ';', 1), length(v_src))
            on conflict (id) do nothing;
            n_foto := n_foto + 1;
          end if;
        end loop;
      end if;
      -- ore degli operai con account (anche per rapportini gia' importati: un operaio mappato dopo si aggiunge)
      for op in select o from jsonb_array_elements(coalesce(g.dati->'operai', '[]'::jsonb)) o
                where coalesce(p_operai, '{}'::jsonb) ? lower(btrim(o->>'nome')) loop
        v_dalle := null; v_alle := null;
        if coalesce(s.c->'fasce'->0->>'d', '') ~ hhmm and coalesce(s.c->'fasce'->0->>'a', '') ~ hhmm then
          v_dalle := (s.c->'fasce'->0->>'d')::time; v_alle := (s.c->'fasce'->0->>'a')::time;
        elsif v_schede = 1 and coalesce(op.o->>'dalle', '') ~ hhmm and coalesce(op.o->>'alle', '') ~ hhmm then
          v_dalle := (op.o->>'dalle')::time; v_alle := (op.o->>'alle')::time;
        end if;
        if v_dalle is not null and v_alle <= v_dalle then v_dalle := null; v_alle := null; end if;   -- oltre mezzanotte: non indicato
        insert into public.rapportino_operai (rapportino_id, operaio_id, dalle, alle)
        select v_id, (p_operai->>lower(btrim(op.o->>'nome')))::uuid, v_dalle, v_alle
        where exists (select 1 from public.rapportini where id = v_id and origine = v_origine)
        on conflict (rapportino_id, operaio_id) do nothing;
        if found then n_ore := n_ore + 1; end if;
      end loop;
    end loop;
  end loop;

  alter table public.rapportini enable trigger rapportini_notifiche;
  return query select n_giornate, n_rap, n_ore, n_foto, n_gia;
end $$;

-- solo per chi amministra il database (pannello / SQL): mai dall'app
revoke all on function public.importa_rapporti_vecchi(uuid, jsonb) from public, anon, authenticated;
