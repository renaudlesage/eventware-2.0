-- ============ 033_acces_secours ============
-- =====================================================================
-- Migration 033 : catégories d'accès et de dispositif de secours
-- ---------------------------------------------------------------------
-- Vocabulaire de la doctrine belge plutôt que termes génériques : c'est
-- ce que les intervenants cherchent sur un plan, et l'écart de langage
-- coûte des minutes au moment où il ne faut pas en perdre.
--
--   PRV  — point de regroupement des victimes
--   PMA  — poste médical avancé
--   noria — trajet PRV → PMA (petite) ou PMA → hôpital (grande)
-- =====================================================================

alter type categorie_element add value if not exists 'point_rassemblement';
alter type categorie_element add value if not exists 'prv';
alter type categorie_element add value if not exists 'pma';
alter type categorie_element add value if not exists 'aire_helico';
alter type categorie_element add value if not exists 'point_transfert';
alter type categorie_element add value if not exists 'noria';
alter type categorie_element add value if not exists 'point_rencontre_secours';;
