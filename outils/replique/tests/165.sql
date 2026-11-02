-- 165 — notification DMP : jours ouvrés, pré-rempli, saisie qui prime, destinataires, complétude, contrôle DOS_NOTIF_DMP, droits.
-- Suppose 157.sql joué avant (BFMF 2027 du 14 au 15/08/2027, contacts secours/police, PC-Ops) ; pose ses propres données et les retire.
set client_min_messages = notice;
\echo '=== 165 : notification DMP'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

-- Rejouable.
delete from notifications_dmp where evenement_id = :EA;
delete from contacts where evenement_id = :EA and code like 'T165%';
delete from lieux where evenement_id = :EA and code like 'T165%';
delete from prima_saisies where evenement_id = :EA;

-- Les jours ouvrés : 10 avant un samedi 21/08/2027 → lundi 9/08 ; entre deux dates, samedis et dimanches exclus.
select tests.ok(jours_ouvres_avant('2027-08-21', 10) = '2027-08-09', '10 jours ouvrés avant le samedi 21/08/2027 : lundi 9/08');
select tests.ok(jours_ouvres_avant('2027-08-16', 1) = '2027-08-13', '1 jour ouvré avant un lundi : le vendredi');
select tests.ok(jours_ouvres_entre('2027-08-09', '2027-08-21') = 10, 'entre le 9 et le 21/08 : 10 jours ouvrés');
select tests.ok((select count(*) from notification_dmp_categories()) = 8 and (select count(*) from notification_dmp_categories() where nominatif) = 6, 'huit catégories, six nominatives');

-- Coordinateur A : le pré-rempli vide (pas de prestataire) ; un créneau par jour ; date limite à 10 jours ouvrés du 14/08/2027 (samedi) → 2/08.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(jsonb_array_length(notification_dmp(:EA) -> 'creneaux') = 2 and (notification_dmp(:EA) -> 'creneaux' -> 0 ->> 'date') = '2027-08-14', 'créneaux : un par jour, dates en clair');
select tests.ok((notification_dmp(:EA) ->> 'date_limite') = '2027-08-02', 'date limite : 10 jours ouvrés avant le 14/08/2027');
select tests.ok((notification_dmp(:EA) -> 'destinataires' ->> 'coamu') = 'admin.lie@health.fgov.be' and (notification_dmp(:EA) -> 'destinataires' ->> 'cu112') = 'expert@cs112.com', 'destinataires : CoAMU Liège et CU 112');
select tests.ok(not (notification_dmp(:EA) ->> 'complete')::boolean, 'sans prestataire : incomplète');
select tests.ok(notification_dmp(:EA) -> 'preremplis' ? 'creneaux', 'provenance : les créneaux sont pré-remplis');
reset role;

-- Un prestataire Croix-Rouge dans les contacts, un poste de secours et une entrée parmi les lieux, un programme : tout se pré-remplit.
insert into contacts (evenement_id, code, nom, organisation, categorie, fonction, telephone) values
  (:EA, 'T165-CR', 'Anne Secours', 'Croix-Rouge, section de Ferrières', 'medical', 'responsable DMP', '0471 00 00 00');
insert into lieux (evenement_id, code, nom, type, description) values
  (:EA, 'T165-PS', 'Poste de secours', 'poste_secours', null), (:EA, 'T165-IN', 'Entrée principale', 'entree', 'Rue de la Fête 1');
insert into moyens_premiers_secours (evenement_id, type, quantite) values (:EA, 'secouriste', 6), (:EA, 'ambulance', 2);
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((notification_dmp(:EA) ->> 'prestataire_nom') = 'Croix-Rouge, section de Ferrières' and (notification_dmp(:EA) ->> 'contact_gsm') = '0471 00 00 00', 'pré-rempli : prestataire depuis les contacts');
select tests.ok((notification_dmp(:EA) -> 'responsable_dmp' ->> 'nom') = 'Anne Secours', 'pré-rempli : responsable DMP');
select tests.ok((notification_dmp(:EA) -> 'effectifs' ->> 'secouriste')::int = 6, 'pré-rempli : 6 secouristes');
select tests.ok((notification_dmp(:EA) -> 'moyens' -> 'poste_soins' ->> 'fixes')::int = 1, 'pré-rempli : un poste de soins fixe');
select tests.ok((notification_dmp(:EA) ->> 'informations') like '2 ambulance(s)%', 'pré-rempli : les ambulances à répartir');
select tests.ok((notification_dmp(:EA) -> 'adresses' -> 'acces_public' ->> 'rue') = 'Rue de la Fête 1' and (notification_dmp(:EA) -> 'adresses' -> 'poste_soins' ->> 'rue') = 'Poste de secours', 'pré-rempli : adresses accès public et poste de soins');
select tests.ok(notification_dmp(:EA) -> 'documents' ? 'localisation du/des poste(s) de soins', 'pré-rempli : documents joints');
select tests.ok((notification_dmp(:EA) ->> 'complete')::boolean, 'complète avec prestataire, contact, responsable, créneaux et poste');
-- La saisie prime, le pré-rempli reste signalé pour le reste.
insert into notifications_dmp (evenement_id, prestataire_nom, vecteurs, ambulances_112)
values (:EA, 'Ambulances du Condroz', '{"ambulance_112": 2}', '[{"indicatif": "AMB 42", "plaque": "1-ABC-123", "issi": "1234567", "gsm": "0470 42 42 42"}]');
select tests.ok((notification_dmp(:EA) ->> 'prestataire_nom') = 'Ambulances du Condroz', 'saisie : le prestataire prime');
select tests.ok(not (notification_dmp(:EA) -> 'preremplis' ? 'prestataire_nom') and notification_dmp(:EA) -> 'preremplis' ? 'contact_gsm', 'provenance : saisi vs pré-rempli');
select tests.ok(jsonb_array_length(notification_dmp(:EA) -> 'ambulances_112') = 1 and (notification_dmp(:EA) -> 'vecteurs' ->> 'ambulance_112')::int = 2, 'saisie : vecteurs et ambulances 112');
select tests.ok((select updated_by from notifications_dmp where evenement_id = :EA) = '00000000-0000-0000-0000-00000000a001', 'traçabilité : updated_by');
-- Le contrôle : rien tant que PRIMA ne demande pas de dispositif ; avec un niveau ≥ 2 et une date limite à moins de 30 jours, DOS_NOTIF_DMP.
select tests.ok(not exists (select 1 from controle_dossier(:EA) where code = 'DOS_NOTIF_DMP'), 'contrôle : rien sans dispositif attendu');
reset role;
create temp table t165 as select id, date_debut, date_fin, date_montage, date_demontage from evenements where id = :EA;
update evenements set date_montage = current_date + 20, date_debut = current_date + 21, date_fin = current_date + 21, date_demontage = current_date + 22 where id = :EA;
insert into prima_saisies (evenement_id, type_evenement, type_public, age_spectateurs, nuit, journee, alcool) values (:EA, 3, 3, 2, true, false, 3);
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((calcul_prima(:EA) ->> 'niveau')::int >= 2, 'PRIMA : niveau ≥ 2 (concert rock de nuit)');
select tests.ok(exists (select 1 from controle_dossier(:EA) where code = 'DOS_NOTIF_DMP' and gravite = 'alerte' and titre like 'Notification du dispositif médical : à envoyer avant le %'), 'contrôle : DOS_NOTIF_DMP à moins de 30 jours');
-- Marquée envoyée : plus d'alerte.
update notifications_dmp set envoyee_le = now(), envoyee_a = 'admin.lie@health.fgov.be, expert@cs112.com' where evenement_id = :EA;
select tests.ok(not exists (select 1 from controle_dossier(:EA) where code = 'DOS_NOTIF_DMP'), 'contrôle : plus rien une fois envoyée');
reset role;
update evenements e set date_debut = t.date_debut, date_fin = t.date_fin, date_montage = t.date_montage, date_demontage = t.date_demontage from t165 t where e.id = t.id;
drop table t165;

-- Bénévole A : lit, ne saisit pas.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((notification_dmp(:EA) ->> 'prestataire_nom') = 'Ambulances du Condroz', 'bénévole A : lit la notification');
select tests.ok(tests.refuse($$update notifications_dmp set nature = 'x' where evenement_id = '00000000-0000-0000-0000-00000000e0aa'$$, '42501') or (select nature from notifications_dmp where evenement_id = '00000000-0000-0000-0000-00000000e0aa') is null, 'bénévole A : ne saisit pas');
reset role;

-- Organisation B : rien de A.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok(tests.refuse($$select notification_dmp('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'org B : ne lit pas la notification de A');
select tests.ok((select count(*) from notifications_dmp where evenement_id = :EA) = 0, 'org B : ne voit pas la ligne de A');
reset role;

-- Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select count(*) from notifications_dmp$$, '42501'), 'anonyme : rien');
reset role;

delete from notifications_dmp where evenement_id = :EA;
delete from prima_saisies where evenement_id = :EA;
delete from moyens_premiers_secours where evenement_id = :EA and type in ('secouriste', 'ambulance') and quantite in (6, 2);
delete from contacts where evenement_id = :EA and code like 'T165%';
delete from lieux where evenement_id = :EA and code like 'T165%';
\echo '=== 165 OK'
