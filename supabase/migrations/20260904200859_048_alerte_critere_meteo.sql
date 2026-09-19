-- =====================================================================
-- Migration 048 : rattacher une alerte à son critère météo
-- ---------------------------------------------------------------------
-- Défaut trouvé à l'usage : rien n'empêchait de cliquer plusieurs fois
-- sur « Diffuser l'alerte », chaque clic créant une nouvelle alerte
-- distincte. Sans savoir qu'une alerte est déjà active pour ce critère,
-- le bouton ne pouvait pas non plus se transformer en « Lever ».
--
-- Une colonne, nullable — vide pour toute alerte qui ne vient pas de la
-- veille météo (bandeau manuel, Mayday).
-- =====================================================================

alter table alertes add column source_meteo_critere text;
comment on column alertes.source_meteo_critere is
  'Critère météo d''origine (vent, pluie, chaleur, froid, orage) si l''alerte vient de la veille. Permet de savoir qu''une alerte est déjà active pour ce critère avant d''en proposer une nouvelle.';