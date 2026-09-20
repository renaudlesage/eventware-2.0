-- =====================================================================
-- 108 — LA MATRICE STANDARD, RESSERRÉE SUR QUATRE POINTS
--
-- Décisions prises sur les résultats de la campagne du 20/09. Ce
-- fichier est SÉPARÉ de la 107 parce qu'il change ce que des rôles
-- peuvent faire, pas seulement ce que le code fait : il se lit et
-- s'applique en connaissance de cause.
--
-- a. LE CHEF D'ÉQUIPE N'ÉCRIT PAS LES RÉFÉRENTIELS (3d-04, 3d-06).
--    Le standard lui donnait `referentiels:creer/modifier` : il
--    pouvait modifier une fiche réflexe, ajouter un article de stock,
--    démarrer un contrôle de conformité, importer une trace. Ce sont
--    des gestes de préparation, qui relèvent de la coordination. Il
--    garde la lecture. (Un client qui veut un chef d'équipe plus large
--    le coche dans Réglages › Rôles : la matrice n'est qu'un départ.)
--
-- b. LE BÉNÉVOLE LIT LA LOGISTIQUE, IL NE L'ÉCRIT PAS (3e-05).
--    Le standard lui donnait `logistique:creer/modifier` en montage,
--    exploitation et démontage : mouvements de stock, comptage de
--    jauge, remise et retour de matériel, création de demandes de
--    transport. Ce qu'il doit pouvoir faire — prendre un transport
--    sans chauffeur et le mener à bout — passe depuis la 107 par
--    `missions:modifier`, qu'il garde.
--
-- c. LE BÉNÉVOLE N'ENCADRE PAS LES RH (2b-04, 2d-04). `rh:modifier`
--    lui donnait la main sur TOUS les jalons de l'événement — statut,
--    échéance, visibilité, y compris ceux passés en « coordination »
--    — et sur les créneaux (rappels, fiches rattachées). Il ne le
--    détenait que pour pouvoir passer « fait », depuis Mon terrain,
--    l'action dont il répond : la 107 ouvre ce chemin au responsable
--    de l'action, comme au titulaire d'une mission. Confirmer sa propre
--    affectation n'a jamais exigé ce droit (policy `affectations`).
--
-- d. « TRANSPORTS » N'EST PAS UNE RESSOURCE. Aucune policy ne lit
--    `transports:*` (les transports sont protégés par `logistique`) :
--    ces lignes, héritées d'un premier découpage, ne faisaient que
--    laisser croire à un droit. Retirées de la matrice et des rôles.
--
-- Puis le RÉALIGNEMENT des événements existants, limité à ces quatre
-- points : rien d'autre n'est touché dans les capacités que les
-- coordinateurs ont pu régler à la main. Sans ce second bloc, seuls
-- les événements créés après la 108 suivraient la nouvelle matrice.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- La matrice standard (copiée dans chaque nouvel événement)
-- ---------------------------------------------------------------------
delete from matrice_permissions
 where role::text = 'chef_equipe'
   and ressource = 'referentiels' and action in ('creer', 'modifier');

delete from matrice_permissions
 where role::text = 'benevole'
   and ressource = 'logistique' and action in ('creer', 'modifier');

delete from matrice_permissions
 where role::text = 'benevole'
   and ressource = 'rh' and action = 'modifier';

delete from matrice_permissions
 where ressource = 'transports';

-- ---------------------------------------------------------------------
-- Réalignement des événements existants, sur ces quatre points
-- ---------------------------------------------------------------------
delete from role_capacites rc
 using roles r
 where rc.role_id = r.id
   and r.code = 'chef_equipe'
   and rc.ressource = 'referentiels' and rc.action in ('creer', 'modifier');

delete from role_capacites rc
 using roles r
 where rc.role_id = r.id
   and r.code = 'benevole'
   and rc.ressource = 'logistique' and rc.action in ('creer', 'modifier');

delete from role_capacites rc
 using roles r
 where rc.role_id = r.id
   and r.code = 'benevole'
   and rc.ressource = 'rh' and rc.action = 'modifier';

delete from role_capacites
 where ressource = 'transports';

commit;

-- =====================================================================
-- VÉRIFICATION — droits.sql : bloc R, une fois la 108 appliquée, le
-- bénévole de Rando VTT ne détient plus logistique:modifier et la ligne
-- « il ne reprend pas le transport d'un autre chauffeur » passe de
-- IGNORÉ à OK ; bloc T, le bénévole fait avancer l'action dont il est
-- responsable et pas une autre.
-- =====================================================================
