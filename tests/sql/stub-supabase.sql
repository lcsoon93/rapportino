-- Ambiente minimo che imita Supabase per provare le migrazioni su un Postgres 16 locale
-- (ruoli anon/authenticated/service_role, auth.uid() da una variabile di sessione, schema storage).
-- Mai sul progetto vero: lo usa solo tests/sql/esegui.sh su un database locale usa e getta.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
create or replace function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
grant usage on schema public, storage to anon, authenticated, service_role;
-- privilegi predefiniti di Supabase per service_role
alter default privileges in schema public grant all on tables to service_role;
alter role service_role bypassrls;
