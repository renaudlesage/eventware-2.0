-- =====================================================================
-- Migration 083 : « Préparation » devient un module activable
-- ---------------------------------------------------------------------
-- Les modules se règlent à DEUX niveaux : l'organisation les souscrit
-- (modules_autorises), l'événement les active. Un déclencheur refuse
-- d'activer un module non souscrit. Les deux niveaux sont donc traités
-- ici — n'en faire qu'un rendait le module impossible à activer.
--
-- Choix assumé : Préparation est aligné sur Sécurité, le seul module
-- accordé d'office à toute organisation. Les autres répondent à des
-- besoins qui n'existent pas toujours ; celui-ci répond à un moment que
-- tout événement traverse — on prépare toujours, avant. En faire une
-- option payante reviendrait à facturer la première chose qu'on ouvre.
--
-- Les événements existants le reçoivent activé : sans cette reprise,
-- l'écran disparaîtrait de ceux qui s'en servent déjà, BFMF2027 le
-- premier, créé précisément pour préparer.
-- =====================================================================

begin;

-- 1. Souscription : accordé à toutes les organisations, présentes...
alter table organisations alter column modules_autorises set default
  '{"rh": false, "analyse": false, "parcours": false, "securite": true,
    "preparation": true, "logistique": false, "sos_participants": false,
    "plan_implantation": false}'::jsonb;

update organisations
set modules_autorises = modules_autorises || '{"preparation": true}'::jsonb
where deleted_at is null and not (modules_autorises ? 'preparation');

-- 2. ...et activé au niveau de l'événement.
alter table evenements alter column modules set default
  '{"rh": false, "analyse": false, "securite": true, "preparation": true,
    "logistique": false, "sos_participants": false, "plan_implantation": false}'::jsonb;

update evenements
set modules = modules || '{"preparation": true}'::jsonb
where deleted_at is null and not (modules ? 'preparation');

commit;