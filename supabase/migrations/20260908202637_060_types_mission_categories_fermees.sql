-- =====================================================================
-- Migration 060 : sept catégories fermées, REX BFMF 2026 (#1 + #2)
-- ---------------------------------------------------------------------
-- Constat chiffré du REX : le module à texte libre produit 66 missions
-- sur 74 classées « Autre » et une priorité qui ne discrimine rien
-- (P1 = 36 min, P2 = 47 min — écart non significatif, 35 % classées P1
-- arbitrairement). Le module à catégories fermées, même équipe, même
-- jour : 22 min de délai médian, 100 % de complétude.
--
-- types_mission existait déjà en base, avec exactement les colonnes
-- nécessaires (categorie, priorite, delai_cible_min) — jamais peuplé,
-- jamais branché dans le formulaire de création. Ce n'est pas une
-- table à créer, c'est un mécanisme à faire enfin servir.
-- =====================================================================

insert into types_mission (evenement_id, code, libelle, categorie, priorite, delai_cible_min)
select e.id, v.code, v.libelle, v.categorie, v.priorite::priorite_mission, v.delai
from evenements e,
(values
  ('transport', 'Transport de personnes', 'transport_personnes', 'P3', 30),
  ('reappro', 'Réappro boissons / consommables', 'reappro_boissons', 'P3', 45),
  ('caisse', 'Monnaie / caisse', 'monnaie_caisse', 'P3', 30),
  ('sanitaire', 'Sanitaire', 'sanitaire', 'P2', 20),
  ('energie', 'Énergie / éclairage', 'energie', 'P2', 20),
  ('amenagement', 'Aménagement / installation', 'amenagement', 'P4', 60),
  ('securite', 'Sécurité — situation à risque', 'securite', 'P1', 10)
) as v(code, libelle, categorie, priorite, delai)
where e.deleted_at is null
on conflict do nothing;