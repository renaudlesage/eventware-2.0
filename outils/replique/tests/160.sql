-- 160 — grille DMP : niveaux aux bornes, calcul par sources, copie au dépôt, droits d'édition.
-- Suppose 157.sql joué avant (BFMF 2027 sans bloquant).
set client_min_messages = notice;
\echo '=== 160 : grille DMP'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set OA '''00000000-0000-0000-0000-0000000000aa'''

-- Rejouable.
delete from grilles_dmp where code = 'T160';
delete from dmp_reponses where evenement_id = :EA;

-- Les niveaux aux bornes, sur la grille initiale.
select tests.ok((select string_agg(n.niveau::text || case when n.avis_coamu then '*' else '' end, ' ' order by s.score)
                   from (values (10), (11), (20), (21), (30), (31), (35), (36)) as s(score),
                        lateral niveau_dmp_pour((select id from grilles_dmp where code = 'PLANU_2009'), s.score) n)
                = '1 2 2 3 3 4* 4* 5*', 'bornes : 10→1, 11→2, 20→2, 21→3, 30→3, 31→4*, 35→4*, 36→5* (* avis CoAMU)');
select tests.ok((select count(*) from grille_dmp_criteres k join grilles_dmp g on g.id = k.grille_id where g.code = 'PLANU_2009' and k.famille <> 'Correctifs' and k.points = 0) = 6,
                'grille initiale : six familles à 0 point (rien d''inventé)');
select tests.ok((select points from grille_dmp_criteres k join grilles_dmp g on g.id = k.grille_id where g.code = 'PLANU_2009' and k.code = 'AMBU_10MIN') = -3, 'correctif ambulance : −3');

-- Coordinateur A : lit la grille partagée mais ne l'édite pas ; crée une grille d'organisation.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select count(*) from grilles_dmp where code = 'PLANU_2009') = 1, 'coord A : lit la grille partagée');
update grille_dmp_criteres set points = 99 where code = 'TYPE' and grille_id = (select id from grilles_dmp where code = 'PLANU_2009');
select tests.ok((select points from grille_dmp_criteres where code = 'TYPE' and grille_id = (select id from grilles_dmp where code = 'PLANU_2009')) = 0, 'coord A : n''édite pas la grille partagée (RLS)');
insert into grilles_dmp (code, libelle, province, organisation_id, version) values ('T160', 'Grille de test A', 'Liège', :OA, 'test');
insert into grille_dmp_seuils (grille_id, niveau, score_min, score_max, avis_coamu)
select id, s.n, s.mn, s.mx, s.c from grilles_dmp, (values (1, -100, 10, false), (2, 11, 20, false), (3, 21, 30, false), (4, 31, 35, true), (5, 36, null, true)) as s(n, mn, mx, c) where code = 'T160';
insert into grille_dmp_criteres (grille_id, code, libelle, famille, source, condition_cle, seuil_min, seuil_max, points, ordre)
select id, c.code, c.lib, c.fam, c.src, c.cle, c.mn, c.mx, c.pts, c.o from grilles_dmp, (values
  ('PUBLIC_1000', 'Plus de 1 000 personnes', 'Affluence', 'frequentation', null, 1000, null, 20, 10),
  ('PUBLIC_500',  '500 à 999 personnes',      'Affluence', 'frequentation', null, 500, 999, 10, 11),
  ('CHAPITEAU',   'Chapiteau',                'Aménagement du site', 'conformite', 'structure.chapiteau', null, null, 8, 20),
  ('FEU',         'Feu d''artifice',          'Facteurs aggravants', 'conformite', 'activite.pyrotechnie', null, null, 15, 30),
  ('NUIT',        'Manifestation nocturne',   'Facteurs aggravants', 'manuel', null, null, null, 5, 40),
  ('AMBU',        'Ambulance à moins de 10 min', 'Correctifs', 'manuel', null, null, null, -3, 90)
) as c(code, lib, fam, src, cle, mn, mx, pts, o) where grilles_dmp.code = 'T160';
-- BFMF 2027 : 1 200 personnes (+20), chapiteau coché (+8), pyrotechnie non cochée, rien de manuel → 28, niveau 3.
select tests.ok((calcul_dmp(:EA) ->> 'score')::int = 28 and (calcul_dmp(:EA) ->> 'niveau')::int = 3, 'calcul : 20 (affluence) + 8 (chapiteau) = 28 → niveau 3');
select tests.ok((calcul_dmp(:EA) -> 'grille' ->> 'code') = 'T160', 'la grille de l''organisation prime sur la partagée');
select tests.ok((select count(*) from jsonb_array_elements(calcul_dmp(:EA) -> 'details') d where (d ->> 'applique')::boolean) = 2, 'détail : deux critères appliqués');
-- Nocturne coché (+5) → 33, niveau 4, avis CoAMU ; ambulance proche (−3) → 30, niveau 3.
insert into dmp_reponses (evenement_id, critere_id) select :EA, id from grille_dmp_criteres where code = 'NUIT' and grille_id = (select id from grilles_dmp where code = 'T160');
select tests.ok((calcul_dmp(:EA) ->> 'score')::int = 33 and (calcul_dmp(:EA) ->> 'niveau')::int = 4 and (calcul_dmp(:EA) ->> 'avis_coamu')::boolean, 'nocturne : 33 → niveau 4, avis CoAMU');
insert into dmp_reponses (evenement_id, critere_id) select :EA, id from grille_dmp_criteres where code = 'AMBU' and grille_id = (select id from grilles_dmp where code = 'T160');
select tests.ok((calcul_dmp(:EA) ->> 'score')::int = 30 and (calcul_dmp(:EA) ->> 'niveau')::int = 3, 'ambulance proche : 30 → niveau 3');
-- Le dépôt copie le DMP dans le dossier et dans la version.
select tests.ok((deposer_dossier(:EA) ->> 'niveau_dmp')::int = 3, 'dépôt : niveau DMP rendu');
select tests.ok((select niveau_dmp from dossiers_securite where evenement_id = :EA) = 3 and (select score_dmp from dossiers_securite where evenement_id = :EA) = 30, 'dossier : niveau 3, score 30');
select tests.ok((select (contenu -> 'dmp' ->> 'score')::int from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA order by v.version desc limit 1) = 30, 'version : DMP figé');
reset role;

-- Bénévole A : lit, ne coche pas.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((calcul_dmp(:EA) ->> 'score')::int = 30, 'bénévole A : lit le calcul');
select tests.ok(tests.refuse($$insert into dmp_reponses (evenement_id, critere_id) select '00000000-0000-0000-0000-00000000e0aa', id from grille_dmp_criteres where code = 'CHAPITEAU'$$, '42501'), 'bénévole A : ne coche pas');
reset role;
-- Exploitant : édite la grille partagée.
select tests.connecter('00000000-0000-0000-0000-00000000e001'); set role authenticated;
update grille_dmp_criteres set points = 4 where code = 'TYPE' and grille_id = (select id from grilles_dmp where code = 'PLANU_2009');
select tests.ok((select points from grille_dmp_criteres where code = 'TYPE' and grille_id = (select id from grilles_dmp where code = 'PLANU_2009')) = 4, 'exploitant : édite la grille partagée');
update grille_dmp_criteres set points = 0 where code = 'TYPE' and grille_id = (select id from grilles_dmp where code = 'PLANU_2009');
reset role;
-- Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select * from grilles_dmp$$, '42501'), 'anonyme : grilles fermées');
reset role;
\echo '=== 160 OK'
