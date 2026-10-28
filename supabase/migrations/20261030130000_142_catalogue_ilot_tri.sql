-- =====================================================================
-- 142 — CATALOGUE LOGISTIQUE : ÎLOT DE TRI SÉLECTIF (retour de Ren, 28/10)
--
-- Un îlot de tri de plus dans le calque logistique du catalogue
-- standard, à côté du conteneur 1 100 l et de la benne : quatre bacs
-- côte à côte (PMC, papier-carton, verre, résiduel) sous un panneau,
-- 3 × 1,5 m. Insertion gardée par « n'existe pas encore ». Aucun DROP.
-- =====================================================================

begin;

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, hauteur_m, nature, accueil_public, ordre, description)
select 'ILOTTRI', 'Îlot de tri sélectif', 'logistique', 'autre'::public.categorie_element, 'rect', 3.0, 1.5, 1.2, 'objet', true, 76,
       'Quatre bacs côte à côte (PMC, papier-carton, verre, résiduel) sous un panneau ; un par zone de restauration, accessible aux engins pour la vidange'
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = 'ILOTTRI'
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle, calque from catalogue_equipements where code = 'ILOTTRI';  -- 1 ligne
-- =====================================================================
