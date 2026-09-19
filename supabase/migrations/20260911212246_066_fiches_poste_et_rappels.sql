-- =====================================================================
-- Migration 066 : fiche de poste et rappel de prise de poste
-- ---------------------------------------------------------------------
-- Deux besoins distincts, souvent confondus :
--
--   La FICHE DE POSTE est durable et attachée au poste, pas au créneau.
--   « Responsable BAR plaine » veut dire la même chose à 18h et à 02h ;
--   l'écrire une fois et la rattacher évite qu'une version dérive de
--   l'autre. C'est pour ça qu'elle n'est pas un simple champ texte de
--   plus sur creneaux — `consignes` existait déjà et était vide sur les
--   cinq créneaux, signe qu'un champ libre ne suffit pas à faire écrire.
--
--   Le RAPPEL est ponctuel et attaché au créneau : « on se retrouve à
--   l'entrée, prends une frontale ». Il vit et meurt avec ce créneau-là.
-- =====================================================================

begin;

create table fiches_poste (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  intitule      text not null,
  mission       text,
  taches        jsonb not null default '[]'::jsonb,
  materiel      text,
  a_signaler    text,
  contact       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  unique (evenement_id, intitule)
);

comment on table fiches_poste is
  'Ce que fait un poste, écrit une fois et réutilisé par tous ses créneaux.';
comment on column fiches_poste.mission is
  'En une phrase : à quoi sert ce poste. Ce que le bénévole lit en premier.';
comment on column fiches_poste.a_signaler is
  'Ce qu''il doit remonter immédiatement plutôt que gérer seul — la limite de son autonomie.';

alter table creneaux add column fiche_id uuid references fiches_poste(id) on delete set null;

-- Rappel de prise de poste : ponctuel, propre au créneau.
alter table creneaux add column rappel text;
alter table creneaux add column rappel_envoye_le timestamptz;
alter table creneaux add column rappel_par uuid references auth.users(id);
comment on column creneaux.rappel is
  'Message du chef d''équipe aux affectés de CE créneau, avant la prise de poste.';

alter table fiches_poste enable row level security;

-- Lecture ouverte à tout membre : un bénévole doit pouvoir lire la fiche
-- du poste qu'on lui confie, sans capacité d'encadrement.
create policy fiches_poste_lecture on fiches_poste for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);

create policy fiches_poste_ecriture on fiches_poste for all to authenticated
  using (a_permission(evenement_id, 'rh', 'creer'))
  with check (a_permission(evenement_id, 'rh', 'creer'));

commit;