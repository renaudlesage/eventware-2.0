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
  v_exploitant uuid;   -- un compte plateforme de niveau exploitant (bloc P)
  v_membre_ex  uuid;   -- sa ligne membres_evenement sur BFMF2027 (bloc P)
  v_code_inv   text;   -- code d'invitation créé pour le bloc P
  v_transport  uuid;   -- transports du bloc R
  v_transport2 uuid;
  v_groupe     uuid;   -- groupe de travail du bloc S
  v_membre_gt  uuid;   -- un membre rattaché à ce groupe (bloc S)
  v_json_op    jsonb;  -- page autorité au niveau opérationnel (bloc U)
  v_jeton_op   uuid;
  v_contact    uuid;   -- contact de l'annuaire (bloc U)
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

  select user_id into v_exploitant from membres_plateforme
  where actif and niveau = 'exploitant' limit 1;

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
  -- BLOC O — un logo existant se remplace (107.1)
  --
  -- `upsert` sur le stockage = INSERT … ON CONFLICT DO UPDATE : la
  -- ligne existante doit être VISIBLE de celui qui remplace. Sans
  -- policy de lecture sur le bucket, le premier envoi passait et le
  -- second échouait (42501). On envoie donc deux fois le même chemin.
  -- ------------------------------------------------------------------
  if v_ren is null or v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('O. Logo', 'Remplacement d''un logo', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
        values ('logos', v_bfmf || '/verif-107.png', v_ren, v_ren::text, '{"v":1}'::jsonb);
      insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
        values ('logos', v_bfmf || '/verif-107.png', v_ren, v_ren::text, '{"v":2}'::jsonb)
        on conflict (name, bucket_id) do update set metadata = excluded.metadata;
      execute 'reset role';
      select count(*) into v_n from storage.objects
      where bucket_id = 'logos' and name = v_bfmf || '/verif-107.png' and metadata->>'v' = '2';
      insert into verif (bloc, intitule, resultat) values
        ('O. Logo', 'Le coordinateur remplace un logo déjà en place (upsert)',
         case when v_n = 1 then 'OK' else 'ÉCHEC : l''objet n''a pas été remplacé' end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('O. Logo', 'Remplacement d''un logo', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC P — retiré, on peut revenir (107.2)
  --
  -- Deux chemins : l'exploitant se rattache lui-même après avoir été
  -- retiré ; un membre retiré revient par un code d'invitation. Dans
  -- les deux cas la ligne retirée doit revivre, pas être doublée.
  -- ------------------------------------------------------------------
  if v_exploitant is null or v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('P. Retour', 'Retour de l''exploitant', 'IGNORÉ : aucun exploitant');
  else
    begin
      select id into v_membre_ex from membres_evenement
      where evenement_id = v_bfmf and user_id = v_exploitant and deleted_at is null;
      if v_membre_ex is null then
        insert into verif (bloc, intitule, resultat)
          values ('P. Retour', 'Retour de l''exploitant', 'IGNORÉ : l''exploitant n''est pas membre de BFMF2027');
      else
        update membres_evenement set deleted_at = now() where id = v_membre_ex;

        perform set_config('request.jwt.claims',
          json_build_object('sub', v_exploitant, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        perform rejoindre_evenement(v_bfmf, 'coordinateur');
        execute 'reset role';

        select count(*) into v_n from membres_evenement
        where evenement_id = v_bfmf and user_id = v_exploitant and deleted_at is null and actif;
        insert into verif (bloc, intitule, resultat) values
          ('P. Retour', 'L''exploitant retiré revient, sur sa ligne d''origine, sans doublon',
           case when v_n = 1 then 'OK' else 'ÉCHEC : ' || v_n || ' ligne(s) vivante(s)' end);
      end if;
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('P. Retour', 'Retour de l''exploitant', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  if v_benevole is null or v_membre_ben is null or v_rando is null then
    insert into verif (bloc, intitule, resultat)
      values ('P. Retour', 'Retour par code d''invitation', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      update membres_evenement set deleted_at = now() where id = v_membre_ben;
      v_code_inv := 'VERIF' || substr(gen_random_uuid()::text, 1, 5);
      insert into invitations (evenement_id, code, libelle, role_id)
        values (v_rando, v_code_inv, 'Vérification 107',
                (select id from roles where evenement_id = v_rando and code = 'benevole' and deleted_at is null limit 1));

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_benevole, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select deja_membre into v_bool from rejoindre_evenement(v_code_inv);
      execute 'reset role';

      select count(*) into v_n from membres_evenement
      where evenement_id = v_rando and user_id = v_benevole and deleted_at is null and actif;
      insert into verif (bloc, intitule, resultat) values
        ('P. Retour', 'Un membre retiré revient par un code d''invitation',
         case when v_n = 1 and v_bool = false then 'OK'
              else 'ÉCHEC : ' || v_n || ' ligne(s) vivante(s), deja_membre = ' || coalesce(v_bool::text, 'null') end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('P. Retour', 'Retour par code d''invitation', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC Q — « coordination » est réservée à l'encadrement (107.3)
  -- ------------------------------------------------------------------
  if v_chef is null or v_rando is null then
    insert into verif (bloc, intitule, resultat)
      values ('Q. Coordination', 'Visibilité coordination', 'IGNORÉ : pas de chef d''équipe sur Rando VTT');
  else
    begin
      insert into jalons (evenement_id, code, libelle, visibilite)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'Action réservée', 'coordination')
        returning id into v_jalon;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_chef, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_n from jalons where id = v_jalon;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('Q. Coordination', 'Un chef d''équipe (rh:modifier, sans tout pouvoir) ne voit pas une action « coordination »',
         case when v_n = 0 then 'OK' else 'ÉCHEC : l''action est visible' end);

      perform set_config('request.jwt.claims',
        json_build_object('sub', (select user_id from membres_evenement
                                  where evenement_id = v_rando and role = 'coordinateur'
                                    and deleted_at is null limit 1),
                          'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_n from jalons where id = v_jalon;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('Q. Coordination', 'Le coordinateur la voit',
         case when v_n = 1 then 'OK' else 'ÉCHEC : invisible du coordinateur' end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('Q. Coordination', 'Visibilité coordination', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC R — un chauffeur bénévole prend un transport (107.5) et
  --          mon_terrain dit qui tient chaque ligne (107.4)
  -- ------------------------------------------------------------------
  if v_benevole is null or v_membre_ben is null or v_rando is null or v_autre_memb is null then
    insert into verif (bloc, intitule, resultat)
      values ('R. Transports', 'Prise d''un transport', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      insert into transports (evenement_id, reference, nb_personnes, statut)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 2, 'a_traiter')
        returning id into v_transport;
      insert into transports (evenement_id, reference, nb_personnes, statut, chauffeur_id)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 2, 'attribuee', v_autre_memb)
        returning id into v_transport2;
      insert into missions (evenement_id, reference, titre, statut, membre_id)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'Mission tenue', 'attribuee', v_membre_ben)
        returning id into v_mission;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_benevole, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      update transports set statut = 'attribuee', chauffeur_id = v_membre_ben where id = v_transport;
      get diagnostics v_n = row_count;
      insert into verif (bloc, intitule, resultat) values
        ('R. Transports', 'Un bénévole (missions:modifier) prend un transport sans chauffeur',
         case when v_n = 1 then 'OK' else 'ÉCHEC : ' || v_n || ' ligne(s)' end);

      v_etat := 'passée';
      begin
        update transports set chauffeur_id = v_membre_ben where id = v_transport2;
        get diagnostics v_n = row_count;
        if v_n = 0 then v_etat := 'refusée'; end if;
      exception when others then
        if sqlstate = '42501' then v_etat := 'refusée'; else v_etat := sqlstate; end if;
      end;
      -- Avec `logistique:modifier` (matrice standard actuelle du
      -- bénévole) la réattribution passe par le premier chemin de la
      -- policy : le refus n'est attendu qu'une fois la 108 appliquée.
      select a_permission(v_rando, 'logistique', 'modifier') into v_bool;
      insert into verif (bloc, intitule, resultat) values
        ('R. Transports', 'Il ne reprend pas le transport d''un autre chauffeur',
         case when v_etat = 'refusée' then 'OK'
              when v_bool then 'IGNORÉ : ce bénévole détient logistique:modifier (matrice de l''événement)'
              else 'ÉCHEC : réattribution ' || v_etat end);

      select titulaire into v_texte from mon_terrain(v_rando) where id = v_mission;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('R. Transports', 'mon_terrain renvoie le titulaire d''une ligne tenue',
         case when v_texte is not null then 'OK' else 'ÉCHEC : titulaire null' end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('R. Transports', 'Prise d''un transport', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC S — reprendre un groupe de travail comme équipe (107.8)
  -- ------------------------------------------------------------------
  if v_ren is null or v_bfmf is null then
    insert into verif (bloc, intitule, resultat)
      values ('S. Groupe → équipe', 'Reprise d''un groupe', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      insert into groupes_travail (evenement_id, nom, objet, ordre)
        values (v_bfmf, 'Vérification bar & co', 'Vérification 107', 99)
        returning id into v_groupe;
      select id into v_membre_gt from membres_evenement
      where evenement_id = v_bfmf and deleted_at is null and equipe_id is null limit 1;
      if v_membre_gt is not null then
        insert into membres_groupe_travail (groupe_id, membre_id) values (v_groupe, v_membre_gt);
      end if;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select reprendre_groupe_comme_equipe(v_groupe) into v_json;
      execute 'reset role';

      select count(*) into v_n from equipes
      where groupe_travail_id = v_groupe and deleted_at is null and nom = 'Vérification bar & co';
      insert into verif (bloc, intitule, resultat) values
        ('S. Groupe → équipe', 'L''équipe est créée, liée au groupe, avec son nom',
         case when v_n = 1 then 'OK' else 'ÉCHEC : ' || v_n || ' équipe(s)' end);

      insert into verif (bloc, intitule, resultat) values
        ('S. Groupe → équipe', 'Les membres du groupe sans équipe y sont affectés',
         case when v_membre_gt is null then 'IGNORÉ : aucun membre libre pour le test'
              when (v_json->>'membres_affectes')::int >= 1
                   and exists (select 1 from membres_evenement
                               where id = v_membre_gt and equipe_id = (v_json->>'equipe_id')::uuid)
                then 'OK'
              else 'ÉCHEC : ' || v_json::text end);

      -- Idempotence : une seconde reprise rend l'équipe existante.
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_ren, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select reprendre_groupe_comme_equipe(v_groupe) into v_json;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('S. Groupe → équipe', 'Reprendre deux fois ne crée pas deux équipes',
         case when (v_json->>'existait')::boolean then 'OK' else 'ÉCHEC : ' || v_json::text end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('S. Groupe → équipe', 'Reprise d''un groupe', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC T — le responsable d'une action la fait avancer (107.3)
  --
  -- Sans `rh:modifier` (retiré au bénévole standard par la 108), un
  -- bénévole doit encore pouvoir passer « fait » l'action dont il
  -- répond — et pas celle d'un autre.
  -- ------------------------------------------------------------------
  if v_benevole is null or v_membre_ben is null or v_rando is null or v_autre_memb is null then
    insert into verif (bloc, intitule, resultat)
      values ('T. Actions', 'Avancement par le responsable', 'IGNORÉ : jeu de test incomplet');
  else
    begin
      insert into jalons (evenement_id, code, libelle, responsable_membre_id)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'Mon action', v_membre_ben)
        returning id into v_jalon;
      insert into jalons (evenement_id, code, libelle, responsable_membre_id)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'L''action d''un autre', v_autre_memb)
        returning id into v_equipe;   -- variable réemployée : un simple uuid

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_benevole, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      update jalons set statut = 'fait' where id = v_jalon;
      get diagnostics v_n = row_count;
      insert into verif (bloc, intitule, resultat) values
        ('T. Actions', 'Le responsable passe son action « fait »',
         case when v_n = 1 then 'OK' else 'ÉCHEC : ' || v_n || ' ligne(s)' end);

      v_etat := 'passée';
      begin
        update jalons set statut = 'fait' where id = v_equipe;
        get diagnostics v_n = row_count;
        if v_n = 0 then v_etat := 'refusée'; end if;
      exception when others then
        if sqlstate = '42501' then v_etat := 'refusée'; else v_etat := sqlstate; end if;
      end;
      select a_permission(v_rando, 'rh', 'modifier') into v_bool;
      execute 'reset role';
      insert into verif (bloc, intitule, resultat) values
        ('T. Actions', 'Il ne touche pas à l''action d''un autre',
         case when v_etat = 'refusée' then 'OK'
              when v_bool then 'IGNORÉ : ce bénévole détient rh:modifier (matrice de l''événement)'
              else 'ÉCHEC : modification ' || v_etat end);
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('T. Actions', 'Avancement par le responsable', 'ERREUR : ' || sqlerrm);
    end;
  end if;

  -- ------------------------------------------------------------------
  -- BLOC U — la page autorité opérationnelle, et ce qu'elle tait (109)
  --
  -- Un signalement avec description et numéro d'appelant, une recherche
  -- avec le nom de l'enfant et celui de son parent, une mission P1 ;
  -- deux liens, « situation » et « opérationnel », consultés sans
  -- compte. Le premier n'a aucun texte libre ; le second a les
  -- descriptions ; aucun des deux n'a de nom ni de numéro. Un contact
  -- non coché ne sort pas ; coché, il sort. Et un chef d'équipe (sans
  -- tout pouvoir) ne peut pas cocher un contact.
  -- ------------------------------------------------------------------
  if v_rando is null then
    insert into verif (bloc, intitule, resultat)
      values ('U. Autorité 109', 'Niveaux du lien autorité', 'IGNORÉ : Rando VTT absent');
  else
    begin
      insert into signalements (evenement_id, reference, cle_client, type, description, contact, statut, gravite, emis_le)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), gen_random_uuid(), 'malaise',
                'VERIF_DESCRIPTION_MALAISE', 'VERIF_NUMERO_APPELANT', 'recu', 'grave', now());
      insert into recherches (evenement_id, reference, nom, age_approx, description, dernier_lieu,
                              accompagnant_nom, accompagnant_tel, point_regroupement, statut)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'VERIF_NOM_ENFANT', 7,
                'VERIF_SIGNALEMENT_PHYSIQUE', 'buvette', 'VERIF_NOM_PARENT', 'VERIF_TEL_PARENT', 'Accueil', 'en_cours');
      insert into missions (evenement_id, reference, module, titre, description, priorite, statut)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'logistique',
                'VERIF_TITRE_MISSION', 'VERIF_DESC_MISSION', 'P1', 'a_traiter');
      insert into contacts (evenement_id, code, nom, telephone)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'VERIF_CONTACT_CACHE', '0400')
        returning id into v_contact;
      insert into contacts (evenement_id, code, nom, telephone, visible_autorite)
        values (v_rando, 'VERIF-' || substr(gen_random_uuid()::text, 1, 6), 'VERIF_CONTACT_VISIBLE', '0401', true);
      insert into acces_autorite (evenement_id, libelle)
        values (v_rando, 'Vérification situation') returning jeton into v_jeton;
      insert into acces_autorite (evenement_id, libelle, niveau)
        values (v_rando, 'Vérification opérationnel', 'operationnel') returning jeton into v_jeton_op;

      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      execute 'set local role anon';
      select situation_autorite(v_jeton) into v_json;
      select situation_autorite(v_jeton_op) into v_json_op;
      execute 'reset role';

      insert into verif (bloc, intitule, resultat) values
        ('U. Autorité 109', 'Niveau situation : les interventions sont listées une par une',
         case when jsonb_array_length(v_json->'interventions') >= 2 then 'OK'
              else 'ÉCHEC : ' || jsonb_array_length(v_json->'interventions') || ' intervention(s)' end);
      insert into verif (bloc, intitule, resultat) values
        ('U. Autorité 109', 'Niveau situation : aucun texte libre',
         case when v_json::text ~ 'VERIF_(DESCRIPTION|TITRE|DESC_MISSION|SIGNALEMENT)'
              then 'ÉCHEC : un texte libre sort' else 'OK' end);
      insert into verif (bloc, intitule, resultat) values
        ('U. Autorité 109', 'Niveau opérationnel : descriptions et signalement physique présents',
         case when v_json_op::text like '%VERIF_DESCRIPTION_MALAISE%'
               and v_json_op::text like '%VERIF_TITRE_MISSION%'
               and v_json_op::text like '%VERIF_SIGNALEMENT_PHYSIQUE%' then 'OK'
              else 'ÉCHEC : description absente' end);
      insert into verif (bloc, intitule, resultat) values
        ('U. Autorité 109', 'Aucun niveau : nom ou numéro de l''appelant, de l''enfant, du parent',
         case when (v_json::text || v_json_op::text) ~ 'VERIF_(NUMERO_APPELANT|NOM_ENFANT|NOM_PARENT|TEL_PARENT)'
              then 'ÉCHEC : une donnée nominative sort' else 'OK' end);
      insert into verif (bloc, intitule, resultat) values
        ('U. Autorité 109', 'Seuls les contacts cochés sortent',
         case when v_json_op::text like '%VERIF_CONTACT_VISIBLE%'
               and v_json_op::text not like '%VERIF_CONTACT_CACHE%' then 'OK'
              else 'ÉCHEC : annuaire mal filtré' end);

      if v_chef is null then
        insert into verif (bloc, intitule, resultat) values
          ('U. Autorité 109', 'Un chef d''équipe ne coche pas un contact', 'IGNORÉ : pas de chef d''équipe');
      else
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_chef, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        v_etat := 'passée';
        begin
          update contacts set visible_autorite = true where id = v_contact;
          get diagnostics v_n = row_count;
          if v_n = 0 then v_etat := 'refusée (RLS)'; end if;
        exception when others then
          if sqlstate = '42501' then v_etat := 'refusée'; else v_etat := sqlstate; end if;
        end;
        execute 'reset role';
        insert into verif (bloc, intitule, resultat) values
          ('U. Autorité 109', 'Un chef d''équipe ne coche pas un contact',
           case when v_etat like 'refusée%' then 'OK' else 'ÉCHEC : modification ' || v_etat end);
      end if;
    exception when others then
      execute 'reset role';
      insert into verif (bloc, intitule, resultat)
        values ('U. Autorité 109', 'Niveaux du lien autorité', 'ERREUR : ' || sqlerrm);
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
