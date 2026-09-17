-- =====================================================================
-- VÉRIFICATIONS DE DROITS — à rejouer avant chaque déploiement
--
-- Tout se passe dans une transaction annulée à la fin : le fichier
-- n'écrit rien de durable, même quand il crée ou supprime des lignes
-- pour éprouver une policy. On peut le lancer sur la base de
-- production sans rien risquer.
--
-- Chaque vérification est isolée dans son propre bloc d'exception :
-- une qui échoue n'empêche pas les suivantes de s'exécuter. Le résultat
-- est une grille — OK, ÉCHEC, ou ERREUR avec le message Postgres.
--
-- Les identités et les événements sont résolus par leur nom, pas par
-- UUID : le fichier survit à un jeu de données qui change. Ce qui
-- manque est signalé IGNORÉ plutôt que compté comme réussi.
--
-- Pourquoi ce fichier existe : deux défauts vieux de plusieurs semaines
-- ont été découverts le 15/09/2026 en cliquant au hasard — la veille
-- météo absente de tout nouvel événement, et la suppression logique
-- impossible sur 34 tables. Les deux auraient été pris ici en trois
-- secondes.
-- =====================================================================

begin;

create temp table verif (
  n         serial,
  bloc      text,
  intitule  text,
  resultat  text
) on commit drop;

-- Les blocs ci-dessous prennent l'identité d'un utilisateur applicatif
-- pour éprouver les policies. Sans ce grant, ils ne peuvent pas écrire
-- leur propre résultat : « permission denied for table verif ».
grant select, insert on verif to authenticated;
grant usage on sequence verif_n_seq to authenticated;

do $$
declare
  v_ren        uuid;   -- coordinateur sur BFMF2027, observateur ailleurs
  v_benevole   uuid;   -- bénévole sur Rando VTT, étranger à BFMF2027
  v_bfmf       uuid;
  v_autre      uuid;   -- événement dont v_ren n'est pas membre
  v_fete       uuid;   -- événement où v_ren est observateur
  v_jalon      uuid;
  v_equipe     uuid;
  v_chef       uuid;   -- chef d'équipe : un rôle SANS tout_pouvoir
  v_rando      uuid;
  v_n          integer;
  v_bool       boolean;
  -- Prend l'identité d'un utilisateur applicatif : rôle `authenticated`
  -- et claims JWT, exactement ce que PostgREST installe.
  v_phase      phase_evenement;
begin
  select user_id into v_ren
  from membres_evenement m join evenements e on e.id = m.evenement_id
  where e.nom = 'BFMF2027' and m.role = 'coordinateur' and m.deleted_at is null
  limit 1;

  select m.user_id into v_benevole
  from membres_evenement m join evenements e on e.id = m.evenement_id
  where e.nom = 'Rando VTT' and m.role = 'benevole' and m.deleted_at is null
  limit 1;

  select id into v_bfmf from evenements where nom = 'BFMF2027' limit 1;
  select id into v_rando from evenements where nom = 'Rando VTT' limit 1;

  select m.user_id into v_chef
  from membres_evenement m
  where m.evenement_id = v_rando and m.role = 'chef_equipe' and m.deleted_at is null
  limit 1;
  select id into v_fete from evenements where nom = 'Fête du Vin' limit 1;

  select e.id into v_autre
  from evenements e
  where not exists (
    select 1 from membres_evenement m
    where m.evenement_id = e.id and m.user_id = v_ren and m.deleted_at is null
  )
  limit 1;

  -- ------------------------------------------------------------------
  -- BLOC A — socle
  -- ------------------------------------------------------------------
  begin
    select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
    insert into verif (bloc, intitule, resultat) values
      ('A. Socle', 'Toutes les tables publiques ont RLS activée',
       case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' table(s) sans RLS' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('A. Socle', 'RLS activée partout', 'ERREUR : ' || sqlerrm);
  end;

  begin
    select count(*) into v_n
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
    insert into verif (bloc, intitule, resultat) values
      ('A. Socle', 'Aucune table avec RLS mais sans policy',
       case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' table(s) muette(s)' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('A. Socle', 'Tables sans policy', 'ERREUR : ' || sqlerrm);
  end;

  begin
    select count(*) into v_n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'));
    insert into verif (bloc, intitule, resultat) values
      ('A. Socle', 'Toutes les fonctions ont un search_path figé',
       case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' fonction(s)' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('A. Socle', 'search_path figé', 'ERREUR : ' || sqlerrm);
  end;

  begin
    select count(*) into v_n
    from information_schema.role_routine_grants
    where routine_schema = 'public' and grantee = 'anon' and privilege_type = 'EXECUTE';
    insert into verif (bloc, intitule, resultat) values
      ('A. Socle', 'La surface anonyme se limite aux 6 RPC publiques',
       case when v_n = 6 then 'OK' else 'ÉCHEC : ' || v_n || ' fonction(s) ouvertes à anon' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('A. Socle', 'Surface anonyme', 'ERREUR : ' || sqlerrm);
  end;

  -- ------------------------------------------------------------------
  -- BLOC B — étanchéité entre événements
  -- ------------------------------------------------------------------
  if v_ren is null or v_autre is null then
    insert into verif (bloc, intitule, resultat)
      values ('B. Étanchéité', 'Cloisonnement multi-tenant', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      select count(*) into v_n from jalons where evenement_id = v_autre;
      insert into verif (bloc, intitule, resultat) values
        ('B. Étanchéité', 'Aucun jalon visible sur un événement dont on n''est pas membre',
         case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' ligne(s) visibles' end);

      select count(*) into v_n from lieux where evenement_id = v_autre;
      insert into verif (bloc, intitule, resultat) values
        ('B. Étanchéité', 'Aucun lieu visible sur un événement étranger',
         case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' ligne(s) visibles' end);

      select a_permission(v_autre, 'referentiels', 'lire') into v_bool;
      insert into verif (bloc, intitule, resultat) values
        ('B. Étanchéité', 'a_permission refuse un non-membre',
         case when v_bool is not true then 'OK' else 'ÉCHEC : permission accordée' end);

      execute 'reset role';
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('B. Étanchéité', 'Cloisonnement', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC C — rôles
  -- ------------------------------------------------------------------
  if v_benevole is null then
    insert into verif (bloc, intitule, resultat)
      values ('C. Rôles', 'Droits du bénévole', 'IGNORÉ : aucun bénévole dans le jeu de test');
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_benevole, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      select id into v_autre from evenements where nom = 'Rando VTT' limit 1;

      select a_permission(v_autre, 'referentiels', 'creer') into v_bool;
      insert into verif (bloc, intitule, resultat) values
        ('C. Rôles', 'Un bénévole ne crée pas de référentiel',
         case when v_bool is not true then 'OK' else 'ÉCHEC : permission accordée' end);

      select a_permission(v_autre, 'sos', 'lire') into v_bool;
      insert into verif (bloc, intitule, resultat) values
        ('C. Rôles', 'Un bénévole lit quand même les signalements',
         case when v_bool then 'OK' else 'ÉCHEC : lecture critique refusée' end);

      execute 'reset role';
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('C. Rôles', 'Droits du bénévole', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  if v_ren is null or v_fete is null then
    insert into verif (bloc, intitule, resultat)
      values ('C. Rôles', 'Droits de l''observateur', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      select a_permission(v_fete, 'referentiels', 'modifier') into v_bool;
      insert into verif (bloc, intitule, resultat) values
        ('C. Rôles', 'Un observateur ne modifie rien',
         case when v_bool is not true then 'OK' else 'ÉCHEC : écriture accordée' end);

      execute 'reset role';
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('C. Rôles', 'Droits de l''observateur', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC D — phases
  -- La phase est modifiée puis annulée avec la transaction.
  -- ------------------------------------------------------------------
  if v_ren is null or v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('D. Phases', 'Droits par phase', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      select phase into v_phase from evenements where id = v_bfmf;

      update evenements set phase = 'exploitation' where id = v_bfmf;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select a_permission(v_bfmf, 'rh', 'modifier') into v_bool;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('D. Phases', 'En exploitation, le coordinateur écrit le RH',
         case when v_bool then 'OK' else 'ÉCHEC : écriture refusée' end);

      -- Règle R1 de a_permission : un rôle marqué `tout_pouvoir` répond
      -- vrai avant même que la phase soit consultée. Le coordinateur le
      -- porte, donc AUCUNE restriction de phase ne s'applique à lui.
      -- L'assertion fige ce comportement plutôt que de le déplorer : si
      -- elle casse un jour, c'est que R1 a changé, et il faudra le
      -- savoir — la moitié des écrans en dépend.
      update evenements set phase = 'cloture' where id = v_bfmf;
      execute 'set local role authenticated';
      select a_permission(v_bfmf, 'referentiels', 'supprimer') into v_bool;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('D. Phases', 'Le rôle à tout pouvoir n''est pas limité par la phase (R1)',
         case when v_bool then 'OK' else 'ÉCHEC : R1 ne s''applique plus' end);

      update evenements set phase = v_phase where id = v_bfmf;

      update evenements set phase = v_phase where id = v_bfmf;
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('D. Phases', 'Droits par phase', 'ERREUR : ' || sqlerrm);
    end;

    -- La phase ne mord que sur les rôles ordinaires. C'est celle-là qui
    -- vérifie vraiment que le mécanisme fonctionne.
    if v_chef is null or v_rando is null then
      insert into verif (bloc, intitule, resultat)
        values ('D. Phases', 'Phase opposable à un chef d''équipe', 'IGNORÉ : aucun chef d''équipe');
    else
      begin
        select phase into v_phase from evenements where id = v_rando;
        update evenements set phase = 'cloture' where id = v_rando;

        perform set_config('request.jwt.claims',
          json_build_object('sub', v_chef, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        select a_permission(v_rando, 'referentiels', 'creer') into v_bool;
        execute 'reset role';
        insert into verif (bloc, intitule, resultat) values
          ('D. Phases', 'En clôture, un chef d''équipe ne crée plus de référentiel',
           case when v_bool is not true then 'OK' else 'ÉCHEC : écriture encore ouverte' end);

        update evenements set phase = v_phase where id = v_rando;
      exception when others then
        execute 'reset role';
        insert into verif (bloc, intitule, resultat)
          values ('D. Phases', 'Phase opposable', 'ERREUR : ' || sqlerrm);
      end;
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC E — suppression logique (le défaut du 15/09)
  -- ------------------------------------------------------------------
  if v_ren is null or v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('E. Suppression', 'Suppression logique', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      select id into v_jalon from jalons
      where evenement_id = v_bfmf and deleted_at is null limit 1;

      if v_jalon is null then
        insert into verif (bloc, intitule, resultat)
          values ('E. Suppression', 'Suppression logique', 'IGNORÉ : aucun jalon à supprimer');
      else
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';

        select supprimer_logiquement('jalons', v_jalon) into v_bool;
        insert into verif (bloc, intitule, resultat) values
          ('E. Suppression', 'Un jalon peut être supprimé logiquement',
           case when v_bool then 'OK' else 'ÉCHEC : la fonction a renvoyé faux' end);

        select count(*) into v_n from jalons where id = v_jalon;
        insert into verif (bloc, intitule, resultat) values
          ('E. Suppression', 'La ligne supprimée sort des écrans',
           case when v_n = 0 then 'OK' else 'ÉCHEC : encore visible' end);

        execute 'reset role';
      end if;
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('E. Suppression', 'Suppression logique d''un jalon', 'ERREUR : ' || sqlerrm);
    end;

    begin
      select id into v_equipe from equipes
      where evenement_id = v_bfmf and deleted_at is null limit 1;
      if v_equipe is null then
        insert into verif (bloc, intitule, resultat)
          values ('E. Suppression', 'Suppression logique d''une équipe', 'IGNORÉ : aucune équipe');
      else
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        select supprimer_logiquement('equipes', v_equipe) into v_bool;
        execute 'reset role';
        insert into verif (bloc, intitule, resultat) values
          ('E. Suppression', 'Une équipe aussi peut être supprimée logiquement',
           case when v_bool then 'OK' else 'ÉCHEC' end);
      end if;
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('E. Suppression', 'Suppression d''une équipe', 'ERREUR : ' || sqlerrm);
    end;

    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        select supprimer_logiquement('journal', gen_random_uuid()) into v_bool;
        insert into verif (bloc, intitule, resultat)
          values ('E. Suppression', 'Une table hors liste blanche est refusée', 'ÉCHEC : acceptée');
      exception when others then
        insert into verif (bloc, intitule, resultat)
          values ('E. Suppression', 'Une table hors liste blanche est refusée', 'OK');
      end;
      execute 'reset role';
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('E. Suppression', 'Liste blanche', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC F — journal (le durcissement 037)
  -- ------------------------------------------------------------------
  if v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('F. Journal', 'Garde-fou du journal', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        perform journaliser(v_bfmf, 'test', 'test', 'tentative depuis un non-membre');
        insert into verif (bloc, intitule, resultat)
          values ('F. Journal', 'Un non-membre ne peut pas écrire au journal', 'ÉCHEC : écriture acceptée');
      exception when others then
        insert into verif (bloc, intitule, resultat)
          values ('F. Journal', 'Un non-membre ne peut pas écrire au journal', 'OK');
      end;
      execute 'reset role';

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        perform journaliser(v_bfmf, 'test', 'test', 'tentative depuis un membre');
        insert into verif (bloc, intitule, resultat)
          values ('F. Journal', 'Un membre écrit toujours au journal', 'OK');
      exception when others then
        insert into verif (bloc, intitule, resultat)
          values ('F. Journal', 'Un membre écrit toujours au journal', 'ÉCHEC : ' || sqlerrm);
      end;
      execute 'reset role';
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('F. Journal', 'Garde-fou du journal', 'ERREUR : ' || sqlerrm);
    end;
  end if;


  -- ------------------------------------------------------------------
  -- BLOC H — stockage (041)
  -- ------------------------------------------------------------------
  begin
    -- Une policy de lecture qui ne mentionne ni événement ni membre est
    -- une lecture large : c'est par là que les documents réglementaires
    -- d'un client fuyaient vers un autre.
    select count(*) into v_n
    from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polcmd = 'r'
      and pg_get_expr(polqual, polrelid) not like '%evenement%'
      and pg_get_expr(polqual, polrelid) not like '%membre%';
    insert into verif (bloc, intitule, resultat) values
      ('H. Stockage', 'Aucune policy de lecture large sur le stockage',
       case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' policy(ies)' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('H. Stockage', 'Lecture du stockage', 'ERREUR : ' || sqlerrm);
  end;

  begin
    select count(*) into v_n
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in ('supprimer_logiquement', 'appartient_organisation')
      and grantee = 'anon';
    insert into verif (bloc, intitule, resultat) values
      ('H. Stockage', 'Les fonctions de service restent fermées à anon',
       case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' ouverture(s)' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('H. Stockage', 'Fonctions de service', 'ERREUR : ' || sqlerrm);
  end;

  -- ------------------------------------------------------------------
  -- BLOC I — lien groupe de travail / équipe (043)
  -- ------------------------------------------------------------------
  begin
    select count(*) into v_n from pg_indexes
    where indexname = 'equipes_groupe_travail_unique';
    insert into verif (bloc, intitule, resultat) values
      ('I. Liens', 'Une seule équipe par groupe de travail',
       case when v_n = 1 then 'OK' else 'ÉCHEC : index unique absent' end);

    select count(*) into v_n from pg_trigger
    where tgrelid = 'public.groupes_travail'::regclass
      and tgname = 'nom_groupe_vers_equipe' and not tgisinternal;
    insert into verif (bloc, intitule, resultat) values
      ('I. Liens', 'Le nom du groupe se propage à son équipe',
       case when v_n = 1 then 'OK' else 'ÉCHEC : trigger absent' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('I. Liens', 'Lien groupe / équipe', 'ERREUR : ' || sqlerrm);
  end;

  -- ------------------------------------------------------------------
  -- BLOC G — dotation d'un événement (le défaut météo du 15/09)
  -- ------------------------------------------------------------------
  begin
    select count(*) into v_n
    from evenements e
    left join veille_meteo v on v.evenement_id = e.id
    where v.evenement_id is null and e.deleted_at is null;
    insert into verif (bloc, intitule, resultat) values
      ('G. Dotation', 'Chaque événement a ses seuils de veille météo',
       case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' événement(s) sans seuils' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('G. Dotation', 'Seuils de veille météo', 'ERREUR : ' || sqlerrm);
  end;

  begin
    select count(*) into v_n from pg_trigger
    where tgrelid = 'public.evenements'::regclass
      and tgname = 'veille_nouvel_evenement' and not tgisinternal;
    insert into verif (bloc, intitule, resultat) values
      ('G. Dotation', 'Un nouvel événement recevra ses seuils automatiquement',
       case when v_n = 1 then 'OK' else 'ÉCHEC : trigger absent' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('G. Dotation', 'Trigger de dotation', 'ERREUR : ' || sqlerrm);
  end;

end
$$;

select n, bloc, intitule, resultat from verif order by n;

rollback;
