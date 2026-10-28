-- =====================================================================
-- 146 — UNE COULEUR PAR GROUPE DE TRAVAIL, ET AU CHOIX PAR JALON
--       (retour de Ren, 28/10)
--
-- Dans le Gantt, le remplissage d'une barre ou d'un losange prend la
-- couleur de son groupe de travail (choisie dans Préparation, sur
-- l'en-tête du groupe), ou une couleur propre posée sur le jalon depuis
-- sa fiche, qui l'emporte. Le contour garde le code des statuts (à
-- venir, en cours, fait, en retard). Deux colonnes texte « #rrggbb »,
-- facultatives : sans rien, le Gantt reste tel qu'il était. Aucun DROP.
-- =====================================================================

begin;

alter table public.groupes_travail
  add column if not exists couleur text
  check (couleur is null or couleur ~ '^#[0-9a-fA-F]{6}$');
comment on column public.groupes_travail.couleur is
  '(146) Couleur du groupe sur le Gantt (#rrggbb) ; vide : neutre.';

alter table public.jalons
  add column if not exists couleur text
  check (couleur is null or couleur ~ '^#[0-9a-fA-F]{6}$');
comment on column public.jalons.couleur is
  '(146) Couleur propre du jalon sur le Gantt (#rrggbb), prioritaire sur celle du groupe ; vide : celle du groupe.';

commit;

-- =====================================================================
-- VÉRIFICATION
--   select table_name from information_schema.columns
--    where column_name = 'couleur' and table_name in ('groupes_travail', 'jalons');  -- 2 lignes
-- =====================================================================
