-- =====================================================================
-- Migration 056 : enrichir les demandes et les transports, repris de
-- BFMF2026 — localisation précise, délai, blocage, adresse GPS externe,
-- volume de matériel, heure d'arrivée attendue.
-- =====================================================================

alter table missions add column qui_concerne text;
alter table missions add column bloquant boolean not null default false;
comment on column missions.qui_concerne is 'Qui est concerné par la demande — personne ou fonction, texte libre.';

alter table transports add column type_transport text;
alter table transports add column adresse_depart text;
alter table transports add column adresse_arrivee text;
alter table transports add column volume_materiel text;
alter table transports add column attendu_le timestamptz;
comment on column transports.adresse_depart is 'Adresse GPS/postale externe — distincte de depart_lieu_id, qui désigne un point interne connu.';
comment on column transports.attendu_le is 'Heure attendue à destination — distincte de souhaite_pour, qui est l''heure de prise en charge.';