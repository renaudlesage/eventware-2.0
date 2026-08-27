-- ============ 015_delai_reel_et_overload_unique ============
-- =====================================================================
-- Migration 015
--   1. delai_reel_min sur missions — mesure absente de l'export BFMF 2026
--   2. suppression de la surcharge obsolète de creer_signalement
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Délai réel de traitement.
-- Constat REX 2026 : l'export ne portait ni horodatage ni assignataire,
-- ce qui interdisait toute métrique quantitative. Comparé au
-- delai_cible_min du type de mission, ce champ rend le REX chiffrable.
-- ---------------------------------------------------------------------
alter table missions add column delai_reel_min integer;

comment on column missions.delai_reel_min is
  'Minutes entre création et clôture. Comparé à types_mission.delai_cible_min, alimente le REX généré.';

-- Reprise intégrale de la logique existante, avec le calcul en plus.
create or replace function trg_cycle_mission()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'attribuee' and new.attribuee_le is null then
      new.attribuee_le := clock_timestamp();
    elsif new.statut = 'en_cours' and new.demarree_le is null then
      new.demarree_le := clock_timestamp();
    elsif new.statut in ('resolue','annulee') and new.resolue_le is null then
      new.resolue_le := clock_timestamp();
      new.delai_reel_min :=
        round(extract(epoch from (clock_timestamp() - new.created_at)) / 60);
    end if;
  end if;
  -- Une mission attribuée sans l'être formellement : on aligne le statut
  if tg_op = 'UPDATE'
     and new.statut = 'a_traiter'
     and (new.equipe_id is not null or new.membre_id is not null)
     and (old.equipe_id is null and old.membre_id is null) then
    new.statut := 'attribuee';
    new.attribuee_le := clock_timestamp();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Deux surcharges de creer_signalement coexistaient : celle à 9
-- arguments et la nouvelle à 10 (avec p_code_lieu, pour les QR par bloc).
-- PostgREST résout par NOM d'argument : un appel du front à 9 paramètres
-- correspond aux deux, et peut renvoyer « function is not unique ».
-- Le SOS public tomberait alors en panne sans qu'on comprenne pourquoi.
-- La version à 10 arguments a un défaut sur p_code_lieu : elle absorbe
-- les appels à 9 paramètres sans rien changer pour eux.
-- ---------------------------------------------------------------------
drop function if exists creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision, double precision, timestamptz
);

commit;;

-- ============ 016_module_logistique ============
-- =====================================================================
-- Migration 016 : module LOGISTIQUE
--   1. ressource 'logistique' dans la matrice
--   2. mouvements_stock  — traçabilité des stocks (bars, étapes)
--   3. attributions      — clefier ET parc radio, objet unique
--   4. comptages         — jauge par point d'accès
--   5. transports        — demandes et courses
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Droits. Le bénévole peut SAISIR en phases terrain (comptage,
-- mouvement de stock, retour de clé) sans pouvoir rien supprimer :
-- c'est lui qui est devant l'objet, pas le coordinateur.
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, 'logistique', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier','supprimer']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('coordinateur','cloture','logistique','lire');

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'logistique', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'logistique', 'lire'
from unnest(array['preparation','cloture']::phase_evenement[]) p;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'logistique', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'logistique', 'lire'
from unnest(array['preparation','cloture']::phase_evenement[]) p;

insert into matrice_permissions (role, phase, ressource, action)
values ('observateur','exploitation','logistique','lire'),
       ('observateur','cloture','logistique','lire');

-- ---------------------------------------------------------------------
-- 2. MOUVEMENTS DE STOCK
-- materiel porte l'état courant ; ici on garde le fil de ce qui l'a
-- fait bouger. Sans ce fil, un écart d'inventaire est indébrouillable.
-- ---------------------------------------------------------------------
create type sens_mouvement as enum ('entree','sortie','ajustement','transfert');

create table mouvements_stock (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  materiel_id   uuid not null references materiel(id) on delete cascade,
  sens          sens_mouvement not null,
  quantite      numeric(10,2) not null,
  lieu_id       uuid references lieux(id) on delete set null,
  lieu_vers_id  uuid references lieux(id) on delete set null,
  motif         text,
  horodatage    timestamptz not null default clock_timestamp(),
  membre_id     uuid references membres_evenement(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_mouvements_ev on mouvements_stock (evenement_id, horodatage desc);
create index idx_mouvements_mat on mouvements_stock (materiel_id, horodatage desc);

-- Le stock courant suit le mouvement : une seule vérité.
create or replace function trg_appliquer_mouvement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_delta numeric(10,2);
begin
  v_delta := case new.sens
    when 'entree' then new.quantite
    when 'sortie' then -new.quantite
    when 'ajustement' then new.quantite      -- signé par l'appelant
    else 0 end;

  if v_delta <> 0 then
    update materiel set quantite = quantite + v_delta where id = new.materiel_id;
  end if;
  return null;
end;
$$;

create trigger appliquer_mouvement after insert on mouvements_stock
  for each row execute function trg_appliquer_mouvement();

-- Alerte au franchissement de seuil : le REX 2026 a montré que le
-- réapprovisionnement des étapes distantes pesait ~43 % de la charge.
create or replace function trg_alerte_seuil()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.seuil_alerte is not null
     and new.quantite <= new.seuil_alerte
     and (old.quantite is null or old.quantite > new.seuil_alerte) then
    perform journaliser(new.evenement_id, 'logistique', 'seuil',
      'Seuil atteint : ' || new.nom || ' (' || new.quantite ||
      coalesce(' ' || new.unite, '') || ', seuil ' || new.seuil_alerte || ')',
      'notable'::importance_journal, 'materiel', new.id, new.code);
  end if;
  return null;
end;
$$;

create trigger alerte_seuil after update on materiel
  for each row execute function trg_alerte_seuil();

-- ---------------------------------------------------------------------
-- 3. ATTRIBUTIONS — clefier et parc radio fusionnés
-- Même objet : un bien confié, un porteur, un retour attendu.
-- Couvre aussi gilets, badges, talkies, véhicules.
-- ---------------------------------------------------------------------
create type nature_attribution as enum ('cle','radio','equipement','vehicule','autre');

create table attributions (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references evenements(id) on delete cascade,
  nature         nature_attribution not null default 'equipement',
  code           text not null,               -- N° de clé, indicatif radio
  libelle        text not null,
  detail         text,                        -- canal, local ouvert…

  materiel_id    uuid references materiel(id) on delete set null,
  membre_id      uuid references membres_evenement(id) on delete set null,
  equipe_id      uuid references equipes(id) on delete set null,
  porteur_libre  text,                        -- externe, prestataire

  remis_le       timestamptz,
  rendu_le       timestamptz,
  etat_retour    text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz,
  origine        origine_donnee not null default 'humain'
);

create index idx_attributions_ev on attributions (evenement_id, nature)
  where deleted_at is null;
create index idx_attributions_encours on attributions (evenement_id)
  where deleted_at is null and rendu_le is null;

comment on table attributions is
  'Clefier et parc radio fusionnés : un bien confié, un porteur, un retour attendu. rendu_le NULL = toujours dehors.';

-- ---------------------------------------------------------------------
-- 4. COMPTAGES (jauge)
-- Écriture par lots : sur le terrain on saisit +5, pas cinq fois +1.
-- ---------------------------------------------------------------------
create table comptages (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  lieu_id       uuid references lieux(id) on delete set null,
  sens          sens_mouvement not null default 'entree',
  nombre        integer not null default 1,
  horodatage    timestamptz not null default clock_timestamp(),
  membre_id     uuid references membres_evenement(id) on delete set null,
  commentaire   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_comptages_ev on comptages (evenement_id, horodatage desc)
  where deleted_at is null;

-- Jauge instantanée par événement
create or replace function jauge_courante(p_evenement uuid)
returns integer
language sql stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(case when sens = 'entree' then nombre else -nombre end), 0)::int
  from comptages
  where evenement_id = p_evenement and deleted_at is null;
$$;

grant execute on function jauge_courante(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. TRANSPORTS
-- Cycle aligné sur les missions, mais objet distinct : un transport
-- porte un nombre de personnes, un départ et une arrivée.
-- ---------------------------------------------------------------------
create table transports (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references evenements(id) on delete cascade,
  reference      text not null,

  depart_lieu_id uuid references lieux(id) on delete set null,
  depart_libre   text,
  arrivee_lieu_id uuid references lieux(id) on delete set null,
  arrivee_libre  text,

  nb_personnes   integer not null default 1,
  motif          text,
  demandeur      text,
  contact        text,

  priorite       priorite_mission not null default 'P3',
  statut         statut_mission not null default 'a_traiter',
  chauffeur_id   uuid references membres_evenement(id) on delete set null,
  vehicule       text,

  souhaite_pour  timestamptz,
  prise_en_charge_le timestamptz,
  termine_le     timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz,
  origine        origine_donnee not null default 'humain',

  unique (evenement_id, reference)
);

create index idx_transports_ev on transports (evenement_id, statut)
  where deleted_at is null;

create or replace function trg_reference_transport()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare v_num int;
begin
  if new.reference is not null and new.reference <> '' then return new; end if;
  select coalesce(max(substring(reference from '[0-9]+$')::int), 0) + 1
    into v_num from transports where evenement_id = new.evenement_id;
  new.reference := 'TRSP-' || lpad(v_num::text, 3, '0');
  return new;
end;
$$;

create trigger reference_transport before insert on transports
  for each row execute function trg_reference_transport();

create or replace function trg_cycle_transport()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'en_cours' and new.prise_en_charge_le is null then
      new.prise_en_charge_le := clock_timestamp();
    elsif new.statut in ('resolue','annulee') and new.termine_le is null then
      new.termine_le := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create trigger cycle_transport before update on transports
  for each row execute function trg_cycle_transport();

-- ---------------------------------------------------------------------
-- 6. Traçabilité et journalisation
-- ---------------------------------------------------------------------
create trigger tracabilite_mouvements before insert or update on mouvements_stock
  for each row execute function trg_tracabilite_simple();
create trigger tracabilite_attributions before insert or update on attributions
  for each row execute function trg_tracabilite();
create trigger tracabilite_comptages before insert or update on comptages
  for each row execute function trg_tracabilite_simple();
create trigger tracabilite_transports before insert or update on transports
  for each row execute function trg_tracabilite();

create or replace function trg_journal_transport()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'logistique', 'transport',
      new.reference || ' — ' || new.nb_personnes || ' pers. ' ||
      coalesce(new.depart_libre,'?') || ' → ' || coalesce(new.arrivee_libre,'?'),
      'routine'::importance_journal, 'transport', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'logistique', 'transport',
      new.reference || ' → ' || new.statut,
      'routine'::importance_journal, 'transport', new.id, new.reference);
  end if;
  return null;
end;
$$;

create trigger journal_transport after insert or update on transports
  for each row execute function trg_journal_transport();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table mouvements_stock enable row level security;
alter table attributions     enable row level security;
alter table comptages        enable row level security;
alter table transports       enable row level security;

create policy mouvements_lecture on mouvements_stock for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy mouvements_creation on mouvements_stock for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));

create policy attributions_lecture on attributions for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy attributions_creation on attributions for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));
create policy attributions_modification on attributions for update to authenticated
  using (a_permission(evenement_id,'logistique','modifier'))
  with check (a_permission(evenement_id,'logistique','modifier'));

create policy comptages_lecture on comptages for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy comptages_creation on comptages for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));

create policy transports_lecture on transports for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy transports_creation on transports for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));
create policy transports_modification on transports for update to authenticated
  using (a_permission(evenement_id,'logistique','modifier'))
  with check (a_permission(evenement_id,'logistique','modifier'));

commit;;

-- ============ 017_module_parcours ============
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

commit;;

-- ============ 018_fix_groupes_sans_nouvelles ============
-- =====================================================================
-- Migration 018 : correction de groupes_sans_nouvelles
-- ---------------------------------------------------------------------
-- Défaut trouvé au test, inversé par rapport au besoin :
-- un groupe parti SANS aucun pointage avait dernier_passage NULL et
-- depart_reel NULL. La comparaison renvoyait « inconnu » et le groupe
-- était EXCLU de la liste d'alerte — alors que c'est précisément celui
-- qu'il faut voir en premier.
--
-- On remonte la chaîne jusqu'à une date qui existe toujours, et on
-- ajoute un drapeau : « jamais pointé » n'est pas la même information
-- que « pas de nouvelles depuis 50 minutes ».
-- =====================================================================

begin;

drop function if exists groupes_sans_nouvelles(uuid, integer);

create function groupes_sans_nouvelles(
  p_evenement uuid,
  p_minutes integer default 45
)
returns table (
  groupe_id uuid, code text, nom text, effectif integer,
  dernier_lieu text, dernier_passage timestamptz, minutes_ecoulees integer,
  jamais_pointe boolean, accompagnateur text, contact text
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  select g.id, g.code, g.nom, coalesce(g.effectif_reel, g.effectif_prevu),
         l.nom, g.dernier_passage,
         round(extract(epoch from (clock_timestamp() -
           coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at)))/60)::int,
         (g.dernier_passage is null),
         coalesce(m.nom_affiche, g.accompagnateur_libre), g.contact
  from groupes g
  left join lieux l on l.id = g.dernier_lieu_id
  left join membres_evenement m on m.id = g.accompagnateur_id
  where g.evenement_id = p_evenement
    and g.deleted_at is null
    and g.statut in ('parti','en_cours')
    and coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at)
        < clock_timestamp() - (p_minutes || ' minutes')::interval
  order by coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at);
$$;

grant execute on function groupes_sans_nouvelles(uuid, integer) to authenticated;

commit;;

-- ============ 019_module_rh ============
-- =====================================================================
-- Migration 019 : module RH / BÉNÉVOLES
--   1. creneaux     — besoins en postes, datés
--   2. affectations — qui couvre quoi, avec présence constatée
--   3. jalons       — échéances logistiques et artistes
--
-- Les personnes sont déjà dans membres_evenement : on n'ajoute que ce
-- qui manque, à savoir le temps et la couverture.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Droits. Le bénévole doit pouvoir confirmer sa propre présence :
-- sans ça, le planning reste déclaratif et personne ne sait qui est
-- réellement venu.
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, 'rh', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier','supprimer']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('coordinateur','cloture','rh','lire');

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'rh', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'rh', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('chef_equipe','cloture','rh','lire'),
       ('benevole','cloture','rh','lire');

-- ---------------------------------------------------------------------
-- 2. CRÉNEAUX
-- Un besoin en personnes, sur une plage horaire, à un poste.
-- ---------------------------------------------------------------------
create table creneaux (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  poste         text not null,
  equipe_id     uuid references equipes(id) on delete set null,
  lieu_id       uuid references lieux(id) on delete set null,

  debut         timestamptz not null,
  fin           timestamptz not null,
  phase         phase_evenement,

  besoin        integer not null default 1,
  consignes     text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code),
  check (fin > debut)
);

create index idx_creneaux_ev on creneaux (evenement_id, debut)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- 3. AFFECTATIONS
-- ---------------------------------------------------------------------
create type statut_affectation as enum (
  'propose','confirme','present','absent','annule'
);

create table affectations (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  creneau_id    uuid not null references creneaux(id) on delete cascade,
  membre_id     uuid references membres_evenement(id) on delete cascade,
  personne_libre text,                     -- renfort externe, non inscrit

  statut        statut_affectation not null default 'propose',
  confirme_le   timestamptz,
  pointe_le     timestamptz,
  commentaire   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,

  unique (creneau_id, membre_id)
);

create index idx_affectations_creneau on affectations (creneau_id)
  where deleted_at is null;
create index idx_affectations_membre on affectations (membre_id)
  where deleted_at is null;

create or replace function trg_cycle_affectation()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'confirme' and new.confirme_le is null then
      new.confirme_le := clock_timestamp();
    elsif new.statut = 'present' and new.pointe_le is null then
      new.pointe_le := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create trigger cycle_affectation before update on affectations
  for each row execute function trg_cycle_affectation();

-- ---------------------------------------------------------------------
-- 4. JALONS
-- Échéances datées : livraison chapiteau, arrivée d'un artiste,
-- balisage posé. S'articule avec le planning de montage.
-- ---------------------------------------------------------------------
create type statut_jalon as enum ('a_venir','en_cours','fait','rate','annule');

create table jalons (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  libelle       text not null,
  categorie     text,                      -- logistique, artiste, administratif
  echeance      timestamptz not null,
  lieu_id       uuid references lieux(id) on delete set null,
  responsable   text,
  contact       text,
  statut        statut_jalon not null default 'a_venir',
  fait_le       timestamptz,
  commentaire   text,
  critique      boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_jalons_ev on jalons (evenement_id, echeance)
  where deleted_at is null;

create or replace function trg_journal_jalon()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut
     and new.statut in ('fait','rate') then
    if new.statut = 'fait' and new.fait_le is null then
      update jalons set fait_le = clock_timestamp() where id = new.id;
    end if;
    perform journaliser(new.evenement_id, 'rh', 'jalon',
      'Jalon ' || new.libelle || ' → ' || new.statut,
      (case when new.statut = 'rate' or new.critique then 'notable' else 'routine' end)::importance_journal,
      'jalon', new.id, new.code);
  end if;
  return null;
end;
$$;

create trigger journal_jalon after update on jalons
  for each row execute function trg_journal_jalon();

-- ---------------------------------------------------------------------
-- 5. COUVERTURE DES CRÉNEAUX
-- La question utile n'est pas « qui est bénévole » mais « quel poste
-- n'est pas couvert ». C'est ce qui se règle en amont, ou pas du tout.
-- ---------------------------------------------------------------------
create or replace function couverture_creneaux(
  p_evenement uuid,
  p_depuis timestamptz default null
)
returns table (
  creneau_id uuid, code text, poste text, debut timestamptz, fin timestamptz,
  lieu text, besoin integer, confirmes integer, proposes integer,
  presents integer, manque integer
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  select c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin,
    count(*) filter (where a.statut in ('confirme','present'))::int,
    count(*) filter (where a.statut = 'propose')::int,
    count(*) filter (where a.statut = 'present')::int,
    greatest(c.besoin - count(*) filter (where a.statut in ('confirme','present')), 0)::int
  from creneaux c
  left join lieux l on l.id = c.lieu_id
  left join affectations a
    on a.creneau_id = c.id and a.deleted_at is null and a.statut <> 'annule'
  where c.evenement_id = p_evenement
    and c.deleted_at is null
    and (p_depuis is null or c.fin >= p_depuis)
  group by c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin
  order by c.debut, c.poste;
$$;

grant execute on function couverture_creneaux(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Traçabilité et RLS
-- ---------------------------------------------------------------------
create trigger tracabilite_creneaux before insert or update on creneaux
  for each row execute function trg_tracabilite();
create trigger tracabilite_affectations before insert or update on affectations
  for each row execute function trg_tracabilite_simple();
create trigger tracabilite_jalons before insert or update on jalons
  for each row execute function trg_tracabilite();

alter table creneaux     enable row level security;
alter table affectations enable row level security;
alter table jalons       enable row level security;

create policy creneaux_lecture on creneaux for select to authenticated
  using (a_permission(evenement_id,'rh','lire') and deleted_at is null);
create policy creneaux_creation on creneaux for insert to authenticated
  with check (a_permission(evenement_id,'rh','creer'));
create policy creneaux_modification on creneaux for update to authenticated
  using (a_permission(evenement_id,'rh','modifier'))
  with check (a_permission(evenement_id,'rh','modifier'));

-- Le bénévole peut modifier SA propre affectation (confirmer, se
-- décommander) sans pouvoir toucher à celle des autres.
create policy affectations_lecture on affectations for select to authenticated
  using (a_permission(evenement_id,'rh','lire') and deleted_at is null);

create policy affectations_creation on affectations for insert to authenticated
  with check (a_permission(evenement_id,'rh','creer'));

create policy affectations_modification on affectations for update to authenticated
  using (
    a_permission(evenement_id,'rh','creer')
    or membre_id in (
      select id from membres_evenement
      where evenement_id = affectations.evenement_id and user_id = auth.uid()
    )
  )
  with check (
    a_permission(evenement_id,'rh','creer')
    or membre_id in (
      select id from membres_evenement
      where evenement_id = affectations.evenement_id and user_id = auth.uid()
    )
  );

create policy jalons_lecture on jalons for select to authenticated
  using (a_permission(evenement_id,'rh','lire') and deleted_at is null);
create policy jalons_creation on jalons for insert to authenticated
  with check (a_permission(evenement_id,'rh','creer'));
create policy jalons_modification on jalons for update to authenticated
  using (a_permission(evenement_id,'rh','modifier'))
  with check (a_permission(evenement_id,'rh','modifier'));

commit;;

-- ============ 020_module_analyse_rex ============
-- =====================================================================
-- Migration 020 : module ANALYSE / REX
--   1. rex_entrees   — constats remontés à chaud, pendant l'événement
--   2. rex_synthese  — métriques calculées sur les données réelles
--
-- Le REX 2026 a été produit à la main, trois semaines après, à partir
-- d'un export sans horodatage ni assignataire. Ici tout est déjà là.
-- =====================================================================

begin;

insert into matrice_permissions (role, phase, ressource, action)
select r, p, 'analyse', a
from unnest(array['coordinateur','chef_equipe','benevole']::role_evenement[]) r
cross join unnest(array['preparation','montage','exploitation','demontage','cloture']::phase_evenement[]) p
cross join unnest(array['lire','creer']::action_permission[]) a
on conflict do nothing;

insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, 'analyse', a
from unnest(array['preparation','montage','exploitation','demontage','cloture']::phase_evenement[]) p
cross join unnest(array['modifier','supprimer']::action_permission[]) a
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. REX À CHAUD
-- Remontable depuis n'importe quel écran, par n'importe quel membre.
-- Un constat noté sur le moment vaut dix reconstitués de mémoire.
-- ---------------------------------------------------------------------
create type impact_rex as enum ('mineur','gene','bloquant','dangereux');
create type nature_rex as enum ('dysfonctionnement','reussite','suggestion','risque');

create table rex_entrees (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,

  nature        nature_rex not null default 'dysfonctionnement',
  module        text,
  constat       text not null,
  impact        impact_rex not null default 'gene',
  proposition   text,

  phase         phase_evenement,
  lieu_id       uuid references lieux(id) on delete set null,
  objet_type    text,
  objet_id      uuid,
  objet_ref     text,

  -- Suivi de la suite donnée, d'une édition à l'autre
  retenu        boolean,
  traite_le     timestamptz,
  suite         text,

  membre_id     uuid references membres_evenement(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_rex_ev on rex_entrees (evenement_id, created_at desc)
  where deleted_at is null;

create trigger tracabilite_rex before insert or update on rex_entrees
  for each row execute function trg_tracabilite_simple();

create or replace function trg_journal_rex()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.impact in ('bloquant','dangereux') then
    perform journaliser(new.evenement_id, 'analyse', 'rex',
      'REX ' || new.impact || ' : ' || new.constat,
      'notable'::importance_journal, 'rex', new.id, null);
  end if;
  return null;
end;
$$;

create trigger journal_rex after insert on rex_entrees
  for each row execute function trg_journal_rex();

alter table rex_entrees enable row level security;

create policy rex_lecture on rex_entrees for select to authenticated
  using (a_permission(evenement_id,'analyse','lire') and deleted_at is null);
create policy rex_creation on rex_entrees for insert to authenticated
  with check (a_permission(evenement_id,'analyse','creer'));
create policy rex_modification on rex_entrees for update to authenticated
  using (a_permission(evenement_id,'analyse','modifier'))
  with check (a_permission(evenement_id,'analyse','modifier'));

-- ---------------------------------------------------------------------
-- 2. SYNTHÈSE
-- Toutes les métriques que l'export BFMF 2026 ne permettait pas de
-- calculer, faute d'horodatage et d'assignataire.
-- ---------------------------------------------------------------------
create or replace function rex_synthese(p_evenement uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not est_membre(p_evenement) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select jsonb_build_object(

    'signalements', (
      select jsonb_build_object(
        'total', count(*),
        'par_type', coalesce(jsonb_object_agg(t.type, t.n) filter (where t.type is not null), '{}'::jsonb),
        'delai_median_prise_en_charge_min', (
          select round(percentile_cont(0.5) within group (
            order by extract(epoch from (pris_en_charge_le - recu_le))/60))
          from signalements
          where evenement_id = p_evenement and pris_en_charge_le is not null
        ),
        'sans_position', (
          select count(*) from signalements
          where evenement_id = p_evenement and latitude is null and deleted_at is null
        ),
        'minutes_file_attente_max', (
          select round(max(extract(epoch from (recu_le - emis_le))/60))
          from signalements where evenement_id = p_evenement and emis_le is not null
        )
      )
      from (
        select type::text as type, count(*) as n
        from signalements where evenement_id = p_evenement and deleted_at is null
        group by type
      ) t
    ),

    'missions', (
      select jsonb_build_object(
        'total', count(*),
        'ouvertes', count(*) filter (where statut not in ('resolue','annulee')),
        'annulees', count(*) filter (where statut = 'annulee'),
        'part_p1_pct', round(100.0 * count(*) filter (where priorite = 'P1')
                             / greatest(count(*), 1)),
        'delai_median_min', round(percentile_cont(0.5) within group (
                              order by delai_reel_min) filter (where delai_reel_min is not null)),
        'delai_max_min', max(delai_reel_min),
        'par_module', (
          select coalesce(jsonb_object_agg(m.module, m.n), '{}'::jsonb)
          from (select module, count(*) n from missions
                where evenement_id = p_evenement and deleted_at is null
                group by module) m
        ),
        'non_attribuees', count(*) filter (where equipe_id is null and membre_id is null
                                             and statut not in ('resolue','annulee'))
      )
      from missions where evenement_id = p_evenement and deleted_at is null
    ),

    'logistique', (
      select jsonb_build_object(
        'mouvements', (select count(*) from mouvements_stock where evenement_id = p_evenement),
        'articles_sous_seuil', (
          select count(*) from materiel
          where evenement_id = p_evenement and deleted_at is null
            and seuil_alerte is not null and quantite <= seuil_alerte
        ),
        'biens_non_rendus', (
          select count(*) from attributions
          where evenement_id = p_evenement and deleted_at is null and rendu_le is null
        ),
        'transports', (select count(*) from transports
                       where evenement_id = p_evenement and deleted_at is null),
        'jauge_max', (
          select coalesce(max(cumul), 0) from (
            select sum(case when sens='entree' then nombre else -nombre end)
                   over (order by horodatage) as cumul
            from comptages where evenement_id = p_evenement and deleted_at is null
          ) c
        )
      )
    ),

    'parcours', (
      select jsonb_build_object(
        'groupes', count(*),
        'arrives', count(*) filter (where statut = 'arrive'),
        'abandons', count(*) filter (where statut = 'abandon'),
        'passages', (select count(*) from passages where evenement_id = p_evenement),
        'groupes_sans_pointage', count(*) filter (where dernier_passage is null
                                                    and statut in ('parti','en_cours'))
      )
      from groupes where evenement_id = p_evenement and deleted_at is null
    ),

    'rh', (
      select jsonb_build_object(
        'creneaux', (select count(*) from creneaux
                     where evenement_id = p_evenement and deleted_at is null),
        'besoin_total', (select coalesce(sum(besoin),0) from creneaux
                         where evenement_id = p_evenement and deleted_at is null),
        'confirmes', count(*) filter (where statut in ('confirme','present')),
        'presents', count(*) filter (where statut = 'present'),
        'defections', count(*) filter (where statut in ('absent','annule')),
        'taux_presence_pct', round(100.0 * count(*) filter (where statut = 'present')
                                   / greatest(count(*) filter (where statut in ('confirme','present')), 1))
      )
      from affectations where evenement_id = p_evenement and deleted_at is null
    ),

    'journal', (
      select jsonb_build_object(
        'entrees', count(*),
        'saisies', count(*) filter (where source = 'saisie'),
        'automatiques', count(*) filter (where source = 'systeme'),
        'majeures', count(*) filter (where importance = 'majeur'),
        'debut', min(horodatage),
        'fin', max(horodatage)
      )
      from journal where evenement_id = p_evenement and deleted_at is null
    ),

    'rex', (
      select jsonb_build_object(
        'entrees', count(*),
        'bloquants', count(*) filter (where impact in ('bloquant','dangereux')),
        'par_nature', (
          select coalesce(jsonb_object_agg(n.nature, n.c), '{}'::jsonb)
          from (select nature::text as nature, count(*) c from rex_entrees
                where evenement_id = p_evenement and deleted_at is null
                group by nature) n
        )
      )
      from rex_entrees where evenement_id = p_evenement and deleted_at is null
    )

  ) into v;

  return v;
end;
$$;

grant execute on function rex_synthese(uuid) to authenticated;

commit;;

-- ============ 021_fix_total_signalements_rex ============
-- =====================================================================
-- Migration 021 : correction du total de signalements dans rex_synthese
-- ---------------------------------------------------------------------
-- Défaut trouvé au test : le count(*) portait sur la sous-requête
-- agrégée par type. Il comptait donc le NOMBRE DE TYPES (3) et non le
-- nombre de signalements (11).
--
-- Une métrique fausse dans un REX est pire qu'une métrique absente :
-- elle est utilisée sans être vérifiée.
-- =====================================================================

create or replace function rex_synthese(p_evenement uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not est_membre(p_evenement) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select jsonb_build_object(

    'signalements', jsonb_build_object(
      'total', (select count(*) from signalements
                where evenement_id = p_evenement and deleted_at is null),
      'par_type', (
        select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb)
        from (select type::text as type, count(*) as n from signalements
              where evenement_id = p_evenement and deleted_at is null
              group by type) t
      ),
      'par_statut', (
        select coalesce(jsonb_object_agg(s.statut, s.n), '{}'::jsonb)
        from (select statut::text as statut, count(*) as n from signalements
              where evenement_id = p_evenement and deleted_at is null
              group by statut) s
      ),
      'delai_median_prise_en_charge_min', (
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (pris_en_charge_le - recu_le))/60))
        from signalements
        where evenement_id = p_evenement and pris_en_charge_le is not null
      ),
      'sans_position', (select count(*) from signalements
                        where evenement_id = p_evenement and latitude is null
                          and deleted_at is null),
      'minutes_file_attente_max', (
        select round(max(extract(epoch from (recu_le - emis_le))/60))
        from signalements where evenement_id = p_evenement and emis_le is not null)
    ),

    'missions', (
      select jsonb_build_object(
        'total', count(*),
        'ouvertes', count(*) filter (where statut not in ('resolue','annulee')),
        'annulees', count(*) filter (where statut = 'annulee'),
        'part_p1_pct', round(100.0 * count(*) filter (where priorite = 'P1')
                             / greatest(count(*), 1)),
        'delai_median_min', round(percentile_cont(0.5) within group (
                              order by delai_reel_min) filter (where delai_reel_min is not null)),
        'delai_max_min', max(delai_reel_min),
        'par_module', (
          select coalesce(jsonb_object_agg(m.module, m.n), '{}'::jsonb)
          from (select module, count(*) n from missions
                where evenement_id = p_evenement and deleted_at is null
                group by module) m
        ),
        'non_attribuees', count(*) filter (where equipe_id is null and membre_id is null
                                             and statut not in ('resolue','annulee'))
      )
      from missions where evenement_id = p_evenement and deleted_at is null
    ),

    'logistique', jsonb_build_object(
      'mouvements', (select count(*) from mouvements_stock where evenement_id = p_evenement),
      'articles_sous_seuil', (select count(*) from materiel
        where evenement_id = p_evenement and deleted_at is null
          and seuil_alerte is not null and quantite <= seuil_alerte),
      'biens_non_rendus', (select count(*) from attributions
        where evenement_id = p_evenement and deleted_at is null and rendu_le is null),
      'transports', (select count(*) from transports
        where evenement_id = p_evenement and deleted_at is null),
      'jauge_max', (
        select coalesce(max(cumul), 0) from (
          select sum(case when sens='entree' then nombre else -nombre end)
                 over (order by horodatage) as cumul
          from comptages where evenement_id = p_evenement and deleted_at is null) c)
    ),

    'parcours', (
      select jsonb_build_object(
        'groupes', count(*),
        'arrives', count(*) filter (where statut = 'arrive'),
        'abandons', count(*) filter (where statut = 'abandon'),
        'passages', (select count(*) from passages where evenement_id = p_evenement),
        'groupes_sans_pointage', count(*) filter (where dernier_passage is null
                                                    and statut in ('parti','en_cours'))
      )
      from groupes where evenement_id = p_evenement and deleted_at is null
    ),

    'rh', (
      select jsonb_build_object(
        'creneaux', (select count(*) from creneaux
                     where evenement_id = p_evenement and deleted_at is null),
        'besoin_total', (select coalesce(sum(besoin),0) from creneaux
                         where evenement_id = p_evenement and deleted_at is null),
        'confirmes', count(*) filter (where statut in ('confirme','present')),
        'presents', count(*) filter (where statut = 'present'),
        'defections', count(*) filter (where statut in ('absent','annule')),
        'taux_presence_pct', round(100.0 * count(*) filter (where statut = 'present')
                                   / greatest(count(*) filter (where statut in ('confirme','present')), 1))
      )
      from affectations where evenement_id = p_evenement and deleted_at is null
    ),

    'journal', (
      select jsonb_build_object(
        'entrees', count(*),
        'saisies', count(*) filter (where source = 'saisie'),
        'automatiques', count(*) filter (where source = 'systeme'),
        'majeures', count(*) filter (where importance = 'majeur'),
        'debut', min(horodatage), 'fin', max(horodatage)
      )
      from journal where evenement_id = p_evenement and deleted_at is null
    ),

    'rex', (
      select jsonb_build_object(
        'entrees', count(*),
        'bloquants', count(*) filter (where impact in ('bloquant','dangereux')),
        'par_nature', (
          select coalesce(jsonb_object_agg(n.nature, n.c), '{}'::jsonb)
          from (select nature::text as nature, count(*) c from rex_entrees
                where evenement_id = p_evenement and deleted_at is null
                group by nature) n
        )
      )
      from rex_entrees where evenement_id = p_evenement and deleted_at is null
    )

  ) into v;
  return v;
end;
$$;

grant execute on function rex_synthese(uuid) to authenticated;;

-- ============ 022_plan_implantation ============
-- =====================================================================
-- Migration 022 : PLAN D'IMPLANTATION « as built »
-- ---------------------------------------------------------------------
-- Un seul objet pour l'élément de plan ET l'installation à risque :
-- un foodtruck est un point de la carte qui porte des attributs de
-- risque. Deux tables obligeraient à saisir deux fois et à les tenir
-- synchronisées — ce qui ne tient pas un vendredi de montage.
--
-- Principe de saisie : on est sur place, donc on ne dessine pas, on se
-- POSITIONNE. Le GPS donne le point, on confirme, on qualifie.
-- =====================================================================

begin;

create type forme_element as enum ('point','ligne','zone');

create type categorie_element as enum (
  -- Points à risque
  'foodtruck','groupe_electrogene','stockage_gaz','bar_installation','feu',
  -- Moyens de secours
  'extincteur','dea','point_eau','poste_secours','coupure_gaz','coffret_electrique',
  -- Circulation et évacuation
  'sortie_secours','cheminement','itineraire_evacuation','voie_engins',
  -- Réseaux
  'cable','tuyau',
  -- Zones
  'scene','bar','camping','parking','perimetre','zone_interdite',
  'autre'
);

create table elements_plan (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  nom           text not null,

  forme         forme_element not null default 'point',
  categorie     categorie_element not null default 'autre',

  -- [[lat,lon], …] — un seul couple pour un point
  geometrie     jsonb not null default '[]'::jsonb,
  precision_m   double precision,

  -- Attributs de risque. Renseignés seulement quand ils ont un sens :
  -- un extincteur n'a pas de mesure de maîtrise, un foodtruck oui.
  est_risque      boolean not null default false,
  description     text,
  mesures_maitrise text,
  organe_coupure  text,
  moyens_proximite text,
  responsable     text,
  contact         text,
  fiche_reflexe_id uuid references fiches_reflexe(id) on delete set null,

  -- Cycle « as built » : un élément prévu devient constaté sur site.
  confirme        boolean not null default false,
  confirme_le     timestamptz,
  confirme_par    uuid references membres_evenement(id) on delete set null,
  ecart_constate  text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_elements_ev on elements_plan (evenement_id, categorie)
  where deleted_at is null;
create index idx_elements_risque on elements_plan (evenement_id)
  where deleted_at is null and est_risque;
create index idx_elements_a_confirmer on elements_plan (evenement_id)
  where deleted_at is null and not confirme;

comment on column elements_plan.precision_m is
  'Précision GPS annoncée. 5 à 10 m sur téléphone, davantage sous couvert forestier — ne jamais laisser croire à une précision qu''on n''a pas.';
comment on column elements_plan.confirme is
  'false = prévu sur plan. true = constaté sur site lors de la tournée de reconnaissance.';

create trigger tracabilite_elements before insert or update on elements_plan
  for each row execute function trg_tracabilite();

-- Confirmation : horodatage automatique + trace au journal pour les
-- éléments à risque, qui sont ceux qui comptent en cas d'incident.
create or replace function trg_confirmation_element()
returns trigger language plpgsql as $$
begin
  if new.confirme and not old.confirme and new.confirme_le is null then
    new.confirme_le := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger confirmation_element before update on elements_plan
  for each row execute function trg_confirmation_element();

create or replace function trg_journal_element()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.est_risque and (tg_op = 'INSERT' or (new.confirme and not old.confirme)) then
    perform journaliser(new.evenement_id, 'securite', 'implantation',
      'Installation à risque ' ||
      (case when tg_op = 'INSERT' then 'déclarée' else 'confirmée sur site' end) ||
      ' : ' || new.nom || ' (' || new.categorie || ')',
      'notable'::importance_journal, 'element_plan', new.id, new.code);
  end if;
  return null;
end;
$$;

create trigger journal_element after insert or update on elements_plan
  for each row execute function trg_journal_element();

-- ---------------------------------------------------------------------
-- Tournée de reconnaissance : ce qui reste à confirmer sur site.
-- ---------------------------------------------------------------------
create or replace function plan_a_confirmer(p_evenement uuid)
returns table (
  id uuid, code text, nom text, categorie text,
  est_risque boolean, a_position boolean
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  select e.id, e.code, e.nom, e.categorie::text, e.est_risque,
         jsonb_array_length(e.geometrie) > 0
  from elements_plan e
  where e.evenement_id = p_evenement
    and e.deleted_at is null
    and not e.confirme
  order by e.est_risque desc, e.categorie, e.code;
$$;

grant execute on function plan_a_confirmer(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS — ressource 'plan_implantation', déjà dans la matrice.
-- Le chef d'équipe peut créer et confirmer en phases terrain : c'est
-- toute l'idée de déléguer la tournée de reconnaissance.
-- ---------------------------------------------------------------------
alter table elements_plan enable row level security;

create policy elements_lecture on elements_plan for select to authenticated
  using (a_permission(evenement_id,'plan_implantation','lire') and deleted_at is null);
create policy elements_creation on elements_plan for insert to authenticated
  with check (a_permission(evenement_id,'plan_implantation','creer'));
create policy elements_modification on elements_plan for update to authenticated
  using (a_permission(evenement_id,'plan_implantation','modifier'))
  with check (a_permission(evenement_id,'plan_implantation','modifier'));

commit;;
