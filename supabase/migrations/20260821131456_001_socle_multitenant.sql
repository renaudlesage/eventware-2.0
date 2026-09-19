create extension if not exists "pgcrypto";

-- 1. TYPES
create type type_geometrie as enum ('site_ferme','parcours','hybride');
create type phase_evenement as enum ('preparation','montage','exploitation','demontage','cloture');
create type role_evenement as enum ('admin','coordinateur','chef_equipe','benevole','observateur');
create type action_permission as enum ('lire','creer','modifier','supprimer');
create type origine_donnee as enum ('seed','humain','import');

-- 2. TABLES
create table evenements (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  slug text not null unique,
  geometrie type_geometrie not null default 'site_ferme',
  phase phase_evenement not null default 'preparation',
  date_debut date,
  date_fin date,
  date_montage date,
  date_demontage date,
  modules jsonb not null default '{"securite": true, "logistique": false, "rh": false, "sos_participants": false, "plan_implantation": false, "analyse": false}'::jsonb,
  point_0_lat double precision,
  point_0_lon double precision,
  archive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);

create table membres_evenement (
  id uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role role_evenement not null default 'benevole',
  perimetre text,
  nom_affiche text,
  telephone text,
  actif boolean not null default true,
  invite_le timestamptz,
  premiere_connexion timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  origine origine_donnee not null default 'humain',
  unique (evenement_id, user_id)
);

create index idx_membres_evenement on membres_evenement (evenement_id) where deleted_at is null;
create index idx_membres_user on membres_evenement (user_id) where deleted_at is null;

create table matrice_permissions (
  role role_evenement not null,
  phase phase_evenement not null,
  ressource text not null,
  action action_permission not null,
  primary key (role, phase, ressource, action)
);

create table bascule_phase (
  id uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements(id) on delete cascade,
  phase_avant phase_evenement,
  phase_apres phase_evenement not null,
  motif text,
  bascule_le timestamptz not null default now(),
  bascule_par uuid references auth.users(id)
);

create index idx_bascule_evenement on bascule_phase (evenement_id, bascule_le desc);

create table journal_imports (
  id uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements(id) on delete cascade,
  ressource text not null,
  fichier text,
  mode text not null check (mode in ('ajouter','mettre_a_jour','ignorer')),
  lignes_lues integer not null default 0,
  lignes_creees integer not null default 0,
  lignes_modifiees integer not null default 0,
  lignes_ignorees integer not null default 0,
  lignes_rejetees integer not null default 0,
  detail jsonb,
  importe_le timestamptz not null default now(),
  importe_par uuid references auth.users(id)
);

-- 3. FONCTIONS D'AUTORISATION
create or replace function est_membre(p_evenement uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from membres_evenement m
    where m.evenement_id = p_evenement and m.user_id = auth.uid()
      and m.actif = true and m.deleted_at is null
  );
$$;

create or replace function role_dans(p_evenement uuid)
returns role_evenement language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from membres_evenement m
  where m.evenement_id = p_evenement and m.user_id = auth.uid()
    and m.actif = true and m.deleted_at is null
  limit 1;
$$;

create or replace function perimetre_dans(p_evenement uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select m.perimetre from membres_evenement m
  where m.evenement_id = p_evenement and m.user_id = auth.uid()
    and m.actif = true and m.deleted_at is null
  limit 1;
$$;

create or replace function phase_courante(p_evenement uuid)
returns phase_evenement language sql stable security definer set search_path = public, pg_temp as $$
  select e.phase from evenements e where e.id = p_evenement;
$$;

create or replace function a_permission(p_evenement uuid, p_ressource text, p_action action_permission)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role role_evenement;
  v_phase phase_evenement;
begin
  v_role := role_dans(p_evenement);
  if v_role is null then return false; end if;
  if v_role = 'admin' then return true; end if;
  if p_action = 'lire' and p_ressource in ('sos','alertes','journal') then return true; end if;
  v_phase := phase_courante(p_evenement);
  return exists (
    select 1 from matrice_permissions mp
    where mp.role = v_role and mp.phase = v_phase
      and mp.ressource = p_ressource and mp.action = p_action
  );
end;
$$;

-- 4. TRIGGERS
create or replace function trg_tracabilite()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := auth.uid();
    new.updated_at := now(); new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at; new.created_by := old.created_by;
    new.updated_at := now(); new.updated_by := auth.uid();
    if old.origine = 'seed' and new.origine = 'seed' then
      new.origine := 'humain';
    end if;
  end if;
  return new;
end;
$$;

create or replace function trg_tracabilite_simple()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := auth.uid();
    new.updated_at := now(); new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at; new.created_by := old.created_by;
    new.updated_at := now(); new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger tracabilite_evenements before insert or update on evenements
  for each row execute function trg_tracabilite_simple();

create trigger tracabilite_membres before insert or update on membres_evenement
  for each row execute function trg_tracabilite();

create or replace function trg_journal_bascule_phase()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.phase is distinct from old.phase then
    insert into bascule_phase (evenement_id, phase_avant, phase_apres, bascule_par)
    values (new.id, old.phase, new.phase, auth.uid());
  end if;
  return new;
end;
$$;

create trigger journal_bascule_phase after update on evenements
  for each row execute function trg_journal_bascule_phase();

-- 5. RLS
alter table evenements enable row level security;
alter table membres_evenement enable row level security;
alter table matrice_permissions enable row level security;
alter table bascule_phase enable row level security;
alter table journal_imports enable row level security;

create policy evenements_lecture on evenements for select to authenticated
  using (est_membre(id) and deleted_at is null);

create policy evenements_creation on evenements for insert to authenticated
  with check (true);

create policy evenements_modification on evenements for update to authenticated
  using (role_dans(id) = 'admin') with check (role_dans(id) = 'admin');

create policy membres_lecture on membres_evenement for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);

create policy membres_creation on membres_evenement for insert to authenticated
  with check (a_permission(evenement_id, 'membres', 'creer'));

create policy membres_modification on membres_evenement for update to authenticated
  using (a_permission(evenement_id, 'membres', 'modifier') or user_id = auth.uid())
  with check (a_permission(evenement_id, 'membres', 'modifier') or user_id = auth.uid());

create policy matrice_lecture on matrice_permissions for select to authenticated
  using (true);

create policy bascule_lecture on bascule_phase for select to authenticated
  using (est_membre(evenement_id));

create policy imports_lecture on journal_imports for select to authenticated
  using (est_membre(evenement_id));

create policy imports_creation on journal_imports for insert to authenticated
  with check (a_permission(evenement_id, 'referentiels', 'creer'));