-- 158 — réception des messages de la commune : réel, doublon, mauvais secret, I2, I3, accusés.
set client_min_messages = notice;
\echo '=== 158 : réception commune'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set EC '''00000000-0000-0000-0000-00000000e0cc'''

-- Rejouable.
delete from exercices where evenement_id = :EA and titre = 'T158';
delete from evenements where id = :EC;
delete from liaisons_commune where evenement_id = :EA;
delete from messages_commune where evenement_id = :EA;
delete from journal_receptions where evenement_id = :EA or evenement_id is null;
delete from journal where evenement_id = :EA and categorie = 'commune';

-- Un bac à sable de l'organisation A, rattaché à un exercice de BFMF 2027.
insert into evenements (id, nom, slug, organisation_id, phase, date_debut, date_fin) values (:EC, 'Bac à sable', 'bac-a-sable-t158', '00000000-0000-0000-0000-0000000000aa', 'exploitation', '2027-08-14', '2027-08-15');
insert into exercices (evenement_id, titre, format, bac_a_sable_id) values (:EA, 'T158', 'table', :EC);
insert into membres_evenement (evenement_id, user_id, role_id, actif, nom_affiche)
select :EC, '00000000-0000-0000-0000-00000000a001', r.id, true, 'Coord A' from roles r where r.evenement_id = :EC and r.code = 'coordinateur';

-- Le coordinateur crée une liaison réelle (BFMF 2027) et une liaison d'exercice (bac à sable).
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
create temp table t158 as
  select (creer_liaison_commune(:EA, 'Ferrières') ->> 'secret') as secret_reel,
         (creer_liaison_commune(:EC, 'Ferrières', 'X-Commune-Secret', true, 'EXO-2027') ->> 'secret') as secret_exo;
select tests.ok(length((select secret_reel from t158)) = 48, 'liaison réelle créée : secret de 48 caractères, rendu une fois');
select tests.ok((select count(*) from liaisons_commune where evenement_id = :EA) = 1, 'coord A : voit sa liaison');
select tests.ok(tests.refuse($$select secret_hash from liaisons_commune$$, '42501'), 'secret_hash : illisible depuis l''application');
select tests.ok(tests.refuse($$select recevoir_message_commune(null, '{}', '{}')$$, '42501'), 'recevoir_message_commune : fermée aux utilisateurs');
reset role;
grant select on t158 to service_role;

-- Le bénévole ne crée pas de liaison.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select creer_liaison_commune('00000000-0000-0000-0000-00000000e0aa', 'Ferrières')$$, '42501'), 'bénévole A : création refusée');
reset role;

-- La réception, comme l'Edge Function : clé de service.
select tests.anonyme(); set role service_role;
\set JA `psql -h /var/lib/postgresql/replique -p 5433 -U postgres -d replique -At -c "select jeton_public from evenements where id = '00000000-0000-0000-0000-00000000e0aa'"`
\set JC `psql -h /var/lib/postgresql/replique -p 5433 -U postgres -d replique -At -c "select jeton_public from evenements where id = '00000000-0000-0000-0000-00000000e0cc'"`
-- 1. Réel : bon secret → reçu, journal, bandeau ; rejoué → doublon ; mauvais secret → refusé et journalisé sans secret.
select tests.ok((recevoir_message_commune(:'JA', jsonb_build_object('x-commune-secret', (select secret_reel from t158)),
   '{"source":"crisiware","commune":"Ferrières","evenement":{"nom":"BFMF 2027"},"incident":{"type":"inondation","phase":"communale"},
     "alerte":{"reference":"CW-001","niveau":"urgence","titre":"Évacuation du camping","message":"Montée de l''Ourthe","consigne":"Rassembler au PRV","emise_le":"2027-08-14T21:00:00+02:00"}}'::jsonb) ->> 'statut') = 'recu',
  'réel : message reçu');
select tests.ok((select count(*) from messages_commune where evenement_id = :EA and reference = 'CW-001' and niveau = 'urgence' and incident_type = 'inondation') = 1, 'réel : une ligne messages_commune');
select tests.ok(exists (select 1 from journal where evenement_id = :EA and source = 'systeme' and categorie = 'commune' and importance = 'majeur' and texte like 'Message de la commune de Ferrières (urgence)%'), 'réel : entrée système au journal');
select tests.ok((recevoir_message_commune(:'JA', jsonb_build_object('x-commune-secret', (select secret_reel from t158)),
   '{"alerte":{"reference":"CW-001","niveau":"urgence","titre":"Évacuation du camping"}}'::jsonb) ->> 'statut') = 'doublon', 'rejoué : doublon, rien de créé');
select tests.ok((select count(*) from messages_commune where evenement_id = :EA) = 1, 'rejoué : toujours une seule ligne');
select tests.ok((recevoir_message_commune(:'JA', '{"x-commune-secret":"mauvais-secret-0000"}', '{"alerte":{"reference":"CW-002","niveau":"urgence","titre":"X"}}') ->> 'motif') = 'secret_faux', 'mauvais secret : refusé');
select tests.ok((recevoir_message_commune(:'JA', '{"x-autre":"abc"}', '{"alerte":{"reference":"CW-002","niveau":"urgence","titre":"X"}}') ->> 'motif') = 'secret_absent', 'sans en-tête : refusé');
select tests.ok((select count(*) from journal_receptions where evenement_id = :EA and motif in ('secret_faux', 'secret_absent')) = 2, 'rejets journalisés');
select tests.ok(not exists (select 1 from journal_receptions where detail like '%mauvais-secret-0000%' or detail like '%' || (select secret_reel from t158) || '%'), 'journal des rejets : aucun secret');
select tests.ok((recevoir_message_commune('00000000-0000-0000-0000-000000000bad', '{}', '{}') ->> 'motif') = 'evenement_inconnu', 'jeton inconnu : refusé');
select tests.ok((recevoir_message_commune(:'JA', jsonb_build_object('x-commune-secret', (select secret_reel from t158)), '{"alerte":{"reference":"CW-003","niveau":"rouge","titre":"X"}}') ->> 'motif') = 'charge_invalide', 'niveau inconnu : charge invalide');
-- I2 : un message marqué exercice vers l'événement réel est refusé.
select tests.ok((recevoir_message_commune(:'JA', jsonb_build_object('x-commune-secret', (select secret_reel from t158)),
   '{"exercice":{"code":"EXO-2027"},"alerte":{"reference":"CW-004","niveau":"urgence","titre":"X"}}'::jsonb) ->> 'motif') = 'exercice_refuse', 'I2 : exercice vers le réel refusé');
-- I3 : un message non marqué vers le bac à sable est refusé ; marqué avec le bon code, accepté.
select tests.ok((recevoir_message_commune(:'JC', jsonb_build_object('x-commune-secret', (select secret_exo from t158)),
   '{"alerte":{"reference":"CW-005","niveau":"urgence","titre":"X"}}'::jsonb) ->> 'motif') = 'exercice_refuse', 'I3 : réel vers le bac à sable refusé');
select tests.ok((recevoir_message_commune(:'JC', jsonb_build_object('x-commune-secret', (select secret_exo from t158)),
   '{"exercice":{"code":"AUTRE"},"alerte":{"reference":"CW-006","niveau":"urgence","titre":"X"}}'::jsonb) ->> 'motif') = 'exercice_refuse', 'bac à sable : mauvais code d''exercice refusé');
select tests.ok((recevoir_message_commune(:'JC', jsonb_build_object('x-commune-secret', (select secret_exo from t158)),
   '{"exercice":{"code":"EXO-2027"},"alerte":{"reference":"CW-007","niveau":"vigilance","titre":"Exercice : crue annoncée"}}'::jsonb) ->> 'statut') = 'recu', 'bac à sable : message d''exercice reçu');
select tests.ok((select est_exercice from messages_commune where evenement_id = :EC and reference = 'CW-007'), 'bac à sable : message marqué exercice');
select tests.ok((select count(*) from messages_commune where evenement_id = :EA) = 1, 'le réel n''a rien reçu de l''exercice');
reset role;

-- Accusé : le bénévole presse « Bien reçu » ; le message est lu, l'accusé nominatif.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((select count(*) from messages_commune) = 1 and (select lu_le from messages_commune limit 1) is null, 'bénévole A : voit le message, non lu');
insert into messages_commune_accuses (evenement_id, message_id) select evenement_id, id from messages_commune where reference = 'CW-001';
select tests.ok((select lu_par from messages_commune where reference = 'CW-001') = '00000000-0000-0000-0000-00000000a002', 'accusé : lu_par = bénévole A');
select tests.ok((select nom from messages_commune_accuses limit 1) = 'Bénévole A', 'accusé : nom du membre');
select tests.ok(tests.refuse($$insert into messages_commune_accuses (evenement_id, message_id, user_id) select evenement_id, id, '00000000-0000-0000-0000-00000000a001' from messages_commune where reference = 'CW-001'$$, '42501'), 'accusé pour un autre : refusé');
select tests.ok(tests.refuse($$select * from journal_receptions$$, '42501') or (select count(*) from journal_receptions) = 0, 'bénévole A : journal des rejets invisible');
reset role;

-- Coordinateur B ne voit rien.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from messages_commune) = 0 and (select count(*) from liaisons_commune) = 0, 'coord B : rien de A');
reset role;
-- Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select * from messages_commune$$, '42501'), 'anonyme : messages refusés');
reset role;
drop table t158;
\echo '=== 158 OK'
