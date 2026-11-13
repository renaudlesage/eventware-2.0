-- 172 — borner le dépôt d'avis par jeton : commentaire 4 000, 50 prescriptions de 1 000 caractères, refus 22001 sans rien écrire.
-- Suppose 159.sql et 161.sql joués avant (dossier de l'événement A déposé puis décidé).
set client_min_messages = notice;
\echo '=== 172 : bornes du dépôt d''avis'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set J2 '''00000000-0000-0000-0000-0000000172d2'''

-- Rejouable. Le dossier est remis en instruction le temps du test, puis rendu à son état.
delete from prescriptions_dossier where discipline = 'D2' and dossier_id = (select id from dossiers_securite where evenement_id = :EA);
delete from avis_autorite where discipline = 'D2' and dossier_id = (select id from dossiers_securite where evenement_id = :EA);
delete from acces_autorite where jeton = :J2;
create temp table t172 as select statut from dossiers_securite where evenement_id = :EA;
update dossiers_securite set statut = 'en_instruction' where evenement_id = :EA;
insert into acces_autorite (evenement_id, jeton, libelle, organisation, niveau, discipline)
values (:EA, :J2, 'T172 D2', 'Zone de police (test 172)', 'avis', 'D2');
create temp table t172j as select count(*) as n from journal where evenement_id = :EA and categorie = 'dossier';

select tests.ok(has_function_privilege('anon', 'public.deposer_avis(uuid,text,text,jsonb,date)'::regprocedure, 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname = 'deposer_avis' and a.grantee = 0),
  'droits : ouverte aux anonymes (accès par jeton), pas à PUBLIC');

select tests.anonyme(); set role anon;
-- Au-delà des bornes : refus 22001.
select tests.ok(tests.erreur(format('select deposer_avis(%L, %L, repeat(%L, 4001))', :J2, 'favorable', 'é')) like '22001 Commentaire trop long%', 'commentaire de 4 001 caractères : refusé (22001)');
select tests.ok(tests.erreur(format($$select deposer_avis(%L, 'favorable', 'ok', (select jsonb_agg(jsonb_build_object('texte', 'p' || g)) from generate_series(1, 51) g))$$, :J2)) like '22001 Trop de prescriptions%', '51 prescriptions : refusé (22001)');
select tests.ok(tests.erreur(format($$select deposer_avis(%L, 'favorable', 'ok', jsonb_build_array(jsonb_build_object('texte', 'courte'), jsonb_build_object('texte', repeat('x', 1001))))$$, :J2)) like '22001 Prescription trop longue%', 'une prescription de 1 001 caractères : refusé (22001)');
select tests.ok(tests.erreur(format($$select deposer_avis(%L, 'favorable', 'ok', '{"texte": "pas une liste"}'::jsonb)$$, :J2)) like '22023%', 'prescriptions qui ne sont pas une liste : refusé (22023)');
reset role;
-- … et rien n'a été écrit : ni avis, ni prescription, ni ligne de journal, ni changement de statut.
select tests.ok((select count(*) from avis_autorite where discipline = 'D2') = 0 and (select count(*) from prescriptions_dossier where discipline = 'D2') = 0, 'après les refus : aucun avis, aucune prescription');
select tests.ok((select count(*) from journal where evenement_id = :EA and categorie = 'dossier') = (select n from t172j), 'après les refus : aucune ligne de journal');

-- Aux bornes exactes : accepté. Les espaces de début et de fin ne comptent pas, une prescription vide non plus.
select tests.anonyme(); set role anon;
select tests.ok((deposer_avis(:J2, 'favorable_conditions', '  ' || repeat('é', 4000) || '  ',
  (select jsonb_agg(jsonb_build_object('texte', case when g = 51 then '   ' else repeat('x', 1000) || ' ' end)) from generate_series(1, 51) g)) ->> 'prescriptions')::int = 50,
  'commentaire de 4 000 caractères et 50 prescriptions de 1 000 (plus une vide) : accepté');
reset role;
select tests.ok((select length(commentaire) from avis_autorite where discipline = 'D2' and remplace_le is null) = 4000, 'le commentaire est enregistré en entier');
select tests.ok((select count(*) from prescriptions_dossier where discipline = 'D2') = 50 and (select max(length(texte)) from prescriptions_dossier where discipline = 'D2') = 1000, 'les 50 prescriptions sont enregistrées en entier');
-- L'usage courant n'a pas changé.
select tests.anonyme(); set role anon;
select tests.ok((deposer_avis(:J2, 'favorable', 'Points levés.') ->> 'prescriptions')::int = 0, 'un avis simple, sans prescription : comme avant');
select tests.ok((deposer_avis(:J2, 'favorable', null, null) ->> 'avis_id') is not null, 'sans commentaire ni liste (null) : comme avant');
select tests.ok(tests.refuse(format('select deposer_avis(%L, %L)', :J2, 'peut-être'), '22023'), 'avis inconnu : toujours refusé (22023)');
select tests.ok(tests.refuse($$select deposer_avis('00000000-0000-0000-0000-000000000000', 'favorable')$$, null), 'lien inconnu : toujours refusé');
reset role;

-- Nettoyage : le dossier retrouve son état.
delete from prescriptions_dossier where discipline = 'D2' and dossier_id = (select id from dossiers_securite where evenement_id = :EA);
delete from avis_autorite where discipline = 'D2' and dossier_id = (select id from dossiers_securite where evenement_id = :EA);
delete from journal where evenement_id = :EA and categorie = 'dossier' and objet_ref = 'D2';
delete from acces_autorite where jeton = :J2;
update dossiers_securite set statut = (select statut from t172) where evenement_id = :EA;
drop table t172; drop table t172j;
\echo '=== 172 OK'
