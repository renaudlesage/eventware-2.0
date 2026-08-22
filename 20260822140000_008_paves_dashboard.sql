-- =====================================================================
-- Migration 008 : composition du dashboard individuel
-- ---------------------------------------------------------------------
-- Liste ORDONNÉE des pavés choisis par l'utilisateur, par événement.
--
-- NULL = jamais personnalisé : on applique le jeu par défaut du rôle.
-- C'est ce qui permet à un bénévole découvrant l'app le samedi matin
-- d'avoir un écran utile sans rien configurer.
--
-- Le catalogue lui-même n'est PAS ici : il est figé au niveau produit,
-- côté application (src/paves.js). Un client n'invente pas de pavé — il
-- en demande un, et il monte dans la roadmap, pour tout le monde.
--
-- Les pavés obligatoires sont réinjectés côté app quoi qu'il y ait dans
-- cette colonne : le sécu garde la main sur ce qui est critique.
-- =====================================================================

alter table membres_evenement
  add column paves jsonb;

comment on column membres_evenement.paves is
  'Liste ordonnée d''identifiants de pavés. NULL = jeu par défaut du rôle. Les pavés obligatoires sont réinjectés côté app, quoi qu''il y ait ici.';
