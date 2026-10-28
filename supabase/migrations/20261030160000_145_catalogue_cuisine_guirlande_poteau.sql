-- =====================================================================
-- 145 — CATALOGUE : CUISINE, GUIRLANDE LED, POTEAU (retour de Ren, 28/10)
--
-- Restauration : four, frigo (armoire), congélateur, évier, pompe à
-- bière — ce qu'un bar ou une cuisine de fête branche et raccorde ;
-- chacun avec sa puissance, l'évier avec son besoin d'eau.
--
-- Énergie : la guirlande LED, un tracé (nature ligne) par modules de
-- 10 m, 10 W par mètre : la puissance de l'élément posé est celle de
-- ses modules, et elle se raccorde à un coffret comme tout consommateur.
--
-- Infrastructures : le poteau, support de guirlandes, enseignes,
-- haut-parleurs ; sur la carte, les sommets d'un tracé s'y accrochent
-- (lien « fixé sur ») et le suivent quand on le déplace.
--
-- Insertion gardée par « n'existe pas encore ». Aucun DROP.
-- =====================================================================

begin;

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, hauteur_m, nature, puissance_kw, besoin_eau, accueil_public, ordre, description)
select v.code, v.libelle, v.calque, 'autre'::public.categorie_element, 'rect', v.largeur_m, v.longueur_m, v.hauteur_m, v.nature, v.puissance_kw, v.besoin_eau, false, v.ordre, v.description
from (values
  ('FOUR',       'Four électrique',            'restauration',    0.9,  0.9, 0.9, 'objet', 3.5, false, 36, 'Four de cuisine, 3,5 kW sur prise 16 A : un départ dédié au coffret'),
  ('FRIGOARM',   'Frigo (armoire)',            'restauration',    0.7,  0.8, 2.0, 'objet', 0.5, false, 37, 'Armoire réfrigérée ; à l''ombre, ventilation dégagée'),
  ('CONGEL',     'Congélateur',                'restauration',    0.7,  1.5, 0.9, 'objet', 0.4, false, 38, 'Coffre ; à l''ombre, ne pas l''ouvrir trop souvent'),
  ('EVIER',      'Évier / plonge',             'restauration',    0.6,  1.2, 0.9, 'objet', 0.0, true,  39, 'Raccord d''eau et évacuation : un bac de rétention ou un rejet autorisé'),
  ('POMPEBIERE', 'Pompe à bière',              'restauration',    0.5,  0.5, 0.6, 'objet', 0.3, false, 40, 'Refroidisseur et tirage ; 0,3 kW, fûts et CO2 à côté'),
  ('GUIRLANDE',  'Guirlande LED (par 10 m)',   'energie',        10.0,  0.1, 3.0, 'ligne', 0.1, false, 52, 'Tracé par modules de 10 m, 10 W par mètre : la puissance suit la longueur. Se raccorde à un coffret, s''accroche aux poteaux'),
  ('POTEAU',     'Poteau (support)',           'infrastructures', 0.3,  0.3, 4.0, 'objet', 0.0, false, 29, 'Support de guirlandes, enseignes, haut-parleurs : les sommets d''un tracé s''y accrochent et le suivent')
) as v(code, libelle, calque, largeur_m, longueur_m, hauteur_m, nature, puissance_kw, besoin_eau, ordre, description)
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = v.code
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, calque, nature, puissance_kw from catalogue_equipements
--    where code in ('FOUR','FRIGOARM','CONGEL','EVIER','POMPEBIERE','GUIRLANDE','POTEAU');  -- 7 lignes
-- =====================================================================
