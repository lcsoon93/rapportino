-- =====================================================================
-- Fase G: nome e cognome, piu' ruoli per utente (admin + operaio), accesso con PIN.
-- Migrazione incrementale (richiede 20261107120000 ... 20261111090000). Non cancella nulla:
-- account, UUID, giornate, interventi e rapportini restano identici.
--
-- 1. profili.cognome: il nome completo mostrato nell'app e' "nome cognome". Gli account esistenti
--    hanno gia' nome e cognome nel campo "nome": cognome resta vuoto e il nome mostrato non cambia.
-- 2. profili.ruoli: elenco dei ruoli. "ruolo" resta il ruolo PRINCIPALE (decide menu e permessi
--    amministrativi, come prima). Combinazioni ammesse: {admin}, {admin,worker}, {company}, {worker}.
--    "worker" nell'elenco = lavora sul campo: compare tra gli operai, si puo' assegnare agli
--    interventi e indicare nelle ore. Finora ogni admin era trattato cosi' d'ufficio: per non cambiare
--    nulla, agli admin esistenti si aggiunge "worker" (Luca resta assegnabile e compila come prima).
-- 3. nomi_utenti(): nome leggibile degli utenti che compaiono nei dati visibili (anche disattivati),
--    cosi' l'app non mostra mai "—" o identificativi al posto dei nomi.
-- 5. Recupero dell'accesso (PIN e password dimenticati): l'admin reimposta la password; la password
--    temporanea scade dopo 72 ore se non viene cambiata, il PIN viene eliminato, le sessioni aperte
--    non si rinnovano piu'. Restano data e autore del reset (profili.password_reimpostata_*).
-- 4. PIN di 6 cifre: tabella pin_accesso leggibile SOLO dal server (service_role, Edge Functions).
--    Il PIN non e' mai salvato in chiaro: c'e' solo l'impronta PBKDF2 calcolata dalla Edge Function.
--    Tentativi: al massimo 5 di fila, poi blocco di 15 minuti; dopo 10 errori consecutivi il PIN
--    viene eliminato (si rientra con la password). Limite aggiuntivo per indirizzo di rete
--    (impronta dell'IP, mai l'IP in chiaro).
-- Policy RLS esistenti: invariate. Nessun permesso nuovo al ruolo anon.
-- =====================================================================

-- ---------------------------------------------------------------- 1-2. profili
alter table public.profili
  add column if not exists cognome text not null default '',
  add column if not exists ruoli text[],
  -- recupero dell'accesso: la password temporanea data dall'admin scade (null = nessuna scadenza,
  -- es. account esistenti); chi e quando ha reimpostato la password. Colonne non leggibili dal browser.
  add column if not exists password_temporanea_scade timestamptz,
  add column if not exists password_reimpostata_il timestamptz,
  add column if not exists password_reimpostata_da uuid references auth.users(id) on delete set null;
alter table public.profili drop constraint if exists profili_cognome_lunghezza;
alter table public.profili add constraint profili_cognome_lunghezza check (length(cognome) <= 80);

update public.profili set ruoli = case when ruolo = 'admin' then array['admin', 'worker'] else array[ruolo] end
  where ruoli is null;

-- chi inserisce un profilo senza ruoli (es. una Edge Function non ancora aggiornata) ottiene il solo ruolo principale
create or replace function public.profili_ruoli_predefiniti() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.ruoli is null then new.ruoli := array[new.ruolo]; end if;
  return new;
end $$;
revoke execute on function public.profili_ruoli_predefiniti() from public, anon, authenticated;
drop trigger if exists profili_ruoli on public.profili;
create trigger profili_ruoli before insert or update on public.profili
  for each row execute function public.profili_ruoli_predefiniti();

alter table public.profili alter column ruoli set not null;
alter table public.profili drop constraint if exists profili_ruoli_validi;
alter table public.profili add constraint profili_ruoli_validi check (
  ruoli = array[ruolo] or (ruolo = 'admin' and ruoli = array['admin', 'worker'])
);
-- lettura del proprio profilo (e, per l'admin, di tutti) anche per i campi nuovi: stesse policy di prima
grant select (cognome, ruoli) on public.profili to authenticated;

-- l'utente collegato (attivo) ha questo ruolo?
create or replace function public.ha_ruolo(p_ruolo text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p_ruolo = any (p.ruoli) from public.profili p where p.id = auth.uid() and p.attivo), false)
$$;
revoke execute on function public.ha_ruolo(text) from public, anon;
grant execute on function public.ha_ruolo(text) to authenticated;

-- l'account indicato e' attivo e lavora sul campo (ruolo worker, anche insieme ad admin)?
create or replace function public.lavora_sul_campo(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profili p where p.id = p_id and p.attivo and 'worker' = any (p.ruoli))
$$;
revoke execute on function public.lavora_sul_campo(uuid) from public, anon, authenticated;

-- assegnazione: stessa funzione della Fase B, cambia solo il controllo "lavora sul campo"
create or replace function public.controlla_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    -- il controllo RLS dell'inserimento non scatterebbe se la riga viene riattivata: si ripete qui
    if not public.pianifica() then
      raise exception 'Operazione non consentita' using errcode = '42501';
    end if;
    -- si assegnano solo account attivi che lavorano sul campo
    if not public.lavora_sul_campo(new.operaio_id) then
      raise exception 'Si possono assegnare solo operai attivi' using errcode = '42501';
    end if;
    if exists (select 1 from public.intervento_operai a where a.intervento_id = new.intervento_id and a.operaio_id = new.operaio_id) then
      update public.intervento_operai set rimosso_il = null, rimosso_da = null, assegnato_da = auth.uid(), assegnato_il = now()
        where intervento_id = new.intervento_id and operaio_id = new.operaio_id and rimosso_il is not null;
      return null;
    end if;
    new.assegnato_da := auth.uid();
    new.assegnato_il := now();
    new.rimosso_il := null;
    new.rimosso_da := null;
    return new;
  end if;
  -- UPDATE: chiave invariata
  new.intervento_id := old.intervento_id;
  new.operaio_id := old.operaio_id;
  return new;
end $$;

-- ore dei rapportini: solo per account attivi che lavorano sul campo
create or replace function public.controlla_ore_operaio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.lavora_sul_campo(new.operaio_id) then
    raise exception 'Operaio non valido' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.controlla_assegnazione(), public.controlla_ore_operaio() from public, anon, authenticated;

-- elenchi degli operai: stessa firma di prima, "nome" e' ora il nome completo
create or replace function public.operai_attivi() returns table (id uuid, username text, nome text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, btrim(p.nome || ' ' || p.cognome) from public.profili p
  where p.attivo and 'worker' = any (p.ruoli) and public.mio_ruolo() is not null
  order by lower(btrim(p.nome || ' ' || p.cognome)), lower(p.username)
$$;
create or replace function public.operai_assegnabili() returns table (id uuid, username text, nome text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, btrim(p.nome || ' ' || p.cognome) from public.profili p
  where p.attivo and 'worker' = any (p.ruoli) and public.mio_ruolo() in ('admin', 'company')
  order by lower(btrim(p.nome || ' ' || p.cognome)), lower(p.username)
$$;
revoke execute on function public.operai_attivi(), public.operai_assegnabili() from public, anon;
grant execute on function public.operai_attivi(), public.operai_assegnabili() to authenticated;

-- ---------------------------------------------------------------- 3. nomi leggibili
-- admin e company: tutti gli utenti (anche disattivati). Operaio: se stesso, gli operai attivi e chi
-- compare negli interventi e nei rapportini che puo' gia' vedere. Solo id, username e nome completo.
create or replace function public.nomi_utenti() returns table (id uuid, username text, nome text, attivo boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, coalesce(nullif(btrim(p.nome || ' ' || p.cognome), ''), p.username), p.attivo
  from public.profili p
  where public.mio_ruolo() is not null and (
    public.pianifica()
    or p.id = auth.uid()
    or (p.attivo and 'worker' = any (p.ruoli))
    or exists (select 1 from public.intervento_operai a where a.operaio_id = p.id and public.assegnato_a(a.intervento_id))
    or exists (select 1 from public.rapportini r where r.autore_id = p.id and public.vede_rapportino(r.id))
    or exists (select 1 from public.rapportino_operai o where o.operaio_id = p.id and public.vede_rapportino(o.rapportino_id))
  )
$$;
revoke execute on function public.nomi_utenti() from public, anon;
grant execute on function public.nomi_utenti() to authenticated;

-- ---------------------------------------------------------------- 4. PIN
create table if not exists public.pin_accesso (
  utente_id uuid primary key references public.profili(id) on delete cascade,
  impronta text not null,                       -- pbkdf2-sha256$iterazioni$sale$impronta (mai il PIN)
  tentativi integer not null default 0,         -- tentativi in corso nella finestra attuale
  errori_consecutivi integer not null default 0,
  bloccato_fino timestamptz,
  aggiornato_il timestamptz not null default now()
);
alter table public.pin_accesso enable row level security;
-- nessuna policy e nessun permesso: dal browser la tabella non esiste
revoke all on public.pin_accesso from public, anon, authenticated;

create table if not exists public.tentativi_accesso (
  chiave text not null,                         -- impronta SHA-256 dell'indirizzo di rete
  momento timestamptz not null default now()
);
create index if not exists tentativi_accesso_chiave on public.tentativi_accesso (chiave, momento);
alter table public.tentativi_accesso enable row level security;
revoke all on public.tentativi_accesso from public, anon, authenticated;

-- Prenota un tentativo di verifica del PIN (atomico: anche con richieste in parallelo non si superano
-- i 5 tentativi). Restituisce l'impronta da verificare, oppure i secondi di attesa se bloccato.
create or replace function public.pin_prenota(p_utente uuid)
returns table (impronta text, attesa integer) language plpgsql set search_path = '' as $$
declare
  r public.pin_accesso%rowtype;
begin
  update public.pin_accesso set tentativi = tentativi + 1
    where utente_id = p_utente and tentativi < 5 and (bloccato_fino is null or bloccato_fino <= now())
    returning * into r;
  if found then
    if r.bloccato_fino is not null then
      update public.pin_accesso set bloccato_fino = null where utente_id = p_utente;
    end if;
    return query select r.impronta, 0;
    return;
  end if;
  select * into r from public.pin_accesso where utente_id = p_utente for update;
  if not found then return; end if;                            -- nessun PIN: nessuna riga
  if r.bloccato_fino is null or r.bloccato_fino <= now() then
    -- 5 tentativi gia' in corso (richieste in parallelo o interrotte): si blocca come dopo 5 errori
    update public.pin_accesso set tentativi = 0, bloccato_fino = now() + interval '15 minutes'
      where utente_id = p_utente returning * into r;
  end if;
  return query select null::text, greatest(1, ceil(extract(epoch from (r.bloccato_fino - now())))::integer);
end $$;

-- Esito della verifica prenotata. Errore: al 5o tentativo blocco di 15 minuti; al 10o errore
-- consecutivo il PIN viene eliminato. Esatto: contatori azzerati.
-- Restituisce 'ok', 'errato', 'bloccato' o 'eliminato'.
create or replace function public.pin_esito(p_utente uuid, p_corretto boolean)
returns text language plpgsql set search_path = '' as $$
declare
  r public.pin_accesso%rowtype;
begin
  if p_corretto then
    update public.pin_accesso set tentativi = 0, errori_consecutivi = 0, bloccato_fino = null where utente_id = p_utente;
    return 'ok';
  end if;
  update public.pin_accesso set errori_consecutivi = errori_consecutivi + 1 where utente_id = p_utente returning * into r;
  if not found then return 'eliminato'; end if;
  if r.errori_consecutivi >= 10 then
    delete from public.pin_accesso where utente_id = p_utente;
    return 'eliminato';
  end if;
  if r.tentativi >= 5 then
    update public.pin_accesso set tentativi = 0, bloccato_fino = now() + interval '15 minutes' where utente_id = p_utente;
    return 'bloccato';
  end if;
  return 'errato';
end $$;

-- Limite per indirizzo di rete: registra il tentativo e dice se e' entro il limite
-- (p_massimo tentativi in p_secondi). Le righe vecchie si cancellano qui.
create or replace function public.limite_tentativi(p_chiave text, p_massimo integer, p_secondi integer)
returns boolean language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  delete from public.tentativi_accesso where momento < now() - interval '1 day';
  perform pg_advisory_xact_lock(hashtext('limite:' || p_chiave));
  select count(*) into n from public.tentativi_accesso
    where chiave = p_chiave and momento > now() - make_interval(secs => p_secondi);
  if n >= p_massimo then return false; end if;
  insert into public.tentativi_accesso (chiave) values (p_chiave);
  return true;
end $$;

revoke execute on function public.pin_prenota(uuid), public.pin_esito(uuid, boolean),
  public.limite_tentativi(text, integer, integer) from public, anon, authenticated;
grant execute on function public.pin_prenota(uuid), public.pin_esito(uuid, boolean),
  public.limite_tentativi(text, integer, integer) to service_role;
