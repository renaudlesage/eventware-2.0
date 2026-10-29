-- =====================================================================
-- 150 — LES PICTOGRAMMES À LA TAILLE D'UN PANNEAU (retour de Ren, 29/10)
--
-- Sur la carte, un pictogramme est dessiné à l'échelle de sa « taille
-- au plan » (largeur_m), bornée entre 12 et 120 px. Les extincteurs
-- sont à 0,5 m : ils rétrécissent avec le zoom jusqu'au plancher, et
-- c'est le comportement voulu. Tous les autres pictos du catalogue
-- étaient à 3 m — six fois plus : des pavés qui couvraient la carte.
--
-- Un panneau de signalisation fait 0,6 m. Le catalogue et les pictos
-- déjà posés passent de 3 m à 0,6 m ; les extincteurs (0,5 m) et tout
-- picto réglé à la main (autre que 3 m) ne bougent pas. La taille reste
-- réglable dans la fiche (« Taille au plan »). Aucune colonne touchée,
-- aucun DROP, rejouable.
-- =====================================================================

begin;

update public.catalogue_equipements
set largeur_m = 0.6, longueur_m = 0.6
where nature = 'picto' and largeur_m = 3;

update public.elements_plan
set largeur_m = 0.6, longueur_m = 0.6
where nature = 'picto' and largeur_m = 3 and deleted_at is null;

commit;

-- =====================================================================
-- VÉRIFICATION
--   select largeur_m, count(*) from catalogue_equipements where nature = 'picto' group by 1;  -- 0,5 et 0,6
--   select largeur_m, count(*) from elements_plan where nature = 'picto' and deleted_at is null group by 1;
-- =====================================================================
