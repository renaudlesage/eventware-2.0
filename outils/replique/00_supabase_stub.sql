-- Réplique locale : ce que Supabase fournit hors migrations (rôles, auth, storage, extensions).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, public;
alter database replique set search_path = public, extensions;

-- auth
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, encrypted_password text, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_sign_in_at timestamptz,
  phone text, confirmed_at timestamptz, deleted_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_setting('request.jwt.claims', true)::jsonb ->> 'role')
$$;
create or replace function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), current_setting('request.jwt.claims', true)::jsonb ->> 'email')
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to postgres, service_role;
grant execute on function auth.uid(), auth.jwt(), auth.role(), auth.email() to anon, authenticated, service_role, public;

-- storage
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, owner_id text, metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[array_length(_parts, 1)]; end $$;
create or replace function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text; begin select string_to_array(name, '/') into _parts; select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1)); end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- suivi des migrations
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);

-- « Enable automatic RLS » : RLS sur toute nouvelle table du schéma public.
create or replace function public.rls_auto_enable() returns event_trigger language plpgsql as $$
declare r record; begin
  for r in select * from pg_event_trigger_ddl_commands() where command_tag = 'CREATE TABLE' and schema_name = 'public' loop
    execute format('alter table %s enable row level security', r.object_identity);
  end loop;
end $$;
drop event trigger if exists rls_auto_enable_trigger;
create event trigger rls_auto_enable_trigger on ddl_command_end when tag in ('CREATE TABLE') execute function public.rls_auto_enable();

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
