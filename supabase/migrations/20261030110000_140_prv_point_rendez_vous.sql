-- =====================================================================
-- 140 — PRV = POINT DE RENDEZ-VOUS DES SECOURS (retour de Ren, 28/10)
--
-- La 139 avait rangé « PRV secours » dans la catégorie prv, qui dans
-- l'application veut dire « regroupement des victimes ». Pour Ren, PRV
-- est le point de rendez-vous des secours : c'est la catégorie
-- point_rencontre_secours (celle que la vue autorité liste sous « accès
-- secours »). Le pictogramme devient « PRV » en blanc sur fond rouge
-- (src/pictos.js). Une mise à jour d'une ligne du catalogue, aucun DROP.
-- =====================================================================

begin;

update public.catalogue_equipements
   set categorie = 'point_rencontre_secours'::public.categorie_element,
       libelle = 'PRV secours (point de rendez-vous)',
       description = 'Point de rendez-vous des secours : là où les engins sont attendus et guidés. Lettres PRV en blanc sur fond rouge, comme sur le terrain'
 where organisation_id is null and code = 'PRVP';

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle, categorie from catalogue_equipements where code = 'PRVP';
--   -- PRV secours (point de rendez-vous), point_rencontre_secours
-- =====================================================================
