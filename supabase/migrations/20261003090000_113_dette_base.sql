-- =====================================================================
-- 113 — DETTE DE LA BASE (audit du 19/09, § 4 « Amélioration »)
--
-- Choix de Ren (03/10) : solder la dette avant le concert du 28/11.
-- Aucun changement de droits : chaque bloc garde exactement ce que
-- chaque compte peut lire et écrire (vérifié en transaction annulée,
-- compte par compte, table par table, avant et après).
--
-- 1. INDEX sur les clés étrangères réellement parcourues : les dix
--    `evenement_id` non indexés (chaque écran filtre par événement) et
--    les liens que suivent les cascades et les jointures (suppression
--    d'un lieu, d'une alerte, d'un type de demande ; vidage 111 ; purge
--    112). Les `created_by` / `updated_by` restent sans index : on ne
--    supprime jamais un compte, et aucun écran ne filtre dessus.
--
-- 2. POLICIES DOUBLES (21 alertes « multiple permissive policies ») :
--    17 tables avaient une policy `…_ecriture` FOR ALL à côté d'une
--    policy de lecture. FOR ALL vaut aussi pour SELECT : la base
--    évaluait les deux à chaque lecture. On ne peut pas simplement
--    retirer SELECT de la policy d'écriture — c'est elle qui laisse un
--    rédacteur « voir » la ligne qu'il vient de supprimer logiquement
--    (fiches de poste, groupes de travail, invitations, pièces jointes :
--    sans elle, la suppression serait refusée). On FUSIONNE donc : par
--    table et par commande, une seule policy dont la condition est le OU
--    des anciennes. C'est, à la lettre, la règle de PostgreSQL pour des
--    policies permissives : même résultat, une évaluation.
--
-- 3. `auth.uid()` nu dans quatre policies : réévalué ligne par ligne.
--    Enveloppé en `(select auth.uid())`, il l'est une fois par requête.
--
-- 4. HORODATAGE : huit tables portaient `updated_at` sans déclencheur
--    (la colonne restait à la date de création). `trg_horodatage` pose
--    `updated_at` et, là où la colonne existe, `updated_by`. Il ne
--    touche pas à `origine` ni à `created_*` : ces tables n'en ont pas
--    toutes, `trg_tracabilite` reste celui des référentiels.
--
-- Non fait, exprès : les six index « jamais utilisés » restent. Ils le
-- sont parce que la base de test est petite ; `idx_passages_*` sert le
-- jour J (pointages), `idx_membres_role` couvre la clé RESTRICT vers
-- `roles`.
-- =====================================================================

begin;

-- 1. Index ------------------------------------------------------------

create index if not exists idx_affectations_evenement        on affectations (evenement_id);
create index if not exists idx_canaux_diffusion_evenement    on canaux_diffusion (evenement_id);
create index if not exists idx_communications_evenement      on communications (evenement_id);
create index if not exists idx_controles_sessions_evenement  on controles_sessions (evenement_id);
create index if not exists idx_invitations_evenement         on invitations (evenement_id);
create index if not exists idx_journal_imports_evenement     on journal_imports (evenement_id);
create index if not exists idx_mission_commentaires_evenement on mission_commentaires (evenement_id);
create index if not exists idx_moyens_secours_evenement      on moyens_premiers_secours (evenement_id);
create index if not exists idx_pieces_jointes_evenement      on pieces_jointes (evenement_id, objet_type);
create index if not exists idx_segments_parcours_evenement   on segments_parcours (evenement_id);

create index if not exists idx_segments_depart_lieu   on segments_parcours (depart_lieu_id);
create index if not exists idx_segments_arrivee_lieu  on segments_parcours (arrivee_lieu_id);
create index if not exists idx_missions_lieu          on missions (lieu_id);
create index if not exists idx_missions_type          on missions (type_id);
create index if not exists idx_missions_signalement   on missions (signalement_id);
create index if not exists idx_diffusions_alerte      on diffusions (alerte_id);
create index if not exists idx_attributions_materiel  on attributions (materiel_id);
create index if not exists idx_creneaux_fiche         on creneaux (fiche_id);
create index if not exists idx_creneaux_equipe        on creneaux (equipe_id);
create index if not exists idx_jalons_groupe_travail  on jalons (groupe_travail_id);
create index if not exists idx_invitations_role       on invitations (role_id);
create index if not exists idx_groupes_trace          on groupes (trace_id);
create index if not exists idx_controles_sessions_modele on controles_sessions (modele_id);
create index if not exists idx_controles_lignes_modele_item on controles_lignes (modele_item_id);
create index if not exists idx_checklist_items_modele on checklist_modele_items (modele_id);

-- 2 et 3. Policies : fusion par commande, auth.uid() enveloppé --------

do $$
declare
  v_table text;
  v_cmd   text;
  v_using text;
  v_check text;
  v_nom   text;
  p record;
  v_tables text[] := array[
    'communes', 'communications', 'conformite_reponses', 'controles_lignes',
    'controles_sessions', 'evenements', 'fiches_poste', 'groupes_travail',
    'invitations', 'membres_groupe_travail', 'membres_plateforme',
    'moyens_premiers_secours', 'pieces_jointes', 'referentiel_items',
    'referentiel_locaux', 'referentiels', 'segments_parcours'];
begin
  foreach v_table in array v_tables loop
    -- Garde-fou : on ne fusionne que des policies permissives réservées
    -- à `authenticated`. Une autre forme arrête tout.
    if exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = v_table
                 and (permissive <> 'PERMISSIVE' or roles <> '{authenticated}'::name[])) then
      raise exception '113 : % porte une policy restrictive ou pour un autre rôle', v_table;
    end if;

    -- Les nouvelles policies, calculées avant de rien retirer.
    create temp table if not exists _p113 (tbl text, cmd text, nom text, u text, c text) on commit drop;
    foreach v_cmd in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      select string_agg('(' || qual || ')', ' or ' order by policyname)
        into v_using
        from pg_policies
       where schemaname = 'public' and tablename = v_table
         and cmd in (v_cmd, 'ALL') and qual is not null and v_cmd <> 'INSERT';
      -- Sans WITH CHECK explicite, une policy contrôle avec son USING.
      select string_agg('(' || coalesce(with_check, qual) || ')', ' or ' order by policyname)
        into v_check
        from pg_policies
       where schemaname = 'public' and tablename = v_table
         and cmd in (v_cmd, 'ALL') and v_cmd in ('INSERT', 'UPDATE');
      continue when v_using is null and v_check is null;

      v_nom := v_table || case v_cmd when 'SELECT' then '_lecture' when 'INSERT' then '_creation'
                                     when 'UPDATE' then '_modification' else '_suppression' end;
      insert into _p113 values (
        v_table, v_cmd, v_nom,
        replace(v_using, 'auth.uid()', '(select auth.uid())'),
        replace(v_check, 'auth.uid()', '(select auth.uid())'));
    end loop;

    for p in select policyname from pg_policies where schemaname = 'public' and tablename = v_table loop
      execute format('drop policy %I on public.%I', p.policyname, v_table);
    end loop;

    for p in select * from _p113 where tbl = v_table loop
      execute format('create policy %I on public.%I for %s to authenticated', p.nom, v_table, p.cmd)
        || case when p.u is not null then format(' using (%s)', p.u) else '' end
        || case when p.c is not null then format(' with check (%s)', p.c) else '' end;
    end loop;
  end loop;

  -- auth.uid() nu ailleurs (membres_evenement, affectations,
  -- mission_commentaires) : même policy, condition enveloppée.
  for p in
    select tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public'
       and ((qual ~ 'auth\.uid\(\)' and qual !~ 'SELECT auth\.uid\(\)')
         or (with_check ~ 'auth\.uid\(\)' and with_check !~ 'SELECT auth\.uid\(\)'))
  loop
    execute format('alter policy %I on public.%I', p.policyname, p.tablename)
      || case when p.qual is not null
              then format(' using (%s)', replace(p.qual, 'auth.uid()', '(select auth.uid())')) else '' end
      || case when p.with_check is not null
              then format(' with check (%s)', replace(p.with_check, 'auth.uid()', '(select auth.uid())')) else '' end;
  end loop;
end;
$$;

-- 4. Horodatage -------------------------------------------------------

create or replace function trg_horodatage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- jsonb_populate_record ne retient que les clés qui sont des colonnes :
  -- `updated_by` n'est posé que là où il existe. Sans session (fonction
  -- serveur), on garde l'auteur précédent plutôt que d'écrire null.
  new := jsonb_populate_record(new, jsonb_build_object(
    'updated_at', now(),
    'updated_by', coalesce(auth.uid()::text, to_jsonb(old) ->> 'updated_by')));
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['communications', 'conformite_reponses', 'fiches_poste',
    'groupes_travail', 'moyens_premiers_secours', 'roles', 'segments_parcours',
    'veille_etat_criteres'] loop
    execute format('drop trigger if exists horodatage_%1$s on public.%1$I', t);
    execute format('create trigger horodatage_%1$s before update on public.%1$I
                    for each row execute function trg_horodatage()', t);
  end loop;
end;
$$;

commit;

-- =====================================================================
-- VÉRIFICATION — avant d'appliquer, en transaction annulée : pour chaque
-- membre de chaque événement et pour l'exploitant, le nombre de lignes
-- visibles dans les 17 tables fusionnées est identique avant et après ;
-- une suppression logique de fiche de poste passe toujours ; les
-- alertes `multiple_permissive_policies` et `auth_rls_initplan` tombent
-- à zéro.
-- =====================================================================
