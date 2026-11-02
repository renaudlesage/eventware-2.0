-- =====================================================================
-- 159 — AVIS DES DISCIPLINES SUR LE DOSSIER, SANS COMPTE (étape 4)
--
-- Le dossier déposé (157) se lit et s'instruit par lien, comme la
-- situation autorité (028, 109) : un accès `acces_autorite` de niveau
-- `avis` (D1 à D5, CoAMU) ou `instruction` (la commune) ouvre le
-- dossier, pas la situation. Chaque discipline rend un avis par version
-- déposée — favorable, favorable sous conditions, défavorable — avec ses
-- prescriptions. Un nouvel avis de la même discipline remplace l'ancien
-- sans l'effacer (`remplace_le`). Le premier avis, ou l'accusé de la
-- commune, passe le dossier en instruction.
--
-- Le jour J, les prescriptions des disciplines entrent dans la
-- check-list de contrôle sur site au même titre que les items de
-- référentiel : `controles_lignes.prescription_id`, et
-- `demarrer_controle` (104) les ajoute.
--
-- `situation_autorite` (149) est rebranchée EN PLACE, comme la 153 :
-- un lien de niveau avis ou instruction n'y entre pas (P0007).
-- Aucun DROP de données (une contrainte de contrôle est remplacée).
-- Rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. acces_autorite : deux niveaux de plus, et la discipline
-- ---------------------------------------------------------------------
alter table public.acces_autorite drop constraint if exists acces_autorite_niveau_check;
alter table public.acces_autorite add constraint acces_autorite_niveau_check
  check (niveau in ('situation', 'operationnel', 'avis', 'instruction'));
alter table public.acces_autorite add column if not exists discipline text
  check (discipline in ('D1', 'D2', 'D3', 'D4', 'D5', 'COAMU', 'COMMUNE'));
comment on column public.acces_autorite.discipline is
  'Pour un accès de niveau avis ou instruction (159) : la discipline qui rend l''avis (D1 à D5, CoAMU) ou COMMUNE.';

-- ---------------------------------------------------------------------
-- 2. Les tables
-- ---------------------------------------------------------------------
create table if not exists public.avis_autorite (
  id                uuid primary key default gen_random_uuid(),
  dossier_id        uuid not null references public.dossiers_securite(id) on delete cascade,
  version           integer not null,
  acces_autorite_id uuid references public.acces_autorite(id) on delete set null,
  discipline        text not null check (discipline in ('D1', 'D2', 'D3', 'D4', 'D5', 'COAMU', 'COMMUNE')),
  avis              text not null check (avis in ('favorable', 'favorable_conditions', 'defavorable')),
  commentaire       text,
  echeance          date,
  rendu_le          timestamptz not null default now(),
  remplace_le       timestamptz,
  rendu_par         text
);
comment on table public.avis_autorite is
  'Avis d''une discipline sur une version déposée du dossier (159). Un nouvel avis remplace l''ancien (remplace_le) sans l''effacer.';
create index if not exists avis_autorite_dossier_idx on public.avis_autorite (dossier_id, version, discipline);

create table if not exists public.prescriptions_dossier (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.dossiers_securite(id) on delete cascade,
  avis_id     uuid not null references public.avis_autorite(id) on delete cascade,
  discipline  text not null,
  texte       text not null check (btrim(texte) <> ''),
  caractere   text not null default 'obligatoire' check (caractere in ('obligatoire', 'recommande')),
  created_at  timestamptz not null default now()
);
comment on table public.prescriptions_dossier is
  'Prescriptions ajoutées par une discipline dans son avis (159). Contrôlées sur site via controles_lignes.prescription_id.';

alter table public.controles_lignes add column if not exists prescription_id uuid references public.prescriptions_dossier(id) on delete set null;

-- ---------------------------------------------------------------------
-- 3. Le lien : lire le dossier, rendre un avis, accuser réception
-- ---------------------------------------------------------------------
create or replace function public.acces_dossier_par_jeton(p_jeton uuid)
returns public.acces_autorite language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a acces_autorite%rowtype;
begin
  select * into a from acces_autorite where jeton = p_jeton and deleted_at is null;
  if not found then raise exception 'Lien inconnu' using errcode = 'P0002'; end if;
  if not a.actif then raise exception 'Cet accès a été révoqué' using errcode = 'P0005'; end if;
  if a.expire_le is not null and a.expire_le < now() then raise exception 'Cet accès a expiré' using errcode = 'P0006'; end if;
  if a.niveau not in ('avis', 'instruction') then raise exception 'Ce lien ne donne pas accès au dossier' using errcode = 'P0008'; end if;
  return a;
end $$;
revoke execute on function public.acces_dossier_par_jeton(uuid) from public, anon, authenticated;

create or replace function public.dossier_par_jeton(p_jeton uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  a acces_autorite%rowtype;
  d dossiers_securite%rowtype;
  ev evenements%rowtype;
begin
  a := acces_dossier_par_jeton(p_jeton);
  select * into d from dossiers_securite where evenement_id = a.evenement_id;
  if d.id is null or d.version_courante = 0 then
    raise exception 'Aucun dossier déposé pour cet événement' using errcode = 'P0009';
  end if;
  select * into ev from evenements where id = a.evenement_id;

  -- Une visite = une ouverture, pas chaque rafraîchissement (109).
  update acces_autorite
     set nb_acces = nb_acces + case when dernier_acces is null or dernier_acces < clock_timestamp() - interval '10 minutes' then 1 else 0 end,
         dernier_acces = clock_timestamp()
   where id = a.id;

  return jsonb_build_object(
    'destinataire', jsonb_build_object('libelle', a.libelle, 'organisation', a.organisation, 'discipline', a.discipline, 'niveau', a.niveau),
    'evenement', jsonb_build_object('nom', ev.nom, 'logo_url', ev.logo_url, 'commune', ev.commune, 'phase', ev.phase),
    'dossier', jsonb_build_object('id', d.id, 'statut', d.statut, 'version', d.version_courante, 'depose_le', d.depose_le,
                                  'decide_le', d.decide_le, 'niveau_dmp', d.niveau_dmp, 'score_dmp', d.score_dmp),
    'contenu', (select v.contenu from dossier_versions v where v.dossier_id = d.id and v.version = d.version_courante),
    'avis', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', av.id, 'discipline', av.discipline, 'avis', av.avis, 'commentaire', av.commentaire,
                        'echeance', av.echeance, 'rendu_le', av.rendu_le, 'rendu_par', av.rendu_par,
                        'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('texte', p.texte, 'caractere', p.caractere) order by p.created_at)
                                                   from prescriptions_dossier p where p.avis_id = av.id), '[]'::jsonb))
                      order by av.discipline)
                      from avis_autorite av where av.dossier_id = d.id and av.version = d.version_courante and av.remplace_le is null), '[]'::jsonb),
    'mon_avis', (select jsonb_build_object('id', av.id, 'avis', av.avis, 'commentaire', av.commentaire, 'echeance', av.echeance, 'rendu_le', av.rendu_le,
                        'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('texte', p.texte, 'caractere', p.caractere) order by p.created_at)
                                                   from prescriptions_dossier p where p.avis_id = av.id), '[]'::jsonb))
                 from avis_autorite av where av.dossier_id = d.id and av.version = d.version_courante and av.remplace_le is null
                  and av.acces_autorite_id = a.id limit 1),
    'consulte_le', now()
  );
end $$;

create or replace function public.deposer_avis(p_jeton uuid, p_avis text, p_commentaire text default null,
                                               p_prescriptions jsonb default '[]'::jsonb, p_echeance date default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  a acces_autorite%rowtype;
  d dossiers_securite%rowtype;
  v_id uuid;
  v_n integer := 0;
  p jsonb;
begin
  a := acces_dossier_par_jeton(p_jeton);
  if a.discipline is null then raise exception 'Cet accès n''a pas de discipline' using errcode = 'P0008'; end if;
  if p_avis not in ('favorable', 'favorable_conditions', 'defavorable') then
    raise exception 'Avis inconnu (favorable, favorable_conditions, defavorable)' using errcode = '22023';
  end if;
  select * into d from dossiers_securite where evenement_id = a.evenement_id for update;
  if d.id is null or d.version_courante = 0 then raise exception 'Aucun dossier déposé pour cet événement' using errcode = 'P0009'; end if;
  if d.statut not in ('depose', 'en_instruction') then
    raise exception 'Le dossier n''est pas en instruction (%)', d.statut using errcode = 'P0012';
  end if;

  -- Un avis par discipline et par version : le précédent est remplacé, jamais effacé.
  update avis_autorite set remplace_le = now()
   where dossier_id = d.id and version = d.version_courante and discipline = a.discipline and remplace_le is null;

  insert into avis_autorite (dossier_id, version, acces_autorite_id, discipline, avis, commentaire, echeance, rendu_par)
  values (d.id, d.version_courante, a.id, a.discipline, p_avis, nullif(btrim(p_commentaire), ''), p_echeance, coalesce(a.organisation, a.libelle))
  returning id into v_id;

  for p in select * from jsonb_array_elements(coalesce(p_prescriptions, '[]'::jsonb)) loop
    if coalesce(btrim(p ->> 'texte'), '') = '' then continue; end if;
    insert into prescriptions_dossier (dossier_id, avis_id, discipline, texte, caractere)
    values (d.id, v_id, a.discipline, btrim(p ->> 'texte'),
            case when p ->> 'caractere' = 'recommande' then 'recommande' else 'obligatoire' end);
    v_n := v_n + 1;
  end loop;

  if d.statut = 'depose' then
    update dossiers_securite set statut = 'en_instruction' where id = d.id;
  end if;

  insert into journal (evenement_id, source, module, categorie, texte, importance, objet_type, objet_id, objet_ref, auteur_nom, phase)
  select d.evenement_id, 'systeme', 'securite', 'dossier',
         format('Avis %s sur le dossier de sécurité (version %s) : %s%s', a.discipline, d.version_courante,
                case p_avis when 'favorable' then 'favorable' when 'favorable_conditions' then 'favorable sous conditions' else 'DÉFAVORABLE' end,
                case when v_n > 0 then format(', %s prescription(s)', v_n) else '' end),
         (case when p_avis = 'defavorable' then 'majeur' else 'notable' end)::importance_journal,
         'avis_autorite', v_id, a.discipline, coalesce(a.organisation, a.libelle), e.phase
  from evenements e where e.id = d.evenement_id;

  return jsonb_build_object('avis_id', v_id, 'discipline', a.discipline, 'version', d.version_courante,
                            'prescriptions', v_n, 'statut', case when d.statut = 'depose' then 'en_instruction' else d.statut end);
end $$;

create or replace function public.accuser_reception_dossier(p_jeton uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a acces_autorite%rowtype; d dossiers_securite%rowtype;
begin
  a := acces_dossier_par_jeton(p_jeton);
  if a.niveau <> 'instruction' then raise exception 'Seule la commune accuse réception' using errcode = 'P0008'; end if;
  select * into d from dossiers_securite where evenement_id = a.evenement_id for update;
  if d.id is null or d.version_courante = 0 then raise exception 'Aucun dossier déposé pour cet événement' using errcode = 'P0009'; end if;
  if d.statut = 'depose' then
    update dossiers_securite set statut = 'en_instruction' where id = d.id;
    insert into journal (evenement_id, source, module, categorie, texte, importance, objet_type, objet_id, objet_ref, auteur_nom, phase)
    select d.evenement_id, 'systeme', 'securite', 'dossier', format('La commune accuse réception du dossier de sécurité (version %s) : en instruction', d.version_courante),
           'notable'::importance_journal, 'dossiers_securite', d.id, 'v' || d.version_courante, coalesce(a.organisation, a.libelle), e.phase
    from evenements e where e.id = d.evenement_id;
  end if;
  return jsonb_build_object('statut', case when d.statut = 'depose' then 'en_instruction' else d.statut end, 'version', d.version_courante);
end $$;

comment on function public.dossier_par_jeton(uuid) is 'Le dossier déposé, lu par un lien de niveau avis ou instruction (159).';
comment on function public.deposer_avis(uuid, text, text, jsonb, date) is 'Rendre l''avis de sa discipline sur la version déposée, avec ses prescriptions (159).';
comment on function public.accuser_reception_dossier(uuid) is 'La commune accuse réception : le dossier passe en instruction (159).';

revoke all on function public.dossier_par_jeton(uuid), public.deposer_avis(uuid, text, text, jsonb, date), public.accuser_reception_dossier(uuid) from public;
grant execute on function public.dossier_par_jeton(uuid), public.deposer_avis(uuid, text, text, jsonb, date), public.accuser_reception_dossier(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. situation_autorite : un lien d'avis n'y entre pas (rebranchée en place)
-- ---------------------------------------------------------------------
do $m$
declare
  v_oid oid := 'public.situation_autorite(uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_motif text := $r$if not found then\s*raise exception 'Lien inconnu' using errcode = 'P0002';\s*end if;$r$;
  v_par text := $r$if not found then raise exception 'Lien inconnu' using errcode = 'P0002'; end if;
  if a.niveau in ('avis', 'instruction') then
    raise exception 'Ce lien donne accès au dossier de sécurité, pas à la situation' using errcode = 'P0007';
  end if;$r$;
  v_nb int;
begin
  if position('P0007' in v_def) > 0 then
    raise notice '159 : situation_autorite refuse déjà les liens d''avis, rien à faire.';
    return;
  end if;
  select count(*) into v_nb from regexp_matches(v_def, v_motif, 'g');
  if v_nb <> 1 then
    raise exception '159 : le contrôle du jeton est trouvé % fois dans situation_autorite (1 attendue). Rien n''a été modifié.', v_nb;
  end if;
  execute regexp_replace(v_def, v_motif, v_par);
  raise notice '159 : situation_autorite refuse désormais les liens de niveau avis et instruction (P0007).';
end
$m$;

-- ---------------------------------------------------------------------
-- 5. demarrer_controle (104) : les prescriptions des disciplines entrent
--    dans la check-list, avec leur prescription_id
-- ---------------------------------------------------------------------
create or replace function public.demarrer_controle(p_evenement uuid, p_modele_code text, p_sequence text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
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

  -- (159) Les prescriptions des disciplines, issues des avis en vigueur.
  insert into controles_lignes (session_id, section, ordre_section, ordre_item, libelle, prescription_id)
  select v_session, 'Prescriptions des disciplines', 998,
         row_number() over (order by p.discipline, p.created_at),
         p.discipline || ' — ' || p.texte || case when p.caractere = 'recommande' then ' (recommandé)' else '' end,
         p.id
  from prescriptions_dossier p
  join dossiers_securite d on d.id = p.dossier_id and d.evenement_id = p_evenement
  join avis_autorite av on av.id = p.avis_id and av.remplace_le is null;

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
end $$;

-- ---------------------------------------------------------------------
-- 6. RLS : lecture par les droits « référentiels », écriture par lien
-- ---------------------------------------------------------------------
alter table public.avis_autorite enable row level security;
alter table public.prescriptions_dossier enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'avis_autorite' and policyname = 'avis_autorite_lecture') then
    create policy avis_autorite_lecture on public.avis_autorite for select to authenticated
      using (exists (select 1 from dossiers_securite d where d.id = dossier_id
                       and (a_permission(d.evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(d.evenement_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prescriptions_dossier' and policyname = 'prescriptions_dossier_lecture') then
    create policy prescriptions_dossier_lecture on public.prescriptions_dossier for select to authenticated
      using (exists (select 1 from dossiers_securite d where d.id = dossier_id
                       and (a_permission(d.evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(d.evenement_id))));
  end if;
end $p$;

revoke all on public.avis_autorite, public.prescriptions_dossier from public, anon;
grant select on public.avis_autorite, public.prescriptions_dossier to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/159.sql)
--   select dossier_par_jeton('<jeton avis>') -> 'dossier';
--   select deposer_avis('<jeton avis>', 'favorable_conditions', 'RAS', '[{"texte":"Extincteur à chaque stand"}]');
-- =====================================================================
