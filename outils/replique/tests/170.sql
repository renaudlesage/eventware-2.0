-- 170 — notifications poussées : chacun ne gère que ses abonnements ; un appareil suit la personne connectée.
set client_min_messages = notice;
\echo '=== 170 : notifications poussées'
delete from abonnements_push where endpoint like 'https://push.test/%';

select tests.ok(exists (select 1 from pg_policies where tablename = 'abonnements_push' and policyname = 'abonnements_push_les_miens'), 'police : chacun les siens');

select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok(abonner_push('https://push.test/appareil-1', 'cle-p256dh', 'cle-auth', 'Téléphone de test') is not null, 'coord A : s''abonne');
select tests.ok((select count(*) from abonnements_push where endpoint like 'https://push.test/%') = 1, 'coord A : voit son abonnement');
select tests.ok(tests.refuse($$select abonner_push('http://pas-https', 'a', 'b')$$, '22023'), 'adresse non https : refusée');
select tests.ok(tests.refuse($$select abonner_push('https://push.test/x', '', 'b')$$, '22023'), 'clé vide : refusée');
update abonnements_push set preferences = '{"rappels": false}' where endpoint = 'https://push.test/appareil-1';
select tests.ok((select preferences ->> 'rappels' from abonnements_push where endpoint = 'https://push.test/appareil-1') = 'false', 'coord A : règle ses préférences');
reset role;

select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((select count(*) from abonnements_push where endpoint like 'https://push.test/%') = 0, 'bénévole : ne voit pas l''abonnement d''un autre');
select tests.ok(tests.refuse($$insert into abonnements_push (user_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-00000000a001', 'https://push.test/vol', 'a', 'b')$$, '42501'), 'bénévole : n''abonne pas quelqu''un d''autre');
-- Le même appareil, une autre personne s'y connecte : l'abonnement la suit.
select tests.ok(abonner_push('https://push.test/appareil-1', 'cle-2', 'auth-2', 'Téléphone de test') is not null, 'bénévole : reprend l''appareil');
select tests.ok((select count(*) from abonnements_push where endpoint = 'https://push.test/appareil-1') = 1, 'bénévole : l''abonnement est maintenant le sien');
delete from abonnements_push where endpoint = 'https://push.test/appareil-1';
select tests.ok((select count(*) from abonnements_push where endpoint like 'https://push.test/%') = 0, 'bénévole : se désabonne');
reset role;
select tests.ok((select count(*) from abonnements_push where endpoint like 'https://push.test/%') = 0, 'un seul abonnement par appareil : rien ne reste chez le premier');

select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select count(*) from abonnements_push$$, '42501'), 'anonyme : table fermée');
select tests.ok(tests.refuse($$select abonner_push('https://push.test/anon', 'a', 'b')$$, '42501'), 'anonyme : ne s''abonne pas');
reset role;
delete from abonnements_push where endpoint like 'https://push.test/%';
\echo '=== 170 OK'
