-- Annulla 20261128090000_scheda_cliente.
-- ATTENZIONE: elimina impianti e documenti dei clienti (righe e file del bucket "documenti-clienti")
-- e i campi nuovi delle schede (tipologia, referente, codice fiscale, SDI, PEC, stato, sedi).
-- Fare prima un backup:
--   create table backup.impianti_cliente as table public.impianti_cliente;
--   create table backup.documenti_cliente as table public.documenti_cliente;
--   create table backup.clienti_scheda as select id, tipologia, referente, codice_fiscale, codice_sdi, pec, stato, sedi from public.clienti;
-- e scaricare i file del bucket "documenti-clienti" dal pannello Storage.
drop policy if exists documenti_clienti_lettura on storage.objects;
drop policy if exists documenti_clienti_caricamento on storage.objects;
drop policy if exists documenti_clienti_cancellazione on storage.objects;
drop table if exists public.documenti_cliente;
drop function if exists public.controlla_documento_cliente();
drop function if exists public.cliente_del_percorso(text);
delete from storage.objects where bucket_id = 'documenti-clienti';
delete from storage.buckets where id = 'documenti-clienti';
drop table if exists public.impianti_cliente;
drop function if exists public.controlla_impianto();
alter table public.clienti drop constraint if exists clienti_campi_scheda;
alter table public.clienti drop column if exists tipologia, drop column if exists referente, drop column if exists codice_fiscale,
  drop column if exists codice_sdi, drop column if exists pec, drop column if exists stato, drop column if exists sedi;
-- salva_cliente com'era in 20261116090000_anagrafica_clienti.sql
create or replace function public.salva_cliente(p_cliente jsonb, p_versione integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.clienti%rowtype;
  v_id uuid := coalesce(nullif(p_cliente->>'id', '')::uuid, gen_random_uuid());
begin
  if p_versione is null then
    -- creazione idempotente: lo stesso id inviato di nuovo (risposta persa) non crea un doppione
    insert into public.clienti (id, nome, indirizzo, telefono, email, partita_iva, note)
    values (v_id, coalesce(p_cliente->>'nome', ''), coalesce(p_cliente->>'indirizzo', ''), coalesce(p_cliente->>'telefono', ''),
            coalesce(p_cliente->>'email', ''), coalesce(p_cliente->>'partita_iva', ''), coalesce(p_cliente->>'note', ''))
    on conflict (id) do nothing
    returning * into c;
    if found then return jsonb_build_object('esito', 'ok', 'cliente', to_jsonb(c)); end if;
  else
    -- modifica: solo admin e company (senza questo controllo RLS la ignorerebbe in silenzio)
    if not public.pianifica() then
      raise exception 'Solo amministratore e company possono modificare l''anagrafica' using errcode = '42501';
    end if;
    update public.clienti set
      nome = coalesce(p_cliente->>'nome', nome), indirizzo = coalesce(p_cliente->>'indirizzo', indirizzo),
      telefono = coalesce(p_cliente->>'telefono', telefono), email = coalesce(p_cliente->>'email', email),
      partita_iva = coalesce(p_cliente->>'partita_iva', partita_iva), note = coalesce(p_cliente->>'note', note),
      archiviato = coalesce((p_cliente->>'archiviato')::boolean, archiviato)
    where id = v_id and versione = p_versione
    returning * into c;
    if found then return jsonb_build_object('esito', 'ok', 'cliente', to_jsonb(c)); end if;
  end if;
  -- gia' esistente (creazione ripetuta) o versione superata: si restituisce la copia del server
  select * into c from public.clienti where id = v_id;
  if not found then
    raise exception 'Cliente non trovato o non modificabile' using errcode = '42501';
  end if;
  return jsonb_build_object('esito', 'conflitto', 'cliente', to_jsonb(c));
end $$;
revoke execute on function public.salva_cliente(jsonb, integer) from public, anon;
grant execute on function public.salva_cliente(jsonb, integer) to authenticated;
