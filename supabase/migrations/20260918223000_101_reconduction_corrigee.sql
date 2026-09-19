-- =====================================================================
-- 101 — RECONDUCTION : TROIS DÉFAUTS QUI L'EMPÊCHAIENT D'ABOUTIR
--
-- Trouvés à l'audit du 18/09 en confrontant le corps de
-- `dupliquer_evenement` (098) aux types réels de la base. Preuve
-- qu'elle n'a jamais abouti : aucune ligne « reconduction » dans le
-- journal. Les deux premiers essais s'étaient arrêtés plus tôt (WHERE
-- manquant, puis créneau sans date) et ces trois-là attendaient
-- derrière.
--
--   1. `statut = 'a_faire'` — la valeur n'existe pas : `statut_jalon`
--      vaut a_venir, en_cours, fait, rate, annule. → 22P02.
--   2. `journaliser(…, 'important')` — `importance_journal` vaut
--      routine, notable, majeur. → 22P02, et la transaction entière est
--      annulée avec lui.
--   3. La copie des équipes portait encore le `groupe_travail_id` de
--      l'édition source au moment de l'insertion ; or la 094 impose
--      qu'un groupe n'ait qu'une équipe (index unique partiel). Le
--      recâblage venait après l'insertion — trop tard. → 23505 pour
--      toute équipe reprise d'un groupe de travail.
--
-- POURQUOI ÇA A ÉCHAPPÉ. PL/pgSQL ne vérifie ni les littéraux d'enum
-- ni les colonnes à la création d'une fonction : `create function`
-- réussit, l'erreur n'apparaît qu'à l'exécution, et seulement une fois
-- passées les étapes précédentes. Une fonction qui traverse quinze
-- tables ne se valide qu'en la faisant tourner jusqu'au bout sur un
-- vrai événement — c'est le test ajouté au bloc K de droits.sql.
--
-- REMÈDE AU POINT 3. La copie générique accepte désormais un recâblage
-- à faire AVANT l'insertion : `p_recablages` associe une colonne à la
-- table dont la correspondance ancien→nouveau existe déjà (copiée juste
-- avant). Seules les équipes en ont besoin aujourd'hui ; les autres
-- recâblages restent après insertion, inchangés.
-- =====================================================================

begin;

create or replace function copier_table_evenement(
  p_table text, p_source uuid, p_cible uuid, p_recablages jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_filtre text := '';
  v_n integer;
  v_colonne text;
  v_table_ref text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'deleted_at'
  ) then
    v_filtre := ' and deleted_at is null';
  end if;

  execute format(
    'create temp table cp on commit drop as select *, id as ancien from %I where evenement_id = $1%s',
    p_table, v_filtre
  ) using p_source;

  -- `where id is not null` n'est pas décoratif : l'éditeur SQL de
  -- Supabase charge pg_safeupdate, qui refuse tout UPDATE sans clause
  -- WHERE — y compris à l'intérieur d'une fonction, et y compris sur
  -- une table temporaire dont on veut justement toucher chaque ligne.
  execute format('update cp set id = gen_random_uuid(), evenement_id = $1 where id is not null')
    using p_cible;

  -- Recâblages à faire avant l'insertion, pour les colonnes soumises à
  -- une contrainte d'unicité qui refuserait la valeur de la source.
  for v_colonne, v_table_ref in
    select key, value #>> '{}' from jsonb_each(p_recablages)
  loop
    execute format(
      'update cp set %I = m.nouveau from map_%s m where cp.%I = m.ancien',
      v_colonne, v_table_ref, v_colonne
    );
  end loop;

  execute 'create temp table mapping on commit drop as select ancien, id as nouveau from cp';
  execute 'alter table cp drop column ancien';
  execute format('insert into %I select * from cp', p_table);
  get diagnostics v_n = row_count;

  execute format('create temp table map_%s on commit drop as select * from mapping', p_table);
  execute 'drop table cp';
  execute 'drop table mapping';
  return v_n;
end;
$$;

-- L'ancienne signature à trois paramètres disparaît : une seule
-- fonction, un seul comportement.
drop function if exists copier_table_evenement(text, uuid, uuid);
revoke all on function copier_table_evenement(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- `dupliquer_evenement` : reprise intégrale de la 098, avec les trois
-- corrections. Cherche « (101) » pour les trouver.
-- ---------------------------------------------------------------------
create or replace function dupliquer_evenement(
  p_source     uuid,
  p_nom        text,
  p_slug       text,
  p_date_debut date,
  p_date_fin   date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cible    uuid;
  v_org      uuid;
  v_quota    integer;
  v_utilises integer;
  v_decalage interval;
  v_datee    boolean;
begin
  if not (est_exploitant() or a_permission(p_source, 'referentiels', 'creer')) then
    raise exception 'Reconduction refusée : vous ne pilotez pas cet événement.'
      using errcode = '42501';
  end if;

  select organisation_id,
         coalesce((p_date_debut - date_debut) * interval '1 day', interval '0 day'),
         date_debut is not null
    into v_org, v_decalage, v_datee
  from evenements where id = p_source;

  if v_org is null then
    raise exception 'Événement source introuvable.' using errcode = 'P0002';
  end if;

  select quota_evenements into v_quota from organisations where id = v_org;
  select count(*) into v_utilises from evenements
   where organisation_id = v_org and deleted_at is null;
  if v_quota is not null and v_utilises >= v_quota then
    raise exception 'Quota de licence atteint (% événements sur %).', v_utilises, v_quota
      using errcode = '23514';
  end if;

  insert into evenements (
    nom, slug, date_debut, date_fin, phase, archive,
    organisation_id, geometrie, mode_parcours, modules, commune,
    point_0_lat, point_0_lon,
    frequentation_min, frequentation_max
  )
  select p_nom, p_slug, p_date_debut, p_date_fin, 'preparation', false,
         organisation_id, geometrie, mode_parcours, modules, commune,
         point_0_lat, point_0_lon,
         frequentation_min, frequentation_max
  from evenements where id = p_source
  returning id into v_cible;

  insert into roles (evenement_id, code, libelle, description, systeme, tout_pouvoir, ordre, origine)
  select v_cible, code, libelle, description, systeme, tout_pouvoir, ordre, 'import'
  from roles where evenement_id = p_source and deleted_at is null
  on conflict (evenement_id, code) do update set
    libelle = excluded.libelle,
    description = excluded.description,
    tout_pouvoir = excluded.tout_pouvoir,
    ordre = excluded.ordre;

  create temp table map_roles on commit drop as
  select ancien.id as ancien, nouveau.id as nouveau
  from roles ancien
  join roles nouveau on nouveau.code = ancien.code and nouveau.evenement_id = v_cible
  where ancien.evenement_id = p_source and ancien.deleted_at is null;

  delete from role_capacites
   where role_id in (select id from roles where evenement_id = v_cible);

  insert into role_capacites (role_id, ressource, action, phase)
  select m.nouveau, c.ressource, c.action, c.phase
  from role_capacites c join map_roles m on m.ancien = c.role_id
  on conflict do nothing;

  perform copier_table_evenement('lieux', p_source, v_cible);
  perform copier_table_evenement('fiches_reflexe', p_source, v_cible);
  perform copier_table_evenement('fiches_poste', p_source, v_cible);
  perform copier_table_evenement('groupes_travail', p_source, v_cible);
  -- (101) Le groupe est recâblé avant l'insertion : la 094 n'admet
  -- qu'une équipe par groupe, et la source tient encore la sienne.
  perform copier_table_evenement('equipes', p_source, v_cible,
                                 '{"groupe_travail_id": "groupes_travail"}'::jsonb);
  perform copier_table_evenement('contacts', p_source, v_cible);
  perform copier_table_evenement('types_mission', p_source, v_cible);
  perform copier_table_evenement('materiel', p_source, v_cible);
  perform copier_table_evenement('canaux_radio', p_source, v_cible);
  perform copier_table_evenement('creneaux', p_source, v_cible);
  perform copier_table_evenement('segments_parcours', p_source, v_cible);
  perform copier_table_evenement('elements_plan', p_source, v_cible);
  perform copier_table_evenement('jalons', p_source, v_cible);

  insert into conformite_reponses (evenement_id, reponses)
  select v_cible, reponses from conformite_reponses where evenement_id = p_source;

  update groupes_travail set pilote_membre_id = null where evenement_id = v_cible;
  update equipes set responsable_id = null where evenement_id = v_cible;

  update contacts c set lieu_id = m.nouveau
  from map_lieux m where c.evenement_id = v_cible and c.lieu_id = m.ancien;

  update materiel x set lieu_id = m.nouveau
  from map_lieux m where x.evenement_id = v_cible and x.lieu_id = m.ancien;
  update materiel x set equipe_id = m.nouveau
  from map_equipes m where x.evenement_id = v_cible and x.equipe_id = m.ancien;
  update materiel set quantite = 0 where evenement_id = v_cible;

  update canaux_radio c set equipe_id = m.nouveau
  from map_equipes m where c.evenement_id = v_cible and c.equipe_id = m.ancien;

  update creneaux c set equipe_id = m.nouveau
  from map_equipes m where c.evenement_id = v_cible and c.equipe_id = m.ancien;
  update creneaux c set lieu_id = m.nouveau
  from map_lieux m where c.evenement_id = v_cible and c.lieu_id = m.ancien;
  update creneaux c set fiche_id = m.nouveau
  from map_fiches_poste m where c.evenement_id = v_cible and c.fiche_id = m.ancien;
  update creneaux set
    debut = debut + v_decalage,
    fin = fin + v_decalage,
    rappel_par = null
  where evenement_id = v_cible;

  update segments_parcours s set depart_lieu_id = m.nouveau
  from map_lieux m where s.evenement_id = v_cible and s.depart_lieu_id = m.ancien;
  update segments_parcours s set arrivee_lieu_id = m.nouveau
  from map_lieux m where s.evenement_id = v_cible and s.arrivee_lieu_id = m.ancien;

  update elements_plan e set fiche_reflexe_id = m.nouveau
  from map_fiches_reflexe m where e.evenement_id = v_cible and e.fiche_reflexe_id = m.ancien;
  update elements_plan set confirme = false, confirme_par = null, confirme_le = null
  where evenement_id = v_cible;

  update jalons j set groupe_travail_id = m.nouveau
  from map_groupes_travail m where j.evenement_id = v_cible and j.groupe_travail_id = m.ancien;
  update jalons j set lieu_id = m.nouveau
  from map_lieux m where j.evenement_id = v_cible and j.lieu_id = m.ancien;
  -- (101) `a_venir`, pas `a_faire`. La visibilité (099) est reprise
  -- telle quelle : un jalon public l'an dernier le sera cette année.
  update jalons set
    statut = 'a_venir',
    responsable_membre_id = null,
    echeance = echeance + v_decalage,
    fait_le = null
  where evenement_id = v_cible;

  update veille_meteo cible set
    active = src.active,
    rafale_vigilance_kmh = src.rafale_vigilance_kmh,
    rafale_critique_kmh = src.rafale_critique_kmh,
    pluie_vigilance_mm = src.pluie_vigilance_mm,
    pluie_critique_mm = src.pluie_critique_mm,
    temp_max_vigilance = src.temp_max_vigilance,
    temp_min_vigilance = src.temp_min_vigilance,
    alerte_orage = src.alerte_orage,
    consigne_vigilance = src.consigne_vigilance,
    consigne_critique = src.consigne_critique,
    consignes = src.consignes
  from veille_meteo src
  where src.evenement_id = p_source and cible.evenement_id = v_cible;

  update membres_evenement cible set
    nom_affiche = coalesce(cible.nom_affiche, src.nom_affiche),
    telephone = coalesce(cible.telephone, src.telephone)
  from membres_evenement src
  where cible.evenement_id = v_cible
    and cible.user_id = auth.uid()
    and src.evenement_id = p_source
    and src.user_id = auth.uid();

  -- (101) `notable`, pas `important`.
  perform journaliser(
    v_cible, 'noyau', 'reconduction',
    format(
      'Événement reconduit depuis « %s »%s',
      (select nom from evenements where id = p_source),
      case when v_datee then ''
           else ' — édition précédente non datée : horaires des créneaux et échéances des jalons repris sans décalage, à revoir'
      end
    ),
    'notable'
  );

  return v_cible;
end;
$$;

revoke all on function dupliquer_evenement(uuid, text, text, date, date) from public, anon;
grant execute on function dupliquer_evenement(uuid, text, text, date, date) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION
--
-- Depuis l'application : Réglages › Reconduire, sur un événement qui a
-- au moins une équipe reprise d'un groupe de travail. Le nouvel
-- événement doit apparaître, et :
--
--   select texte from journal where categorie = 'reconduction'
--   order by created_at desc limit 1;
--
-- doit rendre une ligne. Puis droits.sql, bloc K.
-- =====================================================================
