-- 161 — décision de la commune et charge de transmission.
-- Suppose 159.sql joué avant (BFMF 2027 en instruction, un lien d'instruction JCOM).
set client_min_messages = notice;
\echo '=== 161 : décision et transmission'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

-- Rejouable : on remet le dossier en instruction.
update dossiers_securite set statut = 'en_instruction', decide_le = null where evenement_id = :EA;

-- Bénévole : non. Coordinateur : oui, et le journal le dit.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select decider_dossier('00000000-0000-0000-0000-00000000e0aa', 'autorise')$$, '42501'), 'bénévole A : ne décide pas');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(tests.refuse($$select decider_dossier('00000000-0000-0000-0000-00000000e0aa', 'peut-etre')$$, '22023'), 'décision inconnue : refusée');
select tests.ok((decider_dossier(:EA, 'autorise', 'Arrêté du bourgmestre du 12/07/2027') ->> 'statut') = 'autorise', 'coord A : dossier autorisé');
select tests.ok((select statut from dossiers_securite where evenement_id = :EA) = 'autorise' and (select decide_le from dossiers_securite where evenement_id = :EA) is not null, 'dossier : autorise, daté');
select tests.ok(exists (select 1 from journal where evenement_id = :EA and categorie = 'dossier' and texte like 'Dossier de sécurité AUTORISÉ par la commune%Arrêté du bourgmestre%'), 'journal : décision tracée');
select tests.ok(tests.refuse($$select decider_dossier('00000000-0000-0000-0000-00000000e0aa', 'refuse')$$, 'P0012'), 'déjà décidé : nouvelle décision refusée (P0012)');
select tests.ok(tests.refuse($$select transmission_dossier('00000000-0000-0000-0000-00000000e0aa', 'https://x/')$$, '42501'), 'transmission_dossier : fermée à l''application');
-- Un canal « dossier » se déclare.
insert into canaux_diffusion (evenement_id, libelle, url, objets) values (:EA, 'Crisiware Ferrières', 'https://crisiware.test/functions/v1/ingestion-dossier-evenement', '{alerte,dossier}')
on conflict do nothing;
reset role;

-- La charge, construite par le rôle de service : contrat du briefing 03.
select tests.anonyme(); set role service_role;
select tests.ok((transmission_dossier(:EA, 'https://eventware.test/') ->> 'type') = 'dossier_securite', 'charge : type dossier_securite');
select tests.ok((transmission_dossier(:EA, 'https://eventware.test/') -> 'dossier' ->> 'statut') = 'autorise' and (transmission_dossier(:EA, 'https://eventware.test/') -> 'dossier' ->> 'version')::int >= 3, 'charge : statut et version');
select tests.ok((transmission_dossier(:EA, 'https://eventware.test/') -> 'evenement' ->> 'frequentation_max')::int = 1200, 'charge : fréquentation');
select tests.ok((transmission_dossier(:EA, 'https://eventware.test/') -> 'dossier' ->> 'lien_consultation') like 'https://eventware.test/?autorite=%', 'charge : lien de consultation sur un accès d''instruction');
select tests.ok((transmission_dossier(:EA, 'https://eventware.test/') -> 'evenement' ->> 'jeton_public') = (select jeton_public::text from evenements where id = :EA), 'charge : jeton public de l''événement');
reset role;
\echo '=== 161 OK'
