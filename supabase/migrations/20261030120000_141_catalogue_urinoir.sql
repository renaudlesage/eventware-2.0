-- =====================================================================
-- 141 — CATALOGUE SANITAIRES : URINOIR (retour de Ren, 28/10)
--
-- Un urinoir de plus dans le calque sanitaires du catalogue standard :
-- le modèle courant des événements, autonome, quatre places en croix,
-- 1,2 × 1,2 m, sans raccord d'eau. Insertion gardée par « n'existe pas
-- encore ». Aucun DROP.
-- =====================================================================

begin;

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, hauteur_m, nature, besoin_eau, accueil_public, ordre, description)
select 'URINOIR', 'Urinoir 4 places (autonome)', 'sanitaires', 'autre'::public.categorie_element, 'rect', 1.2, 1.2, 1.5, 'objet', false, false, 64,
       'Urinoir sec en croix, 4 places, sans raccord ; à l''écart des files de WC, écran de pudeur côté public'
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = 'URINOIR'
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle, calque from catalogue_equipements where code = 'URINOIR';  -- 1 ligne
-- =====================================================================
