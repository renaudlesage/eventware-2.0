-- =====================================================================
-- Migration 005 : tables de référentiel
-- ---------------------------------------------------------------------
-- Tout ce qui se prépare en amont et se charge par fichier.
-- Les objets de terrain (missions, installations à risque, plan
-- d'implantation) relèvent de la phase 3 et ne sont pas ici.
--
-- Chaque table porte un `code` unique par événement : c'est la clé sur
-- laquelle l'import CSV décide entre créer et mettre à jour. Sans elle,
-- le mode « mettre à jour » n'a aucun moyen d'identifier une ligne
-- existante et on retombe sur l'écrasement aveugle.
-- =====================================================================

begin;

create type type_lieu as enum (
  'etape','poste_secours','pc_ops','scene','bar','camping',
  'parking','entree','zone','point_kilometrique','autre'
);

create type priorite_mission as enum ('P1','P2','P3','P4');

-- ---------------------------------------------------------------------
-- equipes
-- ---------------------------------------------------------------------
create table equipes (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references evenements(id) on delete cascade,
  code           text not null,
  nom            text not null,
  description    text,
  couleur        text,
  responsable_id uuid references membres_evenement(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz,
  origine        origine_donnee not null default 'humain',
  unique (evenement_id, code)
);

-- ---------------------------------------------------------------------
-- lieux — socle carto commun aux trois géométries.
-- Un site fermé remplit lat/lon, un parcours remplit le PK,
-- un événement hybride remplit les deux.
-- ---------------------------------------------------------------------
create table lieux (
  id           uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements(id) on delete cascade,
  code         text not null,
  nom          text not null,
  type         type_lieu not null default 'autre',
  latitude     double precision,
  longitude    double precision,
  altitude_m   double precision,
  pk_km        numeric(6,2),
  description  text,
  actif        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz,
  origine      origine_donnee not null default 'humain',
  unique (evenement_id, code)
);

comment on column lieux.pk_km is
  'Point kilométrique — pertinent en géométrie parcours ou hybride.';

-- ---------------------------------------------------------------------
-- types_mission — nomenclature LOG-XXX
-- ---------------------------------------------------------------------
create table types_mission (
  id              uuid primary key default gen_random_uuid(),
  evenement_id    uuid not null references evenements(id) on delete cascade,
  code            text not null,
  libelle         text not null,
  categorie       text,
  priorite        priorite_mission not null default 'P3',
  delai_cible_min integer,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  origine         origine_donnee not null default 'humain',
  unique (evenement_id, code)
);

-- ---------------------------------------------------------------------
-- materiel
-- ---------------------------------------------------------------------
create table materiel (
  id           uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements(id) on delete cascade,
  code         text not null,
  nom          text not null,
  categorie    text,
  quantite     numeric(10,2) not null default 0,
  unite        text,
  seuil_alerte numeric(10,2),
  lieu_id      uuid references lieux(id) on delete set null,
  equipe_id    uuid references equipes(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz,
  origine      origine_donnee not null default 'humain',
  unique (evenement_id, code)
);

comment on column materiel.seuil_alerte is
  'Sous ce seuil, réapprovisionnement à déclencher. Facteur d''échec identifié au REX 2026 sur les étapes distantes.';

-- ---------------------------------------------------------------------
-- contacts — externes : secours, commune, prestataires, foodtrucks
-- ---------------------------------------------------------------------
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  nom           text not null,
  organisation  text,
  fonction      text,
  telephone     text,
  email         text,
  categorie     text,
  disponibilite text,
  lieu_id       uuid references lieux(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',
  unique (evenement_id, code)
);

-- ---------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------
create index idx_equipes_ev       on equipes (evenement_id)       where deleted_at is null;
create index idx_lieux_ev         on lieux (evenement_id)         where deleted_at is null;
create index idx_types_mission_ev on types_mission (evenement_id) where deleted_at is null;
create index idx_materiel_ev      on materiel (evenement_id)      where deleted_at is null;
create index idx_contacts_ev      on contacts (evenement_id)      where deleted_at is null;

-- ---------------------------------------------------------------------
-- Traçabilité
-- ---------------------------------------------------------------------
create trigger tracabilite_equipes       before insert or update on equipes
  for each row execute function trg_tracabilite();
create trigger tracabilite_lieux         before insert or update on lieux
  for each row execute function trg_tracabilite();
create trigger tracabilite_types_mission before insert or update on types_mission
  for each row execute function trg_tracabilite();
create trigger tracabilite_materiel      before insert or update on materiel
  for each row execute function trg_tracabilite();
create trigger tracabilite_contacts      before insert or update on contacts
  for each row execute function trg_tracabilite();

-- ---------------------------------------------------------------------
-- RLS
-- 'equipes' a sa propre ressource dans la matrice ;
-- les quatre autres relèvent de 'referentiels'.
-- ---------------------------------------------------------------------
alter table equipes       enable row level security;
alter table lieux         enable row level security;
alter table types_mission enable row level security;
alter table materiel      enable row level security;
alter table contacts      enable row level security;

create policy equipes_lecture on equipes for select to authenticated
  using (a_permission(evenement_id,'equipes','lire') and deleted_at is null);
create policy equipes_creation on equipes for insert to authenticated
  with check (a_permission(evenement_id,'equipes','creer'));
create policy equipes_modification on equipes for update to authenticated
  using (a_permission(evenement_id,'equipes','modifier'))
  with check (a_permission(evenement_id,'equipes','modifier'));

create policy lieux_lecture on lieux for select to authenticated
  using (a_permission(evenement_id,'referentiels','lire') and deleted_at is null);
create policy lieux_creation on lieux for insert to authenticated
  with check (a_permission(evenement_id,'referentiels','creer'));
create policy lieux_modification on lieux for update to authenticated
  using (a_permission(evenement_id,'referentiels','modifier'))
  with check (a_permission(evenement_id,'referentiels','modifier'));

create policy types_mission_lecture on types_mission for select to authenticated
  using (a_permission(evenement_id,'referentiels','lire') and deleted_at is null);
create policy types_mission_creation on types_mission for insert to authenticated
  with check (a_permission(evenement_id,'referentiels','creer'));
create policy types_mission_modification on types_mission for update to authenticated
  using (a_permission(evenement_id,'referentiels','modifier'))
  with check (a_permission(evenement_id,'referentiels','modifier'));

create policy materiel_lecture on materiel for select to authenticated
  using (a_permission(evenement_id,'referentiels','lire') and deleted_at is null);
create policy materiel_creation on materiel for insert to authenticated
  with check (a_permission(evenement_id,'referentiels','creer'));
create policy materiel_modification on materiel for update to authenticated
  using (a_permission(evenement_id,'referentiels','modifier'))
  with check (a_permission(evenement_id,'referentiels','modifier'));

create policy contacts_lecture on contacts for select to authenticated
  using (a_permission(evenement_id,'referentiels','lire') and deleted_at is null);
create policy contacts_creation on contacts for insert to authenticated
  with check (a_permission(evenement_id,'referentiels','creer'));
create policy contacts_modification on contacts for update to authenticated
  using (a_permission(evenement_id,'referentiels','modifier'))
  with check (a_permission(evenement_id,'referentiels','modifier'));

commit;
