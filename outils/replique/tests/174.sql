-- 174 — critère de défaillance unique : un plan construit pour déclencher chaque verdict, puis les six corrections une à une.
-- Suppose 00_jeu.sql (a001 coordinateur à tout pouvoir, a002 bénévole, b001 coordinateur d'une autre organisation).
-- Tout se joue dans une transaction annulée : l'événement d'essai retrouve son état, le test se rejoue tel quel.
set client_min_messages = notice;
\echo '=== 174 : critère de défaillance unique'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
begin;

-- Table rase pour l'événement A : ni plan, ni QG, ni radio, ni moyens, ni téléphone.
delete from elements_plan where evenement_id = :EA;
update lieux set deleted_at = now() where evenement_id = :EA and type = 'pc_ops' and deleted_at is null;
update canaux_radio set actif = false where evenement_id = :EA;
delete from moyens_premiers_secours where evenement_id = :EA;
update evenements set point_0_lat = 50.39000, point_0_lon = 5.62000, telephone_qg = null where id = :EA;
update membres_evenement set telephone = null where evenement_id = :EA;
update membres_evenement set telephone = '0470 00 00 02' where evenement_id = :EA and user_id = '00000000-0000-0000-0000-00000000a002';

-- Le plan. Sous nos latitudes, 0,0001° de latitude font 11 m et 0,0001° de longitude 7 m.
insert into elements_plan (id, evenement_id, code, nom, categorie, nature, centre_lat, centre_lon, production_kva, est_risque, distance_securite_m) values
  ('00000000-0000-0000-0000-0000001740a1', :EA, 'T174-GE1', 'Groupe 20 kVA du bar', 'groupe_electrogene', 'picto', 50.39010, 5.62020, 20, true, 3),
  ('00000000-0000-0000-0000-0000001740a2', :EA, 'T174-GE2', 'Groupe 100 kVA de la scène', 'groupe_electrogene', 'picto', 50.38950, 5.61900, 100, true, 3),
  ('00000000-0000-0000-0000-0000001740a3', :EA, 'T174-MAT', 'Mât lumineux thermique', 'autre', 'picto', 50.39100, 5.62100, 2, false, 0);
insert into elements_plan (evenement_id, code, nom, categorie, nature, centre_lat, centre_lon, accueil_public, est_risque, puissance_kw, alimente_par) values
  (:EA, 'T174-SCENE', 'Scène', 'scene', 'picto', 50.39000, 5.62000, true, false, 5, '00000000-0000-0000-0000-0000001740a2'),
  (:EA, 'T174-BAR', 'Bar', 'bar_installation', 'picto', 50.39050, 5.62000, true, false, 4, null),
  (:EA, 'T174-DEA1', 'DEA du site', 'dea', 'picto', 50.39010, 5.62000, false, false, 0, null),
  (:EA, 'T174-DEA2', 'DEA de la pharmacie du village', 'dea', 'picto', 50.41000, 5.62000, false, false, 0, null),
  (:EA, 'T174-DEA3', 'DEA pas encore placé', 'dea', 'picto', null, null, false, false, 0, null),
  (:EA, 'T174-PS1', 'Poste de soins', 'poste_secours', 'picto', 50.39020, 5.62000, false, false, 0, null),
  (:EA, 'T174-PS2', 'Poste de soins nord', 'poste_secours', 'picto', 50.39070, 5.62000, false, false, 0, null),
  (:EA, 'T174-FRITE', 'Friterie', 'foodtruck', 'picto', 50.38960, 5.62000, false, true, 0, null),
  (:EA, 'T174-EXT1', 'Extincteur de la friterie', 'extincteur', 'picto', 50.38962, 5.62000, false, false, 0, null),
  (:EA, 'T174-FRIGO', 'Frigos du bar', 'autre', 'picto', 50.39030, 5.62030, false, false, 14, '00000000-0000-0000-0000-0000001740a1'),
  (:EA, 'T174-SORTIE1', 'Sortie nord', 'sortie_secours', 'picto', 50.39080, 5.62000, false, false, 0, null),
  (:EA, 'T174-SORTIE2', 'Sortie sud', 'sortie_secours', 'picto', 50.38940, 5.62000, false, false, 0, null),
  (:EA, 'T174-RASS1', 'Point de rassemblement', 'point_rassemblement', 'picto', 50.39120, 5.62000, false, false, 0, null);
-- Le QG : reconnu à sa fiche de catalogue, pas à son nom (correction 1). Objet du plan : son lieu miroir « PC opérationnel » est créé.
insert into elements_plan (id, evenement_id, code, nom, categorie, nature, centre_lat, centre_lon, puissance_kw, alimente_par, catalogue_id)
values ('00000000-0000-0000-0000-0000001740b1', :EA, 'T174-QG', 'Régie sécurité', 'autre', 'objet', 50.39015, 5.62020, 3,
        '00000000-0000-0000-0000-0000001740a1', (select id from catalogue_equipements where code = 'QGSECU' and organisation_id is null));
-- Un secouriste ; une ligne « poste de secours » qui n'en est pas un (le prototype la comptait).
insert into moyens_premiers_secours (evenement_id, type, quantite) values (:EA, 'secouriste', 1), (:EA, 'poste de secours', 3);

select tests.ok(exists (select 1 from lieux where evenement_id = :EA and element_plan_id = '00000000-0000-0000-0000-0000001740b1' and type = 'pc_ops' and deleted_at is null),
  'le plan d''essai est posé (le QG a son lieu miroir « PC opérationnel »)');

-- ---------------------------------------------------------------------
-- 1. Le plan d'essai, lu par un coordinateur
-- ---------------------------------------------------------------------
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
create temp table r1 on commit drop as select * from defaillance_unique(:EA);
reset role;

-- Fonctions de proximité.
select tests.ok((select verdict || '|' || niveau from r1 where fonction = 'DEFIB' and ligne = 'état nominal') = 'assurée|0'
  and (select detail from r1 where fonction = 'DEFIB' and ligne = 'état nominal') like '2 lieu(x) public(s) sur 2 à moins de 225 m%', 'défibrillation : assurée, 2 lieux publics sur 2');
select tests.ok((select verdict || '|' || niveau || '|' || element from r1 where ligne = 'perte de T174-DEA1') = 'ÉLÉMENT UNIQUE|2|T174-DEA1'
  and (select detail from r1 where ligne = 'perte de T174-DEA1') like '0 lieu(x) public(s) couvert(s) au lieu de 2 ; le plus éloigné passe à 22%', 'le DEA du site : élément unique (le suivant est à plus de 2 km)');
select tests.ok((select verdict || '|' || niveau from r1 where ligne = 'perte de T174-DEA2') = 'hors de portée|0'
  and (select detail from r1 where ligne = 'perte de T174-DEA2') like 'ne couvre aucun lieu public à moins de 225 m%', 'correction 5 : le DEA du village sort « hors de portée », pas « tient »');
select tests.ok((select verdict || '|' || niveau from r1 where fonction = 'DEFIB' and ligne = 'moyens sans position') = 'à vérifier|1'
  and (select detail from r1 where fonction = 'DEFIB' and ligne = 'moyens sans position') like '1 moyen(s)%T174-DEA3', 'correction 5 : le DEA sans position est signalé');
select tests.ok(not exists (select 1 from r1 where ligne = 'perte de T174-DEA3'), 'un moyen sans position n''est pas retiré (il ne couvre personne)');
select tests.ok((select verdict from r1 where fonction = 'SOINS' and ligne = 'état nominal') = 'assurée'
  and (select string_agg(verdict, ',' order by ligne) from r1 where fonction = 'SOINS' and ligne like 'perte de %') = 'tient,tient', 'soins : assurés, et la perte de l''un des deux postes tient');
select tests.ok((select verdict || '|' || niveau from r1 where fonction = 'EXTINCTION' and ligne = 'état nominal') = 'NON ASSURÉE|3'
  and (select detail from r1 where fonction = 'EXTINCTION' and ligne = 'état nominal') like '1 élément(s) à risque sur 3 à moins de 20 m%', 'extinction : non assurée, 1 élément à risque sur 3');
select tests.ok((select verdict from r1 where ligne = 'perte de T174-EXT1') = 'ÉLÉMENT UNIQUE', 'l''unique extincteur : élément unique');

-- Comptages.
select tests.ok((select verdict || '|' || detail from r1 where fonction = 'SECOURISTES') = 'ÉLÉMENT UNIQUE|1 secouriste(s) encodé(s) ; 0 disponible(s) si l''un est occupé', 'secouristes : 1, la ligne « poste de secours » n''est pas comptée');
select tests.ok((select verdict from r1 where fonction = 'SORTIES') = 'tient' and (select verdict || '|' || element from r1 where fonction = 'RASSEMBLEMENT') = 'ÉLÉMENT UNIQUE|T174-RASS1'
  and (select verdict || '|' || niveau from r1 where fonction = 'ACCÈS SECOURS') = 'NON ASSURÉE|3', 'sorties 2 : tient ; rassemblement 1 : élément unique ; accès des secours 0 : non assuré');

-- Alerte et commandement.
select tests.ok((select verdict || '|' || detail from r1 where fonction = 'ALERTE') = 'NON ASSURÉE|0 voie(s) indépendante(s) : radio absente ; téléphone du QG absent', 'alerte : aucune voie');
select tests.ok((select verdict || '|' || detail from r1 where fonction = 'COMMANDEMENT') = 'NON ASSURÉE|1 personne(s) à tout pouvoir, dont 0 joignable(s) par téléphone',
  'correction 2 : le téléphone d''un bénévole ne fait pas un commandement joignable');

-- Énergie.
select tests.ok((select verdict || '|' || niveau from r1 where ligne = 'perte de T174-GE1') = 'ÉLÉMENT UNIQUE|2'
  and (select detail from r1 where ligne = 'perte de T174-GE1') = 'alimente seul : T174-QG ; tombent : T174-FRIGO, T174-QG', 'correction 1 : le QG « Régie sécurité » est reconnu à sa fiche de catalogue ; son groupe est un élément unique');
select tests.ok((select verdict from r1 where ligne = 'perte de T174-GE2') = 'ÉLÉMENT UNIQUE' and (select detail from r1 where ligne = 'perte de T174-GE2') like 'alimente seul : T174-SCENE%', 'le groupe de la scène : élément unique');
select tests.ok((select verdict || '|' || niveau from r1 where ligne = 'charge de T174-GE1') = 'SURCHARGE|3'
  and (select detail from r1 where ligne = 'charge de T174-GE1') like '17,0 kW demandés pour 20 kVA : chargé à 106 %%', 'correction 6 : 17 kW sur 20 kVA, surcharge (106 %)');
select tests.ok(not exists (select 1 from r1 where ligne = 'charge de T174-GE2'), 'un groupe chargé à 6 % n''a pas de ligne de charge');
select tests.ok((select verdict || '|' || detail from r1 where ligne = 'consommateurs non raccordés') = 'à vérifier|1 consommateur(s), 4,0 kW, sans source encodée : T174-BAR', 'correction 6 : le bar, 4 kW, n''est raccordé à rien');
select tests.ok((select verdict || '|' || niveau from r1 where ligne = 'perte de T174-MAT') = 'à vérifier|1', 'le mât lumineux : source d''éclairage, à vérifier (et reconnu comme source sans être de catégorie « groupe »)');

-- Cause commune.
select tests.ok((select count(*) from r1 where fonction = 'CAUSE COMMUNE') = 1 and (select element from r1 where fonction = 'CAUSE COMMUNE') = 'T174-GE1',
  'cause commune : un seul élément à risque en cause, le groupe du bar');
select tests.ok((select detail from r1 where fonction = 'CAUSE COMMUNE') = 'défibrillation : 1 sur 1 (T174-DEA1 à 14 m) ; QG : 1 sur 1 (T174-QG à 6 m) ; ce groupe alimente aussi le QG',
  'cause commune : le seul DEA du site et le QG (compté une fois, pas deux avec son lieu miroir) ; les soins n''y sont pas, un poste est hors du voisinage');
select tests.ok(not exists (select 1 from r1 where fonction in ('QG', 'SITE')), 'ni ligne « QG non évaluable », ni ligne « point 0 » : les deux sont connus');
select tests.ok((select string_agg(ordre::text, ',' order by ordre) from (select distinct ordre from r1) x) = '1,2,3,4,5,6,7,8'
  and not exists (select 1 from r1 where niveau not between 0 and 3 or verdict is null or detail is null), 'la forme du résultat : huit rubriques, niveaux de 0 à 3, rien de vide');

-- ---------------------------------------------------------------------
-- 2. Les corrections qui dépendent d'un autre état
-- ---------------------------------------------------------------------
-- Correction 3 : deux canaux radio font UNE voie ; le téléphone du QG en fait une deuxième.
insert into canaux_radio (evenement_id, numero, libelle, canal_urgence, actif, ordre) values (:EA, '81', 'T174 urgence', true, true, 1), (:EA, '83', 'T174 équipes', false, true, 2);
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select verdict || '|' || detail from defaillance_unique(:EA) where fonction = 'ALERTE') = 'ÉLÉMENT UNIQUE|1 voie(s) indépendante(s) : radio 2 canal(aux), dont 1 d''urgence ; téléphone du QG absent',
  'correction 3 : deux canaux radio, une seule voie');
reset role;
update evenements set telephone_qg = '0470 99 88 77' where id = :EA;
update membres_evenement set telephone = '0470 00 00 01' where evenement_id = :EA and user_id = '00000000-0000-0000-0000-00000000a001';
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select verdict from defaillance_unique(:EA) where fonction = 'ALERTE') = 'tient', 'radio et téléphone du QG : deux voies, tient');
select tests.ok((select verdict || '|' || detail from defaillance_unique(:EA) where fonction = 'COMMANDEMENT') = 'ÉLÉMENT UNIQUE|1 personne(s) à tout pouvoir, dont 1 joignable(s) par téléphone',
  'une seule personne à tout pouvoir joignable : élément unique');
reset role;

-- Correction 4 : sans point 0, le site est centré sur ses lieux publics ; la cause commune est toujours trouvée, et on le dit.
update evenements set point_0_lat = null, point_0_lon = null where id = :EA;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
create temp table r2 on commit drop as select * from defaillance_unique(:EA);
reset role;
select tests.ok((select element from r2 where fonction = 'CAUSE COMMUNE') = 'T174-GE1' and (select detail from r2 where fonction = 'CAUSE COMMUNE') like 'défibrillation : 1 sur 1 (T174-DEA1 à 14 m)%',
  'correction 4 : sans point 0, la cause commune est toujours trouvée');
select tests.ok((select verdict || '|' || niveau from r2 where fonction = 'SITE') = 'à vérifier|1' and (select detail from r2 where fonction = 'SITE') like 'point 0 non posé : le site est centré sur ses lieux publics%',
  'correction 4 : le repli est annoncé');
update evenements set point_0_lat = 50.39000, point_0_lon = 5.62000 where id = :EA;

-- Les seuils sont des paramètres.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select verdict || '|' || detail from defaillance_unique(:EA, p_dea_m => 5) where fonction = 'DEFIB' and ligne = 'état nominal') like 'NON ASSURÉE|0 lieu(x) public(s) sur 2 à moins de 5 m%',
  'seuil du DEA ramené à 5 m : la défibrillation n''est plus assurée');
select tests.ok((select detail from defaillance_unique(:EA, p_voisin_m => 10) where fonction = 'CAUSE COMMUNE') = 'QG : 1 sur 1 (T174-QG à 6 m) ; ce groupe alimente aussi le QG',
  'voisinage ramené à 10 m : seul le QG reste dans la cause commune');
select tests.ok((select detail from defaillance_unique(:EA, p_dea_m => null, p_soins_m => -4, p_voisin_m => 0) where fonction = 'DEFIB' and ligne = 'état nominal') like '2 lieu(x) public(s) sur 2 à moins de 225 m%',
  'un seuil absent reprend sa valeur par défaut, un seuil absurde est borné');
reset role;

-- Correction 1, l'autre versant : sans aucun QG reconnu, on le dit au lieu de se taire.
update elements_plan set deleted_at = now() where id = '00000000-0000-0000-0000-0000001740b1';
update lieux set deleted_at = now() where evenement_id = :EA and type = 'pc_ops' and deleted_at is null;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
create temp table r3 on commit drop as select * from defaillance_unique(:EA);
reset role;
select tests.ok((select verdict || '|' || niveau from r3 where fonction = 'QG') = 'non évaluable|1', 'correction 1 : sans QG reconnu, une ligne « non évaluable »');
select tests.ok((select verdict from r3 where ligne = 'perte de T174-GE1') = 'sans effet sur la sécurité' and (select detail from r3 where fonction = 'CAUSE COMMUNE') = 'défibrillation : 1 sur 1 (T174-DEA1 à 14 m)',
  'sans QG : le groupe du bar n''alimente plus rien de critique, et la cause commune ne cite plus que le DEA');
-- Un QG reconnu à son seul nom, et un lieu « PC opérationnel » posé hors du plan.
insert into elements_plan (evenement_id, code, nom, categorie, nature, centre_lat, centre_lon) values (:EA, 'T174-PC', 'PC sécurité', 'autre', 'picto', 50.39300, 5.62000);
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(not exists (select 1 from defaillance_unique(:EA) where fonction = 'QG'), 'un élément nommé « PC sécurité » est reconnu comme QG');
reset role;

-- ---------------------------------------------------------------------
-- 3. Les droits
-- ---------------------------------------------------------------------
select tests.ok(not has_function_privilege('anon', 'public.defaillance_unique(uuid,integer,integer,integer,integer,integer)'::regprocedure, 'execute')
  and has_function_privilege('authenticated', 'public.defaillance_unique(uuid,integer,integer,integer,integer,integer)'::regprocedure, 'execute'), 'droits : fermée aux anonymes, ouverte aux connectés');
select tests.anonyme(); set role anon;
select tests.ok(tests.erreur($$select * from defaillance_unique('00000000-0000-0000-0000-00000000e0aa')$$) like '42501 permission denied for function%', 'anonyme : refusé par les droits de la fonction');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok(tests.erreur($$select * from defaillance_unique('00000000-0000-0000-0000-00000000e0aa')$$) like '42501 L''analyse du plan demande%', 'coordinateur d''une autre organisation : refusé par la garde');
select tests.ok(tests.refuse($$select * from defaillance_unique('00000000-0000-0000-0000-0000000000ff')$$, 'P0002'), 'événement inconnu : P0002');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a002');
select a_permission(:EA, 'plan_implantation', 'lire') as lit174 \gset
set role authenticated;
select tests.ok((tests.erreur($$select * from defaillance_unique('00000000-0000-0000-0000-00000000e0aa')$$) is null) = :'lit174'::boolean,
  'bénévole : la fonction suit son droit de lire le plan (' || case when :'lit174'::boolean then 'il l''a' else 'il ne l''a pas' end || ')');
reset role;
select tests.ok(not exists (select 1 from audit_fonctions_exposees()), 'le contrôle des fonctions exposées reste vide');

rollback;
select tests.ok(not exists (select 1 from elements_plan where code like 'T174-%'), 'transaction annulée : rien ne reste du plan d''essai');
\echo '=== 174 OK'
