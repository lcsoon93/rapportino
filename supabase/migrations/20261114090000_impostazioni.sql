-- =====================================================================
-- Impostazioni condivise dell'app (una riga per chiave), decise dall'amministratore.
-- Prima chiave: ore_per_cliente = stampe con le sole ore per cliente (senza orari e ore dei
-- singoli operai). La sceglie l'admin e vale per le stampe di tutti (anche company e operai).
-- Lettura: ogni utente attivo (mio_ruolo() non nullo). Scrittura: solo admin.
-- Nuova tabella, nessun dato esistente toccato. Ripetibile.
-- =====================================================================
create table if not exists public.impostazioni (
  chiave text primary key,
  valore jsonb not null,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid default auth.uid()
);

alter table public.impostazioni enable row level security;

drop policy if exists impostazioni_leggi on public.impostazioni;
create policy impostazioni_leggi on public.impostazioni
  for select to authenticated using (public.mio_ruolo() is not null);

drop policy if exists impostazioni_inserisci on public.impostazioni;
create policy impostazioni_inserisci on public.impostazioni
  for insert to authenticated with check (public.e_admin());

drop policy if exists impostazioni_modifica on public.impostazioni;
create policy impostazioni_modifica on public.impostazioni
  for update to authenticated using (public.e_admin()) with check (public.e_admin());

-- niente DELETE: le chiavi restano (si cambia solo il valore)
revoke all on public.impostazioni from anon;
revoke all on public.impostazioni from authenticated;
grant select, insert, update on public.impostazioni to authenticated;

-- chi ha modificato e quando lo impone il database, non il browser
create or replace function public.timbra_impostazione() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.aggiornato_il := now();
  new.aggiornato_da := auth.uid();
  return new;
end $$;
revoke execute on function public.timbra_impostazione() from public, anon, authenticated;

drop trigger if exists impostazioni_timbra on public.impostazioni;
create trigger impostazioni_timbra before insert or update on public.impostazioni
  for each row execute function public.timbra_impostazione();

insert into public.impostazioni (chiave, valore) values ('ore_per_cliente', 'false'::jsonb)
  on conflict (chiave) do nothing;
