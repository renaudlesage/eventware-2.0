-- =====================================================================
-- Migration 038 : programme public
-- ---------------------------------------------------------------------
-- Ce que la v18 appelait concerts et départs de balade : des créneaux
-- datés destinés au PUBLIC ou à l'organisation, informationnels plutôt
-- qu'opérationnels. Distinct des jalons (échéances internes) et des
-- missions (tâches à exécuter).
--
-- Générique à dessein : une rando y met ses départs de groupe, un
-- festival ses concerts, une marche Adeps ses animations. La catégorie
-- reste un texte libre plutôt qu'un énuméré fermé au métier musical.
-- =====================================================================

begin;

create table programme (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,

  titre         text not null,          -- nom du concert, de l'animation, du départ
  categorie     text,                    -- concert, depart, animation, ceremonie…
  intervenant   text,                    -- artiste, animateur — facultatif

  debut         timestamptz not null,
  duree_min     integer,
  lieu_id       uuid references lieux(id) on delete set null,
  lieu_libre    text,

  description   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_programme_ev on programme (evenement_id, debut)
  where deleted_at is null;

comment on table programme is
  'Créneaux publics datés — concerts, animations, départs de groupe. Informationnel : ne porte ni statut ni assignation, à la différence des missions.';

create trigger tracabilite_programme before insert or update on programme
  for each row execute function trg_tracabilite();

alter table programme enable row level security;

-- Lecture ouverte à tout membre, sans passer par la matrice : le
-- planning est un document public à l'intérieur du dispositif, comme
-- dans la v18 où il n'imposait aucune restriction de rôle.
create policy programme_lecture on programme for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);

create policy programme_creation on programme for insert to authenticated
  with check (a_permission(evenement_id,'referentiels','creer'));
create policy programme_modification on programme for update to authenticated
  using (a_permission(evenement_id,'referentiels','modifier'))
  with check (a_permission(evenement_id,'referentiels','modifier'));

commit;