-- =====================================================================
-- Migration 061 : annule entièrement la migration 060, qui reposait
-- sur un diagnostic faux.
-- ---------------------------------------------------------------------
-- Le déclencheur trg_appliquer_mouvement existait déjà et faisait
-- correctement le travail. Ma recherche initiale (proname avec
-- 'mouvements_stock' dans prosrc) ne l'a pas trouvé parce que son
-- corps ne mentionne jamais le nom de la table littéralement — un
-- angle mort de ma méthode, pas un défaut réel du produit.
--
-- Deux dégâts à corriger :
--  1. Le trigger redondant que j'ai ajouté, à retirer.
--  2. La réconciliation que j'ai lancée en migration 060, qui a
--     compté une deuxième fois l'historique des mouvements déjà
--     correctement appliqué par le déclencheur d'origine.
-- =====================================================================

drop trigger if exists maj_quantite_stock on mouvements_stock;
drop function if exists trg_maj_quantite_stock();

-- Retire le double comptage introduit par la réconciliation erronée :
-- pour chaque article, on retranche exactement ce que cette
-- réconciliation avait ajouté à tort — la somme de son propre
-- historique de mouvements, déjà pris en compte une première fois par
-- le vrai déclencheur avant même mon intervention.
update materiel m
set quantite = m.quantite - coalesce((
  select sum(case
    when ms.sens = 'entree' then ms.quantite
    when ms.sens = 'sortie' then -ms.quantite
    when ms.sens = 'ajustement' then ms.quantite
    else 0
  end)
  from mouvements_stock ms
  where ms.materiel_id = m.id and ms.deleted_at is null
    and ms.motif is distinct from 'Test réconciliation'
), 0);

-- Retire le mouvement de test lui-même et son effet — appliqué deux
-- fois (par le vrai déclencheur et par le mien, avant que je le
-- retire), pour un article qui n'avait pas d'historique préalable et
-- n'a donc pas été touché par la ligne de réconciliation ci-dessus.
delete from mouvements_stock where motif = 'Test réconciliation';
update materiel set quantite = 76 where id = 'b14ffbe6-ff5b-415e-8b2e-f46a173d6f73';