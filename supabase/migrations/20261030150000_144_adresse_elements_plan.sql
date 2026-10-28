-- =====================================================================
-- 144 — UNE ADRESSE SUR LES OBJETS DU PLAN (retour de Ren, 28/10)
--
-- Les accès secours, PRV et voies engins avaient des coordonnées GPS,
-- pas d'adresse : or c'est une adresse qu'on dicte au 112 et qu'on
-- donne à un chauffeur. Une colonne texte libre sur elements_plan,
-- saisie dans la fiche de l'objet (Conception), proposée depuis la
-- position par l'application, affichée dans l'onglet Accès secours et
-- son impression. Aucun DROP.
-- =====================================================================

begin;

alter table public.elements_plan
  add column if not exists adresse text;
comment on column public.elements_plan.adresse is
  '(144) Adresse postale de l''objet, telle qu''on la dicte aux secours ; libre, à côté des coordonnées.';

commit;

-- =====================================================================
-- VÉRIFICATION
--   select column_name from information_schema.columns
--    where table_name = 'elements_plan' and column_name = 'adresse';  -- 1 ligne
-- =====================================================================
