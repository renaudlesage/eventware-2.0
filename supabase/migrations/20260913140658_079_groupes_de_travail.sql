-- =====================================================================
-- Migration 079 : groupes de travail pour la phase de préparation
-- ---------------------------------------------------------------------
-- En préparation, les utilisateurs ne sont pas des bénévoles mais les
-- membres de l'organisation, et le travail s'organise en groupes :
-- sécurité, bar, communication, logistique.
--
-- Un groupe de travail n'est PAS une équipe opérationnelle. « Volante »
-- ou « Catering » disent qui fait quoi PENDANT l'événement ; un groupe
-- de travail dit qui prépare quoi AVANT. Les mêmes personnes s'y
-- retrouvent souvent, mais pas toujours, et surtout pas aux mêmes
-- moments. Deux tables distinctes, donc.
--
-- Les ACTIONS d'un groupe réutilisent `jalons` plutôt qu'une table
-- parallèle : un jalon est déjà un libellé, un responsable, une
-- échéance, un statut et un caractère critique. En créer une copie
-- aurait produit deux objets qui divergent — le défaut qu'on a déjà
-- corrigé trois fois dans ce projet.
--
-- Seul changement nécessaire : l'échéance devient facultative. Une
-- action de préparation n'a pas toujours de date, et l'exiger pousse
-- à en inventer une fausse ou à ne rien créer du tout. Les actions
-- sans date sortent naturellement de la frise du Planning, qui filtre
-- déjà sur l'échéance.
-- =====================================================================

begin;

create table groupes_travail (
  id               uuid primary key default gen_random_uuid(),
  evenement_id     uuid not null references evenements(id) on delete cascade,
  nom              text not null,
  objet            text,
  pilote_membre_id uuid references membres_evenement(id) on delete set null,
  ordre            integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  deleted_at       timestamptz,
  unique (evenement_id, nom)
);

comment on table groupes_travail is
  'Qui prépare quoi avant l''événement. Distinct des équipes opérationnelles, qui disent qui fait quoi pendant.';
comment on column groupes_travail.objet is
  'Le périmètre du groupe en une phrase — ce dont il répond, et ce dont il ne répond pas.';

create table membres_groupe_travail (
  groupe_id  uuid not null references groupes_travail(id) on delete cascade,
  membre_id  uuid not null references membres_evenement(id) on delete cascade,
  primary key (groupe_id, membre_id)
);

alter table jalons alter column echeance drop not null;
alter table jalons add column groupe_travail_id uuid
  references groupes_travail(id) on delete set null;

comment on column jalons.echeance is
  'Facultative : une action de préparation n''a pas toujours de date. Sans échéance, elle n''apparaît pas dans la frise du Planning — c''est voulu.';

alter table groupes_travail enable row level security;
alter table membres_groupe_travail enable row level security;

-- Lecture ouverte à tout membre : on doit pouvoir voir qui prépare quoi.
create policy gt_lecture on groupes_travail for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);
create policy gt_ecriture on groupes_travail for all to authenticated
  using (a_permission(evenement_id, 'rh', 'creer'))
  with check (a_permission(evenement_id, 'rh', 'creer'));

create policy mgt_lecture on membres_groupe_travail for select to authenticated
  using (exists (select 1 from groupes_travail g
                 where g.id = groupe_id and est_membre(g.evenement_id)));
create policy mgt_ecriture on membres_groupe_travail for all to authenticated
  using (exists (select 1 from groupes_travail g
                 where g.id = groupe_id and a_permission(g.evenement_id, 'rh', 'creer')))
  with check (exists (select 1 from groupes_travail g
                 where g.id = groupe_id and a_permission(g.evenement_id, 'rh', 'creer')));

commit;