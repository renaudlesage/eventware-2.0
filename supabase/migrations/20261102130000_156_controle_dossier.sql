-- =====================================================================
-- 156 — CONTRÔLE DE COMPLÉTUDE DU DOSSIER DE SÉCURITÉ (étape 3)
--
-- `avant_vol` (120, 128) relit le dispositif et nourrit le générateur
-- d'exercices : on n'y touche pas. `controle_dossier` reprend ses
-- résultats tels quels et y ajoute les contrôles `DOS_*`, propres au
-- dossier déposé à la commune :
--   · coordinateur sécurité désigné et joignable (l'interlocuteur des
--     autorités, Partage › Interlocuteur) ;
--   · PC-Ops positionné (un lieu de type pc_ops avec ses coordonnées) ;
--   · numéros d'urgence : zone de secours (dispatch), police ;
--   · commune, fréquentation maximale, dates du montage au démontage ;
--   · questionnaire de conformité rempli ;
--   · profil de sécurité de l'organisation complet (155).
-- Gravités des DOS_* : `bloquant` empêche le dépôt (157), `alerte` est
-- seulement affiché. Les lignes d'avant_vol gardent leurs gravités
-- (`chaud`, `veille`) : elles informent, elles ne bloquent pas.
-- Même signature de retour qu'avant_vol. Aucun DROP, rejouable.
-- =====================================================================

begin;

create or replace function public.controle_dossier(p_evenement uuid)
returns table (code text, gravite text, titre text, detail text, table_source text, source_id uuid, stimulus text, objectif text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v_manques text[];
  v_reponses jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return; end if;

  -- 1. Ce qu'avant_vol voit déjà, sans rien y changer (qui n'a pas le
  --    droit de lire les exercices n'en voit pas les lignes).
  begin
    return query select a.* from avant_vol(p_evenement) a;
  exception when insufficient_privilege then
    null;
  end;

  -- 2. Les contrôles propres au dossier
  if coalesce(ev.commune, '') = '' then
    return query select 'DOS_COMMUNE', 'bloquant', 'Commune non renseignée',
      'Le dossier se dépose auprès d''une commune : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  end if;

  if ev.frequentation_max is null then
    return query select 'DOS_FREQUENTATION', 'bloquant', 'Fréquentation maximale non renseignée',
      'Le niveau du dispositif médical et les prescriptions en dépendent : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  end if;

  if ev.date_debut is null or ev.date_fin is null then
    return query select 'DOS_DATES', 'bloquant', 'Dates de la manifestation non renseignées',
      'Premier et dernier jour : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  elsif ev.date_montage is null or ev.date_demontage is null then
    return query select 'DOS_DATES', 'bloquant', 'Dates de montage et de démontage non renseignées',
      'La commune autorise l''occupation du montage au démontage : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  end if;

  if not exists (select 1 from contacts c where c.evenement_id = p_evenement and c.deleted_at is null
                   and c.role_autorite = 'interlocuteur' and coalesce(c.telephone, '') <> '') then
    return query select 'DOS_COORDINATEUR', 'bloquant', 'Coordinateur sécurité non désigné ou sans téléphone',
      'Désigner l''interlocuteur des autorités, avec son numéro : Réglages › Partage › Interlocuteur', 'contacts', null::uuid, null::text, 'DOSSIER';
  end if;

  if not exists (select 1 from lieux l where l.evenement_id = p_evenement and l.deleted_at is null
                   and l.type = 'pc_ops' and l.latitude is not null and l.longitude is not null) then
    return query select 'DOS_PC_OPS', 'bloquant', 'PC-Ops non positionné',
      'Un lieu de type « PC opérationnel » avec ses coordonnées : Préparation › Lieux', 'lieux', null::uuid, null::text, 'DOSSIER';
  end if;

  if not exists (select 1 from contacts c where c.evenement_id = p_evenement and c.deleted_at is null and coalesce(c.telephone, '') <> ''
                   and (c.categorie ilike '%secours%' or c.organisation ilike '%secours%' or c.nom ilike '%secours%'
                        or c.organisation ilike '%dispatch%' or c.nom ilike '%dispatch%' or c.organisation ilike '%pompier%')) then
    return query select 'DOS_TEL_SECOURS', 'bloquant', 'Numéro de la zone de secours absent',
      'Le dispatch de la zone de secours, avec son numéro direct : Mémento › Contacts (catégorie « secours »)', 'contacts', null::uuid, null::text, 'DOSSIER';
  end if;

  if not exists (select 1 from contacts c where c.evenement_id = p_evenement and c.deleted_at is null and coalesce(c.telephone, '') <> ''
                   and (c.categorie ilike '%police%' or c.organisation ilike '%police%' or c.nom ilike '%police%')) then
    return query select 'DOS_TEL_POLICE', 'bloquant', 'Numéro de la police absent',
      'La zone de police, avec un numéro direct : Mémento › Contacts (catégorie « police »)', 'contacts', null::uuid, null::text, 'DOSSIER';
  end if;

  select r.reponses into v_reponses from conformite_reponses r where r.evenement_id = p_evenement;
  if v_reponses is null or v_reponses = '{}'::jsonb then
    return query select 'DOS_QUESTIONNAIRE', 'bloquant', 'Questionnaire de conformité non rempli',
      'Structures, cuisson, gaz, chauffage, activités : Réglages › Conformité › Questionnaire', 'conformite_reponses', null::uuid, null::text, 'DOSSIER';
  end if;

  if ev.organisation_id is null then
    return query select 'DOS_PROFIL', 'bloquant', 'Événement sans organisation',
      'Le profil de sécurité se lit sur l''organisation', 'organisations_profil_securite', null::uuid, null::text, 'DOSSIER';
  else
    v_manques := profil_securite_manques(ev.organisation_id);
    if coalesce(array_length(v_manques, 1), 0) > 0 then
      return query select 'DOS_PROFIL', 'bloquant', 'Profil de sécurité de l''organisation incomplet',
        'Manque : ' || array_to_string(v_manques, ', ') || ' — Réglages › Organisation', 'organisations_profil_securite', null::uuid, null::text, 'DOSSIER';
    end if;
  end if;

  -- 3. Ce qui n'empêche pas le dépôt mais appauvrit le dossier
  if not exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null) then
    return query select 'DOS_PLAN', 'alerte', 'Plan d''implantation vide',
      'Le dossier joint le plan du site : Implantation', 'elements_plan', null::uuid, null::text, 'DOSSIER';
  end if;
  if not exists (select 1 from moyens_premiers_secours m where m.evenement_id = p_evenement and coalesce(m.quantite, 0) > 0) then
    return query select 'DOS_SECOURS', 'alerte', 'Aucun moyen de premiers secours déclaré',
      'Secouristes, DEA, poste de secours : Réglages › Conformité', 'moyens_premiers_secours', null::uuid, null::text, 'DOSSIER';
  end if;
  return;
end $$;

comment on function public.controle_dossier(uuid) is
  'Contrôles de complétude du dossier de sécurité (156) : les lignes d''avant_vol, puis les DOS_* (bloquant empêche le dépôt, alerte informe).';

revoke execute on function public.controle_dossier(uuid) from public, anon;
grant  execute on function public.controle_dossier(uuid) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/156.sql)
--   select code, gravite, titre from controle_dossier('<evenement>') order by 2, 1;
--   -- avant_vol doit rendre exactement les mêmes lignes qu'avant :
--   select code, count(*) from avant_vol('<evenement>') group by 1 order by 1;
-- =====================================================================
