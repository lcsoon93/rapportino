-- =====================================================================
-- Fase B: interventi assegnati a piu' operai (migrazione incrementale; richiede 20261108090000).
--
-- 1. Assegnazioni con storico: togliere un operaio non cancella la riga di intervento_operai ma la
--    segna "rimossa" (rimosso_il / rimosso_da). Riassegnarlo riattiva la stessa riga.
--    I rapportini, le ore e le foto non dipendono dalle assegnazioni e non vengono mai toccati.
-- 2. Stato complessivo calcolato dal database (stessi quattro stati di prima, nessuno nuovo):
--      annullato    deciso da chi pianifica (resta finche' non viene ripristinato)
--      completato   OGNI operaio assegnato (attivo) ha un proprio rapportino completato;
--                   senza operai assegnati un intervento non e' mai completato
--      in_corso     esiste almeno un rapportino (bozza o completato) collegato
--      pianificato  altrimenti
--    Il ricalcolo blocca la riga dell'intervento (SELECT ... FOR UPDATE): completamenti e modifiche
--    alle assegnazioni contemporanei vengono messi in fila e l'ultimo vede i dati dell'altro.
-- 3. Lo stato non si imposta piu' a mano: un utente puo' solo annullare o ripristinare; il valore
--    "pianificato/in_corso/completato" lo decide sempre il calcolo.
--
-- Non cambia: salva_rapportino, le policy RLS, le tabelle rapporti/profili e le 51 giornate.
-- Ripetibile: ogni istruzione si puo' rieseguire (if not exists / create or replace / drop if exists).
-- =====================================================================

-- ---------------------------------------------------------------- assegnazioni con storico
alter table public.intervento_operai add column if not exists rimosso_il timestamptz;
alter table public.intervento_operai add column if not exists rimosso_da uuid references public.profili(id);
create index if not exists intervento_operai_attivi on public.intervento_operai (intervento_id) where rimosso_il is null;

-- solo le assegnazioni attive danno accesso all'intervento (un operaio rimosso non lo vede piu';
-- i suoi rapportini restano suoi e visibili a lui come autore)
create or replace function public.assegnato_a(p_intervento uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mio_ruolo() is not null and exists (select 1 from public.intervento_operai
                 where intervento_id = p_intervento and operaio_id = auth.uid() and rimosso_il is null)
$$;

-- inserimento: un'assegnazione gia' esistente ma rimossa viene riattivata (nessun doppione, nessun errore);
-- se e' gia' attiva non succede nulla. Gli aggiornamenti arrivano solo dalle funzioni qui sotto
-- (per gli utenti non esiste una policy di UPDATE su intervento_operai).
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
    if not exists (select 1 from public.profili p where p.id = new.operaio_id and p.attivo and p.ruolo in ('worker', 'admin')) then
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

-- eliminazione da parte di un utente = rimozione logica (lo storico resta). Le cancellazioni a cascata
-- (intervento eliminato, possibile solo senza rapportini) e quelle del pannello restano vere.
create or replace function public.rimuovi_assegnazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return old; end if;
  update public.intervento_operai set rimosso_il = now(), rimosso_da = auth.uid()
    where intervento_id = old.intervento_id and operaio_id = old.operaio_id and rimosso_il is null;
  return null;
end $$;
drop trigger if exists intervento_operai_rimozione on public.intervento_operai;
create trigger intervento_operai_rimozione before delete on public.intervento_operai
  for each row execute function public.rimuovi_assegnazione();

-- ---------------------------------------------------------------- stato complessivo
create or replace function public.stato_intervento_calcolato(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.intervento_operai a where a.intervento_id = p_id and a.rimosso_il is null)
     and not exists (
       select 1 from public.intervento_operai a
       where a.intervento_id = p_id and a.rimosso_il is null
         and not exists (select 1 from public.rapportini r
                         where r.intervento_id = p_id and r.autore_id = a.operaio_id and r.stato = 'completato'))
      then 'completato'
    when exists (select 1 from public.rapportini r where r.intervento_id = p_id) then 'in_corso'
    else 'pianificato' end
$$;

-- ricalcolo atomico: prima si blocca la riga dell'intervento, poi (istruzione successiva, quindi con
-- i dati gia' confermati da chi aveva il blocco) si calcola e si scrive lo stato. Idempotente.
create or replace function public.ricalcola_stato_intervento(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null then return; end if;
  perform 1 from public.interventi where id = p_id for update;
  if not found then return; end if;
  update public.interventi set stato = public.stato_intervento_calcolato(p_id)
    where id = p_id and stato <> 'annullato' and stato is distinct from public.stato_intervento_calcolato(p_id);
end $$;

-- trigger comune a rapportini e intervento_operai (entrambe hanno la colonna intervento_id):
-- si ricalcola l'intervento nuovo e, se cambiato, quello vecchio
create or replace function public.aggiorna_stato_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  nuovo uuid := case when tg_op = 'DELETE' then null else new.intervento_id end;
  vecchio uuid := case when tg_op = 'INSERT' then null else old.intervento_id end;
begin
  perform public.ricalcola_stato_intervento(nuovo);
  if vecchio is distinct from nuovo then perform public.ricalcola_stato_intervento(vecchio); end if;
  return null;
end $$;
drop trigger if exists intervento_operai_stato on public.intervento_operai;
create trigger intervento_operai_stato after insert or update or delete on public.intervento_operai
  for each row execute function public.aggiorna_stato_intervento();

-- lo stato non si scrive a mano: inserendo si parte da "pianificato" (o "annullato");
-- aggiornando, qualsiasi valore diverso da "annullato" viene sostituito da quello calcolato
create or replace function public.controlla_intervento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;          -- service_role / pannello
  if tg_op = 'INSERT' then
    new.creato_da := auth.uid();
    new.creato_il := now();
    if new.stato <> 'annullato' then new.stato := 'pianificato'; end if;
  else
    new.creato_da := old.creato_da;
    new.creato_il := old.creato_il;
    if new.stato is distinct from old.stato and new.stato <> 'annullato' then
      new.stato := public.stato_intervento_calcolato(new.id);
    end if;
  end if;
  new.aggiornato_il := now();
  return new;
end $$;

revoke execute on function public.rimuovi_assegnazione(), public.stato_intervento_calcolato(uuid),
  public.ricalcola_stato_intervento(uuid) from public, anon, authenticated;
revoke execute on function public.controlla_assegnazione(), public.controlla_intervento(),
  public.aggiorna_stato_intervento() from public, anon, authenticated;

-- stati gia' presenti allineati alla nuova regola (nessun dato cancellato; eseguito senza utente)
update public.interventi i set stato = public.stato_intervento_calcolato(i.id)
  where i.stato <> 'annullato' and i.stato is distinct from public.stato_intervento_calcolato(i.id);
