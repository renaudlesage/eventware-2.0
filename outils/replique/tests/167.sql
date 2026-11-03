-- 167 — Eventware qui apprend : familles de demandes, REX automatique, mémoire des lieux.
-- Suppose 162.sql joué avant (lieux T162-E2 « Étape 2 », T162-E3 « Étape 3 », T156-PC « PC Ops » ; a001 coordinateur, a002 bénévole).
set client_min_messages = notice;
\echo '=== 167 : Eventware qui apprend'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set EN '''00000000-0000-0000-0000-0000000167e0'''

-- Rejouable.
delete from evenements where id = :EN;
delete from missions where evenement_id = :EA and reference like 'T167-%';
delete from signalements where evenement_id = :EA and reference like 'T167-%';
delete from creneaux where evenement_id = :EA and code like 'T167-%';
delete from journal where evenement_id = :EA and (module = 'meteo' or categorie in ('rex_auto', 'memoire', 'rattachement'));
delete from rex_entrees where evenement_id = :EA and source = 'eventware';
update missions set lieu_id = null where evenement_id = :EA and reference = 'T162-001';
update lieux set lieu_precedent_id = null where evenement_id = :EA;

-- 1. Les familles -----------------------------------------------------------
select tests.ok(famille_demande(:EA, 'Il faut réapprovisionner le bar en fûts de bière') = 'boissons', 'famille : fûts de bière → boissons');
select tests.ok(famille_demande(:EA, 'Plus de papier toilette aux WC du camping') = 'sanitaires', 'famille : papier toilette → sanitaires (via le vocabulaire)');
select tests.ok(famille_demande(:EA, 'Aller récupérer un artiste à la gare') = 'transport_personnes', 'famille : récupérer à la gare → transport de personnes');
select tests.ok(famille_demande(:EA, 'Un blessé au départ') = 'soins', 'famille : blessé → soins, avant tout le reste');
select tests.ok(famille_demande(:EA, 'Bonjour tout le monde') is null, 'famille : rien de reconnu → null');
select tests.ok(famille_demande(:EA, '') is null, 'famille : texte vide → null');

-- 2. Un événement qui a vécu ---------------------------------------------------
-- 6 réassorts de bière à l'Étape 2, toutes les 30 min, résolus d'un coup (sans trace) ;
-- 6 P1 prises en charge après 25 min (seuil par défaut 10) ; 6 P3 après 5 min (seuil 60) ;
-- un pic de 6 demandes entre 20 h et 21 h. (La traçabilité force created_at à now() : on la suspend pour dater le jeu d'essai.)
alter table missions disable trigger tracabilite_missions;
insert into missions (evenement_id, reference, titre, priorite, statut, module, lieu_id, created_at, resolue_le)
select :EA, 'T167-B' || g, 'Fûts de bière à réassortir', 'P2', 'resolue', 'logistique',
       (select id from lieux where evenement_id = :EA and code = 'T162-E2'),
       timestamptz '2026-06-06 14:00+02' + (g - 1) * interval '30 min', timestamptz '2026-06-06 14:20+02' + (g - 1) * interval '30 min'
  from generate_series(1, 6) g;
insert into missions (evenement_id, reference, titre, priorite, statut, module, created_at, attribuee_le, resolue_le)
select :EA, 'T167-U' || g, 'Urgence ' || g, 'P1', 'resolue', 'securite',
       timestamptz '2026-06-06 20:00+02' + (g - 1) * interval '8 min',
       timestamptz '2026-06-06 20:25+02' + (g - 1) * interval '8 min',
       timestamptz '2026-06-06 20:40+02' + (g - 1) * interval '8 min'
  from generate_series(1, 6) g;
insert into missions (evenement_id, reference, titre, priorite, statut, module, created_at, attribuee_le, resolue_le)
select :EA, 'T167-C' || g, 'Courante ' || g, 'P3', 'resolue', 'logistique',
       timestamptz '2026-06-06 11:00+02' + (case when g <= 3 then g - 1 else g + 2 end) * interval '1 hour',
       timestamptz '2026-06-06 11:05+02' + (case when g <= 3 then g - 1 else g + 2 end) * interval '1 hour',
       timestamptz '2026-06-06 11:30+02' + (case when g <= 3 then g - 1 else g + 2 end) * interval '1 hour'
  from generate_series(1, 6) g;
-- Une demande sans lieu qui nomme le PC Ops dans son texte.
insert into missions (evenement_id, reference, titre, priorite, statut, module, created_at)
values (:EA, 'T167-P1', 'Poubelles pleines au PC Ops', 'P3', 'a_traiter', 'logistique', timestamptz '2026-06-06 12:30+02');
alter table missions enable trigger tracabilite_missions;
-- Deux seuils météo franchis, quatre SOS pris en charge après 12 min, trois postes sans fiche.
insert into journal (evenement_id, module, categorie, texte, importance) values
  (:EA, 'meteo', 'veille', 'Seuil orange franchi — Froid : 2 °C', 'notable'),
  (:EA, 'meteo', 'veille', 'Seuil orange franchi — Froid : 1 °C', 'notable');
insert into signalements (evenement_id, reference, cle_client, type, statut, lieu_id, recu_le, pris_en_charge_le, clos_le)
select :EA, 'T167-S' || g, gen_random_uuid(), 'danger', 'clos', (select id from lieux where evenement_id = :EA and code = 'T156-PC'),
       timestamptz '2026-06-06 15:00+02' + g * interval '1 hour', timestamptz '2026-06-06 15:12+02' + g * interval '1 hour', timestamptz '2026-06-06 15:30+02' + g * interval '1 hour'
  from generate_series(1, 4) g;
insert into creneaux (evenement_id, code, poste, debut, fin)
select :EA, 'T167-K' || g, 'Poste ' || g, timestamptz '2026-06-06 10:00+02', timestamptz '2026-06-06 18:00+02' from generate_series(1, 3) g;

select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select n from familles_evenement(:EA) where famille = 'boissons') = 6, 'familles_evenement : 6 réassorts boissons');
select tests.ok((select intervalle_median_min from familles_evenement(:EA) where famille = 'boissons') = 30, 'familles_evenement : une toutes les 30 min');
select tests.ok((select lieux from familles_evenement(:EA) where famille = 'boissons') = 'Étape 2 ×6', 'familles_evenement : surtout à l''Étape 2');

-- 3. Le REX qui s'écrit tout seul ------------------------------------------
create temp table t167 as select rex_proposer(:EA) as n;
select tests.ok((select n from t167) >= 8, 'rex_proposer : au moins 8 constats proposés');
select tests.ok((select count(*) from rex_entrees where evenement_id = :EA and source = 'eventware' and statut = 'a_arbitrer') = (select n from t167), 'tous proposés « à arbitrer », source eventware');
select tests.ok((select constat from rex_entrees where evenement_id = :EA and cle_auto = 'demandes_sans_trace') like '6 demandes sur 18 ont été closes sans passer%', 'constat : demandes closes sans trace');
select tests.ok((select impact from rex_entrees where evenement_id = :EA and cle_auto = 'delai_P1') = 'bloquant', 'constat : P1 au-delà du seuil, bloquant');
select tests.ok((select constat from rex_entrees where evenement_id = :EA and cle_auto = 'delai_P1') like 'P1 : 9 demandes sur 10 ont attendu jusqu''à 25 min%seuil 10 min, 6 demandes mesurées%', 'constat P1 : chiffres justes');
select tests.ok((select nature from rex_entrees where evenement_id = :EA and cle_auto = 'delai_P3') = 'reussite', 'constat : P3 bien sous le seuil → réussite');
select tests.ok((select constat from rex_entrees where evenement_id = :EA and cle_auto = 'pic_charge') like 'Pic de 6 demandes entre 20 h et 21 h (06/06)%', 'constat : pic de charge à 20 h, heure belge');
select tests.ok((select proposition from rex_entrees where evenement_id = :EA and cle_auto = 'famille_boissons') like 'Prévoir une ronde « réassort boissons » toutes les 30 min%', 'constat : ronde boissons toutes les 30 min');
select tests.ok((select lieu_id from rex_entrees where evenement_id = :EA and cle_auto = 'famille_boissons') = (select id from lieux where evenement_id = :EA and code = 'T162-E2'), 'constat boissons : lié à l''Étape 2');
select tests.ok((select constat from rex_entrees where evenement_id = :EA and cle_auto = 'meteo_froid_orange') = 'Seuil orange « Froid » franchi 2 fois pendant l''événement.', 'constat : seuil météo lu dans le journal');
select tests.ok((select impact from rex_entrees where evenement_id = :EA and cle_auto = 'sos_delai') = 'dangereux', 'constat : SOS pris en charge trop tard → dangereux');
select tests.ok((select constat from rex_entrees where evenement_id = :EA and cle_auto = 'postes_sans_fiche') = '3 postes sur 3 n''ont pas de fiche de poste : les bénévoles y arrivent sans consignes écrites.', 'constat : postes sans fiche');
select tests.ok(not exists (select 1 from rex_entrees where evenement_id = :EA and source = 'eventware' and (constat ilike '%Coord A%' or constat ilike '%Bénévole A%')), 'aucun constat ne nomme un bénévole');
select tests.ok(exists (select 1 from journal where evenement_id = :EA and module = 'analyse' and categorie = 'rex_auto'), 'journal : la proposition est consignée');
-- Rejouer sans rien changer ne fait rien.
select tests.ok(rex_proposer(:EA) = 0, 'rex_proposer : rejoué à l''identique → 0');
-- Le QG arbitre la ronde (retenu) et supprime le pic ; la situation change : le retenu ne bouge pas, le supprimé ne revient pas, le reste se met à jour.
update rex_entrees set statut = 'retenu', porteur = 'Logistique' where evenement_id = :EA and cle_auto = 'famille_boissons';
reset role;
update rex_entrees set deleted_at = now() where evenement_id = :EA and cle_auto = 'pic_charge';
alter table missions disable trigger tracabilite_missions;
insert into missions (evenement_id, reference, titre, priorite, statut, module, lieu_id, created_at, resolue_le)
values (:EA, 'T167-B7', 'Encore des fûts', 'P2', 'resolue', 'logistique', (select id from lieux where evenement_id = :EA and code = 'T162-E2'), timestamptz '2026-06-06 17:00+02', timestamptz '2026-06-06 17:10+02');
alter table missions enable trigger tracabilite_missions;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(rex_proposer(:EA) >= 1, 'rex_proposer : la situation a changé → des constats mis à jour');
select tests.ok((select constat from rex_entrees where evenement_id = :EA and cle_auto = 'demandes_sans_trace') like '7 demandes sur 19%', 'constat à arbitrer : mis à jour');
select tests.ok((select constat from rex_entrees where evenement_id = :EA and cle_auto = 'famille_boissons') like '6 demandes%', 'constat retenu : intouché');
select tests.ok((select statut from rex_entrees where evenement_id = :EA and cle_auto = 'famille_boissons') = 'retenu', 'constat retenu : reste retenu');
reset role;
select tests.ok((select count(*) from rex_entrees where evenement_id = :EA and cle_auto = 'pic_charge') = 1 and (select deleted_at from rex_entrees where evenement_id = :EA and cle_auto = 'pic_charge') is not null, 'constat supprimé par le QG : ne revient pas');
-- Le bénévole ne propose pas.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select rex_proposer('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'bénévole : rex_proposer refusé');
reset role;

-- 4. Les demandes rattachées à un lieu d'après leur texte ---------------------
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(rattacher_demandes_lieux(:EA) = 2, 'rattacher : 2 demandes (« Jetons étape 2 », « Poubelles pleines au PC Ops »)');
select tests.ok((select lieu_id from missions where evenement_id = :EA and reference = 'T162-001') = (select id from lieux where evenement_id = :EA and code = 'T162-E2'), 'rattacher : « Jetons étape 2 » → Étape 2');
select tests.ok((select lieu_id from missions where evenement_id = :EA and reference = 'T167-P1') = (select id from lieux where evenement_id = :EA and code = 'T156-PC'), 'rattacher : « au PC Ops » → PC Ops');
select tests.ok(rattacher_demandes_lieux(:EA) = 0, 'rattacher : rejoué → 0');
select tests.ok((select count(*) from missions where evenement_id = :EA and lieu_id is null and reference like 'T167-U%') = 6, 'rattacher : les urgences sans lieu nommé restent sans lieu');
reset role;

-- 5. La mémoire des lieux -------------------------------------------------------
-- L'édition suivante : mêmes codes pour l'Étape 2 et le PC Ops, l'Étape 3 renommée avec un autre code, un lieu nouveau.
-- (Sans session : le créateur ne s'ajoute pas tout seul comme membre.)
select tests.anonyme(); reset role;
insert into evenements (id, nom, slug, organisation_id, phase, date_debut, date_fin) values (:EN, 'BFMF 2028', 'bfmf-2028-t167', '00000000-0000-0000-0000-0000000000aa', 'preparation', '2028-06-03', '2028-06-04');
insert into membres_evenement (evenement_id, user_id, role_id, actif, nom_affiche)
select :EN, '00000000-0000-0000-0000-00000000a001', r.id, true, 'Coord A' from roles r where r.evenement_id = :EN and r.code = 'coordinateur';
insert into lieux (evenement_id, code, nom, type) values
  (:EN, 'T162-E2', 'Étape 2 (nouveau nom)', 'etape'),
  (:EN, 'N-E3', 'ÉTAPE 3', 'etape'),
  (:EN, 'T156-PC', 'PC Ops', 'pc_ops'),
  (:EN, 'N-CAMP', 'Camping', 'camping');
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(tests.refuse($$select rapprocher_lieux('00000000-0000-0000-0000-0000000167e0', '00000000-0000-0000-0000-0000000167e0')$$, '22023'), 'rapprocher : pas avec soi-même');
select tests.ok(tests.refuse($$select rapprocher_lieux('00000000-0000-0000-0000-0000000167e0', '00000000-0000-0000-0000-00000000e0bb')$$, '42501'), 'rapprocher : pas avec un événement d''une autre organisation dont on n''est pas membre');
select tests.ok(rapprocher_lieux(:EN, :EA) = 3, 'rapprocher : 3 lieux appariés (2 par code, 1 par nom)');
select tests.ok((select edition_precedente_id from evenements where id = :EN) = :EA, 'rapprocher : l''édition précédente est posée');
select tests.ok((select l.lieu_precedent_id from lieux l where l.evenement_id = :EN and l.code = 'N-E3') = (select id from lieux where evenement_id = :EA and code = 'T162-E3'), 'rapprocher : « ÉTAPE 3 » ↔ « Étape 3 » par le nom');
select tests.ok((select l.lieu_precedent_id from lieux l where l.evenement_id = :EN and l.code = 'N-CAMP') is null, 'rapprocher : le lieu nouveau reste sans précédent');
select tests.ok(rapprocher_lieux(:EN, :EA) = 0, 'rapprocher : rejoué → 0');
-- La mémoire : l'Étape 2 a vu 7 réassorts de bière + 1 demande de jetons, et un constat retenu ; le PC Ops 1 demande et 4 SOS.
select tests.ok((select demandes from memoire_lieux(:EN) where nom = 'Étape 2 (nouveau nom)') = 8, 'mémoire : Étape 2, 8 demandes à l''édition précédente');
select tests.ok((select familles -> 0 ->> 'code' from memoire_lieux(:EN) where nom = 'Étape 2 (nouveau nom)') = 'boissons', 'mémoire : Étape 2, la famille dominante est boissons');
select tests.ok((select (familles -> 0 ->> 'n')::int from memoire_lieux(:EN) where nom = 'Étape 2 (nouveau nom)') = 7, 'mémoire : Étape 2, 7 réassorts boissons');
select tests.ok((select rex from memoire_lieux(:EN) where nom = 'Étape 2 (nouveau nom)') = 1, 'mémoire : Étape 2, 1 constat retenu');
select tests.ok((select constats[1] from memoire_lieux(:EN) where nom = 'Étape 2 (nouveau nom)') like '6 demandes « Réassort boissons »%', 'mémoire : Étape 2, le constat retenu est raconté');
select tests.ok((select signalements from memoire_lieux(:EN) where nom = 'PC Ops') = 4, 'mémoire : PC Ops, 4 SOS');
select tests.ok((select editions from memoire_lieux(:EN) where nom = 'PC Ops') = 1, 'mémoire : une édition en arrière');
select tests.ok(not exists (select 1 from memoire_lieux(:EN) where nom = 'Camping'), 'mémoire : le lieu nouveau n''a pas de mémoire');
reset role;
-- Le bénévole de A n'est pas membre de 2028 : pas de mémoire pour lui.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select * from memoire_lieux('00000000-0000-0000-0000-0000000167e0')$$, '42501'), 'mémoire : réservée aux membres');
reset role;

-- Nettoyage.
delete from evenements where id = :EN;
delete from missions where evenement_id = :EA and reference like 'T167-%';
delete from signalements where evenement_id = :EA and reference like 'T167-%';
delete from creneaux where evenement_id = :EA and code like 'T167-%';
delete from journal where evenement_id = :EA and (module = 'meteo' or categorie in ('rex_auto', 'memoire', 'rattachement'));
delete from rex_entrees where evenement_id = :EA and source = 'eventware';
update missions set lieu_id = null where evenement_id = :EA and reference = 'T162-001';
\echo '=== 167 OK'
