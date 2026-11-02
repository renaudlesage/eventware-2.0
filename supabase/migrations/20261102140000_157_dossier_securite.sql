-- =====================================================================
-- 157 — LE DOSSIER DE SÉCURITÉ : STATUTS, VERSIONS, DÉPÔT (étape 2)
--
-- Un dossier par événement, avec son statut (brouillon, déposé, en
-- instruction, autorisé, refusé, retiré) et, à chaque dépôt, un
-- instantané complet figé dans `dossier_versions` : fiche de
-- l'événement, organisateur et profil de sécurité (155), questionnaire,
-- prescriptions applicables, lieux et plan, moyens de secours, contacts
-- visibles des autorités, et les contrôles du moment (156). Ce que la
-- commune a reçu ne bouge plus quand l'événement continue de vivre.
--
-- `deposer_dossier(evenement)` vérifie les droits, refuse tant qu'un
-- contrôle bloquant subsiste, fige l'instantané, passe le dossier en
-- `depose`. `retirer_dossier` le retire. Les tables ne s'écrivent que
-- par ces fonctions : pas de policy d'écriture directe.
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Les tables
-- ---------------------------------------------------------------------
create table if not exists public.dossiers_securite (
  id               uuid primary key default gen_random_uuid(),
  evenement_id     uuid not null unique references public.evenements(id) on delete cascade,
  statut           text not null default 'brouillon'
                   check (statut in ('brouillon', 'depose', 'en_instruction', 'autorise', 'refuse', 'retire')),
  version_courante integer not null default 0,
  depose_le        timestamptz,
  decide_le        timestamptz,
  niveau_dmp       integer check (niveau_dmp between 1 and 5),
  score_dmp        numeric,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_by       uuid references auth.users(id)
);
comment on table public.dossiers_securite is
  'Dossier de sécurité d''un événement (157) : statut, version courante, dates de dépôt et de décision, niveau DMP.';

create table if not exists public.dossier_versions (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.dossiers_securite(id) on delete cascade,
  version     integer not null,
  contenu     jsonb not null,
  auteur      uuid references auth.users(id),
  auteur_nom  text,
  created_at  timestamptz not null default now(),
  unique (dossier_id, version)
);
comment on table public.dossier_versions is
  'Instantané complet du dossier à chaque dépôt (157). En ajout seul : jamais modifié, jamais supprimé.';

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_dossiers_securite') then
    create trigger tracabilite_dossiers_securite before insert or update on public.dossiers_securite
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 2. L'instantané
-- ---------------------------------------------------------------------
create or replace function public.instantane_dossier(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  zone communes%rowtype;
  v jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then raise exception 'Événement inconnu' using errcode = 'P0002'; end if;
  select * into zone from communes where nom = ev.commune limit 1;

  v := jsonb_build_object(
    'fige_le', now(),
    'evenement', jsonb_build_object(
      'id', ev.id, 'nom', ev.nom, 'commune', ev.commune, 'province', ev.province,
      'zone_police', zone.zone_police, 'zone_secours', zone.zone_secours,
      'date_montage', ev.date_montage, 'date_debut', ev.date_debut, 'date_fin', ev.date_fin, 'date_demontage', ev.date_demontage,
      'frequentation_min', ev.frequentation_min, 'frequentation_max', ev.frequentation_max,
      'point_0', case when ev.point_0_lat is not null then jsonb_build_object('lat', ev.point_0_lat, 'lon', ev.point_0_lon) end),
    'organisateur', (select jsonb_build_object('nom', o.nom, 'contact_nom', o.contact_nom, 'contact_email', o.contact_email, 'contact_tel', o.contact_tel)
                     from organisations o where o.id = ev.organisation_id),
    'profil_securite', (select to_jsonb(p) - 'created_at' - 'updated_at' - 'created_by' - 'updated_by'
                        from organisations_profil_securite p where p.organisation_id = ev.organisation_id),
    'questionnaire', (select r.reponses from conformite_reponses r where r.evenement_id = p_evenement),
    -- Les prescriptions applicables : la règle de l'écran Conformité (référentiels de l'organisation
    -- ou partagés, de la zone de l'événement ; items toujours applicables ou cochés).
    'prescriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'referentiel', r.nom, 'portee', r.portee, 'version', r.version,
               'code', i.code, 'categorie', i.categorie, 'titre', i.titre, 'caractere', i.caractere,
               'dispositions', i.dispositions, 'seuils', i.seuils,
               'complement_local', (select l.complement from referentiel_locaux l
                                     where l.organisation_id = ev.organisation_id and l.referentiel_item_id = i.id limit 1))
             order by r.nom, i.code)
      from referentiel_items i
      join referentiels r on r.id = i.referentiel_id and r.actif
      left join conformite_reponses cr on cr.evenement_id = p_evenement
      where (r.organisation_id is null or r.organisation_id = ev.organisation_id)
        and (coalesce(r.zone_nom, '') = '' or r.zone_nom in (zone.zone_police, zone.zone_secours))
        and (i.toujours_applicable
             or (i.condition_cle is not null
                 and coalesce((cr.reponses -> split_part(i.condition_cle, '.', 1) ->> split_part(i.condition_cle, '.', 2))::boolean, false)))), '[]'::jsonb),
    'lieux', coalesce((select jsonb_agg(jsonb_build_object('code', l.code, 'nom', l.nom, 'type', l.type, 'lat', l.latitude, 'lon', l.longitude) order by l.code)
                       from lieux l where l.evenement_id = p_evenement and l.deleted_at is null), '[]'::jsonb),
    'plan', coalesce((select jsonb_agg(jsonb_build_object('code', e.code, 'nom', e.nom, 'categorie', e.categorie, 'calque', e.calque, 'nature', e.nature,
                                                          'lat', e.centre_lat, 'lon', e.centre_lon, 'largeur_m', e.largeur_m, 'longueur_m', e.longueur_m,
                                                          'quantite', e.quantite, 'confirme', e.confirme) order by e.calque, e.code)
                      from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null), '[]'::jsonb),
    'secours', coalesce((select jsonb_agg(jsonb_build_object('type', m.type, 'quantite', m.quantite, 'commentaire', m.commentaire) order by m.type)
                         from moyens_premiers_secours m where m.evenement_id = p_evenement), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('nom', c.nom, 'organisation', c.organisation, 'fonction', c.fonction, 'telephone', c.telephone,
                                                              'email', c.email, 'categorie', c.categorie, 'role_autorite', c.role_autorite) order by c.categorie, c.nom)
                          from contacts c where c.evenement_id = p_evenement and c.deleted_at is null
                            and (c.visible_autorite or c.role_autorite is not null)), '[]'::jsonb),
    'controles', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'gravite', k.gravite, 'titre', k.titre, 'detail', k.detail) order by k.gravite, k.code)
                           from controle_dossier(p_evenement) k), '[]'::jsonb),
    'dmp', (select jsonb_build_object('niveau', d.niveau_dmp, 'score', d.score_dmp) from dossiers_securite d where d.evenement_id = p_evenement)
  );
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 3. Déposer, retirer
-- ---------------------------------------------------------------------
create or replace function public.deposer_dossier(p_evenement uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_dossier dossiers_securite%rowtype;
  v_bloquants text[];
  v_version integer;
  v_nom text;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Dépôt du dossier non autorisé' using errcode = '42501';
  end if;

  select array_agg(k.titre order by k.code) into v_bloquants from controle_dossier(p_evenement) k where k.gravite = 'bloquant';
  if coalesce(array_length(v_bloquants, 1), 0) > 0 then
    raise exception 'Dépôt refusé : % point(s) bloquant(s) — %', array_length(v_bloquants, 1), array_to_string(v_bloquants, ' ; ')
      using errcode = 'P0010';
  end if;

  insert into dossiers_securite (evenement_id) values (p_evenement)
  on conflict (evenement_id) do nothing;
  select * into v_dossier from dossiers_securite where evenement_id = p_evenement for update;

  v_version := v_dossier.version_courante + 1;
  select m.nom_affiche into v_nom from membres_evenement m where m.evenement_id = p_evenement and m.user_id = auth.uid() and m.deleted_at is null limit 1;
  insert into dossier_versions (dossier_id, version, contenu, auteur, auteur_nom)
  values (v_dossier.id, v_version, instantane_dossier(p_evenement), auth.uid(), v_nom);

  update dossiers_securite
     set statut = 'depose', version_courante = v_version, depose_le = now(), decide_le = null
   where id = v_dossier.id;

  perform journaliser(p_evenement, 'securite', 'dossier',
    format('Dossier de sécurité déposé (version %s)', v_version), 'notable', 'dossiers_securite', v_dossier.id, 'v' || v_version);

  return jsonb_build_object('dossier_id', v_dossier.id, 'version', v_version, 'statut', 'depose');
end $$;

create or replace function public.retirer_dossier(p_evenement uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_dossier dossiers_securite%rowtype;
begin
  if not a_tout_pouvoir(p_evenement) then
    raise exception 'Retrait du dossier non autorisé' using errcode = '42501';
  end if;
  select * into v_dossier from dossiers_securite where evenement_id = p_evenement for update;
  if v_dossier.id is null or v_dossier.statut not in ('depose', 'en_instruction') then
    raise exception 'Seul un dossier déposé ou en instruction se retire' using errcode = 'P0011';
  end if;
  update dossiers_securite set statut = 'retire' where id = v_dossier.id;
  perform journaliser(p_evenement, 'securite', 'dossier', format('Dossier de sécurité retiré (version %s)', v_dossier.version_courante), 'notable',
                      'dossiers_securite', v_dossier.id, 'v' || v_dossier.version_courante);
  return jsonb_build_object('dossier_id', v_dossier.id, 'version', v_dossier.version_courante, 'statut', 'retire');
end $$;

comment on function public.deposer_dossier(uuid) is
  'Dépose le dossier de sécurité (157) : refuse tant qu''un contrôle bloquant subsiste, fige un instantané, passe en « depose ».';
comment on function public.retirer_dossier(uuid) is 'Retire un dossier déposé ou en instruction (157).';
comment on function public.instantane_dossier(uuid) is 'L''instantané complet du dossier, tel qu''il est figé au dépôt (157).';

revoke execute on function public.instantane_dossier(uuid), public.deposer_dossier(uuid), public.retirer_dossier(uuid) from public, anon;
grant  execute on function public.instantane_dossier(uuid), public.deposer_dossier(uuid), public.retirer_dossier(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS : lecture par les droits « référentiels », écriture par fonctions
-- ---------------------------------------------------------------------
alter table public.dossiers_securite enable row level security;
alter table public.dossier_versions enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'dossiers_securite' and policyname = 'dossiers_securite_lecture') then
    create policy dossiers_securite_lecture on public.dossiers_securite for select to authenticated
      using (a_permission(evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dossier_versions' and policyname = 'dossier_versions_lecture') then
    create policy dossier_versions_lecture on public.dossier_versions for select to authenticated
      using (exists (select 1 from dossiers_securite d where d.id = dossier_id
                       and (a_permission(d.evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(d.evenement_id))));
  end if;
end $p$;

revoke all on public.dossiers_securite, public.dossier_versions from public, anon;
grant select on public.dossiers_securite, public.dossier_versions to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/157.sql)
--   select deposer_dossier('<evenement>');
--   select version, created_at, auteur_nom, jsonb_object_keys(contenu) from dossier_versions order by version;
-- =====================================================================
