-- =====================================================================
-- Migration 044 : province de l'événement
-- ---------------------------------------------------------------------
-- Nécessaire pour interroger l'avertissement officiel Meteoalarm (relai
-- de l'IRM) par zone. Champ libre plutôt qu'énuméré : les intitulés de
-- zone Meteoalarm ne correspondent pas toujours exactement aux dix
-- provinces belges, mieux vaut pouvoir corriger à la main.
-- =====================================================================

alter table evenements add column province text;
comment on column evenements.province is
  'Nom de province tel qu''utilisé par Meteoalarm, pour interroger l''avertissement officiel IRM.';