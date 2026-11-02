-- =====================================================================
-- 165 — LA NOTIFICATION DU DISPOSITIF MÉDICAL PRÉVENTIF (CoAMU & CU 112)
--
-- Quand l'autorité impose un dispositif médical préventif, l'organisateur
-- ou son prestataire de soins complète le « Formulaire de notification
-- DMP — CoAMU & CU 112 » (clusters BHN-LILU, v1.6 février 2025) ; le CPU
-- le transmet au plus tard 10 jours ouvrés avant l'événement à la CoAMU
-- (admin.lie@health.fgov.be pour Liège) et à la CU 112 (expert@cs112.com).
-- Passé ce délai, il n'est pas pris en considération.
--
--   · `notifications_dmp` : la notification d'un événement, une ligne,
--     avec ses listes (créneaux, personnel, ambulances, SMUR) en jsonb ;
--   · `notification_dmp_prerempli(evenement)` : ce qu'Eventware sait
--     (nom, nature PRIMA, créneaux par jour depuis le programme,
--     prestataire et responsable depuis les contacts, effectifs depuis
--     les moyens, postes et adresses depuis les lieux et le plan) ;
--   · `notification_dmp(evenement)` : saisie par-dessus le pré-rempli,
--     destinataires selon la province, date limite à 10 jours ouvrés,
--     complétude.
-- `controle_dossier` (156/163/164) signale la notification à envoyer
-- quand la grille PRIMA demande un dispositif (niveau ≥ 2) et que la
-- date limite approche (DOS_NOTIF_DMP). Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. La notification
-- ---------------------------------------------------------------------
create table if not exists public.notifications_dmp (
  evenement_id          uuid primary key references public.evenements(id) on delete cascade,
  nature                text,
  creneaux              jsonb,          -- [{date, acces_debut, acces_fin, dmp_debut, dmp_fin}]
  documents             text[],         -- documents joints
  prestataire_interne   boolean,
  prestataire_nom       text,
  contact_nom           text,
  contact_gsm           text,
  responsable_dmp       jsonb,          -- {nom, prenom, nn, gsm}
  medecin_coordinateur  jsonb,          -- {nom, prenom, nn, gsm, inami}
  personnel             jsonb,          -- [{categorie, nom, prenom, num_nat, badge}]
  effectifs             jsonb,          -- {categorie: nombre}
  moyens                jsonb,          -- {poste_soins: {fixes, mobiles}, poste_medicalise, poste_medico_chir, autre: {libelle, fixes, mobiles}}
  vecteurs              jsonb,          -- {vsl, ambulance_atnup, ambulance_112, pit, smur}
  informations          text,
  adresses              jsonb,          -- {acces_public: {rue, cp, localite}, acces_secours, poste_soins}
  ambulances_112        jsonb,          -- [{indicatif, plaque, issi, gsm}]
  smur                  jsonb,          -- [{indicatif, plaque, issi, gsm}]
  envoyee_le            timestamptz,
  envoyee_a             text,
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
comment on table public.notifications_dmp is 'Notification du dispositif médical préventif à la CoAMU et à la CU 112 (165, formulaire v1.6 février 2025). Une colonne nulle vaut ce qu''Eventware sait.';
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_notifications_dmp') then
    create trigger tracabilite_notifications_dmp before insert or update on public.notifications_dmp
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- Les catégories de personnel du formulaire, dans son ordre ; (*) : à compléter nominativement pour vérification.
create or replace function public.notification_dmp_categories()
returns table (code text, libelle text, nominatif boolean) language sql immutable set search_path = public, pg_temp as $$
  select * from (values
    ('infirmier', 'Infirmier(ère)s', true), ('infirmier_sisu', 'Infirmiers titrés SISU', true),
    ('medecin_generaliste', 'Médecin généraliste', true), ('medecin_specialise', 'Médecin spécialisé', true),
    ('medecin_urgentiste', 'Médecin SMA, SMU, TPPSU', true), ('secouriste_ambulancier', 'Secouristes-ambulanciers', true),
    ('secouriste', 'Secouristes', false), ('equipe_intervention', 'Équipe(s) d''intervention', false)
  ) as c(code, libelle, nominatif);
$$;
grant execute on function public.notification_dmp_categories() to authenticated;

-- N jours ouvrés avant une date (samedis et dimanches exclus ; les jours fériés ne sont pas comptés).
create or replace function public.jours_ouvres_avant(p_date date, p_n integer)
returns date language plpgsql immutable set search_path = public, pg_temp as $$
declare d date := p_date; n integer := 0;
begin
  while n < p_n loop
    d := d - 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return d;
end $$;
create or replace function public.jours_ouvres_entre(p_de date, p_a date)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select count(*)::int from generate_series(p_de, p_a - 1, interval '1 day') d where extract(isodow from d) < 6;
$$;

-- ---------------------------------------------------------------------
-- 2. Ce qu'Eventware sait déjà
-- ---------------------------------------------------------------------
create or replace function public.notification_dmp_prerempli(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v jsonb := '{}'::jsonb;
  v_nature text; v_presta record; v_poste record; v_acces record; v_entree record;
  v_secouristes int; v_ambulances int; v_postes int;
begin
  if not a_permission(p_evenement, 'referentiels', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return v; end if;

  -- a. et b. Nom, nature : le type PRIMA choisi, sinon la nature du formulaire multidisciplinaire.
  select r.libelle into v_nature from prima_saisies s join prima_referentiel r on r.famille = 'type_evenement' and r.code = s.type_evenement where s.evenement_id = p_evenement;
  if v_nature is null then
    select fr.valeur #>> '{}' into v_nature from formulaire_reponses fr join formulaires f on f.id = fr.formulaire_id where fr.evenement_id = p_evenement and f.code = 'IBZ_2017' and fr.code = '1.05';
  end if;
  v := v || jsonb_build_object('nom', ev.nom, 'nature', v_nature);

  -- c. Créneaux : un par jour, aux heures du programme du jour (sinon vides) ; le dispositif couvre l'accès au public.
  if ev.date_debut is not null then
    v := v || jsonb_build_object('creneaux', (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('date', j.d::date, 'acces_debut', h.debut, 'acces_fin', h.fin, 'dmp_debut', h.debut, 'dmp_fin', h.fin)) order by j.d)
      from generate_series(ev.date_debut, coalesce(ev.date_fin, ev.date_debut), interval '1 day') j(d)
      left join lateral (
        select to_char(min(pr.debut), 'HH24:MI') as debut, to_char(max(pr.debut + make_interval(mins => coalesce(pr.duree_min, 0))), 'HH24:MI') as fin
        from programme pr where pr.evenement_id = p_evenement and pr.deleted_at is null and pr.debut::date = j.d::date
      ) h on true));
  end if;
  -- Documents joints : ce qu'Eventware peut produire.
  v := v || jsonb_build_object('documents', to_jsonb(array_remove(array[
    case when exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null) then 'plan(s) d''implantation du site' end,
    case when exists (select 1 from traces t where t.evenement_id = p_evenement and t.deleted_at is null and t.actif) then 'itinéraire (circuit)' end,
    case when exists (select 1 from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.type = 'poste_secours')
           or exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie::text = 'poste_secours') then 'localisation du/des poste(s) de soins' end,
    case when exists (select 1 from dossiers_securite d where d.evenement_id = p_evenement and d.version_courante > 0) then 'dossier de sécurité Eventware' end
  ], null)));

  -- Partie I : le prestataire de soins et son contact (Croix-Rouge, ambulances, poste médical dans les contacts).
  select c.organisation, c.nom, c.telephone, c.fonction into v_presta from contacts c
   where c.evenement_id = p_evenement and c.deleted_at is null and coalesce(c.telephone, '') <> ''
     and (c.organisation ilike '%croix%' or c.organisation ilike '%ambulance%' or c.categorie ilike '%medic%' or c.categorie ilike '%secours%')
     and c.organisation not ilike '%zone de secours%' and c.nom not ilike '%dispatch%'
   order by case when c.organisation ilike '%croix%' then 0 else 1 end, c.nom limit 1;
  if v_presta.organisation is not null then
    v := v || jsonb_build_object('prestataire_interne', false, 'prestataire_nom', v_presta.organisation, 'contact_nom', v_presta.nom, 'contact_gsm', v_presta.telephone,
                                 'responsable_dmp', jsonb_build_object('nom', v_presta.nom, 'gsm', v_presta.telephone));
  end if;
  -- Effectifs et moyens déclarés dans Eventware.
  select coalesce(sum(quantite), 0) into v_secouristes from moyens_premiers_secours where evenement_id = p_evenement and type = 'secouriste';
  select coalesce(sum(quantite), 0) into v_ambulances from moyens_premiers_secours where evenement_id = p_evenement and type = 'ambulance';
  select count(*) into v_postes from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.type = 'poste_secours';
  if v_postes = 0 then select count(*) into v_postes from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie::text = 'poste_secours'; end if;
  if v_secouristes > 0 then v := v || jsonb_build_object('effectifs', jsonb_build_object('secouriste', v_secouristes)); end if;
  if v_postes > 0 then v := v || jsonb_build_object('moyens', jsonb_build_object('poste_soins', jsonb_build_object('fixes', v_postes, 'mobiles', 0))); end if;
  if v_ambulances > 0 then
    v := v || jsonb_build_object('informations', format('%s ambulance(s) déclarée(s) dans Eventware : à répartir entre ATNUP et agréées 112 (partie I, vecteurs).', v_ambulances));
  end if;

  -- Partie II : adresses des lieux (accès public = entrée, accès secours = voie des engins ou point de rencontre, poste de soins).
  select l.nom, l.description into v_entree from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.type = 'entree' order by l.code limit 1;
  select coalesce(e.adresse, e.nom) as adresse into v_acces from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie::text in ('point_rencontre_secours', 'voie_engins', 'prv') order by e.code limit 1;
  select coalesce(e.adresse, l.nom) as adresse into v_poste from lieux l left join elements_plan e on e.id = l.element_plan_id
   where l.evenement_id = p_evenement and l.deleted_at is null and l.type = 'poste_secours' order by l.code limit 1;
  if v_poste.adresse is null then select e.adresse into v_poste from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie::text = 'poste_secours' order by e.code limit 1; end if;
  v := v || jsonb_build_object('adresses', nullif(jsonb_strip_nulls(jsonb_build_object(
    'acces_public', case when v_entree.nom is not null then jsonb_build_object('rue', coalesce(v_entree.description, v_entree.nom), 'localite', ev.commune) end,
    'acces_secours', case when v_acces.adresse is not null then jsonb_build_object('rue', v_acces.adresse, 'localite', ev.commune) end,
    'poste_soins', case when v_poste.adresse is not null then jsonb_build_object('rue', v_poste.adresse, 'localite', ev.commune) end)), '{}'::jsonb));
  return jsonb_strip_nulls(v);
end $$;

-- ---------------------------------------------------------------------
-- 3. La notification telle qu'elle se lit : saisie par-dessus le pré-rempli
-- ---------------------------------------------------------------------
create or replace function public.notification_dmp(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  n notifications_dmp%rowtype;
  pre jsonb;
  v jsonb;
  v_limite date; v_niveau int; v_zone text;
  v_coamu text;
begin
  if not a_permission(p_evenement, 'referentiels', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return '{}'::jsonb; end if;
  pre := notification_dmp_prerempli(p_evenement);
  select * into n from notifications_dmp where evenement_id = p_evenement;
  v := jsonb_strip_nulls(jsonb_build_object(
    'nom', ev.nom,
    'nature', coalesce(n.nature, pre ->> 'nature'),
    'creneaux', coalesce(n.creneaux, pre -> 'creneaux', '[]'::jsonb),
    'documents', coalesce(to_jsonb(n.documents), pre -> 'documents', '[]'::jsonb),
    'prestataire_interne', coalesce(n.prestataire_interne, (pre ->> 'prestataire_interne')::boolean),
    'prestataire_nom', coalesce(n.prestataire_nom, pre ->> 'prestataire_nom'),
    'contact_nom', coalesce(n.contact_nom, pre ->> 'contact_nom'),
    'contact_gsm', coalesce(n.contact_gsm, pre ->> 'contact_gsm'),
    'responsable_dmp', coalesce(n.responsable_dmp, pre -> 'responsable_dmp', '{}'::jsonb),
    'medecin_coordinateur', coalesce(n.medecin_coordinateur, '{}'::jsonb),
    'personnel', coalesce(n.personnel, '[]'::jsonb),
    'effectifs', coalesce(n.effectifs, pre -> 'effectifs', '{}'::jsonb),
    'moyens', coalesce(n.moyens, pre -> 'moyens', '{}'::jsonb),
    'vecteurs', coalesce(n.vecteurs, '{}'::jsonb),
    'informations', coalesce(n.informations, pre ->> 'informations'),
    'adresses', coalesce(n.adresses, pre -> 'adresses', '{}'::jsonb),
    'ambulances_112', coalesce(n.ambulances_112, '[]'::jsonb),
    'smur', coalesce(n.smur, '[]'::jsonb),
    'envoyee_le', n.envoyee_le, 'envoyee_a', n.envoyee_a
  ));
  -- Provenance : les champs encore pré-remplis (rien de saisi).
  v := v || jsonb_build_object('preremplis', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(pre) k
    where case k when 'nature' then n.nature is null when 'creneaux' then n.creneaux is null when 'documents' then n.documents is null
                 when 'prestataire_nom' then n.prestataire_nom is null when 'contact_nom' then n.contact_nom is null when 'contact_gsm' then n.contact_gsm is null
                 when 'responsable_dmp' then n.responsable_dmp is null when 'effectifs' then n.effectifs is null when 'moyens' then n.moyens is null
                 when 'informations' then n.informations is null when 'adresses' then n.adresses is null else false end));
  -- Destinataires selon la province, date limite à 10 jours ouvrés, niveau PRIMA, complétude.
  v_coamu := case lower(coalesce(ev.province, ''))
    when 'liège' then 'admin.lie@health.fgov.be' when 'liege' then 'admin.lie@health.fgov.be' when 'luxembourg' then 'admin.lux@health.fgov.be'
    when 'brabant wallon' then 'prima.brw@health.fgov.be' when 'hainaut' then 'prima.hai@health.fgov.be' when 'namur' then 'prima.nam@health.fgov.be' end;
  v_limite := case when ev.date_debut is not null then jours_ouvres_avant(ev.date_debut, 10) end;
  select s.type_evenement into v_niveau from prima_saisies s where s.evenement_id = p_evenement;
  select d.niveau_dmp into v_niveau from dossiers_securite d where d.evenement_id = p_evenement;
  v := v || jsonb_build_object(
    'destinataires', jsonb_strip_nulls(jsonb_build_object('coamu', v_coamu, 'cu112', 'expert@cs112.com')),
    'date_limite', v_limite,
    'jours_ouvres_restants', case when v_limite is not null then jours_ouvres_entre(current_date, v_limite) - case when v_limite < current_date then jours_ouvres_entre(v_limite, current_date) * 2 else 0 end end,
    'niveau_dossier', v_niveau,
    'complete', coalesce(n.prestataire_nom, pre ->> 'prestataire_nom') is not null and coalesce(n.contact_gsm, pre ->> 'contact_gsm') is not null
                and coalesce(n.responsable_dmp, pre -> 'responsable_dmp') ->> 'nom' is not null
                and jsonb_array_length(coalesce(n.creneaux, pre -> 'creneaux', '[]'::jsonb)) > 0
                and coalesce(n.adresses, pre -> 'adresses', '{}'::jsonb) ? 'poste_soins',
    'version', 'Formulaire de notification DMP CoAMU & CU 112, v1.6 (février 2025)'
  );
  return v;
end $$;

comment on function public.notification_dmp_prerempli(uuid) is 'Ce qu''Eventware sait déjà pour la notification DMP (165).';
comment on function public.notification_dmp(uuid) is 'La notification DMP d''un événement (165) : saisie par-dessus le pré-rempli, destinataires, date limite à 10 jours ouvrés, complétude.';
revoke execute on function public.notification_dmp_prerempli(uuid), public.notification_dmp(uuid), public.jours_ouvres_avant(date, integer), public.jours_ouvres_entre(date, date) from public, anon;
grant  execute on function public.notification_dmp_prerempli(uuid), public.notification_dmp(uuid), public.jours_ouvres_avant(date, integer), public.jours_ouvres_entre(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Les contrôles (156/163/164, redéfinie) : la notification à envoyer
-- ---------------------------------------------------------------------
create or replace function public.controle_dossier(p_evenement uuid)
returns table (code text, gravite text, titre text, detail text, table_source text, source_id uuid, stimulus text, objectif text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v_manques text[];
  v_reponses jsonb;
  v_form jsonb;
  v_n int;
  v_f formulaires%rowtype;
  v_statut text;
  v_jours int;
  v_prima jsonb;
  v_notif jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return; end if;
  begin
    return query select a.* from avant_vol(p_evenement) a;
  exception when insufficient_privilege then
    null;
  end;
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
  if not exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null) then
    return query select 'DOS_PLAN', 'alerte', 'Plan d''implantation vide',
      'Le dossier joint le plan du site : Implantation', 'elements_plan', null::uuid, null::text, 'DOSSIER';
  end if;
  if not exists (select 1 from moyens_premiers_secours m where m.evenement_id = p_evenement and coalesce(m.quantite, 0) > 0) then
    return query select 'DOS_SECOURS', 'alerte', 'Aucun moyen de premiers secours déclaré',
      'Secouristes, DEA, poste de secours : Réglages › Conformité', 'moyens_premiers_secours', null::uuid, null::text, 'DOSSIER';
  end if;
  -- (163) Chaque formulaire applicable : obligatoires sans réponse, délai de dépôt.
  select d.statut into v_statut from dossiers_securite d where d.evenement_id = p_evenement;
  for v_f in select * from formulaires_applicables(p_evenement) loop
    v_form := formulaire_dossier(p_evenement, v_f.code);
    v_n := jsonb_array_length(v_form -> 'obligatoires_manquantes');
    if v_n > 0 then
      return query select 'DOS_FORMULAIRE', 'alerte', format('%s : %s question(s) obligatoire(s) sans réponse', v_f.libelle, v_n),
        'Questions ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_form -> 'obligatoires_manquantes') x) || ' — Réglages › Dossier de sécurité › Formulaires',
        'formulaire_reponses', v_f.id, null::text, 'DOSSIER';
    end if;
    v_jours := coalesce(ev.date_montage, ev.date_debut) - current_date;
    if v_f.delai_jours is not null and coalesce(v_statut, 'brouillon') in ('brouillon', 'retire') and v_jours < v_f.delai_jours + 14 then
      return query select 'DOS_DELAI', 'alerte',
        case when v_jours < v_f.delai_jours then format('%s : délai de dépôt dépassé', v_f.libelle) else format('%s : délai de dépôt dans %s jour(s)', v_f.libelle, v_jours - v_f.delai_jours) end,
        format('À rentrer %s jours avant la mise en place (%s), soit avant le %s. %s', v_f.delai_jours, to_char(coalesce(ev.date_montage, ev.date_debut), 'DD/MM/YYYY'),
               to_char(coalesce(ev.date_montage, ev.date_debut) - v_f.delai_jours, 'DD/MM/YYYY'), coalesce(v_f.delai_note, '')),
        'formulaires', v_f.id, null::text, 'DOSSIER';
    end if;
  end loop;
  -- (164) La grille PRIMA : le type d'événement à choisir, l'avis CoAMU qu'elle demande.
  v_prima := calcul_prima(p_evenement);
  if v_prima -> 'a_confirmer' ? 'type_evenement' then
    return query select 'DOS_PRIMA_TYPE', 'alerte', 'Grille PRIMA : type d''événement à choisir',
      'Le score de risque et le niveau du dispositif en dépendent : Réglages › Dossier de sécurité › Grille PRIMA', 'prima_saisies', null::uuid, null::text, 'DOSSIER';
  end if;
  if (v_prima ->> 'avis_coamu')::boolean then
    return query select 'DOS_PRIMA_AVIS', 'alerte', 'Grille PRIMA : avis de la CoAMU demandé',
      format('%s Dossier et grille à envoyer via le coordinateur PLANU entre 90 et 60 jours avant l''événement (admin.lie@health.fgov.be) ; notification du dispositif à la CU 112 au moins 10 jours ouvrés avant.', v_prima ->> 'message'),
      'prima_saisies', null::uuid, null::text, 'DOSSIER';
  elsif (v_prima ->> 'informer_coamu')::boolean then
    return query select 'DOS_PRIMA_INFO', 'veille', 'Grille PRIMA : informer la CoAMU',
      v_prima ->> 'message', 'prima_saisies', null::uuid, null::text, 'DOSSIER';
  end if;
  -- (165) La notification du dispositif : dès qu'un dispositif est attendu (niveau PRIMA ≥ 2) et tant qu'elle n'est pas envoyée,
  -- à moins de 30 jours de la date limite (10 jours ouvrés avant l'événement).
  if coalesce((v_prima ->> 'niveau')::int, 0) >= 2 and ev.date_debut is not null then
    v_notif := notification_dmp(p_evenement);
    if v_notif ->> 'envoyee_le' is null and (v_notif ->> 'date_limite')::date - current_date < 30 then
      return query select 'DOS_NOTIF_DMP', 'alerte',
        case when (v_notif ->> 'date_limite')::date < current_date then 'Notification du dispositif médical : délai dépassé'
             else format('Notification du dispositif médical : à envoyer avant le %s', to_char((v_notif ->> 'date_limite')::date, 'DD/MM/YYYY')) end,
        format('Au plus tard 10 jours ouvrés avant l''événement, à la CoAMU (%s) et à la CU 112 (expert@cs112.com)%s — Réglages › Dossier de sécurité › Notification DMP',
               coalesce(v_notif -> 'destinataires' ->> 'coamu', 'adresse de la province'), case when (v_notif ->> 'complete')::boolean then '' else ' ; prestataire, contact, responsable, créneaux ou poste de soins encore à compléter' end),
        'notifications_dmp', null::uuid, null::text, 'DOSSIER';
    end if;
  end if;
  return;
end $$;

-- ---------------------------------------------------------------------
-- 5. RLS : par les droits « référentiels », comme les autres pièces du dossier
-- ---------------------------------------------------------------------
alter table public.notifications_dmp enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'notifications_dmp' and policyname = 'notifications_dmp_lecture') then
    create policy notifications_dmp_lecture on public.notifications_dmp for select to authenticated
      using (a_permission(evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notifications_dmp' and policyname = 'notifications_dmp_ecriture') then
    create policy notifications_dmp_ecriture on public.notifications_dmp for all to authenticated
      using (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id));
  end if;
end $p$;
revoke all on public.notifications_dmp from public, anon;
grant select, insert, update, delete on public.notifications_dmp to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/165.sql)
--   select notification_dmp('<evenement>') -> 'date_limite', -> 'complete';
--   select * from controle_dossier('<evenement>') where code = 'DOS_NOTIF_DMP';
-- =====================================================================
