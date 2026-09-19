-- =====================================================================
-- Migration 017 : module PARCOURS
-- ---------------------------------------------------------------------
-- Ce module n'existait pas dans le cadrage : l'inventaire de la v18 l'a
-- révélé, noyé dans le pôle QG (balade + balade-light + trace + bornes).
-- L'extraire est ce qui rend l'outil vendable à une rando ou une marche.
--
-- Réutilisations : les bornes et étapes sont des `lieux` (pk_km existe
-- déjà), les incidents sont des `signalements`, les interventions des
-- `missions`. On n'ajoute que trace, groupes et passages.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Droits. L'accompagnateur est un bénévole sur le terrain : il DOIT
-- pouvoir pointer un passage. C'est toute la valeur du module.
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, 'parcours', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier','supprimer']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('coordinateur','cloture','parcours','lire');

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'parcours', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'parcours', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select r, p, 'parcours', 'lire'
from unnest(array['chef_equipe','benevole']::role_evenement[]) r
cross join unnest(array['preparation','cloture']::phase_evenement[]) p;

insert into matrice_permissions (role, phase, ressource, action)
values ('observateur','exploitation','parcours','lire'),
       ('observateur','cloture','parcours','lire');

-- ---------------------------------------------------------------------
-- 2. TRACES
-- Les points sont en jsonb plutôt qu'en PostGIS : on n'a besoin ni de
-- requêtes spatiales ni d'index géographique, seulement d'afficher et
-- de calculer un profil. PostGIS serait un poids sans contrepartie.
-- ---------------------------------------------------------------------
create table traces (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  nom           text not null,
  couleur       text,
  sens          text,                       -- horaire, antihoraire, aller-retour
  distance_km   numeric(6,2),
  denivele_pos  integer,
  denivele_neg  integer,
  points        jsonb not null default '[]'::jsonb,   -- [[lat,lon,alt], …]
  source        text,                       -- nom du GPX/KML d'origine
  actif         boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

comment on column traces.points is
  'Suite de [lat, lon, alt]. jsonb et non PostGIS : ni requête spatiale ni index géographique nécessaires ici.';

-- ---------------------------------------------------------------------
-- 3. GROUPES
-- Un peloton, une vague de départ, un groupe accompagné.
-- ---------------------------------------------------------------------
create type statut_groupe as enum ('inscrit','parti','en_cours','arrive','abandon');

create table groupes (
  id              uuid primary key default gen_random_uuid(),
  evenement_id    uuid not null references evenements(id) on delete cascade,
  trace_id        uuid references traces(id) on delete set null,
  code            text not null,
  nom             text not null,

  effectif_prevu  integer,
  effectif_reel   integer,

  accompagnateur_id uuid references membres_evenement(id) on delete set null,
  accompagnateur_libre text,
  contact         text,

  depart_prevu    timestamptz,
  depart_reel     timestamptz,
  arrivee_prevue  timestamptz,
  arrivee_reelle  timestamptz,

  statut          statut_groupe not null default 'inscrit',
  dernier_lieu_id uuid references lieux(id) on delete set null,
  dernier_passage timestamptz,
  commentaire     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  origine         origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_groupes_ev on groupes (evenement_id, statut)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- 4. PASSAGES
-- Le pointage d'un groupe à un point du parcours. Objet le plus saisi
-- du module : il doit être créable en un geste, par un bénévole.
-- ---------------------------------------------------------------------
create table passages (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  groupe_id     uuid not null references groupes(id) on delete cascade,
  lieu_id       uuid references lieux(id) on delete set null,

  horodatage    timestamptz not null default clock_timestamp(),
  effectif      integer,
  latitude      double precision,
  longitude     double precision,
  commentaire   text,
  membre_id     uuid references membres_evenement(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_passages_groupe on passages (groupe_id, horodatage desc)
  where deleted_at is null;
create index idx_passages_ev on passages (evenement_id, horodatage desc)
  where deleted_at is null;

-- Un passage met à jour la position du groupe : le QG n'a jamais à
-- recalculer où en est chacun.
create or replace function trg_passage_maj_groupe()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_pk numeric;
begin
  update groupes
  set dernier_lieu_id = coalesce(new.lieu_id, dernier_lieu_id),
      dernier_passage = new.horodatage,
      effectif_reel   = coalesce(new.effectif, effectif_reel),
      statut = case when statut in ('inscrit','parti') then 'en_cours' else statut end,
      depart_reel = coalesce(depart_reel, case when statut = 'parti' then new.horodatage end)
  where id = new.groupe_id;

  select pk_km into v_pk from lieux where id = new.lieu_id;

  perform journaliser(new.evenement_id, 'parcours', 'passage',
    'Passage ' || (select nom from groupes where id = new.groupe_id) ||
    coalesce(' à ' || (select nom from lieux where id = new.lieu_id), '') ||
    coalesce(' (PK ' || v_pk || ')', '') ||
    coalesce(' — ' || new.effectif || ' pers.', ''),
    'routine'::importance_journal, 'passage', new.id, null);
  return null;
end;
$$;

create trigger passage_maj_groupe after insert on passages
  for each row execute function trg_passage_maj_groupe();

-- ---------------------------------------------------------------------
-- 5. Groupes en retard — la question que le QG se pose en continu
-- ---------------------------------------------------------------------
create or replace function groupes_sans_nouvelles(
  p_evenement uuid,
  p_minutes integer default 45
)
returns table (
  groupe_id uuid, code text, nom text, effectif integer,
  dernier_lieu text, dernier_passage timestamptz, minutes_ecoulees integer,
  accompagnateur text, contact text
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  select g.id, g.code, g.nom, coalesce(g.effectif_reel, g.effectif_prevu),
         l.nom, g.dernier_passage,
         round(extract(epoch from (clock_timestamp() - coalesce(g.dernier_passage, g.depart_reel)))/60)::int,
         coalesce(m.nom_affiche, g.accompagnateur_libre), g.contact
  from groupes g
  left join lieux l on l.id = g.dernier_lieu_id
  left join membres_evenement m on m.id = g.accompagnateur_id
  where g.evenement_id = p_evenement
    and g.deleted_at is null
    and g.statut in ('parti','en_cours')
    and coalesce(g.dernier_passage, g.depart_reel) < clock_timestamp() - (p_minutes || ' minutes')::interval
  order by coalesce(g.dernier_passage, g.depart_reel);
$$;

grant execute on function groupes_sans_nouvelles(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Traçabilité, journalisation, RLS
-- ---------------------------------------------------------------------
create trigger tracabilite_traces before insert or update on traces
  for each row execute function trg_tracabilite();
create trigger tracabilite_groupes before insert or update on groupes
  for each row execute function trg_tracabilite();
create trigger tracabilite_passages before insert or update on passages
  for each row execute function trg_tracabilite_simple();

create or replace function trg_journal_groupe()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut
     and new.statut in ('parti','arrive','abandon') then
    perform journaliser(new.evenement_id, 'parcours', 'groupe',
      'Groupe ' || new.nom || ' → ' || new.statut ||
      coalesce(' (' || new.effectif_reel || ' pers.)', ''),
      (case when new.statut = 'abandon' then 'notable' else 'routine' end)::importance_journal,
      'groupe', new.id, new.code);
  end if;
  return null;
end;
$$;

create trigger journal_groupe after update on groupes
  for each row execute function trg_journal_groupe();

alter table traces   enable row level security;
alter table groupes  enable row level security;
alter table passages enable row level security;

create policy traces_lecture on traces for select to authenticated
  using (a_permission(evenement_id,'parcours','lire') and deleted_at is null);
create policy traces_creation on traces for insert to authenticated
  with check (a_permission(evenement_id,'parcours','creer'));
create policy traces_modification on traces for update to authenticated
  using (a_permission(evenement_id,'parcours','modifier'))
  with check (a_permission(evenement_id,'parcours','modifier'));

create policy groupes_lecture on groupes for select to authenticated
  using (a_permission(evenement_id,'parcours','lire') and deleted_at is null);
create policy groupes_creation on groupes for insert to authenticated
  with check (a_permission(evenement_id,'parcours','creer'));
create policy groupes_modification on groupes for update to authenticated
  using (a_permission(evenement_id,'parcours','modifier'))
  with check (a_permission(evenement_id,'parcours','modifier'));

create policy passages_lecture on passages for select to authenticated
  using (a_permission(evenement_id,'parcours','lire') and deleted_at is null);
create policy passages_creation on passages for insert to authenticated
  with check (a_permission(evenement_id,'parcours','creer'));

commit;