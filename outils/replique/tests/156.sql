-- 156 — controle_dossier : les DOS_* s'ajoutent à avant_vol sans le modifier.
-- Suppose 155.sql joué juste avant (profil de l'organisation A complet).
set client_min_messages = notice;
\echo '=== 156 : contrôle du dossier'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

-- Rejouable : on efface ce que ce test ajoute.
delete from contacts where evenement_id = :EA and code like 'T156-%';
delete from lieux where evenement_id = :EA and code = 'T156-PC';
delete from conformite_reponses where evenement_id = :EA;

-- avant_vol est intact : sa définition ne connaît pas les DOS_*.
select tests.ok(position('DOS_' in pg_get_functiondef('public.avant_vol(uuid)'::regprocedure)) = 0, 'avant_vol : définition inchangée (aucun DOS_*)');

-- Anonyme et bénévole : refusés.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select * from controle_dossier('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'anonyme : refusé');
reset role;
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok(tests.refuse($$select * from controle_dossier('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'bénévole A : refusé');
reset role;

-- Coordinateur A, événement encore vide : les bloquants attendus.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
create temp table t156 as select * from controle_dossier(:EA);
select tests.ok((select array_agg(code order by code) from t156 where gravite = 'bloquant')
                = array['DOS_COORDINATEUR','DOS_PC_OPS','DOS_QUESTIONNAIRE','DOS_TEL_POLICE','DOS_TEL_SECOURS'],
                'événement vide : 5 bloquants (coordinateur, PC-Ops, questionnaire, police, secours)');
select tests.ok(not exists (select 1 from t156 where code in ('DOS_COMMUNE','DOS_FREQUENTATION','DOS_DATES','DOS_PROFIL')), 'commune, fréquentation, dates, profil : OK');
select tests.ok(exists (select 1 from t156 where code = 'DOS_PLAN' and gravite = 'alerte'), 'plan vide : alerte, pas bloquant');
-- Les lignes non DOS_* sont exactement celles d'avant_vol.
select tests.ok((select count(*) from (select code, gravite, titre, detail from t156 where code not like 'DOS_%'
                                        except select code, gravite, titre, detail from avant_vol(:EA)) x) = 0
            and (select count(*) from (select code, gravite, titre, detail from avant_vol(:EA)
                                        except select code, gravite, titre, detail from t156 where code not like 'DOS_%') x) = 0,
                'les lignes d''avant_vol sont reprises telles quelles');
drop table t156;

-- On complète : interlocuteur avec téléphone, PC-Ops, contacts secours et police, questionnaire.
insert into contacts (evenement_id, code, nom, organisation, telephone, categorie, role_autorite) values
  (:EA, 'T156-COORD', 'Coord A', 'Organisation A', '0470 00 00 01', 'organisation', 'interlocuteur'),
  (:EA, 'T156-ZS', 'Dispatch', 'Zone de secours Vesdre-Hoëgne & Plateau', '04 000 00 00', 'secours', null),
  (:EA, 'T156-ZP', 'Officier de garde', 'Zone de police Condroz', '04 000 00 01', 'police', null);
insert into lieux (evenement_id, code, nom, type, latitude, longitude) values (:EA, 'T156-PC', 'PC Ops', 'pc_ops', 50.3821, 5.6168);
insert into conformite_reponses (evenement_id, reponses) values (:EA, '{"structure":{"chapiteau":true},"cuisson":{"gaz":true}}');
select tests.ok(not exists (select 1 from controle_dossier(:EA) where gravite = 'bloquant'), 'événement complété : plus aucun bloquant');
select tests.ok(exists (select 1 from controle_dossier(:EA) where code = 'DOS_SECOURS' and gravite = 'alerte'), 'moyens de secours absents : alerte seulement');
reset role;

-- Un événement d'une autre organisation : coord A n'y lit rien.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(tests.refuse($$select * from controle_dossier('00000000-0000-0000-0000-00000000e0bb')$$, '42501'), 'coord A : événement B refusé');
reset role;
\echo '=== 156 OK'
