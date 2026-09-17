-- =====================================================================
-- 047 — RECONDUIRE UN ÉVÉNEMENT
--
-- Un festival annuel ne rachète pas un outil qui l'oblige à tout
-- ressaisir chaque année. `dupliquer_evenement` reprend le dispositif
-- préparé — ce qui a demandé des semaines de travail — et laisse
-- derrière tout l'opérationnel.
--
-- CE QUI EST REPRIS : les rôles et leurs capacités, les lieux, les
-- groupes de travail et leurs jalons, les équipes, les contacts, les
-- types de mission, le catalogue de matériel, les canaux radio, les
-- fiches réflexe et de poste, les créneaux, les segments de parcours,
-- l'implantation, les seuils météo, le questionnaire de conformité.
--
-- CE QUI NE L'EST PAS : missions, signalements, journal, REX, alertes,
-- maydays, transports, passages, traces, comptages, groupes de
-- participants, recherches, mouvements de stock, contrôles,
-- affectations, membres, invitations, accès autorité. Ce sont les
-- traces d'un événement qui a eu lieu ; les recopier créerait un
-- dossier faux sur un événement qui n'a pas encore commencé.
--
-- TROIS REMISES À ZÉRO délibérées :
--
--   * L'implantation est reprise mais DÉ-CONFIRMÉE. Un emplacement de
--     DEA validé l'an dernier doit être revalidé sur le terrain : la
--     haie a poussé, le chapiteau a bougé. Reprendre la confirmation
--     avec l'élément, c'est offrir un dossier prêt à signer sans que
--     personne ne soit retourné voir.
--
--   * Les jalons repassent « à faire » et leurs échéances glissent du
--     même nombre de jours que l'événement.
--
--   * Le matériel garde son catalogue et ses seuils d'alerte, mais sa
--     quantité repart de zéro. Le stock de l'an dernier a été bu.
--
-- Les liens vers des personnes (pilote, responsable, confirmé par)
-- sont vidés : ce sont des membres de l'ancien événement, qui n'ont
-- pas encore rejoint le nouveau.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Copie générique d'une table rattachée à un événement.
--
-- Passe par une table temporaire construite avec `select *` plutôt que
-- par une liste de colonnes : la fonction survit ainsi à l'ajout d'une
-- colonne, ce qu'une énumération ne ferait pas. Elle laisse derrière
-- elle une table de correspondance `map_<table>` (ancien, nouveau) pour
-- que l'appelant puisse recâbler les clés étrangères.
-- ---------------------------------------------------------------------
create or replace function copier_table_evenement(
  p_table text, p_source uuid, p_cible uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_filtre text := '';
  v_n integer;
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

  execute format('update cp set id = gen_random_uuid(), evenement_id = $1') using p_cible;

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

revoke all on function copier_table_evenement(text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- La reconduction elle-même.
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
begin
  if not (est_exploitant() or a_permission(p_source, 'referentiels', 'creer')) then
    raise exception 'Reconduction refusée : vous ne pilotez pas cet événement.'
      using errcode = '42501';
  end if;

  select organisation_id, (p_date_debut - date_debut) * interval '1 day'
    into v_org, v_decalage
  from evenements where id = p_source;

  if v_org is null then
    raise exception 'Événement source introuvable.' using errcode = 'P0002';
  end if;

  -- Le quota de licence se vérifie ici : sans ça, la reconduction
  -- serait le chemin détourné par lequel on le dépasse.
  select quota_evenements into v_quota from organisations where id = v_org;
  select count(*) into v_utilises from evenements
   where organisation_id = v_org and deleted_at is null;
  if v_quota is not null and v_utilises >= v_quota then
    raise exception 'Quota de licence atteint (% événements sur %).', v_utilises, v_quota
      using errcode = '23514';
  end if;

  -- L'événement lui-même : on reprend sa configuration, jamais son état.
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

  -- Ordre imposé par les dépendances : ce qui est pointé avant ce qui
  -- pointe.
  -- Les rôles ne passent PAS par la copie générique : deux triggers
  -- ont déjà agi à l'insertion de l'événement — l'un installe les rôles
  -- standard, l'autre fait du créateur un coordinateur rattaché à l'un
  -- d'eux. Les écraser casserait ce rattachement ; on aligne donc les
  -- rôles existants sur ceux de la source, et on ajoute les rôles
  -- personnalisés qui n'existent pas encore.
  insert into roles (evenement_id, code, libelle, description, systeme, tout_pouvoir, ordre, origine)
  select v_cible, code, libelle, description, systeme, tout_pouvoir, ordre, 'import'
  from roles where evenement_id = p_source and deleted_at is null
  on conflict (evenement_id, code) do update set
    libelle = excluded.libelle,
    description = excluded.description,
    tout_pouvoir = excluded.tout_pouvoir,
    ordre = excluded.ordre;

  -- Correspondance par le code, pas par l'identifiant : c'est lui qui
  -- est stable entre deux éditions.
  create temp table map_roles on commit drop as
  select ancien.id as ancien, nouveau.id as nouveau
  from roles ancien
  join roles nouveau on nouveau.code = ancien.code and nouveau.evenement_id = v_cible
  where ancien.evenement_id = p_source and ancien.deleted_at is null;

  -- Les capacités posées par l'installation standard cèdent la place à
  -- celles de la source : c'est tout l'intérêt de reconduire.
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
  perform copier_table_evenement('equipes', p_source, v_cible);
  perform copier_table_evenement('contacts', p_source, v_cible);
  perform copier_table_evenement('types_mission', p_source, v_cible);
  perform copier_table_evenement('materiel', p_source, v_cible);
  perform copier_table_evenement('canaux_radio', p_source, v_cible);
  perform copier_table_evenement('creneaux', p_source, v_cible);
  perform copier_table_evenement('segments_parcours', p_source, v_cible);
  perform copier_table_evenement('elements_plan', p_source, v_cible);
  perform copier_table_evenement('jalons', p_source, v_cible);

  -- `conformite_reponses` n'a pas d'`id` : une ligne par événement, la
  -- clé est l'événement lui-même. La copie générique ne s'y applique
  -- donc pas.
  insert into conformite_reponses (evenement_id, reponses)
  select v_cible, reponses from conformite_reponses where evenement_id = p_source;

  -- Recâblage des clés étrangères vers les copies.
  update groupes_travail set pilote_membre_id = null where evenement_id = v_cible;

  update equipes e set
    groupe_travail_id = m.nouveau,
    responsable_id = null
  from map_groupes_travail m
  where e.evenement_id = v_cible and e.groupe_travail_id = m.ancien;
  update equipes set responsable_id = null where evenement_id = v_cible;

  update contacts c set lieu_id = m.nouveau
  from map_lieux m where c.evenement_id = v_cible and c.lieu_id = m.ancien;

  update materiel x set lieu_id = m.nouveau
  from map_lieux m where x.evenement_id = v_cible and x.lieu_id = m.ancien;
  update materiel x set equipe_id = m.nouveau
  from map_equipes m where x.evenement_id = v_cible and x.equipe_id = m.ancien;
  -- Le stock de l'an dernier a été bu ; le catalogue et les seuils, non.
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
  -- Dé-confirmation : la haie a poussé, le chapiteau a bougé.
  update elements_plan set confirme = false, confirme_par = null, confirme_le = null
  where evenement_id = v_cible;

  update jalons j set groupe_travail_id = m.nouveau
  from map_groupes_travail m where j.evenement_id = v_cible and j.groupe_travail_id = m.ancien;
  update jalons j set lieu_id = m.nouveau
  from map_lieux m where j.evenement_id = v_cible and j.lieu_id = m.ancien;
  update jalons set
    statut = 'a_faire',
    responsable_membre_id = null,
    echeance = echeance + v_decalage,
    fait_le = null
  where evenement_id = v_cible;

  -- Les seuils météo : la ligne existe déjà, créée par le trigger 038.
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

  -- Pas besoin de créer le membre : le trigger `b_coordinateur_createur`
  -- a déjà fait du créateur un coordinateur de l'événement à
  -- l'insertion. On se contente de reprendre son nom d'affichage de
  -- l'édition précédente, s'il en avait un.
  update membres_evenement cible set
    nom_affiche = coalesce(cible.nom_affiche, src.nom_affiche),
    telephone = coalesce(cible.telephone, src.telephone)
  from membres_evenement src
  where cible.evenement_id = v_cible
    and cible.user_id = auth.uid()
    and src.evenement_id = p_source
    and src.user_id = auth.uid();

  perform journaliser(
    v_cible, 'noyau', 'reconduction',
    format('Événement reconduit depuis « %s »', (select nom from evenements where id = p_source)),
    'important'
  );

  return v_cible;
end;
$$;

revoke all on function dupliquer_evenement(uuid, text, text, date, date) from public, anon;
grant execute on function dupliquer_evenement(uuid, text, text, date, date) to authenticated;

commit;
