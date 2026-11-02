-- 163 — formulaires de demande : catalogue (IBZ 2017, Ferrières 2023), applicables, pré-remplissage,
-- saisie qui prime, contrôles DOS_FORMULAIRE et DOS_DELAI, droits.
-- Suppose 157.sql joué avant (BFMF 2027 à Ferrières, avec profil, conformité, plan).
set client_min_messages = notice;
\echo '=== 163 : formulaires de demande'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set EB '''00000000-0000-0000-0000-00000000e0bb'''

-- Rejouable.
delete from formulaire_reponses where evenement_id in (:EA, :EB);

-- Le catalogue : deux formulaires, douze sections chacun, des codes uniques par formulaire.
select tests.ok((select count(*) from formulaires where code in ('IBZ_2017', 'FERRIERES_2023')) = 2, 'deux formulaires semés');
select tests.ok((select count(*) from formulaire_sections s join formulaires f on f.id = s.formulaire_id where f.code = 'IBZ_2017') = 12
            and (select count(*) from formulaire_sections s join formulaires f on f.id = s.formulaire_id where f.code = 'FERRIERES_2023') = 12, 'douze sections par formulaire');
select tests.ok((select count(*) from formulaire_questions q join formulaires f on f.id = q.formulaire_id where f.code = 'IBZ_2017' and q.actif) between 150 and 260, 'IBZ 2017 semé');
select tests.ok((select count(*) from formulaire_questions q join formulaires f on f.id = q.formulaire_id where f.code = 'FERRIERES_2023' and q.actif) between 60 and 120, 'Ferrières 2023 semé');
select tests.ok(not exists (select 1 from formulaire_questions q where not exists (select 1 from formulaire_sections s where s.formulaire_id = q.formulaire_id and s.section = q.section)), 'chaque question a sa section');
select tests.ok(not exists (select 1 from formulaire_questions where type not in ('texte', 'nombre', 'oui_non', 'oui_non_explication', 'choix', 'multi', 'date', 'contact', 'annexe')), 'types connus');
select tests.ok(not exists (select 1 from formulaire_questions where type in ('choix', 'multi') and coalesce(array_length(options, 1), 0) = 0), 'les choix ont des options');
select tests.ok((select delai_jours from formulaires where code = 'FERRIERES_2023') = 60, 'Ferrières : 60 jours');

-- Coordinateur A : BFMF 2027 est à Ferrières → le formulaire communal d'abord, puis le fédéral.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select string_agg(code, ' ' order by ordinalite) from (select code, row_number() over () ordinalite from formulaires_applicables(:EA)) x) = 'FERRIERES_2023 IBZ_2017',
                'applicables : Ferrières puis IBZ');
select tests.ok((formulaire_dossier(:EA) -> 'formulaire' ->> 'code') = 'FERRIERES_2023', 'sans code : le formulaire de la commune');
select tests.ok((formulaire_dossier(:EA, 'IBZ_2017') -> 'formulaire' ->> 'code') = 'IBZ_2017', 'avec code : le fédéral');
-- Pré-rempli depuis Eventware.
select tests.ok((formulaire_prerempli(:EA) ->> 'nom') = 'BFMF 2027', 'pré-rempli : nom de l''événement');
select tests.ok((formulaire_prerempli(:EA) ->> 'organisateur') = 'Organisation A', 'pré-rempli : organisateur');
select tests.ok((formulaire_prerempli(:EA) ->> 'frequentation_max')::int = 1200, 'pré-rempli : fréquentation');
select tests.ok((formulaire_prerempli(:EA) ->> 'frequentation_tranche') = '1 000 – 1 499', 'pré-rempli : tranche de fréquentation (Ferrières)');
select tests.ok((formulaire_prerempli(:EA) ->> 'dates') like 'du %/08/2027 au %/08/2027', 'pré-rempli : dates en toutes lettres');
select tests.ok((formulaire_prerempli(:EA) -> 'radio' ->> 'reponse')::boolean, 'pré-rempli : plan radio → oui');
select tests.ok((formulaire_prerempli(:EA) -> 'responsable_legal' ->> 'nom') is not null, 'pré-rempli : responsable légal (profil 155)');
select tests.ok((select q ->> 'valeur' from jsonb_array_elements(formulaire_dossier(:EA, 'IBZ_2017') -> 'questions') q where q ->> 'code' = '1.01') = 'BFMF 2027',
                'IBZ : 1.01 vaut le pré-rempli');
select tests.ok((select q ->> 'valeur' from jsonb_array_elements(formulaire_dossier(:EA) -> 'questions') q where q ->> 'code' = '6.01') = '1 000 – 1 499',
                'Ferrières : 6.01 vaut la tranche');
select tests.ok((formulaire_dossier(:EA) ->> 'repondues')::int >= 10 and (formulaire_dossier(:EA) ->> 'total')::int > 60, 'Ferrières : compteur répondues/total');
select tests.ok(formulaire_dossier(:EA, 'IBZ_2017') -> 'obligatoires_manquantes' ? '1.04', 'IBZ : 1.04 (domaine public) manque');
select tests.ok((select count(*) from controle_dossier(:EA) where code = 'DOS_FORMULAIRE' and gravite = 'alerte') = 2, 'contrôle : DOS_FORMULAIRE pour chaque formulaire');
select tests.ok(not exists (select 1 from controle_dossier(:EA) where code = 'DOS_DELAI'), 'contrôle : pas de DOS_DELAI à neuf mois');

-- Une saisie prime sur le pré-rempli ; une réponse à une obligatoire la retire des manques.
insert into formulaire_reponses (evenement_id, formulaire_id, code, valeur) select :EA, id, '1.01', to_jsonb('Grand BFMF 2027'::text) from formulaires where code = 'IBZ_2017';
insert into formulaire_reponses (evenement_id, formulaire_id, code, valeur) select :EA, id, '1.04', to_jsonb('Domaine public'::text) from formulaires where code = 'IBZ_2017';
select tests.ok((select q ->> 'valeur' from jsonb_array_elements(formulaire_dossier(:EA, 'IBZ_2017') -> 'questions') q where q ->> 'code' = '1.01') = 'Grand BFMF 2027',
                'saisie : 1.01 prime sur le pré-rempli');
select tests.ok((select q ->> 'prerempli' from jsonb_array_elements(formulaire_dossier(:EA, 'IBZ_2017') -> 'questions') q where q ->> 'code' = '1.01') = 'BFMF 2027',
                'saisie : le pré-rempli reste visible');
select tests.ok(not (formulaire_dossier(:EA, 'IBZ_2017') -> 'obligatoires_manquantes' ? '1.04'), 'saisie : 1.04 ne manque plus');
-- La même réponse « 1.04 » sur Ferrières (nom de l'organisateur) est une autre question : rien ne se mélange.
select tests.ok((select q ->> 'valeur' from jsonb_array_elements(formulaire_dossier(:EA) -> 'questions') q where q ->> 'code' = '1.04') = 'Organisation A',
                'les codes sont propres à chaque formulaire');
select tests.ok((select updated_by from formulaire_reponses where evenement_id = :EA and code = '1.01') = '00000000-0000-0000-0000-00000000a001', 'traçabilité : updated_by');
-- Effacer la saisie rend le pré-rempli.
delete from formulaire_reponses where evenement_id = :EA and code = '1.01';
select tests.ok((select q ->> 'valeur' from jsonb_array_elements(formulaire_dossier(:EA, 'IBZ_2017') -> 'questions') q where q ->> 'code' = '1.01') = 'BFMF 2027',
                'effacement : retour au pré-rempli');
-- Le catalogue n'est pas éditable par le coordinateur.
update formulaire_questions set libelle = 'X' where code = '1.01';
select tests.ok(not exists (select 1 from formulaire_questions where libelle = 'X'), 'coord A : n''édite pas le catalogue (RLS)');
update formulaires set delai_jours = 1 where code = 'FERRIERES_2023';
select tests.ok((select delai_jours from formulaires where code = 'FERRIERES_2023') = 60, 'coord A : n''édite pas les formulaires (RLS)');
-- Le dépôt fige les formulaires.
select deposer_dossier(:EA);
select tests.ok((select (contenu -> 'formulaire' ->> 'total')::int from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA order by v.version desc limit 1) > 60
            and (select jsonb_array_length(contenu -> 'formulaires') from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA order by v.version desc limit 1) = 2,
                'version : les deux formulaires sont figés au dépôt');
reset role;

-- Bénévole A : lit, ne saisit pas.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((formulaire_dossier(:EA) ->> 'total')::int > 60, 'bénévole A : lit le formulaire');
select tests.ok(tests.refuse($$insert into formulaire_reponses (evenement_id, formulaire_id, code, valeur) select '00000000-0000-0000-0000-00000000e0aa', id, '1.02', '"x"' from formulaires where code = 'IBZ_2017'$$, '42501'), 'bénévole A : ne saisit pas');
reset role;

-- Organisation B : ne voit pas les réponses de A ; Fête B sans commune connue → seul le fédéral s'applique ;
-- un montage dans 50 jours, dossier non déposé → DOS_DELAI (90 jours IBZ).
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from formulaire_reponses where evenement_id = :EA) = 0, 'org B : ne voit pas les réponses de A');
select tests.ok((formulaire_dossier(:EA) ->> 'formulaire') is null and (formulaire_dossier(:EA) ->> 'total')::int = 0, 'org B : rien du formulaire de A');
select tests.ok(tests.refuse($$select formulaire_prerempli('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'org B : ne lit pas le pré-rempli de A');
reset role;
create temp table t163 as select id, commune, date_montage, date_debut, date_fin, date_demontage from evenements where id = :EB;
update evenements set commune = 'Nulle-Part', date_montage = current_date + 50, date_debut = current_date + 52, date_fin = current_date + 52, date_demontage = current_date + 53 where id = :EB;
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select string_agg(code, ' ') from formulaires_applicables(:EB)) = 'IBZ_2017', 'Fête B : seul le fédéral s''applique');
select tests.ok(exists (select 1 from controle_dossier(:EB) where code = 'DOS_DELAI' and titre like '%dépassé%'), 'Fête B : DOS_DELAI, délai de 90 jours dépassé à 50 jours du montage');
reset role;
update evenements e set commune = t.commune, date_montage = t.date_montage, date_debut = t.date_debut, date_fin = t.date_fin, date_demontage = t.date_demontage from t163 t where e.id = t.id;
drop table t163;

-- Exploitant : édite le catalogue et les formulaires.
select tests.connecter('00000000-0000-0000-0000-00000000e001'); set role authenticated;
update formulaire_questions set aide = 'Aide de test' where code = '1.01' and formulaire_id = (select id from formulaires where code = 'IBZ_2017');
select tests.ok((select aide from formulaire_questions where code = '1.01' and formulaire_id = (select id from formulaires where code = 'IBZ_2017')) = 'Aide de test', 'exploitant : édite le catalogue');
update formulaire_questions set aide = null where code = '1.01' and formulaire_id = (select id from formulaires where code = 'IBZ_2017');
reset role;

-- Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select count(*) from formulaire_questions$$, '42501'), 'anonyme : pas de catalogue');
select tests.ok(tests.refuse($$select count(*) from formulaires$$, '42501'), 'anonyme : pas de formulaires');
reset role;

delete from formulaire_reponses where evenement_id in (:EA, :EB);
\echo '=== 163 OK'
