-- =====================================================================
-- 133 — PICTOGRAMMES : SECOURS ET EAU (retour de Ren, 27/10)
--
-- Les cinq objets de la 132 existent aussi en pictogramme, comme les
-- extincteurs ou les sorties (117) : sur le plan, c'est le panneau
-- qu'on pose, à l'emprise symbolique de 3 m (119). Les dessins sont
-- dans l'application (src/pictos.js), aux couleurs ISO 7010 : bleu =
-- information (eau, pompe, aire de jour), noir et jaune = balisage
-- nocturne, vert = secours (cabinet médical).
--
--   EAUNATP   — point d'eau naturel      · picto eau_naturelle
--   POMPEP    — pompe à eau              · picto pompe
--   HELIJOURP — aire hélicoptère (jour)  · picto helico_jour
--   HELINUITP — aire hélicoptère (nuit)  · picto helico_nuit
--   CABMEDP   — cabinet médical          · picto cabinet_medical
--
-- Insertion gardée par « n'existe pas encore ». Aucun DROP.
-- =====================================================================

begin;

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, nature, picto, source_eau, ordre, description)
select v.code, v.libelle, v.calque, v.categorie::public.categorie_element, 'cercle', 3.0, 3.0, 'picto', v.picto, v.source_eau, v.ordre, v.description
from (values
  ('EAUNATP',   'Point d''eau naturel (picto)',            'eau',      'point_eau',     'eau_naturelle',   true,  56, 'Prise d''eau des pompiers : rivière, étang, réserve'),
  ('POMPEP',    'Pompe à eau (picto)',                     'eau',      'point_eau',     'pompe',           true,  57, 'Motopompe ou pompe électrique'),
  ('HELIJOURP', 'Aire hélicoptère de jour (picto)',        'securite', 'aire_helico',   'helico_jour',     false, 84, 'Marque le centre de la zone d''atterrissage suggérée de jour'),
  ('HELINUITP', 'Aire hélicoptère de nuit (picto)',        'securite', 'aire_helico',   'helico_nuit',     false, 85, 'Marque le centre de la zone d''atterrissage nocturne balisée'),
  ('CABMEDP',   'Cabinet médical (picto)',                 'securite', 'poste_secours', 'cabinet_medical', false, 81, 'Le médecin de l''événement')
) as v(code, libelle, calque, categorie, picto, source_eau, ordre, description)
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = v.code
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, picto from catalogue_equipements
--    where code in ('EAUNATP','POMPEP','HELIJOURP','HELINUITP','CABMEDP');  -- 5 lignes
-- =====================================================================
