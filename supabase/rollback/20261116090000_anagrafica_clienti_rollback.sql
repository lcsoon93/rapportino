-- Annulla 20261116090000_anagrafica_clienti.
-- ATTENZIONE: elimina la tabella clienti (le schede create) e le colonne cliente_id/telefono di
-- interventi e rapportini (i telefoni scritti nei documenti). Fare prima un backup:
--   create table backup.clienti as table public.clienti;
--   create table backup.doc_telefoni as
--     select 'intervento' tipo, id, cliente_id, telefono from public.interventi where telefono <> '' or cliente_id is not null
--     union all select 'rapportino', id, cliente_id, telefono from public.rapportini where telefono <> '' or cliente_id is not null;
drop trigger if exists interventi_cliente_esistente on public.interventi;
drop trigger if exists rapportini_cliente_esistente on public.rapportini;
drop function if exists public.documento_cliente_esistente();
alter table public.interventi drop constraint if exists interventi_telefono_lunghezza;
alter table public.rapportini drop constraint if exists rapportini_telefono_lunghezza;
alter table public.interventi drop column if exists cliente_id, drop column if exists telefono;
alter table public.rapportini drop column if exists cliente_id, drop column if exists telefono;
drop function if exists public.salva_cliente(jsonb, integer);
drop table if exists public.clienti;
drop function if exists public.controlla_cliente();
-- salva_rapportino com'era in 20261108090000_interventi_rapportini.sql (senza cliente_id e telefono)
create or replace function public.salva_rapportino(p_rapportino jsonb, p_ore jsonb, p_completa boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.rapportini%rowtype;
  v_id uuid := coalesce(nullif(p_rapportino->>'id', '')::uuid, gen_random_uuid());
  v_versione integer := nullif(p_rapportino->>'versione', '')::integer;
  v_fatto boolean := false;
begin
  if v_versione is not null then
    -- modifica: riesce solo se la versione e' ancora quella letta (atomico anche con salvataggi contemporanei)
    update public.rapportini set
      data = (p_rapportino->>'data')::date,
      cliente = coalesce(p_rapportino->>'cliente', ''), indirizzo = coalesce(p_rapportino->>'indirizzo', ''),
      tipologia = coalesce(p_rapportino->>'tipologia', ''), attivita = coalesce(p_rapportino->>'attivita', ''),
      materiali = coalesce(p_rapportino->'materiali', '[]'::jsonb), note = coalesce(p_rapportino->>'note', ''),
      esito = coalesce(nullif(p_rapportino->>'esito', ''), 'Completato'),
      firma = coalesce(p_rapportino->>'firma', ''), firmatario = coalesce(p_rapportino->>'firmatario', '')
    where id = v_id and versione = v_versione
    returning * into r;
    v_fatto := found;
  end if;
  if not v_fatto then
    -- creazione: solo se l'id non esiste (ON CONFLICT: niente errore se un altro invio l'ha appena creato)
    if not exists (select 1 from public.rapportini where id = v_id) then
      insert into public.rapportini (id, intervento_id, data, cliente, indirizzo, tipologia, attivita, materiali, note, esito, firma, firmatario)
      values (v_id, nullif(p_rapportino->>'intervento_id', '')::uuid, (p_rapportino->>'data')::date,
              coalesce(p_rapportino->>'cliente', ''), coalesce(p_rapportino->>'indirizzo', ''), coalesce(p_rapportino->>'tipologia', ''),
              coalesce(p_rapportino->>'attivita', ''), coalesce(p_rapportino->'materiali', '[]'::jsonb), coalesce(p_rapportino->>'note', ''),
              coalesce(nullif(p_rapportino->>'esito', ''), 'Completato'), coalesce(p_rapportino->>'firma', ''), coalesce(p_rapportino->>'firmatario', ''))
      on conflict (id) do nothing
      returning * into r;
      v_fatto := found;
    end if;
  end if;
  if not v_fatto then
    -- l'id esiste gia': versione mancante o superata, oppure rapportino non dell'utente.
    -- All'autore si risponde "conflitto" anche se nel frattempo e' stato completato (cosi' l'app vede
    -- che il suo "Completa" era gia' arrivato); agli altri senza diritto di modifica: errore.
    select * into r from public.rapportini where id = v_id;
    if not found or not (public.modifica_rapportino(v_id) or r.autore_id = (select auth.uid())) then
      raise exception 'Rapportino non modificabile' using errcode = '42501';
    end if;
    return jsonb_build_object('esito', 'conflitto', 'rapportino', to_jsonb(r),
      'ore', coalesce((select jsonb_agg(jsonb_build_object('operaio_id', o.operaio_id, 'dalle', o.dalle, 'alle', o.alle) order by o.operaio_id)
                       from public.rapportino_operai o where o.rapportino_id = v_id), '[]'::jsonb));
  end if;
  delete from public.rapportino_operai where rapportino_id = r.id;
  insert into public.rapportino_operai (rapportino_id, operaio_id, dalle, alle)
    select r.id, (o->>'operaio_id')::uuid, nullif(o->>'dalle', '')::time, nullif(o->>'alle', '')::time
    from jsonb_array_elements(coalesce(p_ore, '[]'::jsonb)) o
    where nullif(o->>'operaio_id', '') is not null;
  if p_completa then
    update public.rapportini set stato = 'completato' where id = r.id returning * into r;
  end if;
  return jsonb_build_object('esito', 'ok', 'rapportino', to_jsonb(r));
end $$;
revoke execute on function public.salva_rapportino(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.salva_rapportino(jsonb, jsonb, boolean) to authenticated;
