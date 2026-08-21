-- =====================================================================
-- Migration 002 : seed produit de la matrice de permissions
-- L'admin est absent : traité en dur dans a_permission().
-- Absence de ligne = droit refusé.
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
-- COORDINATEUR — vue complète, écriture ouverte sauf en clôture
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, r, a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array[
  'membres','referentiels','missions','installations_risque',
  'plan_implantation','sos','alertes','journal','equipes'
]) r
cross join unnest(array['lire','creer','modifier','supprimer']::action_permission[]) a;

-- En clôture : lecture seule sur l'opérationnel, analyse ouverte
insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', 'cloture', r, 'lire'
from unnest(array[
  'membres','referentiels','missions','installations_risque',
  'plan_implantation','sos','alertes','journal','equipes'
]) r;

insert into matrice_permissions (role, phase, ressource, action)
values ('coordinateur','cloture','analyse','lire'),
       ('coordinateur','cloture','analyse','creer'),
       ('coordinateur','cloture','analyse','modifier');

-- ---------------------------------------------------------------------
-- CHEF D'ÉQUIPE — édition en place sur son périmètre pendant les phases
-- terrain ; lecture ailleurs. C'est la réponse au point noir du REX 2026.
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, r, a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['missions','installations_risque','plan_implantation']) r
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, r, 'lire'
from unnest(array['preparation','montage','exploitation','demontage','cloture']::phase_evenement[]) p
cross join unnest(array['membres','referentiels','equipes','journal']) r;

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, r, 'lire'
from unnest(array['preparation','cloture']::phase_evenement[]) p
cross join unnest(array['missions','installations_risque','plan_implantation']) r;

-- Signalement : ouvert au chef d'équipe sur toutes les phases terrain
insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'sos', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['creer','modifier']::action_permission[]) a;

-- ---------------------------------------------------------------------
-- BÉNÉVOLE — exécution. Peut faire avancer ses missions et signaler,
-- jamais créer ni supprimer de structure.
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, r, 'lire'
from unnest(array['preparation','montage','exploitation','demontage','cloture']::phase_evenement[]) p
cross join unnest(array['referentiels','equipes','plan_implantation']) r;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'missions', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('benevole','preparation','missions','lire'),
       ('benevole','cloture','missions','lire');

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'sos', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'installations_risque', 'lire'
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p;

-- ---------------------------------------------------------------------
-- OBSERVATEUR — lecture seule, uniquement pendant l'exploitation
-- et la clôture (commune, zone de secours, prestataire)
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'observateur', p, r, 'lire'
from unnest(array['exploitation','cloture']::phase_evenement[]) p
cross join unnest(array[
  'plan_implantation','installations_risque','sos','alertes','journal'
]) r;

commit;
