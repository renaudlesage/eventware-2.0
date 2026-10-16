-- =====================================================================
-- 119 — TAILLE DES PICTOGRAMMES À L'ÉCHELLE (15/10, retour de Ren)
-- Un picto se dessine désormais à l'échelle du plan : `largeur_m` est
-- sa taille au plan (3 m par défaut, réglable sur chaque objet), bornée
-- à l'écran entre 12 et 120 px. Les 0,5 m de la 117 (taille symbolique
-- pour les distances) auraient donné 3 px au zoom 19.
-- =====================================================================
begin;
update public.catalogue_equipements set largeur_m = 3, longueur_m = 3
 where nature = 'picto' and largeur_m = 0.5;
update public.elements_plan set largeur_m = 3, longueur_m = 3
 where nature = 'picto' and largeur_m = 0.5 and deleted_at is null;
commit;
