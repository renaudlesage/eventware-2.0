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
  v_texte      text;   -- libellé interne d'un jalon, pour vérifier qu'il ne sort pas
  v_json       jsonb;  -- ce que la vitrine publique renvoie réellement
  v_copie      uuid;   -- l'événement produit par la reconduction (bloc K)
  v_membre_ben uuid;   -- ligne membres_evenement du bénévole de Rando VTT (bloc M)
  v_autre_memb uuid;   -- un autre membre de Rando VTT (bloc M)
  v_mission    uuid;
  v_jeton      uuid;   -- lien autorité créé pour le bloc N
  v_etat       text;
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

  select m.id into v_membre_ben from membres_evenement m
  where m.evenement_id = v_rando and m.user_id = v_benevole and m.deleted_at is null limit 1;
  select m.id into v_autre_memb from membres_evenement m
  where m.evenement_id = v_rando and m.id <> v_membre_ben and m.deleted_at is null limit 1;

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

  -- Une policy qui teste une ressource inconnue de la matrice répond
  -- toujours faux, sauf pour un rôle tout_pouvoir : le défaut est
  -- invisible en coordinateur et bloquant pour tous les autres (103).
  begin
    select count(*) into v_n
    from pg_policies p,
         regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                        'a_permission\([^,]+, ''([a-z_]+)''', 'g') m
    where p.schemaname = 'public'
      and m[1] not in (select distinct ressource from role_capacites);
    insert into verif (bloc, intitule, resultat) values
      ('A. Socle', 'Toute policy ne cite que des ressources de la matrice',
       case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' occurrence(s) d''une ressource inconnue' end);
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('A. Socle', 'Ressources des policies', 'ERREUR : ' || sqlerrm);
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
  -- BLOC F — journal (le durcissement 088)
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
  -- BLOC H — stockage (092)
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
  -- BLOC I — lien groupe de travail / équipe (094)
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
  -- BLOC J — visibilité des jalons (099)
  --
  -- Ces deux-là gardent la porte du public. La première vérifie qu'on
  -- ne peut pas publier un jalon sous son libellé interne ; la seconde,
  -- qu'un jalon réservé à la coordination ne fuit pas dans la vitrine.
  -- ------------------------------------------------------------------
  begin
    select count(*) into v_n from pg_constraint
    where conrelid = 'public.jalons'::regclass
      and conname = 'jalons_public_exige_libelle';
    insert into verif (bloc, intitule, resultat) values
      ('J. Jalons', 'Publier un jalon exige un libellé public',
       case when v_n = 1 then 'OK' else 'ÉCHEC : contrainte absente' end);

    -- Éprouvé par le comportement, pas en relisant le source : une
    -- assertion qui cherche un motif dans le texte de la fonction passe
    -- au vert pour une virgule et au rouge pour un espace. On publie
    -- donc réellement un jalon, on appelle la vitrine, et on vérifie
    -- que le libellé interne n'en sort pas. La transaction est annulée
    -- à la fin du fichier : rien ne reste.
    if v_bfmf is null then
      insert into verif (bloc, intitule, resultat)
        values ('J. Jalons', 'La vitrine ne sert que le libellé public', 'IGNORÉ : jeu de test incomplet');
    else
      select id, libelle into v_jalon, v_texte from jalons
      where evenement_id = v_bfmf and deleted_at is null limit 1;

      if v_jalon is null then
        insert into verif (bloc, intitule, resultat)
          values ('J. Jalons', 'La vitrine ne sert que le libellé public', 'IGNORÉ : aucun jalon');
      else
        update jalons
           set visibilite = 'public', libelle_public = 'Ouverture du site'
         where id = v_jalon;

        select contenu_public(jeton_public) into v_json
        from evenements where id = v_bfmf;

        insert into verif (bloc, intitule, resultat) values
          ('J. Jalons', 'La vitrine ne sert que le libellé public',
           case
             when v_json->'jalons' @> jsonb_build_array(jsonb_build_object('libelle', 'Ouverture du site'))
              and not (v_json::text like '%' || v_texte || '%')
             then 'OK'
             when v_json::text like '%' || v_texte || '%'
             then 'ÉCHEC : le libellé interne est parti au public'
             else 'ÉCHEC : le jalon public n''apparaît pas'
           end);
      end if;
    end if;
  exception when others then
    insert into verif (bloc, intitule, resultat)
      values ('J. Jalons', 'Visibilité des jalons', 'ERREUR : ' || sqlerrm);
  end;

  -- ------------------------------------------------------------------
  -- BLOC K — la reconduction va jusqu'au bout (101)
  --
  -- PL/pgSQL ne vérifie ni les littéraux d'enum ni les colonnes à la
  -- création : une fonction qui traverse quinze tables ne se valide
  -- qu'en la faisant tourner. On reconduit donc réellement BFMF2027,
  -- sous l'identité de son coordinateur, et on regarde ce qui en sort.
  -- Tout est annulé à la fin du fichier.
  -- ------------------------------------------------------------------
  if v_ren is null or v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('K. Reconduction', 'Reconduire un événement', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      select dupliquer_evenement(
        v_bfmf, 'Vérification reconduction',
        'verif-reconduction-' || substr(gen_random_uuid()::text, 1, 8),
        current_date + 300, current_date + 302
      ) into v_copie;

      execute 'reset role';

      insert into verif (bloc, intitule, resultat) values
        ('K. Reconduction', 'La reconduction aboutit et laisse une trace au journal',
         case when exists (select 1 from journal
                           where evenement_id = v_copie and categorie = 'reconduction')
              then 'OK' else 'ÉCHEC : pas de ligne « reconduction » au journal' end);

      select count(*) into v_n from equipes
      where evenement_id = v_bfmf and deleted_at is null;
      select v_n - count(*) into v_n from equipes
      where evenement_id = v_copie and deleted_at is null;
      insert into verif (bloc, intitule, resultat) values
        ('K. Reconduction', 'Toutes les équipes sont reprises, y compris celles liées à un groupe',
         case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' équipe(s) manquante(s)' end);

      select count(*) into v_n from jalons
      where evenement_id = v_copie and deleted_at is null and statut <> 'a_venir';
      insert into verif (bloc, intitule, resultat) values
        ('K. Reconduction', 'Les jalons repartent tous « à venir »',
         case when v_n = 0 then 'OK' else 'ÉCHEC : ' || v_n || ' jalon(s) dans un autre statut' end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('K. Reconduction', 'Reconduire un événement',
                case when sqlstate = '23514' then 'IGNORÉ : quota de licence atteint'
                     else 'ERREUR : ' || sqlerrm end);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC L — les RPC authentifiées vérifient l'appartenance (104, 106)
  --
  -- Un bénévole de Rando VTT interroge BFMF2027, dont il n'est pas
  -- membre : chaque fonction doit refuser (42501). Le coordinateur de
  -- BFMF2027, lui, obtient ses données — la vérification ne doit pas
  -- gêner l'usage normal, ni la création d'un événement, dont le
  -- trigger appelle une fonction désormais révoquée.
  -- ------------------------------------------------------------------
  if v_benevole is null or v_bfmf is null or v_ren is null then
    insert into verif (bloc, intitule, resultat)
      values ('L. RPC', 'Contrôle d''appartenance', 'IGNORÉ : jeu de test incomplet');
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_benevole, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_etat := '';
    begin
      perform * from chauffeurs_disponibles(v_bfmf);
      v_etat := v_etat || 'chauffeurs_disponibles ';
    exception when others then if sqlstate <> '42501' then v_etat := v_etat || 'chauffeurs_disponibles(' || sqlstate || ') '; end if; end;
    begin
      perform * from groupes_sans_nouvelles(v_bfmf);
      v_etat := v_etat || 'groupes_sans_nouvelles ';
    exception when others then if sqlstate <> '42501' then v_etat := v_etat || 'groupes_sans_nouvelles(' || sqlstate || ') '; end if; end;
    begin
      perform jauge_courante(v_bfmf);
      v_etat := v_etat || 'jauge_courante ';
    exception when others then if sqlstate <> '42501' then v_etat := v_etat || 'jauge_courante(' || sqlstate || ') '; end if; end;
    begin
      perform * from couverture_creneaux(v_bfmf);
      v_etat := v_etat || 'couverture_creneaux ';
    exception when others then if sqlstate <> '42501' then v_etat := v_etat || 'couverture_creneaux(' || sqlstate || ') '; end if; end;
    begin
      perform * from flux_parcours(v_bfmf);
      v_etat := v_etat || 'flux_parcours ';
    exception when others then if sqlstate <> '42501' then v_etat := v_etat || 'flux_parcours(' || sqlstate || ') '; end if; end;
    begin
      perform demarrer_controle(v_bfmf, 'x');
      v_etat := v_etat || 'demarrer_controle ';
    exception when others then if sqlstate <> '42501' then v_etat := v_etat || 'demarrer_controle(' || sqlstate || ') '; end if; end;
    execute 'reset role';

    insert into verif (bloc, intitule, resultat) values
      ('L. RPC', 'Un non-membre est refusé par les six RPC (42501)',
       case when v_etat = '' then 'OK' else 'ÉCHEC : ' || v_etat end);

    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform * from chauffeurs_disponibles(v_bfmf);
      perform * from groupes_sans_nouvelles(v_bfmf);
      perform jauge_courante(v_bfmf);
      perform situation(v_bfmf);
      insert into evenements (nom, slug)
        values ('Vérification 104', 'verif-104-' || substr(gen_random_uuid()::text, 1, 8))
        returning id into v_copie;
      select count(*) into v_n from roles where evenement_id = v_copie;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('L. RPC', 'Le coordinateur garde ses RPC, et créer un événement installe toujours ses rôles',
         case when v_n > 0 then 'OK' else 'ÉCHEC : aucun rôle installé' end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('L. RPC', 'Usage normal par un membre', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC M — un bénévole prend une mission ouverte (105)
  -- ------------------------------------------------------------------
  if v_benevole is null or v_membre_ben is null or v_rando is null then
    insert into verif (bloc, intitule, resultat)
      values ('M. Missions', 'Prise de mission', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      insert into missions (evenement_id, reference, titre, statut)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'Mission de vérification', 'a_traiter')
        returning id into v_mission;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_benevole, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      update missions set statut = 'attribuee', membre_id = v_membre_ben where id = v_mission;
      get diagnostics v_n = row_count;
      insert into verif (bloc, intitule, resultat) values
        ('M. Missions', 'Un bénévole peut prendre une mission sans titulaire',
         case when v_n = 1 then 'OK' else 'ÉCHEC : ' || v_n || ' ligne(s) modifiée(s)' end);

      v_etat := 'passée';
      begin
        update missions set membre_id = v_autre_memb where id = v_mission;
        get diagnostics v_n = row_count;
        if v_n = 0 then v_etat := 'refusée'; end if;
      exception when others then
        if sqlstate = '42501' then v_etat := 'refusée'; else v_etat := sqlstate; end if;
      end;
      insert into verif (bloc, intitule, resultat) values
        ('M. Missions', 'Il ne peut pas la donner à quelqu''un d''autre',
         case when v_etat = 'refusée' then 'OK' else 'ÉCHEC : réattribution ' || v_etat end);

      update missions set statut = 'resolue' where id = v_mission;
      get diagnostics v_n = row_count;
      insert into verif (bloc, intitule, resultat) values
        ('M. Missions', 'Il peut clôturer la sienne',
         case when v_n = 1 then 'OK' else 'ÉCHEC : ' || v_n || ' ligne(s)' end);

      execute 'reset role';
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('M. Missions', 'Prise de mission', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC N — le lien autorité ne nomme personne (106)
  --
  -- Le coordinateur émet un MAYDAY ; la page autorité, consultée sans
  -- compte, ne doit pas en montrer l'alerte (nom et position de
  -- l'intervenant) mais doit compter un intervenant en difficulté.
  -- ------------------------------------------------------------------
  if v_ren is null or v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('N. Autorité', 'Mayday et lien autorité', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform emettre_mayday(v_bfmf, 'vérification', 50.4, 5.6, 10);
      execute 'reset role';

      insert into acces_autorite (evenement_id, libelle)
        values (v_bfmf, 'Vérification') returning jeton into v_jeton;

      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      execute 'set local role anon';
      select situation_autorite(v_jeton) into v_json;
      execute 'reset role';

      insert into verif (bloc, intitule, resultat) values
        ('N. Autorité', 'L''alerte MAYDAY ne sort pas sur le lien autorité',
         case when (v_json->'alertes')::text ilike '%mayday%'
              then 'ÉCHEC : le MAYDAY est dans les alertes' else 'OK' end);
      insert into verif (bloc, intitule, resultat) values
        ('N. Autorité', 'Mais l''autorité sait qu''un intervenant est en difficulté',
         case when (v_json->'activite'->>'maydays_en_cours')::int >= 1
              then 'OK' else 'ÉCHEC : maydays_en_cours = ' || coalesce(v_json->'activite'->>'maydays_en_cours', 'absent') end);
      insert into verif (bloc, intitule, resultat) values
        ('N. Autorité', 'Le lien autorité fonctionne sans compte après la 106',
         case when v_json ? 'public' and v_json->'public' ? 'jauge' then 'OK' else 'ÉCHEC : bloc public absent' end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('N. Autorité', 'Mayday et lien autorité', 'ERREUR : ' || sqlerrm);
    end;
  end if;

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
