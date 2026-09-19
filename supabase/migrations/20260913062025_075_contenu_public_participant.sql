-- =====================================================================
-- Migration 075 : variante publique de l'application
-- ---------------------------------------------------------------------
-- Principe non négociable : RIEN n'est public par défaut.
--
-- `lieux` contient le PC Ops, les PRV, les voies de secours et les
-- zones techniques. Une publication par défaut, même « corrigée plus
-- tard », afficherait au public l'emplacement du poste de commandement
-- et les itinéraires d'évacuation comme s'ils étaient des chemins à
-- emprunter. L'organisateur coche ce qu'il publie, jamais l'inverse.
--
-- Même raison pour le programme (les briefings et le montage n'y
-- regardent personne) et pour les alertes : « PMR15 sature » ne
-- concerne pas les participants, « mise à l'abri générale » si.
-- =====================================================================

begin;

alter table lieux add column public boolean not null default false;
alter table programme add column public boolean not null default false;
alter table alertes add column public boolean not null default false;

comment on column lieux.public is
  'Visible dans l''app participant. Faux par défaut — on ne publie pas un PC Ops par omission.';
comment on column alertes.public is
  'Poussée aux participants. C''est la discipline 5 de l''AR du 22/05/2019 — alerte et information de la population.';

-- Communications : avant, pendant, et surtout APRÈS l'événement —
-- remerciements, photos, annonce de l'édition suivante. C'est ce qui
-- fait qu'un participant garde l'app plutôt que de la désinstaller le
-- dimanche soir.
create table communications (
  id                uuid primary key default gen_random_uuid(),
  evenement_id      uuid not null references evenements(id) on delete cascade,
  titre             text not null,
  corps             text,
  lien_url          text,
  lien_libelle      text,
  publie_le         timestamptz,
  visible_jusqu_au  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  deleted_at        timestamptz
);

comment on column communications.publie_le is
  'Null = brouillon. Une communication ne part pas tant qu''elle n''est pas datée.';

alter table communications enable row level security;

create policy communications_lecture on communications for select to authenticated
  using (est_membre(evenement_id));
create policy communications_ecriture on communications for all to authenticated
  using (a_permission(evenement_id, 'evenement', 'modifier'))
  with check (a_permission(evenement_id, 'evenement', 'modifier'));

commit;