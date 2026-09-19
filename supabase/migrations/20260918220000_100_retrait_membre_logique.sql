-- =====================================================================
-- 100 — RETRAIT D'UN MEMBRE PAR SUPPRESSION LOGIQUE
--
-- Même défaut que celui corrigé par la 091 pour les jalons, trouvé à
-- l'audit sur deux autres écrans : « Retirer » un membre (Membres.jsx)
-- et retirer une fiche réflexe (Securite.jsx) posaient `deleted_at`
-- par un UPDATE direct. La ligne devient invisible au regard de la
-- policy de lecture (`deleted_at is null`), PostgreSQL refuse alors
-- l'écriture, et l'écran affiche « droits insuffisants » à un
-- coordinateur qui les a.
--
-- `fiches_reflexe` était déjà dans la liste blanche de la 091 — seul
-- le front était en faute. `membres_evenement` n'y était pas : on
-- l'ajoute, contrôlée par la ressource `membres`, celle que la policy
-- de modification de la table utilise déjà.
--
-- La fonction est reprise à l'identique de la 091, une ligne en plus.
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
    when 'jalons'            then 'rh'
    when 'groupes_travail'   then 'rh'
    when 'creneaux'          then 'rh'
    when 'equipes'           then 'equipes'
    when 'lieux'             then 'referentiels'
    when 'contacts'          then 'referentiels'
    when 'types_mission'     then 'referentiels'
    when 'materiel'          then 'logistique'
    when 'programme'         then 'referentiels'
    when 'fiches_reflexe'    then 'referentiels'
    when 'membres_evenement' then 'membres'
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

revoke all on function supprimer_logiquement(text, uuid) from public, anon;
grant execute on function supprimer_logiquement(text, uuid) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION
--
-- Depuis l'application, en tant que coordinateur : Réglages › Équipe ›
-- Membres, « Retirer » sur un membre de test → il disparaît de la
-- liste. Puis Sécurité › Fiches, retirer une fiche → idem.
-- =====================================================================
