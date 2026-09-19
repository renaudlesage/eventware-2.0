-- =====================================================================
-- Migration 070 : deux modes de suivi de parcours
-- ---------------------------------------------------------------------
-- GROUPES ENCADRÉS (BFMF) : des entités nommées, un accompagnateur
--   joignable, un effectif connu. On suit QUI est où. Modèle existant.
--
-- INDIVIDUS ISOLÉS (marche Adeps, rando VTT) : des centaines de
--   participants sans encadrant ni identité suivie. On ne peut pas
--   suivre qui est où — on COMPTE des passages à chaque borne.
--
-- La question de sécurité change avec le mode. En groupes : « le
-- groupe 3 n'a pas pointé depuis 50 min ». En individuels : « 340
-- partis, 310 arrivés — il en reste 30 dehors, et 12 entre E2B et
-- E3B ». C'est ce second chiffre qui décide d'une battue en fin de
-- journée.
--
-- Les comptages sont stockés en INCRÉMENTS horodatés, pas en cumul :
--   - deux bénévoles peuvent compter à la même borne sans s'écraser ;
--   - un incrément négatif corrige une erreur sans réécrire l'histoire ;
--   - le débit par heure se déduit, un cumul seul l'aurait perdu.
-- =====================================================================

begin;

create type mode_parcours as enum ('groupes', 'individuels');

alter table evenements add column mode_parcours mode_parcours not null default 'groupes';
comment on column evenements.mode_parcours is
  'Quel suivi Parcours présente en premier. Les deux modèles de données coexistent : un événement hybride (individuels + quelques groupes encadrés) reste possible.';

create table comptages_parcours (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  lieu_id       uuid not null references lieux(id) on delete cascade,
  nombre        integer not null,
  horodatage    timestamptz not null default now(),
  membre_id     uuid references membres_evenement(id),
  commentaire   text,
  created_at    timestamptz not null default now()
);

create index on comptages_parcours (evenement_id, lieu_id, horodatage);

comment on table comptages_parcours is
  'Passages comptés à une borne, en incréments horodatés. Un nombre négatif corrige sans effacer.';

alter table comptages_parcours enable row level security;

create policy comptages_lecture on comptages_parcours for select to authenticated
  using (est_membre(evenement_id));

-- Écriture ouverte à tout membre : c'est un bénévole posté à la borne
-- qui compte, pas l'encadrement. Lui demander une capacité
-- d'encadrement garantirait que personne ne compte.
create policy comptages_ecriture on comptages_parcours for insert to authenticated
  with check (est_membre(evenement_id));

commit;