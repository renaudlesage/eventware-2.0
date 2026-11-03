-- 168 — le QR du poste : postes depuis les créneaux, page publique sans nom ni numéro personnel.
-- Suppose 162.sql joué avant (lieux T162-E2 « Étape 2 », équipe VOL ; a001 coordinateur, a002 bénévole, b001 coordinateur B).
set client_min_messages = notice;
\echo '=== 168 : QR du poste'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

-- Rejouable.
delete from postes_qr where evenement_id = :EA;
delete from creneaux where evenement_id = :EA and code like 'T168-%';
delete from canaux_radio where evenement_id = :EA and libelle like 'T168%';
delete from elements_plan where evenement_id = :EA and code like 'T168-%';
delete from fiches_reflexe where evenement_id = :EA and code like 'T168-%';
delete from fiches_poste where evenement_id = :EA and intitule like 'T168%';
delete from journal where evenement_id = :EA and categorie = 'qr_poste';
update evenements set telephone_qg = '0470 99 88 77' where id = :EA;

-- Le poste « Bar étape 2 » : une fiche (avec un numéro personnel dedans), deux créneaux (en cours, suivant) de l'équipe VOL
-- à l'Étape 2 ; un poste « Jetons » sans fiche ; les canaux ; un DEA à ~110 m de l'Étape 2 ; une fiche réflexe.
insert into fiches_poste (id, evenement_id, intitule, mission, taches, materiel, a_signaler, contact)
values ('00000000-0000-0000-0000-0000000168f1', :EA, 'T168 Bar étape 2', 'Servir et tenir la caisse', '["Servir", "Compter les fûts"]', 'Tablier, pompe', 'Bagarre, malaise', 'Marc 0470 12 34 56 ou le 112');
insert into canaux_radio (evenement_id, numero, libelle, equipe_id, canal_urgence, actif, ordre) values
  (:EA, '93', 'T168 équipe VOL', '00000000-0000-0000-0000-0000000000e1', false, true, 3),
  (:EA, '91', 'T168 urgence', null, true, true, 1);
insert into creneaux (evenement_id, code, poste, debut, fin, equipe_id, lieu_id, fiche_id, consignes) values
  (:EA, 'T168-C1', 'Bar étape 2', now() - interval '1 hour', now() + interval '1 hour', '00000000-0000-0000-0000-0000000000e1', (select id from lieux where evenement_id = :EA and code = 'T162-E2'), '00000000-0000-0000-0000-0000000168f1', 'Appeler Sophie au 0499 11 22 33 si rupture'),
  (:EA, 'T168-C2', 'Bar étape 2 ', now() + interval '2 hour', now() + interval '4 hour', '00000000-0000-0000-0000-0000000000e1', (select id from lieux where evenement_id = :EA and code = 'T162-E2'), null, null),
  (:EA, 'T168-C3', 'Jetons', now() + interval '2 hour', now() + interval '4 hour', null, null, null, null);
insert into elements_plan (evenement_id, code, nom, categorie, nature, centre_lat, centre_lon) values
  (:EA, 'T168-DEA', 'DEA du bar', 'dea', 'picto', 50.391, 5.62),
  (:EA, 'T168-SORTIE', 'Sortie nord', 'sortie_secours', 'picto', 50.395, 5.62);
insert into fiches_reflexe (evenement_id, code, titre, categorie, declencheur, conduite, a_ne_pas_faire, contacts, ordre)
values (:EA, 'T168-R1', 'Malaise', 'sanitaire', 'Une personne s''effondre', '["Appeler le 112", "Prévenir le QG"]', '["Déplacer la personne"]', 'QG 0470 99 88 77, secours 112', 1);

select tests.ok(exists (select 1 from pg_policies where tablename = 'postes_qr' and policyname = 'postes_qr_lecture'), 'police de lecture des postes');
select tests.ok(masquer_numeros('Marc 0470 12 34 56 ou le 112') = 'Marc [numéro : voir le QG] ou le 112', 'masquer_numeros : le portable est masqué, le 112 reste');
select tests.ok(masquer_numeros('+32 470 12 34 56 et 04 70/12.34.56') = '[numéro : voir le QG] et [numéro : voir le QG]', 'masquer_numeros : formats +32 et points/barres');
select tests.ok(masquer_numeros(null) is null, 'masquer_numeros : null');

-- Le bénévole ne génère pas ; le coordinateur génère deux postes, pas trois (le libellé est normalisé).
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select generer_postes_qr('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'bénévole : ne génère pas');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(generer_postes_qr(:EA) = 2, 'générer : 2 postes (« Bar étape 2 », « Jetons »)');
select tests.ok(generer_postes_qr(:EA) = 0, 'générer : rejoué → 0');
select tests.ok((select count(*) from postes_qr where evenement_id = :EA) = 2, 'coord A : voit ses 2 postes');
select tests.ok((select fiche_id from postes_qr where evenement_id = :EA and poste = 'Bar étape 2') = '00000000-0000-0000-0000-0000000168f1', 'poste : la fiche vient des créneaux');
select tests.ok((select lieu_id from postes_qr where evenement_id = :EA and poste = 'Bar étape 2') = (select id from lieux where evenement_id = :EA and code = 'T162-E2'), 'poste : le lieu vient des créneaux');
select tests.ok((select equipe_id from postes_qr where evenement_id = :EA and poste = 'Bar étape 2') = '00000000-0000-0000-0000-0000000000e1', 'poste : l''équipe vient des créneaux');
select tests.ok((select fiche_id from postes_qr where evenement_id = :EA and poste = 'Jetons') is null, 'poste sans fiche : fiche_id null');
select tests.ok(exists (select 1 from journal where evenement_id = :EA and categorie = 'qr_poste'), 'journal : génération consignée');
update postes_qr set consigne = 'Les fûts sont derrière le bar. Clé chez Luc : 0477 00 00 00.' where evenement_id = :EA and poste = 'Bar étape 2';
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from postes_qr where evenement_id = :EA) = 0, 'coord B : ne voit rien');
reset role;

-- La page publique, sans session.
-- (Variables psql plutôt qu'une table temporaire : anon ne lit pas ce que postgres a créé.)
select jeton as jeton168 from postes_qr where evenement_id = :EA and poste = 'Bar étape 2' \gset
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select count(*) from postes_qr$$, '42501'), 'anonyme : la table est fermée');
select tests.ok(tests.refuse($$select poste_par_jeton('00000000-0000-0000-0000-000000000000')$$, 'P0002'), 'anonyme : jeton inconnu → P0002');
select poste_par_jeton(:'jeton168')::text as page168 \gset
create temp table t168p as select :'page168'::jsonb as p;
select tests.ok((select p -> 'evenement' ->> 'nom' from t168p) = 'BFMF 2027', 'page : l''événement');
select tests.ok((select p -> 'evenement' ->> 'telephone_qg' from t168p) = '0470 99 88 77', 'page : le numéro du QG, le seul numéro affiché');
select tests.ok((select p -> 'poste' ->> 'poste' from t168p) = 'Bar étape 2' and (select p -> 'poste' ->> 'lieu' from t168p) = 'Étape 2', 'page : le poste et son lieu');
select tests.ok((select p -> 'poste' ->> 'equipe' from t168p) like 'VOL · %', 'page : l''équipe (code et nom, pas de personne)');
select tests.ok((select p -> 'poste' ->> 'consigne' from t168p) = 'Les fûts sont derrière le bar. Clé chez Luc : [numéro : voir le QG].', 'page : la consigne du poste, numéro masqué');
select tests.ok((select p -> 'fiche' ->> 'intitule' from t168p) = 'T168 Bar étape 2' and (select jsonb_array_length(p -> 'fiche' -> 'taches') from t168p) = 2, 'page : la fiche et ses tâches');
select tests.ok((select p -> 'fiche' ->> 'contact' from t168p) = 'Marc [numéro : voir le QG] ou le 112', 'page : le numéro personnel de la fiche est masqué');
select tests.ok((select p -> 'creneau_courant' ->> 'code' from t168p) = 'T168-C1' and (select p -> 'creneau_courant' ->> 'consignes' from t168p) = 'Appeler Sophie au [numéro : voir le QG] si rupture', 'page : le créneau en cours, consignes masquées');
select tests.ok((select p -> 'creneau_suivant' ->> 'code' from t168p) = 'T168-C2', 'page : le créneau suivant (libellé avec espace final rattaché)');
select tests.ok((select p -> 'radio' -> 'equipe' ->> 'numero' from t168p) = '93' and (select p -> 'radio' -> 'urgence' ->> 'numero' from t168p) = '91', 'page : canal de l''équipe et canal d''urgence');
select tests.ok((select p -> 'secours' -> 0 ->> 'categorie' from t168p) = 'dea' and (select (p -> 'secours' -> 0 ->> 'distance_m')::int from t168p) between 80 and 140, 'page : le DEA le plus proche, à ~110 m');
select tests.ok((select p -> 'secours' -> 1 ->> 'categorie' from t168p) = 'sortie_secours', 'page : puis la sortie de secours');
select tests.ok((select jsonb_array_length(p -> 'reflexes') from t168p) >= 1 and (select p -> 'reflexes' -> 0 ->> 'contacts' from t168p) = 'QG [numéro : voir le QG], secours 112', 'page : les fiches réflexe, numéros masqués');
select tests.ok((select p::text from t168p) not ilike '%Coord A%' and (select p::text from t168p) not ilike '%Bénévole A%', 'page : aucun nom de membre');
select tests.ok((select p::text from t168p) !~ '0470 99 88 77.*0470 99 88 77', 'page : le numéro du QG ne figure qu''une fois (dans l''événement)');
reset role;
select tests.ok((select nb_acces from postes_qr where jeton = :'jeton168') = 1, 'compteur : 1 accès');
-- Désactivé → P0003.
update postes_qr set actif = false where jeton = :'jeton168';
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse(format('select poste_par_jeton(%L)', :'jeton168'), 'P0003'), 'anonyme : QR désactivé → P0003');
reset role;

-- Nettoyage.
delete from postes_qr where evenement_id = :EA;
delete from creneaux where evenement_id = :EA and code like 'T168-%';
delete from canaux_radio where evenement_id = :EA and libelle like 'T168%';
delete from elements_plan where evenement_id = :EA and code like 'T168-%';
delete from fiches_reflexe where evenement_id = :EA and code like 'T168-%';
delete from fiches_poste where evenement_id = :EA and intitule like 'T168%';
delete from journal where evenement_id = :EA and categorie = 'qr_poste';
update evenements set telephone_qg = null where id = :EA;
\echo '=== 168 OK'
