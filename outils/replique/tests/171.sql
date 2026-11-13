-- 171 — refermer les RPC de 167/168, durcir le masquage de la page du QR de poste, contrôle des fonctions exposées.
-- Suppose 162.sql joué avant (lieu T162-E2 « Étape 2 », équipe VOL ; a001 coordinateur, a002 bénévole, b001 coordinateur B).
set client_min_messages = notice;
\echo '=== 171 : droits des fonctions, masquage, contrôle'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

-- Rejouable.
delete from postes_qr where evenement_id = :EA;
delete from creneaux where evenement_id = :EA and code like 'T171-%';
delete from canaux_radio where evenement_id = :EA and libelle like 'T171%';
delete from lieux where evenement_id = :EA and code like 'T171-%';
delete from elements_plan where evenement_id = :EA and code like 'T171-%';
delete from fiches_reflexe where evenement_id = :EA and code like 'T171-%';
delete from fiches_poste where evenement_id = :EA and intitule like 'T171%';
delete from journal where evenement_id = :EA and categorie = 'qr_poste';
update evenements set telephone_qg = '0470 99 88 77' where id = :EA;

-- ---------------------------------------------------------------------
-- 1. Le masquage : les 37 écritures de l'annexe B (attendu null = inchangé)
-- ---------------------------------------------------------------------
create temp table t171b as
select t.texte, t.attendu, masquer_numeros(t.texte) as obtenu
  from (values
  ('Appelle Régis au 0470 11 22 33', 'Appelle Régis au [numéro : voir le QG]'),
  ('GSM 0470/11.22.33', 'GSM [numéro : voir le QG]'),
  ('+32 470 11 22 33', '[numéro : voir le QG]'),
  ('0032470112233', '[numéro : voir le QG]'),
  ('+32(0)470 11 22 33', '[numéro : voir le QG]'),
  ('0470112233', '[numéro : voir le QG]'),
  ('04 70 11 22 33', '[numéro : voir le QG]'),
  ('0470-11-22-33', '[numéro : voir le QG]'),
  ('Fixe 086 21 12 34', 'Fixe [numéro : voir le QG]'),
  ('04/222.33.44', '[numéro : voir le QG]'),
  ('Numéro vert 0800 12 345', 'Numéro vert [numéro : voir le QG]'),
  ('0470 11 22 33 ou 0471 22 33 44', '[numéro : voir le QG] ou [numéro : voir le QG]'),
  ('tel:0470.11.22.33', 'tel:[numéro : voir le QG]'),
  ('+33 6 12 34 56 78', '[numéro : voir le QG]'),
  ('whatsapp wa.me/32470112233', 'whatsapp wa.me/[numéro : voir le QG]'),
  ('GSM 0470' || chr(160) || '11' || chr(160) || '22' || chr(160) || '33', 'GSM [numéro : voir le QG]'),
  ('GSM 0470' || chr(8239) || '11' || chr(8239) || '22' || chr(8239) || '33', 'GSM [numéro : voir le QG]'),
  ('0470' || chr(8209) || '11' || chr(8209) || '22' || chr(8209) || '33', '[numéro : voir le QG]'),
  ('0470_11_22_33', '[numéro : voir le QG]'),
  ('Tél : 21 12 34', 'Tél : [numéro : voir le QG]'),
  ('mail regis.dupont@example.be', 'mail [adresse : voir le QG]'),
  ('Poste 09.00-12.30 0470 11 22 33', 'Poste 09.00-12.30 [numéro : voir le QG]'),
  ('Urgence 112, QG canal 3', null),
  ('Créneau 14h00-18h30, 25 barrières', null),
  ('Code cadenas 4812', null),
  ('Montage du 21/08/2027 au 22/08/2027', null),
  ('Poste tenu de 20.30-22.30', null),
  ('Poste 09.00-12.30 2 personnes', null),
  ('Stock : 1 500 000 gobelets', null),
  ('Coordonnées 50.3832, 5.6143', null),
  ('Rue de la Station 12-14 4190 Ferrières', null),
  ('Fréquence 446.00625 MHz', null),
  ('le 15-08-2026', null),
  ('Réf. LOG-2026-044', null),
  ('2 x 10 m, 3 x 3 m (12 pièces)', null),
  ('IBAN BE68 5390 0754 7034', 'IBAN BE[numéro : voir le QG]'),
  ('TVA BE 0123.456.789', 'TVA BE [numéro : voir le QG]')
  ) as t(texte, attendu);
select tests.ok((select count(*) from t171b) = 37, 'annexe B : 37 écritures');
select tests.ok(not exists (select 1 from t171b where obtenu is distinct from coalesce(attendu, texte)),
  'annexe B : les 37 donnent le résultat attendu' || coalesce(' — écart sur : ' || (select string_agg(texte, ' | ') from t171b where obtenu is distinct from coalesce(attendu, texte)), ''));
select tests.ok((select count(*) from t171b where attendu is not null) = 24 and (select count(*) from t171b where attendu is null and obtenu = texte) = 13, 'annexe B : 24 masquées, 13 inchangées');
select tests.ok(masquer_numeros(null) is null and masquer_numeros('') = '', 'masquer_numeros : null et vide');

-- Le JSON : seules les chaînes changent ; nombres, booléens, null et structure restent.
select tests.ok(
  masquer_numeros_json('{"n": 470112233, "d": 1.5, "v": true, "f": false, "z": null, "t": ["Servir", "Luc 0477 00 00 01", 12, {"e": "luc@example.be", "k": [null, 0]}], "s": "rien"}'::jsonb)
  = '{"n": 470112233, "d": 1.5, "v": true, "f": false, "z": null, "t": ["Servir", "Luc [numéro : voir le QG]", 12, {"e": "[adresse : voir le QG]", "k": [null, 0]}], "s": "rien"}'::jsonb,
  'masquer_numeros_json : chaînes masquées, nombres, booléens, null et structure intacts');
select tests.ok(masquer_numeros_json(null) is null and masquer_numeros_json('[]'::jsonb) = '[]'::jsonb and masquer_numeros_json('{}'::jsonb) = '{}'::jsonb
  and masquer_numeros_json('"GSM 0470 11 22 33"'::jsonb) = '"GSM [numéro : voir le QG]"'::jsonb and masquer_numeros_json('42'::jsonb) = '42'::jsonb,
  'masquer_numeros_json : null, liste vide, objet vide, chaîne seule, nombre seul');
select tests.ok((select string_agg(v #>> '{}', ',' order by n) from jsonb_array_elements(masquer_numeros_json('["c", "a", "b"]'::jsonb)) with ordinality as e(v, n)) = 'c,a,b',
  'masquer_numeros_json : l''ordre d''une liste est gardé');

-- ---------------------------------------------------------------------
-- 2. Un poste dont CHAQUE champ de texte libre porte un numéro ou une adresse
-- ---------------------------------------------------------------------
insert into fiches_poste (id, evenement_id, intitule, mission, taches, materiel, a_signaler, contact)
values ('00000000-0000-0000-0000-0000000171f1', :EA, 'T171 Bar piégé',
        'Servir. Si rupture, appeler Marc au 0470 12 34 56',
        jsonb_build_array('Servir', 'Prévenir Luc 0477' || chr(160) || '00' || chr(160) || '00' || chr(160) || '01', 'Écrire à luc@example.be'),
        'Tablier ; clé chez Anne (0478 11 11 11)',
        'Bagarre, malaise : GSM 0479 22 22 22',
        'Marc 0470 12 34 56 ou marc@example.be, sinon le 112');
insert into canaux_radio (evenement_id, numero, libelle, equipe_id, canal_urgence, actif, ordre) values
  (:EA, '73', 'T171 équipe VOL', '00000000-0000-0000-0000-0000000000e1', false, true, 3),
  (:EA, '71', 'T171 urgence', null, true, true, 1);
insert into creneaux (evenement_id, code, poste, debut, fin, equipe_id, lieu_id, fiche_id, consignes) values
  (:EA, 'T171-C1', 'Bar piégé', now() - interval '1 hour', now() + interval '1 hour', '00000000-0000-0000-0000-0000000000e1',
   (select id from lieux where evenement_id = :EA and code = 'T162-E2'), '00000000-0000-0000-0000-0000000171f1', 'Appeler Sophie au 0471 33 33 33 si rupture');
insert into elements_plan (evenement_id, code, nom, categorie, nature, centre_lat, centre_lon) values
  (:EA, 'T171-DEA', 'DEA du bar', 'dea', 'picto', 50.391, 5.62);
insert into fiches_reflexe (evenement_id, code, titre, categorie, declencheur, conduite, a_ne_pas_faire, contacts, ordre)
values (:EA, 'T171-R1', 'Malaise piégé', 'sanitaire', 'Appel de Paul (0472 44 44 44) ou alarme',
        '["Appeler le 112", "Puis Paul au 0472 44 44 44"]', '["Écrire à paul@example.be au lieu d''appeler"]', 'Paul 0472 44 44 44, secours 112', 0);

-- Connecté : la génération répond toujours (droit gardé aux connectés, garde interne intacte).
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.erreur($$select generer_postes_qr('00000000-0000-0000-0000-00000000e0aa')$$) like '42501%' and tests.erreur($$select generer_postes_qr('00000000-0000-0000-0000-00000000e0aa')$$) not like '%permission denied for function%',
  'bénévole : generer_postes_qr refusée par sa garde interne, pas par les droits de la fonction');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(generer_postes_qr(:EA) >= 1, 'coordinateur : generer_postes_qr répond');
update postes_qr set consigne = 'Les fûts sont derrière le bar. Clé chez Luc : 0477 00 00 00.' where evenement_id = :EA and poste = 'Bar piégé';
reset role;

select jeton as jeton171 from postes_qr where evenement_id = :EA and poste = 'Bar piégé' \gset
select tests.anonyme(); set role anon;
select poste_par_jeton(:'jeton171')::text as page171 \gset
create temp table t171p as select :'page171'::jsonb as p, :'page171'::text as t;
create temp table t171r as select r as r from t171p, jsonb_array_elements(p -> 'reflexes') as r where r ->> 'code' = 'T171-R1';

-- Champ par champ.
select tests.ok((select p -> 'fiche' ->> 'mission' from t171p) = 'Servir. Si rupture, appeler Marc au [numéro : voir le QG]', 'page : mission masquée');
select tests.ok((select p -> 'fiche' -> 'taches' from t171p) = '["Servir", "Prévenir Luc [numéro : voir le QG]", "Écrire à [adresse : voir le QG]"]'::jsonb, 'page : tâches masquées (espaces insécables, adresse), liste et ordre gardés');
select tests.ok((select p -> 'fiche' ->> 'materiel' from t171p) = 'Tablier ; clé chez Anne [numéro : voir le QG])', 'page : matériel masqué');
select tests.ok((select p -> 'fiche' ->> 'a_signaler' from t171p) = 'Bagarre, malaise : GSM [numéro : voir le QG]', 'page : à signaler masqué');
select tests.ok((select p -> 'fiche' ->> 'contact' from t171p) = 'Marc [numéro : voir le QG] ou [adresse : voir le QG], sinon le 112', 'page : contact masqué, le 112 reste');
select tests.ok((select p -> 'creneau_courant' ->> 'consignes' from t171p) = 'Appeler Sophie au [numéro : voir le QG] si rupture', 'page : consignes du créneau masquées');
select tests.ok((select p -> 'poste' ->> 'consigne' from t171p) = 'Les fûts sont derrière le bar. Clé chez Luc : [numéro : voir le QG].', 'page : consigne du poste masquée');
select tests.ok((select count(*) from t171r) = 1, 'page : la fiche réflexe piégée est servie');
select tests.ok((select r ->> 'declencheur' from t171r) = 'Appel de Paul [numéro : voir le QG]) ou alarme', 'page : déclencheur masqué');
select tests.ok((select r -> 'conduite' from t171r) = '["Appeler le 112", "Puis Paul au [numéro : voir le QG]"]'::jsonb, 'page : conduite masquée, le 112 reste');
select tests.ok((select r -> 'a_ne_pas_faire' from t171r) = '["Écrire à [adresse : voir le QG] au lieu d''appeler"]'::jsonb, 'page : à ne pas faire masqué');
select tests.ok((select r ->> 'contacts' from t171r) = 'Paul [numéro : voir le QG], secours 112', 'page : contacts de la fiche réflexe masqués');

-- La page entière : aucun numéro personnel, aucune adresse, sous aucune écriture.
select tests.ok((select t from t171p) !~ '(0470 12 34 56|0477.00.00.0[01]|0478 11 11 11|0479 22 22 22|0471 33 33 33|0472 44 44 44)', 'page : aucun des six numéros personnels');
select tests.ok((select t from t171p) !~ '@', 'page : aucune adresse e-mail');
select tests.ok((select replace(t, '0470 99 88 77', '') from t171p) !~ ('0[0-9]{3}[ ./' || chr(160) || chr(8239) || '_-]?[0-9]{2}[ ./' || chr(160) || chr(8239) || '_-]?[0-9]{2}[ ./' || chr(160) || chr(8239) || '_-]?[0-9]{2}'),
  'page : hors numéro du QG, plus rien qui ait la forme d''un numéro belge');
-- Ce qui doit rester.
select tests.ok((select p -> 'evenement' ->> 'telephone_qg' from t171p) = '0470 99 88 77', 'page : le numéro du QG reste affiché');
select tests.ok((select (length(t) - length(replace(t, '0470 99 88 77', ''))) / length('0470 99 88 77') from t171p) = 1, 'page : le numéro du QG ne figure qu''une fois');
select tests.ok((select p -> 'radio' -> 'equipe' ->> 'numero' from t171p) = '73' and (select p -> 'radio' -> 'urgence' ->> 'numero' from t171p) = '71', 'page : les canaux radio restent affichés');
select tests.ok((select p -> 'secours' -> 0 ->> 'categorie' from t171p) = 'dea' and (select (p -> 'secours' -> 0 ->> 'distance_m')::int from t171p) between 80 and 140, 'page : les secours proches restent affichés');
select tests.ok((select p -> 'fiche' ->> 'intitule' from t171p) = 'T171 Bar piégé' and (select p -> 'poste' ->> 'lieu' from t171p) = 'Étape 2', 'page : intitulé et lieu inchangés');
reset role;

-- ---------------------------------------------------------------------
-- 3. Les droits
-- ---------------------------------------------------------------------
-- Vu du catalogue : fermées aux anonymes, gardées aux connectés.
select tests.ok(not exists (
  select 1 from unnest(array[
    'famille_demande(uuid,text)', 'familles_evenement(uuid)', 'memoire_lieux(uuid)', 'rex_proposer(uuid)', 'rapprocher_lieux(uuid,uuid)',
    'rattacher_demandes_lieux(uuid)', 'generer_postes_qr(uuid)', 'masquer_numeros(text)', 'masquer_numeros_json(jsonb)',
    'notification_dmp_categories()', 'type_lieu_du_plan(categorie_element,text)']) as s
   where has_function_privilege('anon', ('public.' || s)::regprocedure, 'execute') or not has_function_privilege('authenticated', ('public.' || s)::regprocedure, 'execute')),
  'droits : les onze fonctions sont fermées aux anonymes et ouvertes aux connectés');
select tests.ok(not has_function_privilege('authenticated', 'public.miroir_lieu_element(elements_plan)'::regprocedure, 'execute')
  and not has_function_privilege('authenticated', 'public.miroir_dependance_lien(liens_plan)'::regprocedure, 'execute')
  and not has_function_privilege('anon', 'public.miroir_lieu_element(elements_plan)'::regprocedure, 'execute'),
  'droits : les deux aides internes ne s''appellent plus directement');
select tests.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'droits : plus aucune fonction de déclencheur dans l''API');
select tests.ok(not exists (
  select 1 from unnest(array['contenu_public', 'evenement_public', 'creer_signalement', 'suivi_signalement', 'suivre_signalement', 'pointer_passage',
                             'situation_autorite', 'dossier_par_jeton', 'deposer_avis', 'accuser_reception_dossier', 'poste_par_jeton']) as n
   where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n and has_function_privilege('anon', p.oid, 'execute'))),
  'droits : les onze fonctions publiques par jeton restent ouvertes aux anonymes');

-- Vu d'un anonyme : les huit RPC sont refusées par les droits de la fonction, avant toute garde interne.
select tests.anonyme(); set role anon;
select tests.ok(tests.erreur($$select famille_demande(null, 'jetons')$$) like '42501 permission denied for function%', 'anonyme : famille_demande refusée');
select tests.ok(tests.erreur($$select * from familles_evenement('00000000-0000-0000-0000-00000000e0aa')$$) like '42501 permission denied for function%', 'anonyme : familles_evenement refusée');
select tests.ok(tests.erreur($$select * from memoire_lieux('00000000-0000-0000-0000-00000000e0aa')$$) like '42501 permission denied for function%', 'anonyme : memoire_lieux refusée');
select tests.ok(tests.erreur($$select rex_proposer('00000000-0000-0000-0000-00000000e0aa')$$) like '42501 permission denied for function%', 'anonyme : rex_proposer refusée');
select tests.ok(tests.erreur($$select rapprocher_lieux('00000000-0000-0000-0000-00000000e0aa', '00000000-0000-0000-0000-00000000e0bb')$$) like '42501 permission denied for function%', 'anonyme : rapprocher_lieux refusée');
select tests.ok(tests.erreur($$select rattacher_demandes_lieux('00000000-0000-0000-0000-00000000e0aa')$$) like '42501 permission denied for function%', 'anonyme : rattacher_demandes_lieux refusée');
select tests.ok(tests.erreur($$select generer_postes_qr('00000000-0000-0000-0000-00000000e0aa')$$) like '42501 permission denied for function%', 'anonyme : generer_postes_qr refusée');
select tests.ok(tests.erreur($$select masquer_numeros('GSM 0470 11 22 33')$$) like '42501 permission denied for function%', 'anonyme : masquer_numeros refusée');
select tests.ok(tests.erreur($$select masquer_numeros_json('[]'::jsonb)$$) like '42501 permission denied for function%', 'anonyme : masquer_numeros_json refusée');
select tests.ok(tests.erreur($$select * from audit_fonctions_exposees()$$) like '42501 permission denied for function%', 'anonyme : le contrôle lui-même est fermé');
-- … et les fonctions par jeton répondent toujours (un refus éventuel vient d'elles, pas des droits).
select tests.ok(coalesce(tests.erreur($$select dossier_par_jeton('00000000-0000-0000-0000-000000000000')$$), '') not like '%permission denied for function%', 'anonyme : dossier_par_jeton répond');
select tests.ok(coalesce(tests.erreur($$select deposer_avis('00000000-0000-0000-0000-000000000000', 'favorable')$$), '') not like '%permission denied for function%', 'anonyme : deposer_avis répond');
select tests.ok(coalesce(tests.erreur($$select accuser_reception_dossier('00000000-0000-0000-0000-000000000000')$$), '') not like '%permission denied for function%', 'anonyme : accuser_reception_dossier répond');
select tests.ok(coalesce(tests.erreur($$select situation_autorite('00000000-0000-0000-0000-000000000000')$$), '') not like '%permission denied for function%', 'anonyme : situation_autorite répond');
select tests.ok(coalesce(tests.erreur($$select contenu_public('00000000-0000-0000-0000-000000000000')$$), '') not like '%permission denied for function%', 'anonyme : contenu_public répond');
select tests.ok(tests.erreur(format('select poste_par_jeton(%L)', :'jeton171')) is null, 'anonyme : poste_par_jeton répond');
reset role;

-- Connecté : les RPC répondent (un refus éventuel vient de leur garde, pas des droits).
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(tests.erreur($$select famille_demande('00000000-0000-0000-0000-00000000e0aa', 'Il faut des jetons au bar')$$) is null, 'connecté : famille_demande répond');
select tests.ok(tests.erreur($$select count(*) from familles_evenement('00000000-0000-0000-0000-00000000e0aa')$$) is null, 'connecté : familles_evenement répond');
select tests.ok(tests.erreur($$select count(*) from memoire_lieux('00000000-0000-0000-0000-00000000e0aa')$$) is null, 'connecté : memoire_lieux répond');
select tests.ok(masquer_numeros('GSM 0470 11 22 33') = 'GSM [numéro : voir le QG]', 'connecté : masquer_numeros répond (aperçu de l''organisateur)');
select tests.ok(tests.erreur($$select notification_dmp_categories()$$) is null, 'connecté : notification_dmp_categories répond');
select tests.ok(coalesce(tests.erreur($$select rex_proposer(null)$$), '') not like '%permission denied for function%'
  and coalesce(tests.erreur($$select rapprocher_lieux(null, null)$$), '') not like '%permission denied for function%'
  and coalesce(tests.erreur($$select rattacher_demandes_lieux(null)$$), '') not like '%permission denied for function%',
  'connecté : rex_proposer, rapprocher_lieux et rattacher_demandes_lieux restent appelables');
select tests.ok(tests.erreur($$select * from audit_fonctions_exposees()$$) like '42501 permission denied for function%', 'connecté : le contrôle est réservé au rôle postgres');
-- Un déclencheur dont la fonction a perdu EXECUTE tourne encore, et appelle l'aide interne fermée.
insert into elements_plan (evenement_id, code, nom, categorie, nature, centre_lat, centre_lon)
values (:EA, 'T171-BAR', 'Bar d''essai', 'bar', 'objet', 50.39, 5.62);
select tests.ok(exists (select 1 from lieux where evenement_id = :EA and code = 'T171-BAR' and type = 'bar' and element_plan_id is not null),
  'connecté : le déclencheur miroir tourne encore (lieu créé depuis l''objet du plan)');
select tests.ok((select created_by from elements_plan where evenement_id = :EA and code = 'T171-BAR') = '00000000-0000-0000-0000-00000000a001',
  'connecté : le déclencheur de traçabilité tourne encore');
select tests.ok(tests.erreur($$select miroir_lieu_element((select e from elements_plan e where e.code = 'T171-BAR'))$$) like '42501 permission denied for function%',
  'connecté : l''aide interne ne s''appelle plus directement');
reset role;

-- ---------------------------------------------------------------------
-- 4. Le contrôle qui doit rester vide
-- ---------------------------------------------------------------------
select tests.ok(not exists (select 1 from audit_fonctions_exposees()),
  'audit_fonctions_exposees() est vide' || coalesce(' — il reste : ' || (select string_agg(fonction || ' [' || probleme || ']', ' ; ') from audit_fonctions_exposees()), ''));
-- Il voit bien un oubli : une fonction créée sans retrait de droits apparaît trois fois, puis disparaît avec elle.
begin;
create function public.t171_oubli() returns int language sql as 'select 1';
select tests.ok((select count(*) from audit_fonctions_exposees() where fonction = 't171_oubli()') = 3, 'le contrôle voit une fonction créée sans retrait : sans connexion, PUBLIC, search_path');
rollback;
select tests.ok(not exists (select 1 from audit_fonctions_exposees()), 'le contrôle est de nouveau vide');

-- ---------------------------------------------------------------------
-- 5. La migration rejouée ne change rien
-- ---------------------------------------------------------------------
create temp table t171e as
select md5(string_agg(pg_get_functiondef(p.oid) || '|' || coalesce(p.proacl::text, 'NULL'), E'\n' order by p.oid::regprocedure::text)) as empreinte, count(*) as n
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
\ir ../../../supabase/migrations/20261111220000_171_fermer_rpc_et_masquage.sql
select tests.ok((select empreinte from t171e) = (
  select md5(string_agg(pg_get_functiondef(p.oid) || '|' || coalesce(p.proacl::text, 'NULL'), E'\n' order by p.oid::regprocedure::text))
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'la migration rejouée ne change ni une définition ni un droit (' || (select n from t171e) || ' fonctions comparées)');
select tests.ok(not exists (select 1 from audit_fonctions_exposees()), 'après le rejeu, le contrôle est toujours vide');

-- Nettoyage.
delete from postes_qr where evenement_id = :EA;
delete from creneaux where evenement_id = :EA and code like 'T171-%';
delete from canaux_radio where evenement_id = :EA and libelle like 'T171%';
delete from lieux where evenement_id = :EA and code like 'T171-%';
delete from elements_plan where evenement_id = :EA and code like 'T171-%';
delete from fiches_reflexe where evenement_id = :EA and code like 'T171-%';
delete from fiches_poste where evenement_id = :EA and intitule like 'T171%';
delete from journal where evenement_id = :EA and categorie = 'qr_poste';
update evenements set telephone_qg = null where id = :EA;
\echo '=== 171 OK'
