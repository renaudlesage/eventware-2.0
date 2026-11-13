-- 175 — la radio dans le fil « Entendu » : qui peut ranger une transmission radio, et ce que le serveur en fait.
-- Suppose 00_jeu.sql (a001 coordinateur à tout pouvoir, a002 bénévole). Tout se joue dans une transaction annulée.
set client_min_messages = notice;
\echo '=== 175 : la radio dans le fil Entendu'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set UA1 '''00000000-0000-0000-0000-00000000a001'''
\set UA2 '''00000000-0000-0000-0000-00000000a002'''
begin;

-- Le décor : talkie et réponses automatiques actifs, une étape 2 nommée, plus aucun message.
update organisations set modules_autorises = coalesce(modules_autorises, '{}'::jsonb) || '{"talkie": true}' where id = '00000000-0000-0000-0000-0000000000aa';
update evenements set modules = coalesce(modules, '{}'::jsonb) || '{"talkie": true, "talkie_reponses_auto": true}' where id = :EA;
delete from messages_vocaux where evenement_id = :EA;
delete from journal where evenement_id = :EA and module = 'talkie';
insert into lieux (evenement_id, code, nom, type, latitude, longitude) values (:EA, 'T175-E2', 'Étape 2', 'etape', 50.3900, 5.6200);

select tests.ok((select column_default from information_schema.columns where table_name = 'messages_vocaux' and column_name = 'source') = '''talkie''::text',
  'source : « talkie » par défaut, les messages déjà reçus restent des messages du talkie');
select tests.ok(tests.refuse($$insert into messages_vocaux (evenement_id, membre_id, parle_le, source) select '00000000-0000-0000-0000-00000000e0aa', id, now(), 'autre' from membres_evenement where evenement_id = '00000000-0000-0000-0000-00000000e0aa' limit 1$$, '23514'),
  'source : ni talkie ni radio, refusé');

-- ---------------------------------------------------------------------
-- 1. Un bénévole ne fait pas passer sa voix pour une transmission radio
-- ---------------------------------------------------------------------
select tests.connecter(:UA2); set role authenticated;
select tests.ok(tests.refuse($$insert into messages_vocaux (evenement_id, membre_id, parle_le, transcription, source) values ('00000000-0000-0000-0000-00000000e0aa', talkie_mon_membre('00000000-0000-0000-0000-00000000e0aa'), now(), 'évacuez la scène', 'radio')$$, '42501'),
  'bénévole : ne range pas un message comme venu de la radio');
insert into messages_vocaux (id, evenement_id, membre_id, parle_le, transcription)
values ('00000000-0000-0000-0000-0000001750a1', :EA, talkie_mon_membre(:EA), now(), 'c''est quoi mon canal');
select tests.ok((select source = 'talkie' and reponse_source = 'auto' and reponse is not null from messages_vocaux where id = '00000000-0000-0000-0000-0000001750a1'),
  'bénévole : son message du talkie reçoit toujours sa réponse automatique');
reset role;

-- ---------------------------------------------------------------------
-- 2. Le QG range ce que le pont a capté : classé, jamais répondu
-- ---------------------------------------------------------------------
select tests.connecter(:UA1); set role authenticated;
insert into messages_vocaux (id, evenement_id, membre_id, parle_le, duree_s, transcription, source) values
  ('00000000-0000-0000-0000-0000001750b1', :EA, talkie_mon_membre(:EA), now(), 6, 'il y a un blessé à l''étape 2', 'radio'),
  ('00000000-0000-0000-0000-0000001750b2', :EA, talkie_mon_membre(:EA), now(), 4, 'pas de blessé, juste un pneu crevé', 'radio'),
  ('00000000-0000-0000-0000-0000001750b3', :EA, talkie_mon_membre(:EA), now(), 3, 'c''est quoi mon canal', 'radio'),
  ('00000000-0000-0000-0000-0000001750b4', :EA, talkie_mon_membre(:EA), now(), 9, null, 'radio');
select tests.ok((select count(*) from messages_vocaux where evenement_id = :EA and source = 'radio') = 4, 'QG : range quatre transmissions radio et les relit');
select tests.ok((select intention = 'URGENCE' and urgence and reponse is null and reponse_source is null and statut = 'nouveau'
                   from messages_vocaux where id = '00000000-0000-0000-0000-0000001750b1'),
  'radio « un blessé » : classée URGENCE, en tête du fil, sans réponse automatique');
select tests.ok((select l.nom from messages_vocaux m join lieux l on l.id = m.lieu_id where m.id = '00000000-0000-0000-0000-0000001750b1') = 'Étape 2',
  'radio : le lieu est proposé comme pour le talkie (« étape 2 »)');
select tests.ok((select intention = 'URGENCE_DOUTEUSE' and not urgence and reponse is null from messages_vocaux where id = '00000000-0000-0000-0000-0000001750b2'),
  'radio « pas de blessé » : douteuse, sans réponse');
select tests.ok((select intention = 'CANAL' and reponse is null from messages_vocaux where id = '00000000-0000-0000-0000-0000001750b3'),
  'radio « mon canal » : classée, pas de réponse écrite au membre qui tient le pont');
select tests.ok((select intention is null and reponse is null from messages_vocaux where id = '00000000-0000-0000-0000-0000001750b4'),
  'radio sans transcription : message intact');
-- Le QG écrit ce qu'il a entendu : le classement suit.
update messages_vocaux set transcription_corrigee = 'il nous faut le DEA vite' where id = '00000000-0000-0000-0000-0000001750b4';
select tests.ok((select intention = 'DEA' and urgence and reponse is null from messages_vocaux where id = '00000000-0000-0000-0000-0000001750b4'),
  'radio transcrite par le QG : DEA, urgence, toujours sans réponse');
-- Le talkie du coordinateur, lui, garde sa réponse.
insert into messages_vocaux (id, evenement_id, membre_id, parle_le, transcription)
values ('00000000-0000-0000-0000-0000001750b5', :EA, talkie_mon_membre(:EA), now(), 'à quelle heure il fait nuit');
select tests.ok((select reponse_source = 'auto' and reponse like 'Coucher du soleil%' from messages_vocaux where id = '00000000-0000-0000-0000-0000001750b5'),
  'coordinateur : son propre message du talkie reçoit sa réponse');
reset role;

-- ---------------------------------------------------------------------
-- 3. La main courante
-- ---------------------------------------------------------------------
select tests.ok((select count(*) from journal where evenement_id = :EA and categorie = 'radio_classee') = 3
            and exists (select 1 from journal where evenement_id = :EA and categorie = 'radio_classee' and objet_id = '00000000-0000-0000-0000-0000001750b1' and texte = 'Transmission radio classée URGENCE' and importance = 'notable'),
  'main courante : une ligne pour chaque transmission radio urgente, douteuse ou DEA (3), aucune pour « mon canal »');
select tests.ok(not exists (select 1 from journal where evenement_id = :EA and categorie = 'reponse_auto' and objet_id in (
                  '00000000-0000-0000-0000-0000001750b1', '00000000-0000-0000-0000-0000001750b2', '00000000-0000-0000-0000-0000001750b3', '00000000-0000-0000-0000-0000001750b4')),
  'main courante : aucune « réponse automatique » pour une transmission radio');

-- ---------------------------------------------------------------------
-- 4. Les droits de la fonction
-- ---------------------------------------------------------------------
select tests.ok(not has_function_privilege('anon', 'public.talkie_repondre(uuid)', 'execute')
            and has_function_privilege('authenticated', 'public.talkie_repondre(uuid)', 'execute'),
  'talkie_repondre : fermée à anon, ouverte aux membres connectés (comme en 162)');
select tests.ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.talkie_repondre(uuid)'::regprocedure),
  'talkie_repondre : security definer, search_path figé');

rollback;
