-- =====================================================================
-- 091 — SUPPRESSION LOGIQUE
--
-- Constat du 15/09/2026 : la suppression logique était impossible
-- depuis l'application, sur les 34 tables dont la policy de lecture
-- porte `deleted_at is null`.
--
-- Pour un UPDATE, PostgreSQL exige que la NOUVELLE version de la ligne
-- reste visible au regard de la policy de lecture. Poser `deleted_at`
-- rend précisément la ligne invisible : l'écriture est refusée avec
-- « new row violates row-level security policy ». Contre-épreuve faite
-- sur `organisations`, dont la lecture ne filtre pas `deleted_at` : la
-- même suppression y passe sans rien changer d'autre.
--
-- Deux sorties possibles. Assouplir les 34 policies de lecture aurait
-- rendu les lignes supprimées visibles à quiconque peut modifier, dans
-- toute requête qui oublierait le filtre — sur soixante fichiers,
-- l'oubli arrive. On passe donc par une fonction qui vérifie les droits
-- elle-même et écrit au-dessus de RLS. La lecture reste stricte : une
-- ligne supprimée n'est visible de personne, pas même de son auteur.
--
-- La liste des tables est explicite. Une table absente ne peut pas être
-- supprimée logiquement : c'est voulu, l'ouverture se décide table par
-- table, avec la ressource dont elle relève pour le contrôle de droits.
-- =====================================================================

begin;

create or replace function supprimer_logiquement(p_table text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ressource text;
  v_evenement uuid;
  v_touchees  integer;
begin
  -- Liste blanche : table -> ressource contrôlée par a_permission.
  v_ressource := case p_table
    when 'jalons'          then 'rh'
    when 'groupes_travail' then 'rh'
    when 'creneaux'        then 'rh'
    when 'equipes'         then 'equipes'
    when 'lieux'           then 'referentiels'
    when 'contacts'        then 'referentiels'
    when 'types_mission'   then 'referentiels'
    when 'materiel'        then 'logistique'
    when 'programme'       then 'referentiels'
    when 'fiches_reflexe'  then 'referentiels'
    else null
  end;

  if v_ressource is null then
    raise exception 'Suppression logique non prévue pour « % ».', p_table
      using errcode = '42501';
  end if;

  execute format('select evenement_id from %I where id = $1 and deleted_at is null', p_table)
    into v_evenement using p_id;

  if v_evenement is null then
    -- Déjà supprimée, ou inexistante : rien à faire, et surtout rien à
    -- dire de plus — on ne renseigne pas un appelant sur l'existence
    -- d'un objet qu'il n'a peut-être pas le droit de voir.
    return false;
  end if;

  if not a_permission(v_evenement, v_ressource, 'modifier') then
    raise exception 'Suppression refusée : droits insuffisants sur « % » dans cette phase.', v_ressource
      using errcode = '42501';
  end if;

  execute format(
    'update %I set deleted_at = now(), updated_by = auth.uid() where id = $1 and deleted_at is null',
    p_table
  ) using p_id;

  get diagnostics v_touchees = row_count;
  return v_touchees > 0;
end;
$$;

-- Même règle qu'en 090 : fermée à `anon`, ouverte à l'application.
revoke all on function supprimer_logiquement(text, uuid) from public, anon;
grant execute on function supprimer_logiquement(text, uuid) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION
--
-- Depuis l'application : supprimer un jalon de test dans Préparation,
-- puis dans Planning. Il doit disparaître de la liste au rechargement.
-- En base, la ligne est toujours là avec son `deleted_at` renseigné :
--
--   select code, libelle, deleted_at from jalons
--   where deleted_at is not null order by deleted_at desc;
-- =====================================================================
