-- 155 — profil de sécurité de l'organisation : qui lit, qui écrit.
set client_min_messages = notice;
\echo '=== 155 : profil de sécurité'
-- Rejouable : on repart d'un profil vide pour l'organisation A.
delete from organisations_profil_securite where organisation_id = '00000000-0000-0000-0000-0000000000aa';

-- Anonyme : rien.
select tests.anonyme(); set role anon;
select tests.ok(tests.refuse($$select * from organisations_profil_securite$$, '42501'), 'anonyme : lecture refusée');
select tests.ok(tests.refuse($$select * from mes_droits_organisation('00000000-0000-0000-0000-0000000000aa')$$, '42501'), 'anonyme : mes_droits_organisation refusée');
reset role;

-- Coordinateur A : gère le profil de A, ne voit pas B.
select tests.connecter('00000000-0000-0000-0000-00000000a001'); set role authenticated;
select tests.ok((select gerer from mes_droits_organisation('00000000-0000-0000-0000-0000000000aa')), 'coord A : gère l''organisation A');
select tests.ok(not (select lire from mes_droits_organisation('00000000-0000-0000-0000-0000000000bb')), 'coord A : ne lit pas l''organisation B');
select tests.ok(array_length(profil_securite_manques('00000000-0000-0000-0000-0000000000aa'), 1) = 6, 'profil vide : 6 manques');
insert into organisations_profil_securite (organisation_id, responsable_legal, assurance_compagnie)
values ('00000000-0000-0000-0000-0000000000aa', 'Jean Dupont', 'Ethias')
on conflict (organisation_id) do update set responsable_legal = excluded.responsable_legal, assurance_compagnie = excluded.assurance_compagnie;
select tests.ok(array_length(profil_securite_manques('00000000-0000-0000-0000-0000000000aa'), 1) = 4, 'profil partiel : 4 manques');
select tests.ok((select created_by from organisations_profil_securite where organisation_id = '00000000-0000-0000-0000-0000000000aa') = '00000000-0000-0000-0000-00000000a001', 'traçabilité : created_by = coord A');
select tests.ok(tests.refuse($$insert into organisations_profil_securite (organisation_id, responsable_legal) values ('00000000-0000-0000-0000-0000000000bb', 'Intrus')$$, '42501'), 'coord A : écriture sur B refusée');
update organisations_profil_securite set responsable_legal_tel = '0470 11 11 11', assurance_police = 'RC-123', securite_nom = 'Marie Martin', securite_tel = '0470 22 22 22'
 where organisation_id = '00000000-0000-0000-0000-0000000000aa';
select tests.ok(coalesce(array_length(profil_securite_manques('00000000-0000-0000-0000-0000000000aa'), 1), 0) = 0, 'profil complet : 0 manque');
reset role;

-- Bénévole A : lit, n'écrit pas.
select tests.connecter('00000000-0000-0000-0000-00000000a002'); set role authenticated;
select tests.ok((select lire and not gerer from mes_droits_organisation('00000000-0000-0000-0000-0000000000aa')), 'bénévole A : lit sans gérer');
select tests.ok((select count(*) from organisations_profil_securite) = 1, 'bénévole A : voit le profil de A');
update organisations_profil_securite set securite_nom = 'X' where organisation_id = '00000000-0000-0000-0000-0000000000aa';
select tests.ok((select securite_nom from organisations_profil_securite where organisation_id = '00000000-0000-0000-0000-0000000000aa') = 'Marie Martin', 'bénévole A : modification sans effet (RLS)');
reset role;

-- Coordinateur B : ne voit pas le profil de A.
select tests.connecter('00000000-0000-0000-0000-00000000b001'); set role authenticated;
select tests.ok((select count(*) from organisations_profil_securite) = 0, 'coord B : ne voit pas le profil de A');
reset role;

-- Exploitant : lit et gère tout.
select tests.connecter('00000000-0000-0000-0000-00000000e001'); set role authenticated;
select tests.ok((select lire and gerer from mes_droits_organisation('00000000-0000-0000-0000-0000000000bb')), 'exploitant : gère B');
reset role;
\echo '=== 155 OK'
