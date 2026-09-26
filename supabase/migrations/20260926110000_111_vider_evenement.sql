-- =====================================================================
-- 111 — VIDER UN ÉVÉNEMENT, BLOC PAR BLOC
--
-- Constat de Ren (26/09) : rien ne permettait de vider un événement.
-- Après une campagne de tests, une répétition ou une reconduction, les
-- données d'essai restaient, et la seule issue était un script SQL
-- écrit à la main (c'est ce qui a été fait pour BFMF 2026).
--
-- Choix de Ren : on vide PAR BLOC, au choix ; réservé au coordinateur
-- (tout pouvoir) ; confirmation en retapant le nom de l'événement ;
-- jamais en phase d'exploitation ; une ligne au journal dit qui a vidé
-- quoi et combien de lignes.
--
-- Les blocs, et ce qu'ils effacent (suppression réelle, lignes déjà
-- supprimées logiquement comprises — vider, c'est vider) :
--
--   activite      signalements, demandes (et leurs commentaires),
--                 recherches, MAYDAY, alertes et leurs diffusions,
--                 journal, comptages, pointages, transports,
--                 attributions, mouvements de stock (les quantités
--                 reviennent à leur valeur d'avant les mouvements),
--                 REX, historique des bascules de phase, état de la
--                 veille météo ; les groupes du parcours reviennent à
--                 « inscrit » (départ, passages, dernier lieu effacés).
--   preparation   jalons et actions, groupes de travail, programme,
--                 communications, pièces jointes des jalons (les
--                 fichiers eux-mêmes sont retirés du stockage par
--                 l'application avant l'appel).
--   benevoles     créneaux, affectations, fiches de poste.
--   parcours      groupes, traces, tronçons.
--   plan          éléments du plan d'implantation, moyens de premiers
--                 secours, canaux radio.
--   referentiels  lieux (et, forcément, les tronçons qui en partent),
--                 matériel (et ses mouvements), contacts, équipes,
--                 types de demande, fiches réflexe, journal des imports.
--   conformite    réponses au questionnaire, contrôles et leurs lignes.
--
-- Jamais touchés : l'événement et ses réglages (dates, modules,
-- commune), les membres, les rôles et leurs capacités, les invitations,
-- les accès autorité et leurs documents, les canaux de diffusion, les
-- seuils de veille météo.
--
-- `p_simulation = true` ne supprime rien et renvoie les mêmes comptes :
-- c'est ce que l'écran affiche avant de demander confirmation.
-- =====================================================================

begin;

create or replace function vider_evenement(
  p_evenement    uuid,
  p_blocs        text[],
  p_confirmation text,
  p_simulation   boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  e        evenements%rowtype;
  v_bloc   text;
  v_comptes jsonb := '{}'::jsonb;
  v_total  bigint := 0;
  v_n      bigint;
  -- Ordre d'exécution : enfants avant parents quand la clé étrangère
  -- n'est ni en cascade ni en « set null ».
  v_etapes text[][] := array[
    -- bloc,        table,                 clause (ajoutée à evenement_id = $1)
    ['activite',     'diffusions',          ''],
    ['activite',     'maydays',             ''],
    ['activite',     'alertes',             ''],
    ['activite',     'mission_commentaires', 'MISSIONS'],
    ['activite',     'missions',            ''],
    ['activite',     'signalements',        ''],
    ['activite',     'recherches',          ''],
    ['activite',     'comptages',           ''],
    ['activite',     'comptages_parcours',  ''],
    ['activite',     'passages',            ''],
    ['activite',     'transports',          ''],
    ['activite',     'attributions',        ''],
    ['activite',     'mouvements_stock',    ''],
    ['activite',     'rex_entrees',         ''],
    ['activite',     'bascule_phase',       ''],
    ['activite',     'veille_etat_criteres', ''],
    ['activite',     'journal',             ''],
    ['preparation',  'pieces_jointes',      'JALONS'],
    ['preparation',  'jalons',              ''],
    ['preparation',  'groupes_travail',     ''],
    ['preparation',  'programme',           ''],
    ['preparation',  'communications',      ''],
    ['benevoles',    'affectations',        ''],
    ['benevoles',    'creneaux',            ''],
    ['benevoles',    'fiches_poste',        ''],
    ['parcours',     'segments_parcours',   ''],
    ['parcours',     'groupes',             ''],
    ['parcours',     'traces',              ''],
    ['plan',         'elements_plan',       ''],
    ['plan',         'moyens_premiers_secours', ''],
    ['plan',         'canaux_radio',        ''],
    ['referentiels', 'segments_parcours',   ''],
    ['referentiels', 'lieux',               ''],
    ['referentiels', 'materiel',            ''],
    ['referentiels', 'contacts',            ''],
    ['referentiels', 'equipes',             ''],
    ['referentiels', 'types_mission',       ''],
    ['referentiels', 'fiches_reflexe',      ''],
    ['referentiels', 'journal_imports',     ''],
    ['conformite',   'conformite_reponses', ''],
    ['conformite',   'controles_sessions',  '']
  ];
  i int;
  v_table text;
  v_filtre text;
  v_blocs_valides text[] := array['activite','preparation','benevoles','parcours','plan','referentiels','conformite'];
begin
  -- 1. Qui, quoi, quand.
  select * into e from evenements where id = p_evenement and deleted_at is null;
  if not found then
    raise exception 'Événement introuvable' using errcode = 'P0002';
  end if;
  if not a_tout_pouvoir(p_evenement) then
    raise exception 'Seul un coordinateur peut vider un événement' using errcode = '42501';
  end if;
  if p_blocs is null or cardinality(p_blocs) = 0 then
    raise exception 'Aucun bloc choisi' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_blocs) b where b <> all (v_blocs_valides)) then
    raise exception 'Bloc inconnu' using errcode = '22023';
  end if;
  if not p_simulation then
    if e.phase = 'exploitation' then
      raise exception 'On ne vide pas un événement en cours d''exploitation : changer de phase d''abord'
        using errcode = '42501';
    end if;
    if lower(trim(coalesce(p_confirmation, ''))) <> lower(trim(e.nom)) then
      raise exception 'Le nom retapé ne correspond pas à celui de l''événement' using errcode = '22023';
    end if;
  end if;

  -- 2. Les stocks d'abord : défaire les mouvements avant de les effacer,
  --    pour que chaque article retrouve sa quantité d'avant.
  if 'activite' = any (p_blocs) and not p_simulation and not ('referentiels' = any (p_blocs)) then
    update materiel m
    set quantite = m.quantite - d.delta
    from (
      select materiel_id,
             sum(case sens when 'entree' then quantite when 'sortie' then -quantite
                           when 'ajustement' then quantite else 0 end) as delta
      from mouvements_stock
      where evenement_id = p_evenement
      group by materiel_id
    ) d
    where m.id = d.materiel_id;
  end if;

  -- 3. Les suppressions, dans l'ordre.
  for i in 1 .. array_length(v_etapes, 1) loop
    v_bloc   := v_etapes[i][1];
    v_table  := v_etapes[i][2];
    v_filtre := v_etapes[i][3];
    continue when not (v_bloc = any (p_blocs));
    -- Une table peut revenir dans deux blocs (les tronçons) : on ne la
    -- compte qu'une fois.
    continue when v_comptes ? v_table;

    if v_filtre = 'MISSIONS' then
      if p_simulation then
        select count(*) into v_n from mission_commentaires
        where mission_id in (select id from missions where evenement_id = p_evenement);
      else
        delete from mission_commentaires
        where mission_id in (select id from missions where evenement_id = p_evenement);
        get diagnostics v_n = row_count;
      end if;
    elsif v_filtre = 'JALONS' then
      if p_simulation then
        select count(*) into v_n from pieces_jointes
        where evenement_id = p_evenement and objet_type = 'jalon';
      else
        delete from pieces_jointes where evenement_id = p_evenement and objet_type = 'jalon';
        get diagnostics v_n = row_count;
      end if;
    elsif p_simulation then
      execute format('select count(*) from %I where evenement_id = $1', v_table)
        into v_n using p_evenement;
    else
      execute format('delete from %I where evenement_id = $1', v_table) using p_evenement;
      get diagnostics v_n = row_count;
    end if;

    v_comptes := v_comptes || jsonb_build_object(v_table, v_n);
    v_total := v_total + v_n;
  end loop;

  -- 4. Les groupes du parcours repartent de zéro (s'ils restent).
  if 'activite' = any (p_blocs) and not ('parcours' = any (p_blocs)) then
    if p_simulation then
      select count(*) into v_n from groupes
      where evenement_id = p_evenement and statut <> 'inscrit';
    else
      update groupes
      set statut = 'inscrit', depart_reel = null, arrivee_reelle = null,
          dernier_lieu_id = null, dernier_passage = null, effectif_reel = null
      where evenement_id = p_evenement and statut <> 'inscrit';
      get diagnostics v_n = row_count;
    end if;
    v_comptes := v_comptes || jsonb_build_object('groupes_remis_a_zero', v_n);
  end if;

  -- 5. La trace de l'opération, écrite après la purge du journal.
  if not p_simulation then
    perform journaliser(p_evenement, 'noyau', 'vidage',
      'Événement vidé — blocs : ' || array_to_string(p_blocs, ', ') ||
      ' — ' || v_total || ' ligne(s) supprimée(s)',
      'majeur'::importance_journal, 'evenement', p_evenement, null);
  end if;

  return jsonb_build_object(
    'simulation', p_simulation,
    'blocs', to_jsonb(p_blocs),
    'total', v_total,
    'detail', v_comptes);
end;
$$;

revoke all on function vider_evenement(uuid, text[], text, boolean) from public, anon;
grant execute on function vider_evenement(uuid, text[], text, boolean) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION — droits.sql, bloc W : un chef d'équipe est refusé ; en
-- exploitation, refusé ; un mauvais nom, refusé ; une simulation ne
-- supprime rien ; « activite » vide les demandes et garde les lieux ;
-- le journal ne contient plus qu'une ligne, celle du vidage.
-- =====================================================================
