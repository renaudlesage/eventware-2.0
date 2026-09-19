-- =====================================================================
-- 104 — LES RPC AUTHENTIFIÉES VÉRIFIENT L'APPARTENANCE
--
-- Trouvé à l'audit du 18/09. Sept fonctions `security definer` — donc
-- au-dessus de RLS — étaient exécutables par tout compte connecté sans
-- vérifier que l'appelant est membre de l'événement demandé. Il suffit
-- de connaître l'UUID d'un événement : un ancien membre retiré l'a, un
-- membre d'une autre organisation peut le trouver. `groupes_sans_
-- nouvelles` renvoie le nom et le téléphone d'un accompagnateur ;
-- `chauffeurs_disponibles` des noms ; `demarrer_controle` ÉCRIT.
--
-- Le remède est celui de la 088 pour `journaliser` : une vérification
-- à l'entrée, avec le code d'erreur 42501 que `texteErreur` traduit
-- déjà en « droits insuffisants ».
--
-- Cette migration traite les fonctions appelées uniquement par des
-- membres. Deux autres — `groupes_sans_nouvelles` et `jauge_courante`
-- — servent aussi la page autorité, consultée SANS compte : elles sont
-- traitées en 106, avec cette page, pour ne laisser aucun instant où
-- le lien autorité serait cassé.
--
-- LA VÉRIFICATION EST UN APPEL, PAS UNE COPIE. Les fonctions en
-- `language sql` ne savent pas lever d'exception ; elles appellent
-- `exiger_membre`, qui le fait pour elles, en première instruction.
-- Un corps SQL à plusieurs instructions les exécute toutes, dans
-- l'ordre, et ne renvoie que la dernière.
-- =====================================================================

begin;

create or replace function exiger_membre(p_evenement uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not est_membre(p_evenement) then
    raise exception 'Accès refusé : vous n''êtes pas membre de cet événement.'
      using errcode = '42501';
  end if;
end;
$$;

-- Jamais appelée directement : elle n'a de sens qu'à l'intérieur d'une
-- autre fonction.
revoke all on function exiger_membre(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Lecture. Corps repris à l'identique, précédés de la vérification.
-- ---------------------------------------------------------------------
create or replace function chauffeurs_disponibles(p_evenement uuid)
returns table (membre_id uuid, nom text, type_vehicule text, en_course boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exiger_membre(p_evenement);
  select m.id, m.nom_affiche, m.type_vehicule,
         exists (
           select 1 from transports t
           where t.chauffeur_id = m.id and t.deleted_at is null
             and t.statut in ('attribuee','en_cours')
         )
  from membres_evenement m
  where m.evenement_id = p_evenement and m.est_chauffeur
    and m.actif and m.deleted_at is null
  order by m.nom_affiche;
$$;

create or replace function couverture_creneaux(p_evenement uuid, p_depuis timestamptz default null)
returns table (
  creneau_id uuid, code text, poste text, debut timestamptz, fin timestamptz,
  lieu text, besoin integer, confirmes integer, proposes integer, presents integer,
  manque integer, rappel text, rappel_envoye_le timestamptz, fiche_id uuid, fiche_intitule text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exiger_membre(p_evenement);
  select c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin,
    count(*) filter (where a.statut in ('confirme','present'))::int,
    count(*) filter (where a.statut = 'propose')::int,
    count(*) filter (where a.statut = 'present')::int,
    greatest(c.besoin - count(*) filter (where a.statut in ('confirme','present')), 0)::int,
    c.rappel, c.rappel_envoye_le,
    c.fiche_id, f.intitule
  from creneaux c
  left join lieux l on l.id = c.lieu_id
  left join fiches_poste f on f.id = c.fiche_id and f.deleted_at is null
  left join affectations a
    on a.creneau_id = c.id and a.deleted_at is null and a.statut <> 'annule'
  where c.evenement_id = p_evenement
    and c.deleted_at is null
    and (p_depuis is null or c.fin >= p_depuis)
  group by c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin,
           c.rappel, c.rappel_envoye_le, c.fiche_id, f.intitule
  order by c.debut, c.poste;
$$;

create or replace function flux_parcours(p_evenement uuid)
returns table (
  lieu_id uuid, code text, nom text, pk_km numeric, passages integer,
  comptes integer, scannes integer, dernier timestamptz, encore_apres integer
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exiger_membre(p_evenement);
  with bornes as (
    select l.id, l.code, l.nom, l.pk_km,
           coalesce(sum(c.nombre), 0)::int as passages,
           coalesce(sum(c.nombre) filter (where c.source = 'benevole'), 0)::int as comptes,
           coalesce(sum(c.nombre) filter (where c.source = 'scan'), 0)::int as scannes,
           max(c.horodatage) as dernier
    from lieux l
    left join comptages_parcours c
      on c.lieu_id = l.id and c.evenement_id = p_evenement
    where l.evenement_id = p_evenement
      and l.deleted_at is null
      and l.pk_km is not null
    group by l.id, l.code, l.nom, l.pk_km
  )
  select id, code, nom, pk_km, passages, comptes, scannes, dernier,
         greatest(
           passages - coalesce(lead(passages) over (order by pk_km), passages),
           0
         )::int as encore_apres
  from bornes
  order by pk_km;
$$;

-- ---------------------------------------------------------------------
-- Écriture : être membre ne suffit pas, il faut la capacité que l'écran
-- Conformité exige déjà pour compléter le questionnaire.
-- ---------------------------------------------------------------------
create or replace function demarrer_controle(p_evenement uuid, p_modele_code text, p_sequence text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modele uuid;
  v_session uuid;
  v_reponses jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') then
    raise exception 'Démarrer un contrôle exige le droit de créer des référentiels sur cet événement.'
      using errcode = '42501';
  end if;

  select id into v_modele from checklist_modeles where code = p_modele_code;
  if v_modele is null then
    raise exception 'Modèle de check-list inconnu : %', p_modele_code;
  end if;

  insert into controles_sessions (evenement_id, modele_id, sequence)
  values (p_evenement, v_modele, p_sequence)
  returning id into v_session;

  insert into controles_lignes (session_id, section, ordre_section, ordre_item, libelle, modele_item_id)
  select v_session, mi.section, mi.ordre_section, mi.ordre_item, mi.libelle, mi.id
  from checklist_modele_items mi
  where mi.modele_id = v_modele;

  -- Lignes légales : items dont la condition figure dans les réponses
  -- au questionnaire de l'événement, ou toujours applicables.
  select reponses into v_reponses from conformite_reponses where evenement_id = p_evenement;

  insert into controles_lignes (session_id, section, ordre_section, ordre_item, libelle, referentiel_item_id)
  select v_session, 'Exigences légales (référentiel)', 999,
         row_number() over (order by ri.code),
         ri.code || ' — ' || ri.titre,
         ri.id
  from referentiel_items ri
  join referentiels r on r.id = ri.referentiel_id and r.actif
  where ri.toujours_applicable
     or (v_reponses is not null and ri.condition_cle is not null
         and (v_reponses -> split_part(ri.condition_cle,'.',1) ? split_part(ri.condition_cle,'.',2)));

  return v_session;
end;
$$;

-- ---------------------------------------------------------------------
-- Quatre fonctions que l'application n'appelle jamais restaient
-- exécutables par tout compte. Leurs seuls appelants sont des fonctions
-- `security definer` (un trigger, `creer_signalement`), pour lesquelles
-- ce droit ne compte pas. On le retire.
-- ---------------------------------------------------------------------
revoke execute on function installer_roles_standard(uuid) from authenticated;
revoke execute on function generer_reference_sos(uuid) from authenticated;
revoke execute on function perimetre_dans(uuid) from authenticated;
revoke execute on function plan_a_confirmer(uuid) from authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION
--
-- droits.sql, bloc L : un bénévole d'un autre événement appelle
-- `chauffeurs_disponibles` et `demarrer_controle` sur BFMF2027 et
-- reçoit 42501 ; le coordinateur, lui, obtient sa liste.
-- =====================================================================
