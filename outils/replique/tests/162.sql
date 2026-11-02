-- 162 — talkie : droits, réponses automatiques, négation, lieu proposé, purge, anonyme.
set client_min_messages = notice;
\echo '=== 162 : talkie'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''
\set UA1 '''00000000-0000-0000-0000-00000000a001'''
\set UA2 '''00000000-0000-0000-0000-00000000a002'''

-- Rejouable, et le décor : module activé, une équipe « Volante » pour le bénévole, canaux, un DEA, une étape 2.
delete from messages_vocaux where evenement_id = :EA;
delete from journal where evenement_id = :EA and module = 'talkie';
delete from missions where evenement_id = :EA and reference like 'T162-%';
delete from canaux_radio where evenement_id = :EA and numero in ('3', '8');
delete from elements_plan where evenement_id = :EA and code = 'T162-DEA';
delete from lieux where evenement_id = :EA and code in ('T162-E2', 'T162-E3');
delete from storage.objects where bucket_id = 'vocaux';
update organisations set modules_autorises = coalesce(modules_autorises, '{}'::jsonb) || '{"talkie": true}' where id = '00000000-0000-0000-0000-0000000000aa';
select tests.ok(tests.refuse($$update evenements set modules = coalesce(modules, '{}'::jsonb) || '{"talkie": true, "sos_participants": true}' where id = '00000000-0000-0000-0000-00000000e0aa'$$, 'P0007'), 'licence : un module non souscrit reste refusé');
update evenements set modules = coalesce(modules, '{}'::jsonb) || '{"talkie": true, "talkie_reponses_auto": true}' where id = :EA;
insert into equipes (id, evenement_id, code, nom) values ('00000000-0000-0000-0000-0000000000e1', :EA, 'VOL', 'Volante') on conflict do nothing;
update membres_evenement set equipe_id = '00000000-0000-0000-0000-0000000000e1' where evenement_id = :EA and user_id = :UA2;
insert into canaux_radio (evenement_id, numero, libelle, equipe_id, canal_urgence, actif) values
  (:EA, '3', 'Logistique', '00000000-0000-0000-0000-0000000000e1', false, true),
  (:EA, '8', 'Urgence', null, true, true);
insert into elements_plan (evenement_id, code, nom, nature, calque, categorie, centre_lat, centre_lon) values (:EA, 'T162-DEA', 'DEA chapiteau', 'picto', 'securite', 'dea', 50.3840, 5.6150);
insert into lieux (evenement_id, code, nom, type, latitude, longitude) values (:EA, 'T162-E2', 'Étape 2', 'etape', 50.3900, 5.6200), (:EA, 'T162-E3', 'Étape 3', 'etape', 50.3950, 5.6300);

create temp table t162 as select talkie_mon_membre(:EA) as m where false;
drop table t162;

-- 1. Le bénévole A insère ses messages et ne lit que les siens.
select tests.connecter(:UA2); set role authenticated;
create temp table mb as select talkie_mon_membre(:EA) as id;
grant select on mb to authenticated, anon;
insert into messages_vocaux (id, evenement_id, membre_id, parle_le, duree_s, chemin_audio, transcription) values
  ('00000000-0000-0000-0000-0000000162a1', :EA, (select id from mb), now() - interval '3 minutes', 6, '00000000-0000-0000-0000-00000000e0aa/x/a1.webm', 'c''est quoi mon canal'),
  ('00000000-0000-0000-0000-0000000162a2', :EA, (select id from mb), now() - interval '2 minutes', 5, null, 'à quelle heure il fait nuit'),
  ('00000000-0000-0000-0000-0000000162a3', :EA, (select id from mb), now() - interval '1 minute', 4, null, 'il y a un blessé à l''étape 2'),
  ('00000000-0000-0000-0000-0000000162a4', :EA, (select id from mb), now(), 4, null, 'pas de blessé, juste un pneu crevé à l''étape 3'),
  ('00000000-0000-0000-0000-0000000162a5', :EA, (select id from mb), now(), 3, null, 'où est le DEA'),
  ('00000000-0000-0000-0000-0000000162a6', :EA, (select id from mb), now(), 3, null, 'ma demande de jetons ?'),
  ('00000000-0000-0000-0000-0000000162a7', :EA, (select id from mb), now(), 8, null, null);
select tests.ok((select count(*) from messages_vocaux) = 7, 'bénévole A : relit ses 7 messages');
select tests.ok(tests.refuse($$insert into messages_vocaux (evenement_id, membre_id, parle_le) select '00000000-0000-0000-0000-00000000e0aa', id, now() from membres_evenement where user_id = '00000000-0000-0000-0000-00000000a001'$$, '42501'), 'bénévole A : n''insère pas au nom d''un autre');
select tests.ok(tests.refuse($$insert into messages_vocaux (id, evenement_id, membre_id, parle_le) values ('00000000-0000-0000-0000-0000000162a1', '00000000-0000-0000-0000-00000000e0aa', (select id from mb), now())$$, '23505'), 'renvoi du même id : refusé en doublon (23505), pas de seconde ligne');
-- 2. Les réponses.
select tests.ok((select reponse from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a1') = 'Ton canal : 3 Logistique. Urgence : canal 8 Urgence.', 'CANAL : canal 3 Logistique, urgence 8');
select tests.ok((select reponse from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a2')
                = format('Coucher du soleil à %s, nuit (fin du crépuscule civil) à %s.',
                         to_char(heure_soleil(50.3832, 5.6143, (now() at time zone 'Europe/Brussels')::date, 'coucher') at time zone 'Europe/Brussels', 'HH24"h"MI'),
                         to_char(heure_soleil(50.3832, 5.6143, (now() at time zone 'Europe/Brussels')::date, 'fin_crepuscule_civil') at time zone 'Europe/Brussels', 'HH24"h"MI')),
                'NUIT : coucher et fin du crépuscule civil au point 0, à la date du jour');
select tests.ok((select to_char(heure_soleil(50.3832, 5.6143, date '2026-11-11', 'coucher') at time zone 'Europe/Brussels', 'HH24:MI')) in ('16:57', '16:58')
            and (select to_char(heure_soleil(50.3832, 5.6143, date '2026-11-11', 'fin_crepuscule_civil') at time zone 'Europe/Brussels', 'HH24:MI')) = '17:33', 'NUIT le 11/11 : 16h57/16h58 et 17h33');
select tests.ok((select intention = 'URGENCE' and urgence and statut = 'nouveau' and reponse = 'Si quelqu''un est en danger, appelle le 112 maintenant. Le QG a reçu ton message.' from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a3'), 'URGENCE : consigne 112, rien d''autre, urgence = true, statut nouveau');
select tests.ok((select lieu_id from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a3') = (select id from lieux where code = 'T162-E2'), 'lieu proposé : « étape 2 » reconnu');
select tests.ok((select intention = 'URGENCE_DOUTEUSE' and not urgence from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a4'), 'négation : « pas de blessé » → pas URGENCE, douteuse');
select tests.ok((select lieu_id from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a4') = (select id from lieux where code = 'T162-E3'), 'lieu proposé : « étape 3 » reconnu');
select tests.ok((select intention = 'DEA' and urgence and reponse like 'Appelle le 112. DEA le plus proche : DEA chapiteau, à % m.' from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a5'), 'DEA : 112 + DEA le plus proche avec distance');
select tests.ok((select reponse from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a6') = 'Je ne trouve pas de demande ouverte à ton nom. Le QG a reçu ton message.', 'STATUT_DEMANDE sans demande : « je ne trouve pas »');
select tests.ok((select reponse is null and intention is null from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a7'), 'sans transcription : aucune réponse, message intact');
select tests.ok((select count(*) from messages_vocaux where reponse_source = 'auto') = 6, 'six réponses automatiques');
reset role;
select tests.ok((select count(*) from journal where evenement_id = :EA and module = 'talkie' and categorie = 'reponse_auto') = 6, 'journal : six réponses automatiques tracées');

-- Une demande ouverte du bénévole : la réponse la décrit.
-- (la traçabilité pose created_by = auth.uid() : on se fait passer pour le bénévole, sans RLS)
select tests.connecter(:UA2);
insert into missions (evenement_id, reference, titre, priorite, statut, module) values (:EA, 'T162-001', 'Jetons étape 2', 'P3', 'a_traiter', 'logistique');
-- (le bénévole ne met pas à jour ses messages : c'est le QG qui corrige une transcription — ici, en son nom, sans RLS)
update messages_vocaux set transcription = 'ma demande de jetons c est pour quand' where id = '00000000-0000-0000-0000-0000000162a6';
select tests.ok((select reponse from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a6') = 'Ta demande T162-001 (Jetons étape 2) est en attente au QG.', 'STATUT_DEMANDE avec demande : statut rendu');

-- 3. Le coordinateur (missions : modifier) lit tout, accuse, répond ; le bénévole le voit.
select tests.connecter(:UA1); set role authenticated;
select tests.ok((select count(*) from messages_vocaux) = 7, 'coord A : lit les 7 messages');
update messages_vocaux set statut = 'entendu', entendu_le = now(), entendu_par = auth.uid() where id = '00000000-0000-0000-0000-0000000162a3';
update messages_vocaux set reponse = 'Équipe secours en route.', reponse_le = now(), reponse_source = 'qg' where id = '00000000-0000-0000-0000-0000000162a3';
reset role;
select tests.connecter(:UA2); set role authenticated;
select tests.ok((select statut = 'entendu' and reponse_source = 'qg' from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a3'), 'bénévole A : voit l''accusé et la réponse du QG');
update messages_vocaux set statut = 'traite' where id = '00000000-0000-0000-0000-0000000162a3';
select tests.ok((select statut from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a3') = 'entendu', 'bénévole A : ne modifie pas (RLS)');
reset role;

-- Un autre bénévole ne voit rien ; le coordinateur B non plus.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from messages_vocaux) = 0, 'coord B : aucun message de A');
reset role;

-- 4. Réponses automatiques désactivées : aucune réponse, aucun journal.
update evenements set modules = modules || '{"talkie_reponses_auto": false}' where id = :EA;
select tests.connecter(:UA2); set role authenticated;
insert into messages_vocaux (id, evenement_id, membre_id, parle_le, transcription) values ('00000000-0000-0000-0000-0000000162b1', :EA, (select id from mb), now(), 'c''est quoi mon canal');
select tests.ok((select reponse is null and intention is null from messages_vocaux where id = '00000000-0000-0000-0000-0000000162b1'), 'désactivé : aucune réponse');
reset role;
select tests.ok((select count(*) from journal where evenement_id = :EA and module = 'talkie' and categorie = 'reponse_auto') = 7, 'désactivé : aucun journal de plus (7 = les 6 + la demande)');
update evenements set modules = modules || '{"talkie_reponses_auto": true}' where id = :EA;

-- 5. Purge : chemins vidés, transcriptions gardées ; tout pouvoir seulement.
select tests.connecter(:UA2); set role authenticated;
select tests.ok(tests.refuse($$select purger_vocaux('00000000-0000-0000-0000-00000000e0aa')$$, '42501'), 'bénévole A : ne purge pas');
reset role;
select tests.connecter(:UA1); set role authenticated;
select tests.ok(array_length(purger_vocaux(:EA), 1) = 1, 'purge : un chemin rendu');
select tests.ok((select count(*) from messages_vocaux where chemin_audio is not null) = 0 and (select transcription from messages_vocaux where id = '00000000-0000-0000-0000-0000000162a1') = 'c''est quoi mon canal', 'purge : chemins vidés, transcriptions gardées');
reset role;

-- 6. Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select * from messages_vocaux$$, '42501'), 'anonyme : table fermée');
select tests.ok(tests.refuse($$select * from talkie_intentions$$, '42501'), 'anonyme : intentions fermées');
select tests.ok(tests.refuse($$select talkie_repondre('00000000-0000-0000-0000-0000000162a1')$$, '42501'), 'anonyme : fonction fermée');
reset role;
select tests.ok((select file_size_limit from storage.buckets where id = 'vocaux') = 1048576 and not (select public from storage.buckets where id = 'vocaux'), 'compartiment vocaux : privé, 1 Mo');
drop table mb;
\echo '=== 162 OK'
