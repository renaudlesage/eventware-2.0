-- =====================================================================
-- 134 — CATALOGUE : LES PICTOGRAMMES SEULS (retour de Ren, 27/10)
--
-- Les cinq objets à l'échelle de la 132 doublonnaient leurs
-- pictogrammes de la 133 dans le catalogue. Ren tranche : on ne garde
-- que les pictogrammes. Les objets déjà posés sur un plan restent
-- (elements_plan porte sa propre géométrie ; la clé vers le catalogue
-- passe à nul, `on delete set null`). Les pictogrammes perdent leur
-- suffixe « (picto) », devenu inutile.
--
-- Une suppression de lignes du catalogue standard, pas un DROP.
-- =====================================================================

begin;

delete from public.catalogue_equipements
 where organisation_id is null
   and code in ('POINTEAUNAT', 'POMPE', 'HELIJOUR', 'HELINUIT', 'CABMED');

update public.catalogue_equipements
   set libelle = case code
         when 'EAUNATP'   then 'Point d''eau naturel'
         when 'POMPEP'    then 'Pompe à eau'
         when 'HELIJOURP' then 'Zone d''atterrissage suggérée (jour)'
         when 'HELINUITP' then 'Zone d''atterrissage nocturne hélicoptère'
         when 'CABMEDP'   then 'Cabinet médical'
       end
 where organisation_id is null
   and code in ('EAUNATP', 'POMPEP', 'HELIJOURP', 'HELINUITP', 'CABMEDP');

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle from catalogue_equipements
--    where code in ('POINTEAUNAT','POMPE','HELIJOUR','HELINUIT','CABMED',
--                   'EAUNATP','POMPEP','HELIJOURP','HELINUITP','CABMEDP');  -- 5 lignes, sans « (picto) »
-- =====================================================================
