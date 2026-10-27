-- =====================================================================
-- 132 — CATALOGUE DU PLAN : SECOURS ET EAU (retour de Ren, 27/10)
--
-- Cinq objets de plus dans le catalogue standard (organisation_id nul,
-- donc visibles de tous) :
--
--   POINTEAUNAT — point d'eau naturel (rivière, étang, réserve) : une
--                 prise d'eau pour les pompiers, source du réseau d'eau.
--   POMPE       — pompe à eau : elle alimente, c'est une source.
--   HELIJOUR    — zone d'atterrissage suggérée, de jour : 25 × 25 m.
--   HELINUIT    — zone d'atterrissage nocturne : 40 × 40 m, balisée.
--   CABMED      — cabinet médical : le local de consultation du médecin
--                 de l'événement, à côté du PMA et du poste de secours.
--
-- Les catégories existantes suffisent (`point_eau`, `aire_helico`,
-- `poste_secours`) : pas de valeur ajoutée à l'énuméré. L'insertion est
-- gardée par « n'existe pas encore » (l'index `catalogue_code_standard`
-- la refuserait de toute façon en double). Aucun DROP.
-- =====================================================================

begin;

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, nature, source_eau, accueil_public, ordre, description)
select v.code, v.libelle, v.calque, v.categorie::public.categorie_element, v.forme, v.largeur_m, v.longueur_m, v.nature, v.source_eau, v.accueil_public, v.ordre, v.description
from (values
  ('POINTEAUNAT', 'Point d''eau naturel',                       'eau',      'point_eau',     'cercle', 3.0,  3.0,  'objet', true,  false, 56, 'Rivière, étang, réserve : prise d''eau des pompiers. Précise le débit (l/min) et l''accès des engins'),
  ('POMPE',       'Pompe à eau',                                'eau',      'point_eau',     'rect',   0.8,  1.2,  'objet', true,  false, 57, 'Motopompe ou pompe électrique : alimente le réseau depuis un point d''eau. Précise le débit'),
  ('HELIJOUR',    'Zone d''atterrissage suggérée (jour)',       'securite', 'aire_helico',   'rect',   25.0, 25.0, 'objet', false, false, 84, 'Aire plane et dégagée d''au moins 25 × 25 m, sans fil ni mât dans l''axe d''approche, accès des secours, foule tenue à distance'),
  ('HELINUIT',    'Zone d''atterrissage nocturne hélicoptère',  'securite', 'aire_helico',   'rect',   40.0, 40.0, 'objet', false, false, 85, 'Au moins 40 × 40 m, balisage lumineux des quatre coins et du vent, sol ferme, éclairage ambiant coupé à l''approche'),
  ('CABMED',      'Cabinet médical',                            'securite', 'poste_secours', 'rect',   3.0,  4.0,  'objet', false, true,  81, 'Local de consultation du médecin de l''événement : discret, chauffé, éclairé, eau à proximité')
) as v(code, libelle, calque, categorie, forme, largeur_m, longueur_m, nature, source_eau, accueil_public, ordre, description)
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = v.code
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle, calque, categorie from catalogue_equipements
--    where code in ('POINTEAUNAT','POMPE','HELIJOUR','HELINUIT','CABMED');  -- 5 lignes
-- =====================================================================
