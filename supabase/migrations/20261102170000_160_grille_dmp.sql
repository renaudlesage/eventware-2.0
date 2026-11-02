-- =====================================================================
-- 160 — GRILLE DU DISPOSITIF MÉDICAL PRÉVENTIF (DMP, D2) (étape 5)
--
-- Le fonctionnaire PLANU classe le dispositif médical préventif d'une
-- manifestation en cinq niveaux à partir d'une grille à points. Les
-- seuils sont connus (questionnaire communal, modèle 2009) :
--   niveau 1 : moins de 10 points   niveau 2 : 11 à 20
--   niveau 3 : 21 à 30              niveau 4 : 31 à 35 (avis CoAMU)
--   niveau 5 : plus de 35 (avis CoAMU)
-- On retire 3 points si une ambulance agréée arrive en moins de
-- 10 minutes, 1 point s'il n'y a pas d'antécédent négatif.
--
-- Les POINTS des critères ne sont pas connus : cette migration pose la
-- grille, ses seuils, ses familles de critères et les deux correctifs
-- connus ; tout le reste se saisit par formulaire. Rien n'est inventé.
--
-- `calcul_dmp(evenement)` : score, niveau et détail par critère. Un
-- critère s'applique selon sa source : `frequentation` (fourchette de
-- public), `conformite` (case du questionnaire), `manuel` (coché pour
-- l'événement dans `dmp_reponses`). Le résultat est copié dans le
-- dossier au dépôt (`deposer_dossier` redéfinie).
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Les tables
-- ---------------------------------------------------------------------
create table if not exists public.grilles_dmp (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  libelle         text not null,
  province        text,                       -- portée : une province, ou null pour toutes
  organisation_id uuid references public.organisations(id) on delete cascade,  -- null : grille partagée
  version         text,
  actif           boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id)
);
comment on table public.grilles_dmp is 'Grille à points du dispositif médical préventif (160). Partagée (organisation null) ou propre à une organisation.';

create table if not exists public.grille_dmp_criteres (
  id            uuid primary key default gen_random_uuid(),
  grille_id     uuid not null references public.grilles_dmp(id) on delete cascade,
  code          text not null,
  libelle       text not null,
  famille       text not null,
  source        text not null default 'manuel' check (source in ('frequentation', 'conformite', 'manuel')),
  condition_cle text,                         -- conformite : « groupe.critere »
  seuil_min     integer,                      -- frequentation : public attendu entre seuil_min et seuil_max
  seuil_max     integer,
  points        integer not null default 0,
  ordre         integer not null default 100,
  unique (grille_id, code)
);
comment on table public.grille_dmp_criteres is 'Critères d''une grille DMP (160) : famille, source, points. Les points se saisissent par formulaire.';

create table if not exists public.grille_dmp_seuils (
  id          uuid primary key default gen_random_uuid(),
  grille_id   uuid not null references public.grilles_dmp(id) on delete cascade,
  niveau      integer not null check (niveau between 1 and 5),
  score_min   integer not null,
  score_max   integer,                        -- null : sans plafond
  avis_coamu  boolean not null default false,
  unique (grille_id, niveau)
);
comment on table public.grille_dmp_seuils is 'Bornes de score de chaque niveau DMP (160), et si le niveau appelle l''avis de la CoAMU.';

create table if not exists public.dmp_reponses (
  evenement_id uuid not null references public.evenements(id) on delete cascade,
  critere_id   uuid not null references public.grille_dmp_criteres(id) on delete cascade,
  coche        boolean not null default true,
  note         text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  primary key (evenement_id, critere_id)
);
comment on table public.dmp_reponses is 'Critères DMP à saisie manuelle cochés pour un événement (160).';

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_grilles_dmp') then
    create trigger tracabilite_grilles_dmp before insert or update on public.grilles_dmp
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 2. La grille initiale : seuils connus, familles, deux correctifs
-- ---------------------------------------------------------------------
insert into public.grilles_dmp (code, libelle, province, version, notes)
select 'PLANU_2009', 'Grille DMP — questionnaire communal (modèle 2009)', null, '2009',
       'Seuils et correctifs tirés du questionnaire type des cellules de sécurité communales. Les points des critères sont à saisir.'
where not exists (select 1 from public.grilles_dmp where code = 'PLANU_2009');

insert into public.grille_dmp_seuils (grille_id, niveau, score_min, score_max, avis_coamu)
select g.id, s.niveau, s.score_min, s.score_max, s.avis_coamu
from public.grilles_dmp g,
     (values (1, -100, 10, false), (2, 11, 20, false), (3, 21, 30, false), (4, 31, 35, true), (5, 36, null, true)) as s(niveau, score_min, score_max, avis_coamu)
where g.code = 'PLANU_2009'
  and not exists (select 1 from public.grille_dmp_seuils x where x.grille_id = g.id and x.niveau = s.niveau);

insert into public.grille_dmp_criteres (grille_id, code, libelle, famille, source, points, ordre)
select g.id, c.code, c.libelle, c.famille, c.source, c.points, c.ordre
from public.grilles_dmp g,
     (values
       ('TYPE',        'Type de manifestation',              'Type de manifestation',      'manuel', 0, 10),
       ('SITE',        'Aménagement du site',                'Aménagement du site',        'manuel', 0, 20),
       ('AFFLUENCE',   'Affluence attendue',                 'Affluence',                  'manuel', 0, 30),
       ('PUBLIC',      'Nature du public',                   'Public',                     'manuel', 0, 40),
       ('AGGRAVANT',   'Facteurs aggravants',                'Facteurs aggravants',        'manuel', 0, 50),
       ('SMUR',        'Délai d''intervention du SMUR',      'Délai d''intervention SMUR', 'manuel', 0, 60),
       ('AMBU_10MIN',  'Ambulance agréée à moins de 10 minutes', 'Correctifs',             'manuel', -3, 90),
       ('SANS_ANTECEDENT', 'Aucun antécédent négatif',       'Correctifs',                 'manuel', -1, 91)
     ) as c(code, libelle, famille, source, points, ordre)
where g.code = 'PLANU_2009'
  and not exists (select 1 from public.grille_dmp_criteres x where x.grille_id = g.id and x.code = c.code);

-- ---------------------------------------------------------------------
-- 3. Le calcul
-- ---------------------------------------------------------------------
create or replace function public.grille_dmp_pour(p_evenement uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  -- La grille de l'organisation d'abord, puis la grille partagée de la province, puis la grille partagée générale.
  select g.id from grilles_dmp g join evenements e on e.id = p_evenement
   where g.actif and (g.organisation_id = e.organisation_id or g.organisation_id is null)
     and (g.province is null or g.province = e.province)
   order by (g.organisation_id is not null) desc, (g.province is not null) desc, g.created_at
   limit 1;
$$;

create or replace function public.niveau_dmp_pour(p_grille uuid, p_score numeric)
returns table (niveau integer, avis_coamu boolean) language sql stable security definer set search_path = public, pg_temp as $$
  select s.niveau, s.avis_coamu from grille_dmp_seuils s
   where s.grille_id = p_grille and p_score >= s.score_min and (s.score_max is null or p_score <= s.score_max)
   order by s.niveau limit 1;
$$;

create or replace function public.calcul_dmp(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v_grille uuid;
  v_reponses jsonb;
  v_score integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_niveau integer;
  v_coamu boolean;
  c record;
  v_applique boolean;
begin
  if not a_permission(p_evenement, 'referentiels', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return null; end if;
  v_grille := grille_dmp_pour(p_evenement);
  if v_grille is null then return jsonb_build_object('grille', null, 'score', null, 'niveau', null, 'details', '[]'::jsonb); end if;
  select r.reponses into v_reponses from conformite_reponses r where r.evenement_id = p_evenement;

  for c in select k.*, (select coche from dmp_reponses d where d.evenement_id = p_evenement and d.critere_id = k.id) as coche
             from grille_dmp_criteres k where k.grille_id = v_grille order by k.ordre, k.code loop
    v_applique := case c.source
      when 'frequentation' then ev.frequentation_max is not null
                                and (c.seuil_min is null or ev.frequentation_max >= c.seuil_min)
                                and (c.seuil_max is null or ev.frequentation_max <= c.seuil_max)
      when 'conformite' then c.condition_cle is not null
                             and coalesce((v_reponses -> split_part(c.condition_cle, '.', 1) ->> split_part(c.condition_cle, '.', 2))::boolean, false)
      else coalesce(c.coche, false) end;
    if v_applique then v_score := v_score + c.points; end if;
    v_details := v_details || jsonb_build_object('id', c.id, 'code', c.code, 'libelle', c.libelle, 'famille', c.famille, 'source', c.source,
                                                 'points', c.points, 'applique', v_applique);
  end loop;

  select n.niveau, n.avis_coamu into v_niveau, v_coamu from niveau_dmp_pour(v_grille, v_score) n;
  return jsonb_build_object(
    'grille', (select jsonb_build_object('id', g.id, 'code', g.code, 'libelle', g.libelle, 'version', g.version, 'organisation_id', g.organisation_id) from grilles_dmp g where g.id = v_grille),
    'score', v_score, 'niveau', v_niveau, 'avis_coamu', coalesce(v_coamu, false),
    'points_a_saisir', (select count(*) from grille_dmp_criteres k where k.grille_id = v_grille and k.points = 0 and k.famille <> 'Correctifs'),
    'details', v_details);
end $$;

comment on function public.calcul_dmp(uuid) is 'Score, niveau DMP et détail par critère pour un événement, selon la grille applicable (160).';

-- Le dépôt copie le niveau et le score dans le dossier (157, redéfinie).
create or replace function public.deposer_dossier(p_evenement uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_dossier dossiers_securite%rowtype;
  v_bloquants text[];
  v_version integer;
  v_nom text;
  v_dmp jsonb;
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

  -- (160) Le DMP du moment, copié dans le dossier avant l'instantané.
  v_dmp := calcul_dmp(p_evenement);
  update dossiers_securite set niveau_dmp = (v_dmp ->> 'niveau')::int, score_dmp = (v_dmp ->> 'score')::numeric where id = v_dossier.id;

  v_version := v_dossier.version_courante + 1;
  select m.nom_affiche into v_nom from membres_evenement m where m.evenement_id = p_evenement and m.user_id = auth.uid() and m.deleted_at is null limit 1;
  insert into dossier_versions (dossier_id, version, contenu, auteur, auteur_nom)
  values (v_dossier.id, v_version, instantane_dossier(p_evenement) || jsonb_build_object('dmp', v_dmp), auth.uid(), v_nom);

  update dossiers_securite
     set statut = 'depose', version_courante = v_version, depose_le = now(), decide_le = null
   where id = v_dossier.id;

  perform journaliser(p_evenement, 'securite', 'dossier',
    format('Dossier de sécurité déposé (version %s)', v_version), 'notable', 'dossiers_securite', v_dossier.id, 'v' || v_version);

  return jsonb_build_object('dossier_id', v_dossier.id, 'version', v_version, 'statut', 'depose', 'niveau_dmp', v_dmp ->> 'niveau');
end $$;

revoke execute on function public.grille_dmp_pour(uuid), public.niveau_dmp_pour(uuid, numeric), public.calcul_dmp(uuid) from public, anon;
grant  execute on function public.grille_dmp_pour(uuid), public.niveau_dmp_pour(uuid, numeric), public.calcul_dmp(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS : grilles lisibles par tous les connectés ; une grille partagée
--    s'édite par l'exploitant, une grille d'organisation par qui gère
--    les données d'organisation ; les réponses par qui remplit la
--    conformité.
-- ---------------------------------------------------------------------
alter table public.grilles_dmp enable row level security;
alter table public.grille_dmp_criteres enable row level security;
alter table public.grille_dmp_seuils enable row level security;
alter table public.dmp_reponses enable row level security;

create or replace function public.peut_editer_grille_dmp(p_grille uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from grilles_dmp g where g.id = p_grille
                   and ((g.organisation_id is null and est_exploitant()) or (g.organisation_id is not null and peut_gerer_organisation(g.organisation_id))));
$$;
revoke execute on function public.peut_editer_grille_dmp(uuid) from public, anon;
grant  execute on function public.peut_editer_grille_dmp(uuid) to authenticated;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'grilles_dmp' and policyname = 'grilles_dmp_lecture') then
    create policy grilles_dmp_lecture on public.grilles_dmp for select to authenticated
      using (organisation_id is null or appartient_organisation(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'grilles_dmp' and policyname = 'grilles_dmp_creation') then
    create policy grilles_dmp_creation on public.grilles_dmp for insert to authenticated
      with check ((organisation_id is null and est_exploitant()) or (organisation_id is not null and peut_gerer_organisation(organisation_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'grilles_dmp' and policyname = 'grilles_dmp_modification') then
    create policy grilles_dmp_modification on public.grilles_dmp for update to authenticated
      using (peut_editer_grille_dmp(id)) with check (peut_editer_grille_dmp(id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'grille_dmp_criteres' and policyname = 'grille_dmp_criteres_lecture') then
    create policy grille_dmp_criteres_lecture on public.grille_dmp_criteres for select to authenticated
      using (exists (select 1 from grilles_dmp g where g.id = grille_id and (g.organisation_id is null or appartient_organisation(g.organisation_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'grille_dmp_criteres' and policyname = 'grille_dmp_criteres_ecriture') then
    create policy grille_dmp_criteres_ecriture on public.grille_dmp_criteres for all to authenticated
      using (peut_editer_grille_dmp(grille_id)) with check (peut_editer_grille_dmp(grille_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'grille_dmp_seuils' and policyname = 'grille_dmp_seuils_lecture') then
    create policy grille_dmp_seuils_lecture on public.grille_dmp_seuils for select to authenticated
      using (exists (select 1 from grilles_dmp g where g.id = grille_id and (g.organisation_id is null or appartient_organisation(g.organisation_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'grille_dmp_seuils' and policyname = 'grille_dmp_seuils_ecriture') then
    create policy grille_dmp_seuils_ecriture on public.grille_dmp_seuils for all to authenticated
      using (peut_editer_grille_dmp(grille_id)) with check (peut_editer_grille_dmp(grille_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dmp_reponses' and policyname = 'dmp_reponses_lecture') then
    create policy dmp_reponses_lecture on public.dmp_reponses for select to authenticated
      using (a_permission(evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dmp_reponses' and policyname = 'dmp_reponses_ecriture') then
    create policy dmp_reponses_ecriture on public.dmp_reponses for all to authenticated
      using (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id));
  end if;
end $p$;

revoke all on public.grilles_dmp, public.grille_dmp_criteres, public.grille_dmp_seuils, public.dmp_reponses from public, anon;
grant select, insert, update on public.grilles_dmp to authenticated;
grant select, insert, update, delete on public.grille_dmp_criteres, public.grille_dmp_seuils, public.dmp_reponses to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/160.sql)
--   select calcul_dmp('<evenement>');
--   select * from niveau_dmp_pour((select id from grilles_dmp where code = 'PLANU_2009'), 31);  -- 4, avis CoAMU
-- =====================================================================
