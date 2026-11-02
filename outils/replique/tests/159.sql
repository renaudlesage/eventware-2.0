-- 159 — avis des disciplines par lien : lecture, avis + prescriptions, cloisonnement, expiration, check-list, situation refusée.
-- Suppose 157.sql joué juste avant (BFMF 2027 déposé, version 3).
set client_min_messages = notice;
\echo '=== 159 : avis des disciplines'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set EB '''00000000-0000-0000-0000-00000000e0bb'''
\set JD1 '''00000000-0000-0000-0000-00000000f0d1'''
\set JD1X '''00000000-0000-0000-0000-00000000f0d2'''
\set JCOM '''00000000-0000-0000-0000-00000000f0c0'''
\set JSIT '''00000000-0000-0000-0000-00000000f0a0'''
\set JB '''00000000-0000-0000-0000-00000000f0bb'''

-- Rejouable.
delete from acces_autorite where jeton in (:JD1, :JD1X, :JCOM, :JSIT, :JB);
delete from avis_autorite where dossier_id in (select id from dossiers_securite where evenement_id = :EA);
delete from controles_sessions where evenement_id = :EA;
update dossiers_securite set statut = 'depose' where evenement_id = :EA;
insert into checklist_modeles (code, libelle, ordre) select 'test159', 'Modèle de test', 900 where not exists (select 1 from checklist_modeles where code = 'test159');

-- Le coordinateur A ouvre les liens : D1 (avis), un D1 expiré, la commune (instruction), un lien de situation.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
insert into acces_autorite (evenement_id, jeton, libelle, organisation, niveau, discipline, expire_le) values
  (:EA, :JD1, 'Zone de secours', 'ZS Vesdre-Hoëgne & Plateau', 'avis', 'D1', null),
  (:EA, :JD1X, 'Zone de secours (ancien lien)', 'ZS', 'avis', 'D1', now() - interval '1 day'),
  (:EA, :JCOM, 'Commune', 'Commune de Ferrières', 'instruction', 'COMMUNE', null),
  (:EA, :JSIT, 'Bourgmestre', 'Commune', 'situation', null, null);
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
insert into acces_autorite (evenement_id, jeton, libelle, niveau, discipline) values (:EB, :JB, 'D1 de B', 'avis', 'D1');
reset role;

-- Sans compte : le lien D1 lit le dossier.
select tests.anonyme(); set role anon;
select tests.ok((dossier_par_jeton(:JD1) -> 'dossier' ->> 'version')::int = 3, 'D1 : lit le dossier (version 3)');
select tests.ok((dossier_par_jeton(:JD1) -> 'contenu' -> 'evenement' ->> 'nom') = 'BFMF 2027', 'D1 : contenu figé de la version');
select tests.ok((dossier_par_jeton(:JD1) -> 'destinataire' ->> 'discipline') = 'D1', 'D1 : sa discipline');
select tests.ok(tests.refuse($$select dossier_par_jeton('00000000-0000-0000-0000-00000000f0d2')$$, 'P0006'), 'lien expiré : refusé (P0006)');
select tests.ok(tests.refuse($$select dossier_par_jeton('00000000-0000-0000-0000-00000000f0a0')$$, 'P0008'), 'lien de situation : pas le dossier (P0008)');
select tests.ok(tests.refuse($$select situation_autorite('00000000-0000-0000-0000-00000000f0d1')$$, 'P0007'), 'lien d''avis : pas la situation (P0007)');
select tests.ok(tests.refuse($$select dossier_par_jeton('00000000-0000-0000-0000-00000000f0bb')$$, 'P0009'), 'D1 de B : aucun dossier déposé chez B (P0009)');

-- D1 dépose un avis avec deux prescriptions : le dossier passe en instruction.
select tests.ok((deposer_avis(:JD1, 'favorable_conditions', 'Sous réserve des deux points ci-dessous.',
   '[{"texte":"Un extincteur 6 kg à chaque stand de cuisson"},{"texte":"Voie engins de 4 m maintenue libre côté Ourthe","caractere":"obligatoire"},{"texte":"  "}]'::jsonb) ->> 'prescriptions')::int = 2,
   'D1 : avis déposé, deux prescriptions (la vide ignorée)');
select tests.ok((dossier_par_jeton(:JD1) -> 'dossier' ->> 'statut') = 'en_instruction', 'premier avis : dossier en instruction');
select tests.ok((dossier_par_jeton(:JD1) -> 'mon_avis' ->> 'avis') = 'favorable_conditions', 'D1 : relit son avis');
select tests.ok(jsonb_array_length(dossier_par_jeton(:JCOM) -> 'avis') = 1, 'commune : voit l''avis de D1');
-- Un second avis D1 remplace le premier sans l'effacer.
select tests.ok((deposer_avis(:JD1, 'favorable', 'Points levés.', '[]') ->> 'avis_id') is not null, 'D1 : second avis');
reset role;
select tests.ok((select count(*) from avis_autorite where discipline = 'D1') = 2 and (select count(*) from avis_autorite where discipline = 'D1' and remplace_le is null) = 1, 'historique : deux avis D1, un seul en vigueur');
select tests.anonyme(); set role anon;
select tests.ok((dossier_par_jeton(:JCOM) -> 'avis' -> 0 ->> 'avis') = 'favorable', 'commune : l''avis en vigueur est le second');
-- Le lien expiré n'écrit plus ; révoqué non plus.
select tests.ok(tests.refuse($$select deposer_avis('00000000-0000-0000-0000-00000000f0d2', 'favorable')$$, 'P0006'), 'lien expiré : n''écrit pas');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
update acces_autorite set actif = false where jeton = :JD1;
reset role;
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select deposer_avis('00000000-0000-0000-0000-00000000f0d1', 'favorable')$$, 'P0005'), 'lien révoqué : n''écrit plus (P0005)');
-- La commune accuse réception ; un lien de situation ne peut pas.
select tests.ok((accuser_reception_dossier(:JCOM) ->> 'statut') = 'en_instruction', 'commune : accusé de réception');
select tests.ok(tests.refuse($$select accuser_reception_dossier('00000000-0000-0000-0000-00000000f0a0')$$, 'P0008'), 'situation : n''accuse pas réception');
select tests.ok(tests.refuse($$select * from avis_autorite$$, '42501'), 'anonyme : table des avis fermée');
reset role;

-- Les prescriptions en vigueur entrent dans la check-list du jour J (celles du premier avis D1, remplacé, non).
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
update acces_autorite set actif = true where jeton = :JD1;
reset role;
select tests.anonyme(); set role anon;
select tests.ok((deposer_avis(:JD1, 'favorable_conditions', null, '[{"texte":"Extincteur 6 kg à chaque stand de cuisson"},{"texte":"Éclairage de secours du chapiteau","caractere":"recommande"}]'::jsonb) ->> 'prescriptions')::int = 2, 'D1 : troisième avis, deux prescriptions');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select count(*) from avis_autorite where discipline = 'D1') = 3, 'coord A : voit les trois avis D1');
select tests.ok((select count(*) from prescriptions_dossier) = 4, 'coord A : voit les quatre prescriptions (deux remplacées, deux en vigueur)');
create temp table t159 as select demarrer_controle(:EA, 'test159', 'J-1') as session;
select tests.ok((select count(*) from controles_lignes l where l.session_id = (select session from t159) and l.prescription_id is not null) = 2, 'check-list : les deux prescriptions en vigueur, pas les remplacées');
select tests.ok(exists (select 1 from controles_lignes l where l.session_id = (select session from t159) and l.libelle like 'D1 — Éclairage de secours du chapiteau (recommandé)'), 'check-list : libellé avec la discipline et le caractère');
drop table t159;
reset role;

-- Coordinateur B ne voit rien des avis de A.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from avis_autorite) = 0 and (select count(*) from prescriptions_dossier) = 0, 'coord B : aucun avis de A');
reset role;
\echo '=== 159 OK'
