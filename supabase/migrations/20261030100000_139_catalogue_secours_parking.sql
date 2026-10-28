-- =====================================================================
-- 139 — CATALOGUE : PRV, ACCÈS SECOURS, VOIE D'ACCÈS SECOURS, PARKING
--       (retour de Ren, 28/10)
--
-- Quatre entrées de plus dans le catalogue standard, toutes avec leur
-- pictogramme (src/pictos.js) :
--
--   PRVP      — PRV secours : le point de regroupement des victimes,
--               pictogramme vert (brancard). Calque sécurité.
--   ACCESSECP — accès secours : flèche blanche sur fond rouge, à tourner
--               vers l'entrée (la rotation d'un pictogramme se règle
--               dans sa fiche). Calque sécurité, catégorie voie_engins.
--   VOIESEC   — voie d'accès secours : un tracé (nature ligne), dessiné
--               en chaussée rouge sur la carte ; 4 m de large, ce que le
--               bilan de sécurité vérifie. Calque sécurité, voie_engins.
--   PARKINGP  — parking : le P bleu. Calque circulation.
--
-- Insertion gardée par « n'existe pas encore ». Aucun DROP.
-- =====================================================================

begin;

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, nature, picto, accueil_public, ordre, description)
select v.code, v.libelle, v.calque, v.categorie::public.categorie_element, v.forme, v.largeur_m, v.longueur_m, v.nature, v.picto, v.accueil_public, v.ordre, v.description
from (values
  ('PRVP',      'PRV secours',            'securite',    'prv',         'cercle', 3.0, 3.0, 'picto', 'prv',           false, 83, 'Point de regroupement des victimes : à côté du poste de secours, accessible aux ambulances, à l''abri des regards'),
  ('ACCESSECP', 'Accès secours',          'securite',    'voie_engins', 'cercle', 3.0, 3.0, 'picto', 'acces_secours', false, 88, 'Flèche blanche sur fond rouge : tourne-la vers l''entrée des engins (rotation dans la fiche). Gardé libre en permanence'),
  ('VOIESEC',   'Voie d''accès secours',  'securite',    'voie_engins', 'rect',   4.0, 0.1, 'ligne', 'voie_secours',  false, 89, 'Tracé de la voie engins : 4 m de large et 3,5 m de haut libres, rayon de braquage 11 m, pas de stationnement. Le bilan de sécurité la vérifie'),
  ('PARKINGP',  'Parking',                'circulation', 'parking',     'cercle', 3.0, 3.0, 'picto', 'parking',       true,  93, 'Marque l''entrée ou le centre d''un parking ; la zone elle-même se dessine avec un objet à l''échelle si besoin')
) as v(code, libelle, calque, categorie, forme, largeur_m, longueur_m, nature, picto, accueil_public, ordre, description)
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = v.code
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, calque, nature, picto from catalogue_equipements
--    where code in ('PRVP','ACCESSECP','VOIESEC','PARKINGP');  -- 4 lignes
-- =====================================================================
