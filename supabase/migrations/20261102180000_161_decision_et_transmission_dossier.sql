-- =====================================================================
-- 161 — DÉCISION DE LA COMMUNE ET TRANSMISSION DU DOSSIER (étapes 7 et 8)
--
-- Étape 7 (MVP) : l'organisateur dépose l'arrêté reçu de la commune
-- dans `documents_autorite`, puis passe le dossier en `autorise` ou
-- `refuse` : `decider_dossier`. Tout pouvoir seulement, journalisé.
--
-- Étape 8 : à chaque changement de statut (depose, en_instruction,
-- autorise, refuse, retire), le dossier part vers Crisiware par les
-- canaux de diffusion (042) dont `objets` contient `dossier`. La
-- transmission est l'affaire de l'Edge Function `diffuser-dossier`
-- (clé de service) ; ici, la colonne `canaux_diffusion.objets`, le
-- journal `diffusions` élargi (objet, référence, sans alerte) et
-- `transmission_dossier(evenement)`, la charge du contrat partagé avec
-- le briefing 03. Un échec d'envoi n'annule jamais le changement de
-- statut. Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Décision (étape 7)
-- ---------------------------------------------------------------------
create or replace function public.decider_dossier(p_evenement uuid, p_statut text, p_commentaire text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare d dossiers_securite%rowtype;
begin
  if not a_tout_pouvoir(p_evenement) then
    raise exception 'La décision se consigne avec tout pouvoir' using errcode = '42501';
  end if;
  if p_statut not in ('autorise', 'refuse') then
    raise exception 'Décision inconnue (autorise, refuse)' using errcode = '22023';
  end if;
  select * into d from dossiers_securite where evenement_id = p_evenement for update;
  if d.id is null or d.version_courante = 0 then raise exception 'Aucun dossier déposé' using errcode = 'P0009'; end if;
  if d.statut not in ('depose', 'en_instruction') then
    raise exception 'Seul un dossier déposé ou en instruction reçoit une décision (%)', d.statut using errcode = 'P0012';
  end if;
  update dossiers_securite set statut = p_statut, decide_le = now() where id = d.id;
  perform journaliser(p_evenement, 'securite', 'dossier',
    format('Dossier de sécurité %s par la commune (version %s)%s', case p_statut when 'autorise' then 'AUTORISÉ' else 'REFUSÉ' end, d.version_courante,
           case when coalesce(btrim(p_commentaire), '') <> '' then ' — ' || btrim(p_commentaire) else '' end),
    (case when p_statut = 'refuse' then 'majeur' else 'notable' end)::importance_journal, 'dossiers_securite', d.id, 'v' || d.version_courante);
  return jsonb_build_object('dossier_id', d.id, 'version', d.version_courante, 'statut', p_statut);
end $$;
comment on function public.decider_dossier(uuid, text, text) is 'Consigne la décision de la commune (autorise / refuse) sur le dossier déposé (161, MVP : l''organisateur la saisit).';
revoke execute on function public.decider_dossier(uuid, text, text) from public, anon;
grant  execute on function public.decider_dossier(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Transmission (étape 8)
-- ---------------------------------------------------------------------
alter table public.canaux_diffusion add column if not exists objets text[] not null default '{alerte}';
comment on column public.canaux_diffusion.objets is 'Ce que le canal reçoit (161) : alerte, dossier.';
alter table public.diffusions add column if not exists objet text not null default 'alerte';
alter table public.diffusions add column if not exists reference text;
comment on column public.diffusions.objet is 'alerte (042) ou dossier (161).';

-- La charge du contrat (briefing 01 § étape 8, briefing 03 partie B).
create or replace function public.transmission_dossier(p_evenement uuid, p_base_url text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ev evenements%rowtype; d dossiers_securite%rowtype; v_jeton uuid;
begin
  -- Réservée au rôle de service (Edge Function) : aucun contrôle de membre, aucune exposition à l'application.
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  select * into d from dossiers_securite where evenement_id = p_evenement;
  if ev.id is null or d.id is null then return null; end if;
  -- Le lien de consultation : un accès de niveau instruction (159), actif, le plus récent.
  select a.jeton into v_jeton from acces_autorite a
   where a.evenement_id = p_evenement and a.niveau = 'instruction' and a.actif and a.deleted_at is null
     and (a.expire_le is null or a.expire_le > now())
   order by a.created_at desc limit 1;
  return jsonb_build_object(
    'source', 'eventware', 'type', 'dossier_securite',
    'evenement', jsonb_build_object('jeton_public', ev.jeton_public, 'nom', ev.nom, 'commune', ev.commune,
                                    'date_debut', ev.date_debut, 'date_fin', ev.date_fin, 'frequentation_max', ev.frequentation_max),
    'dossier', jsonb_build_object('reference', d.id, 'version', d.version_courante, 'statut', d.statut, 'niveau_dmp', d.niveau_dmp,
                                  'lien_consultation', case when v_jeton is not null and p_base_url is not null then p_base_url || '?autorite=' || v_jeton end,
                                  'maj_le', coalesce(d.updated_at, now())));
end $$;
comment on function public.transmission_dossier(uuid, text) is 'La charge « dossier_securite » envoyée à Crisiware (161), construite pour l''Edge Function diffuser-dossier.';
revoke execute on function public.transmission_dossier(uuid, text) from public, anon, authenticated;
grant  execute on function public.transmission_dossier(uuid, text) to service_role;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/161.sql)
--   select decider_dossier('<evenement>', 'autorise', 'Arrêté du 12/07');
--   select transmission_dossier('<evenement>', 'https://eventware.app/');
-- =====================================================================
