\pset pager off
\echo '=== 1. Seuils appris pour l''organisation (attendu : P1 15, P2 32, P3 32, P4 120)'
select * from seuils_prise_en_charge('a6d4d8c5-0ea3-4786-abba-4e1b59fcb32d');
\echo '=== 2. Organisation sans historique : valeurs par défaut'
select * from seuils_prise_en_charge('00000000-0000-0000-0000-0000000000aa');
\echo '=== 3. Rando VTT en cours : qui souffre ?'
insert into missions (evenement_id, reference, titre, priorite, statut, created_at, attribuee_le) values
 ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6','LOG-A','P1 qui attend 20 min','P1','a_traiter', now() - interval '20 minutes', null),
 ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6','LOG-B','P1 qui attend 8 min','P1','a_traiter', now() - interval '8 minutes', null),
 ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6','LOG-C','P2 attribuée il y a longtemps','P2','attribuee', now() - interval '90 minutes', now() - interval '80 minutes'),
 ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6','LOG-D','P3 qui attend 40 min','P3','a_traiter', now() - interval '40 minutes', null),
 ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6','LOG-E','P4 qui attend 40 min','P4','a_traiter', now() - interval '40 minutes', null);
insert into missions (evenement_id, reference, titre, priorite, statut, created_at, deleted_at) values
 ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6','LOG-F','P1 supprimée','P1','a_traiter', now() - interval '60 minutes', now());
select reference, priorite, attente_min, seuil_min, depassement from missions_en_souffrance('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6');
\echo '=== 4. Anonyme : refusé'
set role anon;
select * from missions_en_souffrance('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6');
reset role;
