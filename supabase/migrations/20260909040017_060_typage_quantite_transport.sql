-- =====================================================================
-- Migration 060 : typer la quantité selon la nature du transport
-- ---------------------------------------------------------------------
-- REX BFMF 2026, point 5 : le champ nb_personnes a été détourné en
-- litres pour une course de mazout. Le transport de matériel n'entrait
-- dans aucune des trois catégories existantes (artiste, staff,
-- technique) — il fallait le contourner pour l'encoder du tout.
-- =====================================================================

alter table transports add column unite_quantite text not null default 'personnes';
comment on column transports.unite_quantite is
  'Unité du champ nb_personnes selon la nature du transport : personnes, litres, kg, unites. Renommé en pratique mais la colonne reste nb_personnes pour ne pas casser l''historique.';