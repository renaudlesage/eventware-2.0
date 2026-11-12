-- 169 — les fonctions de l'audit : demande du bénévole, clôture guidée, constats en lot, recherche globale.
-- Suppose 162.sql et 167.sql joués avant (a001 coordinateur, a002 bénévole, b001 coordinateur B ; lieux T162-E2, T156-PC).
set client_min_messages = notice;
\echo '=== 169 : fonctions de l''audit'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set EN '''00000000-0000-0000-0000-0000000169e0'''

-- Rejouable.
delete from evenements where id = :EN;
delete from missions where evenement_id = :EA and (titre like 'T169%' or titre like '%T169%' or id = '00000000-0000-0000-0000-000000169001');
delete from rex_entrees where evenement_id = :EA and constat like 'T169%';
delete from creneaux where evenement_id = :EA and code like 'T169-%';
delete from signalements where evenement_id = :EA and reference like 'T169-%';
delete from alertes where evenement_id = :EA and titre like 'T169%';
delete from contacts where evenement_id = :EA and code like 'T169-%';
delete from journal where evenement_id = :EA and (categorie = 'rex_report' or texte like 'T169%');
update organisations set modules_autorises = coalesce(modules_autorises, '{}'::jsonb) || '{"logistique": true}' where id = '00000000-0000-0000-0000-0000000000aa';
update evenements set modules = modules || '{"logistique": true}'::jsonb, phase = 'exploitation' where id = :EA;

-- Le débit (dix demandes par quart d'heure) se compte sur ce que le bénévole vient de poser : quand toute la suite
-- s'enchaîne, les tests précédents en ont laissé. On les vieillit, sinon la limite tombe avant la onzième de ce test.
alter table missions disable trigger tracabilite_missions;
update missions set created_at = now() - interval '1 hour'
 where evenement_id = :EA and created_by = '00000000-0000-0000-0000-00000000a002' and created_at > now() - interval '20 minutes';
alter table missions enable trigger tracabilite_missions;

-- 1. La demande du bénévole ---------------------------------------------------
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(not a_permission(:EA, 'missions', 'creer'), 'bénévole : n''a pas « missions : créer »');
select tests.ok(tests.refuse($$insert into missions (evenement_id, module, titre, priorite) values ('00000000-0000-0000-0000-00000000e0aa', 'logistique', 'T169 directe', 'P3')$$, '42501'), 'bénévole : l''insertion directe reste refusée');
create temp table t169 as select demande_terrain(:EA, 'T169 plus de fûts de bière au bar', null, null, false, '00000000-0000-0000-0000-000000169001') as d;
grant select on t169 to authenticated, anon;
select tests.ok((select d ->> 'reference' from t169) is not null, 'bénévole : demande créée, référence rendue');
select tests.ok((select d ->> 'module' from t169) = 'logistique' and (select d ->> 'priorite' from t169) = 'P3', 'demande : logistique, P3');
select tests.ok((select (demande_terrain(:EA, 'T169 plus de fûts de bière au bar', null, null, false, '00000000-0000-0000-0000-000000169001')) ->> 'deja') = 'true', 'demande : rejouée avec la même clé → la même, pas un doublon');
select tests.ok((select (demande_terrain(:EA, 'T169 un blessé à l''entrée')) ->> 'priorite') = 'P1', 'demande : « blessé » → sécurité, P1');
select tests.ok((select (demande_terrain(:EA, 'T169 la pompe est en panne', 'energie', null, true)) ->> 'priorite') = 'P2', 'demande bloquante : P2');
select tests.ok(tests.refuse($$select demande_terrain('00000000-0000-0000-0000-00000000e0aa', '   ')$$, '22023'), 'demande vide : refusée');
select tests.ok(tests.refuse($$select demande_terrain('00000000-0000-0000-0000-00000000e0aa', 'x', 'inconnue')$$, '22023'), 'famille inconnue : refusée');
select tests.ok(tests.refuse($$select demande_terrain('00000000-0000-0000-0000-00000000e0bb', 'T169 chez les voisins')$$, '42501'), 'bénévole de A : pas de demande dans l''événement B');
select tests.ok((select count(*) from mes_demandes(:EA) where titre like '%T169%') = 3, 'mes_demandes : les trois miennes');
reset role;
select tests.ok((select titre from missions where id = '00000000-0000-0000-0000-000000169001') = 'Réassort boissons : T169 plus de fûts de bière au bar', 'demande : la famille est lue dans le texte et titre la demande');
select tests.ok((select qui_concerne from missions where id = '00000000-0000-0000-0000-000000169001') = 'Bénévole A', 'demande : le demandeur est nommé pour le QG');
-- Le lieu vient du créneau en cours du bénévole.
insert into creneaux (id, evenement_id, code, poste, debut, fin, lieu_id) values ('00000000-0000-0000-0000-000000169c01', :EA, 'T169-C1', 'Bar T169', now() - interval '1 hour', now() + interval '1 hour', (select id from lieux where evenement_id = :EA and code = 'T162-E2'));
insert into affectations (evenement_id, creneau_id, membre_id, statut) select :EA, '00000000-0000-0000-0000-000000169c01', id, 'confirme' from membres_evenement where evenement_id = :EA and user_id = '00000000-0000-0000-0000-00000000a002';
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((select (demande_terrain(:EA, 'T169 jetons à la caisse')) ->> 'lieu') = 'Étape 2', 'demande : le lieu est repris du créneau en cours');
-- Débit : dix par quart d'heure.
select demande_terrain(:EA, 'T169 rafale ' || g) from generate_series(1, 6) g;
select tests.ok(tests.refuse($$select demande_terrain('00000000-0000-0000-0000-00000000e0aa', 'T169 de trop')$$, 'P0005'), 'débit : la onzième en un quart d''heure est refusée');
reset role;
-- Module fermé, événement clôturé.
update evenements set modules = modules || '{"logistique": false}'::jsonb where id = :EA;
delete from missions where evenement_id = :EA and titre like '%T169 rafale%';
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select demande_terrain('00000000-0000-0000-0000-00000000e0aa', 'T169 module fermé')$$, 'P0003'), 'module logistique fermé : P0003');
reset role;
update evenements set modules = modules || '{"logistique": true}'::jsonb, phase = 'cloture' where id = :EA;
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select demande_terrain('00000000-0000-0000-0000-00000000e0aa', 'T169 après clôture')$$, 'P0006'), 'événement clôturé : P0006');
reset role;
update evenements set phase = 'exploitation' where id = :EA;
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select demande_terrain('00000000-0000-0000-0000-00000000e0aa', 'T169 anonyme')$$, '42501'), 'anonyme : refusé');
reset role;

-- 2. La clôture guidée --------------------------------------------------------
insert into alertes (evenement_id, niveau, titre, active) values (:EA, 'vigilance', 'T169 orage', true);
insert into signalements (evenement_id, reference, cle_client, type, statut, recu_le) values (:EA, 'T169-S1', gen_random_uuid(), 'danger', 'recu', now());
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select * from controle_cloture('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'bénévole : pas de contrôle de clôture');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select gravite from controle_cloture(:EA) where code = 'CLO_ALERTES') = 'bloquant', 'clôture : alerte active → bloquant');
select tests.ok((select n from controle_cloture(:EA) where code = 'CLO_SOS') >= 1, 'clôture : signalement non clos compté');
select tests.ok((select n from controle_cloture(:EA) where code = 'CLO_DEMANDES') >= 4, 'clôture : demandes ouvertes comptées');
select tests.ok((select rubrique from controle_cloture(:EA) where code = 'CLO_DEMANDES') = 'interventions', 'clôture : chaque point dit où aller');
select tests.ok(exists (select 1 from controle_cloture(:EA) where code = 'CLO_REX' and gravite = 'info'), 'clôture : les constats à arbitrer sont une information, pas un blocage');
reset role;
update alertes set active = false where evenement_id = :EA and titre like 'T169%';
update signalements set statut = 'clos', clos_le = now() where evenement_id = :EA and reference = 'T169-S1';
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(not exists (select 1 from controle_cloture(:EA) where code in ('CLO_ALERTES')), 'clôture : l''alerte levée ne bloque plus');
reset role;

-- 3. Les constats en lot --------------------------------------------------------
insert into rex_entrees (id, evenement_id, nature, module, impact, constat, proposition, statut, porteur) values
  ('00000000-0000-0000-0000-0000001690a1', :EA, 'dysfonctionnement', 'logistique', 'gene', 'T169 il manquait des bouchons d''oreille au bar', 'Prévoir 200 paires de bouchons au bar', 'a_arbitrer', null),
  ('00000000-0000-0000-0000-0000001690a2', :EA, 'dysfonctionnement', 'logistique', 'gene', 'T169 il manquait des bouchons d''oreilles au bar !', null, 'a_arbitrer', null),
  ('00000000-0000-0000-0000-0000001690a3', :EA, 'suggestion', 'securite', 'mineur', 'T169 le parking débordait dès 14 h sur la route', 'Ouvrir le second parking dès midi', 'retenu', 'Sécurité');
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(exists (select 1 from rex_doublons(:EA) where id_a = '00000000-0000-0000-0000-0000001690a1' and id_b = '00000000-0000-0000-0000-0000001690a2' and similarite > 0.8), 'doublons : les deux constats « bouchons » sont rapprochés');
select tests.ok(not exists (select 1 from rex_doublons(:EA) where '00000000-0000-0000-0000-0000001690a3' in (id_a, id_b)), 'doublons : un constat déjà arbitré n''est pas proposé');
-- Arbitrage en lot : une seule écriture pour plusieurs constats.
update rex_entrees set statut = 'retenu', porteur = 'Logistique' where id in ('00000000-0000-0000-0000-0000001690a1');
update rex_entrees set statut = 'rejete', suite = 'Doublon' where id in ('00000000-0000-0000-0000-0000001690a2');
reset role;
-- L'édition suivante, et le report.
select tests.anonyme(); reset role;
insert into evenements (id, nom, slug, organisation_id, phase, date_debut, date_fin) values (:EN, 'BFMF 2028 T169', 'bfmf-2028-t169', '00000000-0000-0000-0000-0000000000aa', 'preparation', '2028-06-03', '2028-06-04');
insert into membres_evenement (evenement_id, user_id, role_id, actif, nom_affiche)
select :EN, '00000000-0000-0000-0000-00000000a001', r.id, true, 'Coord A' from roles r where r.evenement_id = :EN and r.code = 'coordinateur';
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(rex_reporter(:EA, :EN, array['00000000-0000-0000-0000-0000001690a1', '00000000-0000-0000-0000-0000001690a2', '00000000-0000-0000-0000-0000001690a3']::uuid[]) = 2, 'report : les deux constats retenus deviennent des jalons, le rejeté non');
select tests.ok((select count(*) from jalons where evenement_id = :EN and code like 'REX-%') = 2, 'report : deux jalons REX-01 et REX-02 dans l''édition suivante');
select tests.ok((select libelle from jalons where evenement_id = :EN and code = 'REX-01') = 'Prévoir 200 paires de bouchons au bar', 'report : le jalon porte la proposition');
select tests.ok((select echeance::date from jalons where evenement_id = :EN and code = 'REX-01') = date '2028-05-04', 'report : échéance un mois avant l''événement');
select tests.ok((select commentaire from jalons where evenement_id = :EN and code = 'REX-01') like 'Constat de « BFMF 2027 » : T169 il manquait%', 'report : le jalon dit d''où il vient');
select tests.ok((select objet_ref from rex_entrees where id = '00000000-0000-0000-0000-0000001690a1') = 'REX-01', 'report : le constat garde le lien vers son jalon');
select tests.ok(rex_reporter(:EA, :EN, array['00000000-0000-0000-0000-0000001690a1', '00000000-0000-0000-0000-0000001690a3']::uuid[]) = 0, 'report : rejoué → rien de plus');
select tests.ok(tests.refuse($$select rex_reporter('00000000-0000-0000-0000-00000000e0aa', '00000000-0000-0000-0000-00000000e0aa', array[]::uuid[])$$, '22023'), 'report : pas vers soi-même');
select tests.ok(tests.refuse($$select rex_reporter('00000000-0000-0000-0000-00000000e0aa', '00000000-0000-0000-0000-00000000e0bb', array[]::uuid[])$$, '22023'), 'report : pas vers une autre organisation');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select rex_reporter('00000000-0000-0000-0000-00000000e0aa', '00000000-0000-0000-0000-0000000169e0', array[]::uuid[])$$, '42501'), 'bénévole : ne reporte pas');
reset role;

-- 4. La recherche globale ---------------------------------------------------------
insert into contacts (evenement_id, code, nom, organisation, fonction, telephone) values (:EA, 'T169-K1', 'Zoé Lambiotte', 'Croix-Rouge T169', 'Cheffe de poste', '0471 23 45 67');
insert into journal (evenement_id, module, categorie, texte) values (:EA, 'securite', 'observation', 'T169 clôture du parking à 23 h');
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select count(*) from rechercher(:EA, 'x')) = 0, 'recherche : une lettre ne cherche pas');
select tests.ok(exists (select 1 from rechercher(:EA, 'futs de biere') where genre = 'demande' and ecran = 'logistique' and rubrique = 'interventions'), 'recherche : « futs de biere » (sans accents) trouve la demande et dit où l''ouvrir');
select tests.ok((select objet from rechercher(:EA, (select d ->> 'reference' from t169)) where genre = 'demande' limit 1) = (select d ->> 'reference' from t169), 'recherche : par référence');
select tests.ok(exists (select 1 from rechercher(:EA, 'lambiotte') where genre = 'contact' and detail like '%0471 23 45 67%' and ecran = 'memento' and rubrique = 'contacts'), 'recherche : un contact par son nom, avec son numéro');
select tests.ok(exists (select 1 from rechercher(:EA, '0471234567') where genre = 'contact'), 'recherche : un contact par son numéro, sans les espaces');
select tests.ok(exists (select 1 from rechercher(:EA, 'etape 2') where genre = 'lieu'), 'recherche : un lieu');
select tests.ok(exists (select 1 from rechercher(:EA, 'T169-S1') where genre = 'signalement' and rubrique = 'signalements'), 'recherche : un signalement par sa référence');
select tests.ok(exists (select 1 from rechercher(:EA, 'bouchons') where genre = 'constat'), 'recherche : un constat');
select tests.ok(exists (select 1 from rechercher(:EA, 'cloture du parking') where genre = 'main courante'), 'recherche : la main courante');
select tests.ok(exists (select 1 from rechercher(:EA, 'bar t169') where genre = 'créneau'), 'recherche : un créneau par son poste');
select tests.ok((select count(*) from rechercher(:EA, 'T169', 2) where genre = 'demande') <= 2, 'recherche : la limite par genre est respectée');
reset role;
-- Avec les droits de l'appelant : le coordinateur de B ne trouve rien dans A.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from rechercher(:EA, 'lambiotte')) = 0, 'recherche : le coordinateur B ne trouve rien dans A');
reset role;
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select * from rechercher('00000000-0000-0000-0000-00000000e0aa', 'lambiotte')$$, '42501'), 'recherche : fermée aux anonymes');
reset role;

-- Nettoyage.
delete from evenements where id = :EN;
delete from affectations where creneau_id = '00000000-0000-0000-0000-000000169c01';
delete from creneaux where evenement_id = :EA and code like 'T169-%';
delete from missions where evenement_id = :EA and (titre like 'T169%' or titre like '%T169%');
delete from rex_entrees where evenement_id = :EA and constat like 'T169%';
delete from signalements where evenement_id = :EA and reference like 'T169-%';
delete from alertes where evenement_id = :EA and titre like 'T169%';
delete from contacts where evenement_id = :EA and code like 'T169-%';
delete from journal where evenement_id = :EA and (categorie = 'rex_report' or texte like 'T169%');
update evenements set phase = 'preparation' where id = :EA;
\echo '=== 169 OK'
