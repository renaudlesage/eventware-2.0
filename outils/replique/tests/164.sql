-- 164 — grille PRIMA : référentiel, pré-rempli, calcul conforme au classeur, zones, avis d'office, niveaux DMP, dépôt, droits.
-- Suppose 157.sql joué avant (BFMF 2027 : 1 200 personnes, 2 jours, chapiteau coché).
set client_min_messages = notice;
\echo '=== 164 : grille PRIMA'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

-- Rejouable.
delete from prima_saisies where evenement_id = :EA;

-- Le référentiel : 36 types, les familles, un défaut par famille (sauf le type), cinq seuils.
select tests.ok((select count(*) from prima_referentiel where famille = 'type_evenement') = 36, '36 types d''événement');
select tests.ok((select count(distinct famille) from prima_referentiel) = 15, 'quinze familles');
select tests.ok(not exists (select famille from prima_referentiel where famille <> 'type_evenement' group by famille having count(*) filter (where defaut) <> 1), 'un défaut par famille');
select tests.ok((select coefficient from prima_referentiel where famille = 'type_evenement' and code = 3) = 10 and (select scoring from prima_referentiel where famille = 'type_evenement' and code = 3) = 100, 'rock/pop : 10, scoring 100');
select tests.ok((select string_agg(seuil::text, ' ' order by niveau) from prima_seuils) = '450 750 850 875 1000', 'seuils 450 750 850 875 1000');

-- Coordinateur A : sans type, la grille est incomplète ; le contrôle le dit.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((prima_prerempli(:EA) ->> 'spectateurs')::int = 1200, 'pré-rempli : spectateurs = fréquentation');
select tests.ok((prima_prerempli(:EA) ->> 'multijour')::boolean, 'pré-rempli : multi-jour (deux dates)');
select tests.ok((prima_prerempli(:EA) ->> 'infrastructure')::int = 2, 'pré-rempli : chapiteau coché → infrastructure 2');
select tests.ok((calcul_prima(:EA) ->> 'zone') = 'incomplet' and (calcul_prima(:EA) ->> 'score') is null and (calcul_prima(:EA) ->> 'niveau') is null, 'sans type : incomplet, ni score ni niveau');
select tests.ok(exists (select 1 from controle_dossier(:EA) where code = 'DOS_PRIMA_TYPE' and gravite = 'alerte'), 'contrôle : DOS_PRIMA_TYPE');
select tests.ok((calcul_prima(:EA) -> 'entrees' -> 'spectateurs' ->> 'source') = 'eventware' and (calcul_prima(:EA) -> 'entrees' -> 'densite' ->> 'source') = 'defaut', 'provenances : eventware, défaut');

-- Fête de quartier (6), 1 200 spectateurs, mélange (1), mixte (1), groupes exclus (1), densité moyenne (1), 6 h, journée (1),
-- lieux 0,75 × 1 × 1,5 × 1,5 = 1,6875, certitude raisonnable 1,5, pas de VIP (1), violence exclue (1), alcool possible (1), météo possible (1,25)
-- → 1 200 × 6 × 1 × 1 × 1,6875 × 1,5 × 1 × 1 × 1,25 / 10 000 = 2,28 → FAIBLE.
insert into prima_saisies (evenement_id, type_evenement, duree_h, journee, soiree, nuit, multijour) values (:EA, 12, 6, true, false, false, false);
select tests.ok(abs((calcul_prima(:EA) ->> 'score')::numeric - 2.28) < 0.01, 'fête de quartier, 1 200 personnes : score 2,28');
select tests.ok((calcul_prima(:EA) ->> 'zone') = 'faible' and not (calcul_prima(:EA) ->> 'avis_coamu')::boolean, 'zone FAIBLE, pas d''avis');
-- Scoring : 60 + 50 + 100 + 100 + 50 + 50 + 20 + 43 + 75 + 50 + 50 + 75 + 0 = 723 → niveau 1 (< 750).
select tests.ok((calcul_prima(:EA) -> 'scoring' ->> 'total')::numeric = 723 and (calcul_prima(:EA) ->> 'niveau')::int = 1, 'scoring 723 → niveau 1, point d''alerte');
select tests.ok(not exists (select 1 from controle_dossier(:EA) where code like 'DOS_PRIMA%'), 'contrôle : plus rien à signaler');

-- Concert rock (3), debout dynamique (1,5), jeunes (1,5), nuit (2), alcool probable (2) : 1 200 × 1,5 × 1,5 × 1 × 1 = 2 700 ; × 10 × 1 × 2 × 1,6875 × 1,5 × 1 × 1 × 2 × 1,25 / 10 000 = 34,17 → ÉLEVÉ.
update prima_saisies set type_evenement = 3, type_public = 3, age_spectateurs = 2, nuit = true, journee = false, alcool = 3 where evenement_id = :EA;
select tests.ok(abs((calcul_prima(:EA) ->> 'score')::numeric - 34.17) < 0.01, 'concert rock de nuit : score 34,17');
select tests.ok((calcul_prima(:EA) ->> 'zone') = 'eleve' and (calcul_prima(:EA) ->> 'avis_coamu')::boolean, 'zone ÉLEVÉ, avis CoAMU');
-- Scoring : 100 + 50 + 100 + 100 + 100 + 75 + 20 + 43 + 100 + 75 + 50 + 75 + 0 = 888 → niveau 4, poste de soins médicalisé.
select tests.ok((calcul_prima(:EA) -> 'scoring' ->> 'total')::numeric = 888 and (calcul_prima(:EA) ->> 'niveau')::int = 4, 'scoring 888 → niveau 4');
select tests.ok((calcul_prima(:EA) ->> 'dispositif') like 'Poste de soins médicalisé%', 'dispositif : PS Med');
select tests.ok(exists (select 1 from controle_dossier(:EA) where code = 'DOS_PRIMA_AVIS' and gravite = 'alerte' and detail like '%90 et 60 jours%'), 'contrôle : DOS_PRIMA_AVIS avec les délais');
-- Zone MOYEN : 6 h de jour, rock, debout dynamique, jeunes, alcool possible → 2 700 × 10 × 1 × 1 × 1,6875 × 1,5 × 1,25 / 10 000 = 8,54… trop bas ; avec 1 800 spectateurs : 12,81 → MOYEN.
update prima_saisies set nuit = false, journee = true, alcool = 2, spectateurs = 1800 where evenement_id = :EA;
select tests.ok(abs((calcul_prima(:EA) ->> 'score')::numeric - 12.81) < 0.01 and (calcul_prima(:EA) ->> 'zone') = 'moyen' and (calcul_prima(:EA) ->> 'informer_coamu')::boolean, 'zone MOYEN : informer la CoAMU');
select tests.ok(exists (select 1 from controle_dossier(:EA) where code = 'DOS_PRIMA_INFO' and gravite = 'veille'), 'contrôle : DOS_PRIMA_INFO en veille');
-- Avis d'office : 600 actifs, quel que soit le score.
update prima_saisies set actifs = 600 where evenement_id = :EA;
select tests.ok((calcul_prima(:EA) ->> 'zone') = 'avis_office' and (calcul_prima(:EA) -> 'motifs_avis_office') ? 'plus de 500 participants actifs', 'avis d''office : plus de 500 actifs');
update prima_saisies set actifs = null, impact_riverains = true where evenement_id = :EA;
select tests.ok((calcul_prima(:EA) -> 'motifs_avis_office') ? 'impact important sur les riverains', 'avis d''office : riverains');
-- Le plafond des 100 000 spectateurs : la moitié des suivants compte.
update prima_saisies set impact_riverains = false, spectateurs = 120000 where evenement_id = :EA;
select tests.ok((calcul_prima(:EA) -> 'facteurs' ->> 'spectateurs')::numeric = 110000 * 1.5 * 1.5, 'au-delà de 100 000, la moitié des spectateurs supplémentaires');
-- IAS 2003 : 800 personnes assises, 2 h, journée, marche populaire, groupes exclus, densité moyenne → extrêmement faible.
update prima_saisies set spectateurs = 800, type_evenement = 20, type_public = 1, age_spectateurs = 3, duree_h = 2, alcool = 1 where evenement_id = :EA;
select tests.ok((calcul_prima(:EA) ->> 'zone') = 'extremement_faible' and (calcul_prima(:EA) ->> 'ias2003')::boolean, 'IAS 2003 : extrêmement faible');
-- VIP : 50 personnalités doublent le risque (1 + log10(1 + 10)) ; scoring 100.
update prima_saisies set vip = 50 where evenement_id = :EA;
select tests.ok(abs((calcul_prima(:EA) -> 'facteurs' ->> 'vip')::numeric - 2.041) < 0.001, 'VIP : 50 personnalités → ×2,04');
select tests.ok((select (x ->> 'points')::numeric from jsonb_array_elements(calcul_prima(:EA) -> 'scoring' -> 'details') x where x ->> 'critere' = 'Personnalités') = 88, 'VIP : scoring 88');
-- Le dépôt copie niveau et score PRIMA dans le dossier et fige la grille.
update prima_saisies set vip = null, type_evenement = 3, type_public = 3, age_spectateurs = 2, nuit = true, journee = false, alcool = 3, spectateurs = 1200, duree_h = 6 where evenement_id = :EA;
select deposer_dossier(:EA);
select tests.ok((select niveau_dmp from dossiers_securite where evenement_id = :EA) = 4 and abs((select score_dmp from dossiers_securite where evenement_id = :EA) - 34.17) < 0.01, 'dépôt : niveau 4, score 34,17 dans le dossier');
select tests.ok((select (contenu -> 'prima' ->> 'zone') from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA order by v.version desc limit 1) = 'eleve', 'version : la grille PRIMA est figée');
select tests.ok((select updated_by from prima_saisies where evenement_id = :EA) = '00000000-0000-0000-0000-00000000a001', 'traçabilité : updated_by');
-- Le référentiel n'est pas éditable par le coordinateur.
update prima_referentiel set coefficient = 99 where famille = 'type_evenement' and code = 3;
select tests.ok((select coefficient from prima_referentiel where famille = 'type_evenement' and code = 3) = 10, 'coord A : n''édite pas le référentiel (RLS)');
reset role;

-- Bénévole A : lit, ne saisit pas.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((calcul_prima(:EA) ->> 'zone') = 'eleve', 'bénévole A : lit le calcul');
select tests.ok(tests.refuse($$update prima_saisies set vip = 3 where evenement_id = '00000000-0000-0000-0000-00000000e0aa'$$, '42501') or (select vip from prima_saisies where evenement_id = '00000000-0000-0000-0000-00000000e0aa') is null, 'bénévole A : ne saisit pas');
reset role;

-- Organisation B : rien de A.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok(tests.refuse($$select calcul_prima('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'org B : ne lit pas la grille de A');
select tests.ok((select count(*) from prima_saisies where evenement_id = :EA) = 0, 'org B : ne voit pas les saisies de A');
reset role;

-- Exploitant : édite le référentiel.
select tests.connecter('00000000-0000-0000-0000-00000000e001'); set role authenticated;
update prima_referentiel set note = 'test' where famille = 'type_evenement' and code = 3;
select tests.ok((select note from prima_referentiel where famille = 'type_evenement' and code = 3) = 'test', 'exploitant : édite le référentiel');
update prima_referentiel set note = 'à mi-chemin entre Grange 1999 et Milsten 2003' where famille = 'type_evenement' and code = 3;
reset role;

-- Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select count(*) from prima_referentiel$$, '42501'), 'anonyme : pas de référentiel');
reset role;

delete from prima_saisies where evenement_id = :EA;
\echo '=== 164 OK'
