-- =====================================================================
-- 148 — LA NOTE D'UN OBJET DU PLAN N'EST PLUS LA DÉFINITION DU CATALOGUE
--       (retour de Ren, 29/10)
--
-- À la pose, la conception copiait la description de la fiche du
-- catalogue (« Point de rendez-vous des secours : là où les engins
-- sont attendus et guidés… ») dans la note de l'objet. Résultat : la
-- page autorité et l'onglet Accès secours répétaient la définition
-- d'un PRV sous chaque PRV, et la note n'était jamais libre pour ce
-- qui compte — un repère sur place, une consigne d'accès, un
-- commentaire à côté de l'adresse.
--
-- La conception ne copie plus cette définition (elle reste affichée
-- comme conseil dans la fiche, depuis le catalogue). Ici : on efface
-- les notes qui sont exactement la description du catalogue de
-- l'objet ; les notes écrites à la main (différentes) sont gardées.
-- Aucune colonne touchée, aucun DROP, rejouable.
-- =====================================================================

begin;

update public.elements_plan ep
set description = null
from public.catalogue_equipements c
where c.id = ep.catalogue_id
  and ep.deleted_at is null
  and ep.description = c.description;

commit;

-- =====================================================================
-- VÉRIFICATION
--   select count(*) from elements_plan ep join catalogue_equipements c on c.id = ep.catalogue_id
--   where ep.deleted_at is null and ep.description = c.description;  -- 0
-- =====================================================================
