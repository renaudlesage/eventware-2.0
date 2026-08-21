-- =====================================================================
-- EVENTWARE 2.0 — Migration 001 : socle multi-tenant
-- ---------------------------------------------------------------------
-- Contenu :
--   1. Types énumérés
--   2. Tables du socle
--   3. Fonctions d'autorisation (SECURITY DEFINER)
--   4. Triggers de traçabilité et de bascule de phase
--   5. Politiques RLS
--   6. Seed produit de la matrice de permissions
--
-- Principe directeur : aucune donnée client n'est injectée ici.
-- Seule la matrice de permissions est semée, car elle relève du produit
-- et non du client (jeu de rôles figé, non paramétrable).
-- =====================================================================

begin;

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1. TYPES ÉNUMÉRÉS
-- =====================================================================

create type type_geometrie as enum (
  'site_ferme',   -- périmètre, entrées, zones
  'parcours',     -- itinéraire, PK, étapes, sens de circulation
  'hybride'       -- les deux (cas BFMF)
);

create type phase_evenement as enum (
  'preparation',
  'montage',
  'exploitation',
  'demontage',
  'cloture'
);

create type role_evenement as enum (
  'admin',
  'coordinateur',
  'chef_equipe',
  'benevole',
  'observateur'
);

create type action_permission as enum (
  'lire',
  'creer',
  'modifier',
  'supprimer'
);

-- Origine de l'enregistrement : protège les saisies humaines
-- contre un réimport de seed (cf. cadrage §2.3 et §3).
create type origine_donnee as enum (
  'seed',
  'humain',
  'import'
);

-- =====================================================================
-- 2. TABLES DU SOCLE
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2.1 Événements — entité racine, porteuse de l'isolation multi-tenant
-- ---------------------------------------------------------------------
create table evenements (
  id                uuid primary key default gen_random_uuid(),
  nom               text not null,
  slug              text not null unique,
  geometrie         type_geometrie not null default 'site_ferme',
  phase             phase_evenement not null default 'preparation',

  date_debut        date,
  date_fin          date,
  date_montage      date,
  date_demontage    date,

  -- Modules activés : filtre la disponibilité des pavés et des écrans.
  -- Le catalogue est figé au niveau produit ; ici on n'active/désactive.
  modules           jsonb not null default '{
                        "securite": true,
                        "logistique": false,
                        "rh": false,
                        "sos_participants": false,
                        "plan_implantation": false,
                        "analyse": false
                      }'::jsonb,

  -- Point de référence cartographique (Point 0)
  point_0_lat       double precision,
  point_0_lon       double precision,

  archive           boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  deleted_at        timestamptz
);

comment on column evenements.phase is
  'État courant. Réversible : on peut repasser de exploitation à montage.';

-- ---------------------------------------------------------------------
-- 2.2 Membres — le rôle est porté par le couple utilisateur × événement
-- ---------------------------------------------------------------------
create table membres_evenement (
  id                uuid primary key default gen_random_uuid(),
  evenement_id      uuid not null references evenements(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              role_evenement not null default 'benevole',

  -- Périmètre du chef d'équipe / de l'observateur.
  -- NULL = périmètre global (coordinateur, admin).
  perimetre         text,

  nom_affiche       text,
  telephone         text,
  actif             boolean not null default true,

  invite_le         timestamptz,
  premiere_connexion timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  deleted_at        timestamptz,
  origine           origine_donnee not null default 'humain',

  unique (evenement_id, user_id)
);

create index idx_membres_evenement on membres_evenement (evenement_id) where deleted_at is null;
create index idx_membres_user on membres_evenement (user_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 2.3 Matrice de permissions — rôle × phase × ressource
-- Seed produit. Aucun client ne l'édite.
-- ---------------------------------------------------------------------
create table matrice_permissions (
  role              role_evenement not null,
  phase             phase_evenement not null,
  ressource         text not null,
  action            action_permission not null,
  primary key (role, phase, ressource, action)
);

comment on table matrice_permissions is
  'Droits ouverts. Absence de ligne = droit refusé. L''admin ne figure pas ici : il est traité en dur dans a_permission().';

-- ---------------------------------------------------------------------
-- 2.4 Historique des bascules de phase
-- ---------------------------------------------------------------------
create table bascule_phase (
  id                uuid primary key default gen_random_uuid(),
  evenement_id      uuid not null references evenements(id) on delete cascade,
  phase_avant       phase_evenement,
  phase_apres       phase_evenement not null,
  motif             text,
  bascule_le        timestamptz not null default now(),
  bascule_par       uuid references auth.users(id)
);

create index idx_bascule_evenement on bascule_phase (evenement_id, bascule_le desc);

-- ---------------------------------------------------------------------
-- 2.5 Journal des imports — traçabilité des chargements de masse
-- ---------------------------------------------------------------------
create table journal_imports (
  id                uuid primary key default gen_random_uuid(),
  evenement_id      uuid not null references evenements(id) on delete cascade,
  ressource         text not null,
  fichier           text,
  mode              text not null check (mode in ('ajouter','mettre_a_jour','ignorer')),
  lignes_lues       integer not null default 0,
  lignes_creees     integer not null default 0,
  lignes_modifiees  integer not null default 0,
  lignes_ignorees   integer not null default 0,
  lignes_rejetees   integer not null default 0,
  detail            jsonb,
  importe_le        timestamptz not null default now(),
  importe_par       uuid references auth.users(id)
);

comment on table journal_imports is
  'Permet de répondre à "qui a écrasé quoi et quand", trois semaines après.';

-- =====================================================================
-- 3. FONCTIONS D'AUTORISATION
-- ---------------------------------------------------------------------
-- SECURITY DEFINER obligatoire : ces fonctions lisent membres_evenement,
-- qui est elle-même protégée par RLS. Sans cela, les policies qui les
-- appellent provoquent une récursion infinie.
-- search_path figé pour éviter tout détournement.
-- =====================================================================

create or replace function est_membre(p_evenement uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from membres_evenement m
    where m.evenement_id = p_evenement
      and m.user_id = auth.uid()
      and m.actif = true
      and m.deleted_at is null
  );
$$;

create or replace function role_dans(p_evenement uuid)
returns role_evenement
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role from membres_evenement m
  where m.evenement_id = p_evenement
    and m.user_id = auth.uid()
    and m.actif = true
    and m.deleted_at is null
  limit 1;
$$;

create or replace function perimetre_dans(p_evenement uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.perimetre from membres_evenement m
  where m.evenement_id = p_evenement
    and m.user_id = auth.uid()
    and m.actif = true
    and m.deleted_at is null
  limit 1;
$$;

create or replace function phase_courante(p_evenement uuid)
returns phase_evenement
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.phase from evenements e where e.id = p_evenement;
$$;

-- ---------------------------------------------------------------------
-- Fonction centrale d'autorisation.
--
-- Trois règles de sûreté y sont codées en dur, volontairement :
--   R1 — l'admin n'est jamais bloqué ;
--   R2 — les ressources critiques (sos, alertes, journal) restent
--        toujours LISIBLES par tout membre, quelle que soit la phase ;
--   R3 — la phase ne restreint que l'écriture, jamais la lecture du
--        critique.
-- Ces règles ne sont pas paramétrables : elles protègent contre le
-- verrouillage d'un intervenant au pire moment.
-- ---------------------------------------------------------------------
create or replace function a_permission(
  p_evenement uuid,
  p_ressource text,
  p_action    action_permission
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role  role_evenement;
  v_phase phase_evenement;
begin
  v_role := role_dans(p_evenement);

  -- Non-membre : aucun droit.
  if v_role is null then
    return false;
  end if;

  -- R1 — l'admin passe toujours.
  if v_role = 'admin' then
    return true;
  end if;

  -- R2 / R3 — lecture du critique toujours ouverte aux membres.
  if p_action = 'lire'
     and p_ressource in ('sos', 'alertes', 'journal') then
    return true;
  end if;

  v_phase := phase_courante(p_evenement);

  return exists (
    select 1 from matrice_permissions mp
    where mp.role      = v_role
      and mp.phase     = v_phase
      and mp.ressource = p_ressource
      and mp.action    = p_action
  );
end;
$$;

-- =====================================================================
-- 4. TRIGGERS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4.1 Traçabilité — à appliquer sur TOUTE table métier
-- ---------------------------------------------------------------------
create or replace function trg_tracabilite()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.updated_at := now();
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
    -- Une modification humaine efface définitivement le statut de seed :
    -- l'enregistrement devient intouchable par un réimport.
    if old.origine = 'seed' and new.origine = 'seed' then
      new.origine := 'humain';
    end if;
  end if;
  return new;
end;
$$;

-- Variante sans colonne origine (tables du socle qui n'en portent pas)
create or replace function trg_tracabilite_simple()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.updated_at := now();
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger tracabilite_evenements
  before insert or update on evenements
  for each row execute function trg_tracabilite_simple();

create trigger tracabilite_membres
  before insert or update on membres_evenement
  for each row execute function trg_tracabilite();

-- ---------------------------------------------------------------------
-- 4.2 Bascule de phase — journalisée automatiquement
-- ---------------------------------------------------------------------
create or replace function trg_journal_bascule_phase()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.phase is distinct from old.phase then
    insert into bascule_phase (evenement_id, phase_avant, phase_apres, bascule_par)
    values (new.id, old.phase, new.phase, auth.uid());
  end if;
  return new;
end;
$$;

create trigger journal_bascule_phase
  after update on evenements
  for each row execute function trg_journal_bascule_phase();

-- =====================================================================
-- 5. POLITIQUES RLS
-- =====================================================================

alter table evenements          enable row level security;
alter table membres_evenement   enable row level security;
alter table matrice_permissions enable row level security;
alter table bascule_phase       enable row level security;
alter table journal_imports     enable row level security;

-- ---------------------------------------------------------------------
-- 5.1 Événements
-- ---------------------------------------------------------------------
create policy evenements_lecture on evenements
  for select to authenticated
  using (est_membre(id) and deleted_at is null);

-- Tout utilisateur authentifié peut créer un événement ; le trigger
-- applicatif (ou l'Edge Function) l'inscrit ensuite comme admin.
create policy evenements_creation on evenements
  for insert to authenticated
  with check (true);

create policy evenements_modification on evenements
  for update to authenticated
  using (role_dans(id) = 'admin')
  with check (role_dans(id) = 'admin');

-- Pas de policy DELETE : suppression logique uniquement (deleted_at).

-- ---------------------------------------------------------------------
-- 5.2 Membres
-- ---------------------------------------------------------------------
create policy membres_lecture on membres_evenement
  for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);

create policy membres_creation on membres_evenement
  for insert to authenticated
  with check (a_permission(evenement_id, 'membres', 'creer'));

create policy membres_modification on membres_evenement
  for update to authenticated
  using (
    a_permission(evenement_id, 'membres', 'modifier')
    or user_id = auth.uid()          -- chacun édite sa propre fiche
  )
  with check (
    a_permission(evenement_id, 'membres', 'modifier')
    or user_id = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 5.3 Matrice — lisible par tous, modifiable par personne
-- (seul le service_role, hors RLS, peut la faire évoluer)
-- ---------------------------------------------------------------------
create policy matrice_lecture on matrice_permissions
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- 5.4 Bascules et imports — lecture membre, écriture par trigger/admin
-- ---------------------------------------------------------------------
create policy bascule_lecture on bascule_phase
  for select to authenticated
  using (est_membre(evenement_id));

create policy imports_lecture on journal_imports
  for select to authenticated
  using (est_membre(evenement_id));

create policy imports_creation on journal_imports
  for insert to authenticated
  with check (a_permission(evenement_id, 'referentiels', 'creer'));

commit;
