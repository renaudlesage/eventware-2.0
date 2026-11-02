-- 166 — talkie : le sort de la reconnaissance, la suppression par le QG.
-- Suppose 162.sql joué avant (membres a001 coordinateur, a002 bénévole dans A ; module talkie actif).
set client_min_messages = notice;
\echo '=== 166 : talkie, reconnaissance et suppression'
\set EA '''00000000-0000-0000-0000-00000000e0aa'''

delete from messages_vocaux where id in ('00000000-0000-0000-0000-0000000166a1', '00000000-0000-0000-0000-0000000166a2');

select tests.ok(exists (select 1 from information_schema.columns where table_name = 'messages_vocaux' and column_name = 'reconnaissance'), 'colonne reconnaissance');
select tests.ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vocaux_suppression_qg'), 'police de suppression du compartiment pour le QG');

-- Le bénévole envoie un message sans transcription, avec le motif.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
insert into messages_vocaux (id, evenement_id, membre_id, parle_le, duree_s, chemin_audio, transcription, reconnaissance)
values ('00000000-0000-0000-0000-0000000166a1', :EA, talkie_mon_membre(:EA), now(), 4, '00000000-0000-0000-0000-00000000e0aa/x/166a1.webm', null, 'erreur:audio-capture'),
       ('00000000-0000-0000-0000-0000000166a2', :EA, talkie_mon_membre(:EA), now(), 3, null, 'c est quoi mon canal', 'ok');
select tests.ok((select reconnaissance from messages_vocaux where id = '00000000-0000-0000-0000-0000000166a1') = 'erreur:audio-capture', 'le motif est enregistré');
select tests.ok((select intention from messages_vocaux where id = '00000000-0000-0000-0000-0000000166a2') = 'CANAL', 'avec transcription, l''intention est reconnue');
select tests.ok((select intention from messages_vocaux where id = '00000000-0000-0000-0000-0000000166a1') is null, 'sans transcription, pas d''intention');
-- Le bénévole ne supprime pas.
select tests.ok(tests.refuse($$select supprimer_message_vocal('00000000-0000-0000-0000-0000000166a1')$$, '42501'), 'bénévole : ne supprime pas');
reset role;

-- Le QG corrige la transcription : les mots-clés sont alors reconnus (déclencheur sur transcription_corrigee).
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
update messages_vocaux set transcription_corrigee = 'il y a un blessé au départ' where id = '00000000-0000-0000-0000-0000000166a1';
select tests.ok((select intention from messages_vocaux where id = '00000000-0000-0000-0000-0000000166a1') = 'URGENCE', 'transcription saisie par le QG : URGENCE reconnue');
-- Le QG supprime : effacement logique, chemin rendu, journal, plus visible.
select tests.ok(supprimer_message_vocal('00000000-0000-0000-0000-0000000166a1') = '00000000-0000-0000-0000-00000000e0aa/x/166a1.webm', 'QG : supprime et reçoit le chemin de l''audio');
select tests.ok((select count(*) from messages_vocaux where id = '00000000-0000-0000-0000-0000000166a1') = 0, 'QG : le message supprimé n''est plus visible');
select tests.ok(supprimer_message_vocal('00000000-0000-0000-0000-0000000166a1') is null, 'QG : supprimer deux fois ne fait rien');
select tests.ok(exists (select 1 from journal where evenement_id = :EA and module = 'talkie' and categorie = 'suppression'), 'journal : la suppression est consignée');
select tests.ok(supprimer_message_vocal('00000000-0000-0000-0000-0000000166a2') = '', 'QG : sans audio, chemin vide');
reset role;
select tests.ok((select deleted_at from messages_vocaux where id = '00000000-0000-0000-0000-0000000166a1') is not null, 'effacement logique : la ligne reste en base');

delete from messages_vocaux where id in ('00000000-0000-0000-0000-0000000166a1', '00000000-0000-0000-0000-0000000166a2');
\echo '=== 166 OK'
