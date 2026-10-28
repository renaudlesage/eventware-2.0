-- =====================================================================
-- 143 — CATALOGUE ÉNERGIE : MÂTS LUMINEUX (retour de Ren, 28/10)
--
-- Deux mâts d'éclairage dans le calque énergie du catalogue standard,
-- après les coffrets :
--
--   MATLUMEL — mât lumineux électrique : projecteurs LED sur mât
--              télescopique, branché sur le réseau de l'événement
--              (0,6 kW, à raccorder à un coffret). 1 × 1 m au sol, 7 m.
--   MATLUMTH — mât lumineux thermique : tour d'éclairage sur remorque,
--              groupe diesel intégré, autonome. Du carburant sur site :
--              installation à risque, 3 m de distance de sécurité.
--              1,5 × 3 m au sol, 9 m déployé.
--
-- Insertion gardée par « n'existe pas encore ». Aucun DROP.
-- =====================================================================

begin;

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, hauteur_m, nature, puissance_kw, production_kva, est_risque, distance_securite_m, accueil_public, ordre, description)
select v.code, v.libelle, 'energie', 'autre'::public.categorie_element, 'rect', v.largeur_m, v.longueur_m, v.hauteur_m, 'objet', v.puissance_kw, 0, v.est_risque, v.distance_securite_m, false, v.ordre, v.description
from (values
  ('MATLUMEL', 'Mât lumineux électrique', 1.0, 1.0, 7.0, 0.6, false, 0.0, 50, 'Projecteurs LED sur mât télescopique, branché sur le réseau : 0,6 kW à raccorder à un coffret. Haubané ou lesté par vent fort'),
  ('MATLUMTH', 'Mât lumineux thermique',  1.5, 3.0, 9.0, 0.0, true,  3.0, 51, 'Tour d''éclairage sur remorque, groupe diesel intégré, autonome : carburant sur site, extincteur à proximité, 3 m dégagés, pas sous les arbres')
) as v(code, libelle, largeur_m, longueur_m, hauteur_m, puissance_kw, est_risque, distance_securite_m, ordre, description)
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = v.code
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle, puissance_kw, est_risque from catalogue_equipements
--    where code in ('MATLUMEL', 'MATLUMTH');  -- 2 lignes
-- =====================================================================
