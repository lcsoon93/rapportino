-- Schema gia' presente in produzione prima dell'introduzione degli utenti (riferimento).
-- Idempotente: in produzione non cambia nulla.
create table if not exists public.rapporti (
  data text primary key,                 -- "AAAA-MM-GG"
  dati jsonb,                            -- la giornata, stesso formato del backup dell'app
  aggiornato timestamptz default now()   -- ultima modifica (decisa dal telefono che ha scritto)
);
alter table public.rapporti enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rapporti' and policyname = 'accesso app') then
    create policy "accesso app" on public.rapporti for all to public using (true) with check (true);
  end if;
end $$;
