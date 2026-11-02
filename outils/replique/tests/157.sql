-- 157 — dossier de sécurité : dépôt refusé puis accepté, instantané figé, retrait, droits.
-- Suppose 155.sql et 156.sql joués juste avant (BFMF 2027 complet, sans bloquant).
set client_min_messages = notice;
\echo '=== 157 : dossier de sécurité'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

-- Rejouable.
delete from dossiers_securite where evenement_id = :EA;

-- Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select * from dossiers_securite$$, '42501'), 'anonyme : dossiers refusés');
select tests.ok(tests.refuse($$select * from dossier_versions$$, '42501'), 'anonyme : versions refusées');
select tests.ok(tests.refuse($$select deposer_dossier('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'anonyme : dépôt refusé');
reset role;

-- Bénévole A : ne dépose pas.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select deposer_dossier('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'bénévole A : dépôt refusé');
reset role;

-- Coordinateur A : un bloquant réapparaît (PC-Ops effacé) → dépôt refusé, aucune version.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
update lieux set latitude = null where evenement_id = :EA and code = 'T156-PC';
select tests.ok(tests.refuse($$select deposer_dossier('00000000-0000-0000-0000-00000000e0aa')$$, 'P0010'), 'un bloquant : dépôt refusé (P0010)');
select tests.ok((select count(*) from dossiers_securite where evenement_id = :EA) = 0, 'dépôt refusé : aucun dossier créé');
update lieux set latitude = 50.3821 where evenement_id = :EA and code = 'T156-PC';

-- Plus de bloquant → dépôt accepté, version 1 figée.
select tests.ok((deposer_dossier(:EA) ->> 'version')::int = 1, 'dépôt accepté : version 1');
select tests.ok((select statut from dossiers_securite where evenement_id = :EA) = 'depose', 'statut : depose');
select tests.ok((select count(*) from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA) = 1, 'une version');
select tests.ok((select contenu -> 'evenement' ->> 'frequentation_max' from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA and v.version = 1) = '1200',
                'instantané : fréquentation 1200');
select tests.ok((select contenu -> 'profil_securite' ->> 'securite_nom' from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA and v.version = 1) = 'Marie Martin',
                'instantané : profil de sécurité repris');
select tests.ok((select jsonb_array_length(contenu -> 'contacts') from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA and v.version = 1) >= 1,
                'instantané : contacts (interlocuteur)');
select tests.ok((select jsonb_array_length(contenu -> 'controles') from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA and v.version = 1) >= 1,
                'instantané : contrôles du moment');
select tests.ok(exists (select 1 from journal where evenement_id = :EA and categorie = 'dossier' and texte like 'Dossier de sécurité déposé (version 1)%'), 'journal : dépôt tracé');

-- L'événement continue de vivre : la version déposée ne bouge pas.
update evenements set frequentation_max = 1500 where id = :EA;
select tests.ok((select contenu -> 'evenement' ->> 'frequentation_max' from dossier_versions v join dossiers_securite d on d.id = v.dossier_id where d.evenement_id = :EA and v.version = 1) = '1200',
                'version 1 figée après modification de l''événement');
select tests.ok((instantane_dossier(:EA) -> 'evenement' ->> 'frequentation_max') = '1500', 'l''instantané courant, lui, suit l''événement');
update evenements set frequentation_max = 1200 where id = :EA;

-- Pas d'écriture directe, même pour le coordinateur.
update dossiers_securite set statut = 'autorise' where evenement_id = :EA;
select tests.ok((select statut from dossiers_securite where evenement_id = :EA) = 'depose', 'update direct sans effet (pas de policy)');
select tests.ok(tests.refuse($$insert into dossier_versions (dossier_id, version, contenu) select id, 9, '{}' from dossiers_securite$$, '42501'), 'insert direct des versions refusé');

-- Nouveau dépôt : version 2. Retrait, puis redépôt : version 3.
select tests.ok((deposer_dossier(:EA) ->> 'version')::int = 2, 'second dépôt : version 2');
select tests.ok((retirer_dossier(:EA) ->> 'statut') = 'retire', 'retrait : statut retire');
select tests.ok(tests.refuse($$select retirer_dossier('00000000-0000-0000-0000-00000000e0aa')$$, 'P0011'), 'retirer un dossier retiré : refusé (P0011)');
select tests.ok((deposer_dossier(:EA) ->> 'version')::int = 3, 'redépôt : version 3');
reset role;

-- Coordinateur B ne voit rien du dossier de A.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from dossiers_securite) = 0 and (select count(*) from dossier_versions) = 0, 'coord B : ne voit ni dossier ni version de A');
select tests.ok(tests.refuse($$select instantane_dossier('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'coord B : instantané de A refusé');
reset role;
\echo '=== 157 OK'
