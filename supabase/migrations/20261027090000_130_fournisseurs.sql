-- =====================================================================
-- 130 — ANNUAIRE DES FOURNISSEURS (briefing du 26/10, migration 1 sur 2)
--
-- Première table métier au niveau de l'organisation : un loueur de
-- barrières, un sanitaire mobile, un groupe électrogène se rappellent
-- chaque année, et ce qui vaut est l'historique (prix de l'an dernier,
-- ponctualité, REX). Un annuaire par événement se recopierait et
-- perdrait les évaluations. Le fournisseur appartient donc à
-- `organisations` ; une demande de prix (131) appartient à un
-- événement et pointe vers des fournisseurs de son organisation.
--
--   fournisseurs            — la société, ses catégories, sa zone.
--   fournisseur_contacts    — les gens chez le fournisseur ; un principal.
--   fournisseur_evaluations — une note et un verdict par événement (REX).
--
-- Droits : lecture pour quiconque appartient à l'organisation
-- (`appartient_organisation`, gabarit de RLS de niveau organisation) ;
-- écriture pour qui a `referentiels : modifier` sur au moins un
-- événement actif de l'organisation (`peut_gerer_annuaire`). Les
-- évaluations s'écrivent avec `analyse : creer` sur l'événement.
--
-- Rien ne sort : ni la page autorité ni la vitrine ne lisent ces
-- tables, et on n'y met pas de `visible_autorite`.
--
-- Les catégories sont un référentiel produit, côté application
-- (`CATEGORIES_FOURNISSEUR` dans referentielsProduit.js, codes stables,
-- libellés modifiables) : `referentiels` / `referentiel_items` portent
-- les références réglementaires (dispositions, seuils, page d'origine)
-- et ne sont pas faits pour une liste de catégories. La colonne
-- `categories` garde les codes en texte, sans contrainte, pour que le
-- jeu évolue sans migration.
--
-- Idempotente : chaque objet est créé « s'il n'existe pas » et chaque
-- fonction est `create or replace`. Aucun DROP.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.fournisseurs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  nom             text not null,
  tva             text,                              -- BE 0123.456.789, libre, non validé
  adresse         text,
  site            text,
  telephone       text,
  email           text,
  categories      text[] not null default '{}',     -- codes de CATEGORIES_FOURNISSEUR
  zone            text,                              -- rayon d'action, libre
  notes           text,
  actif           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  origine         public.origine_donnee not null default 'humain'
);
create unique index if not exists fournisseurs_nom_vivant
  on public.fournisseurs (organisation_id, lower(nom)) where deleted_at is null;
create index if not exists idx_fournisseurs_organisation
  on public.fournisseurs (organisation_id) where deleted_at is null;
comment on table public.fournisseurs is
  'Annuaire des fournisseurs d''une organisation (130). Survit aux événements ; les demandes de prix (131) y pointent.';

create table if not exists public.fournisseur_contacts (
  id              uuid primary key default gen_random_uuid(),
  fournisseur_id  uuid not null references public.fournisseurs(id) on delete cascade,
  nom             text not null,
  fonction        text,                              -- commercial, planning, astreinte livraison
  telephone       text,
  email           text,
  principal       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz
);
create index if not exists idx_fournisseur_contacts_fournisseur
  on public.fournisseur_contacts (fournisseur_id) where deleted_at is null;

create table if not exists public.fournisseur_evaluations (
  id              uuid primary key default gen_random_uuid(),
  fournisseur_id  uuid not null references public.fournisseurs(id) on delete cascade,
  evenement_id    uuid not null references public.evenements(id) on delete cascade,
  note            smallint not null check (note between 1 and 5),
  verdict         text not null check (verdict in ('a_reprendre', 'sous_reserve', 'a_eviter')),
  commentaire     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  unique (fournisseur_id, evenement_id)              -- une évaluation par événement
);
create index if not exists idx_fournisseur_evaluations_evenement
  on public.fournisseur_evaluations (evenement_id) where deleted_at is null;
comment on table public.fournisseur_evaluations is
  'REX d''un fournisseur après un événement (130) : note 1..5 et verdict (à reprendre, sous réserve, à éviter).';

-- Traçabilité : `trg_tracabilite` lit `origine` (fournisseurs),
-- `trg_tracabilite_simple` s'en passe (contacts, évaluations).
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_fournisseurs' and tgrelid = 'public.fournisseurs'::regclass) then
    create trigger tracabilite_fournisseurs before insert or update on public.fournisseurs
      for each row execute function public.trg_tracabilite();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_fournisseur_contacts' and tgrelid = 'public.fournisseur_contacts'::regclass) then
    create trigger tracabilite_fournisseur_contacts before insert or update on public.fournisseur_contacts
      for each row execute function public.trg_tracabilite_simple();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_fournisseur_evaluations' and tgrelid = 'public.fournisseur_evaluations'::regclass) then
    create trigger tracabilite_fournisseur_evaluations before insert or update on public.fournisseur_evaluations
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- Un seul contact principal par fournisseur : le dernier coché gagne.
create or replace function public.trg_fournisseur_contact_principal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.principal and new.deleted_at is null then
    update fournisseur_contacts
       set principal = false
     where fournisseur_id = new.fournisseur_id and id <> new.id and principal;
  end if;
  return new;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'fournisseur_contact_principal' and tgrelid = 'public.fournisseur_contacts'::regclass) then
    create trigger fournisseur_contact_principal after insert or update of principal on public.fournisseur_contacts
      for each row execute function public.trg_fournisseur_contact_principal();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 2. Qui gère l'annuaire
--    Exploitant de plateforme, ou membre actif d'un événement vivant de
--    l'organisation dont le rôle a tout pouvoir ou `referentiels :
--    modifier` dans la phase courante de cet événement.
-- ---------------------------------------------------------------------
create or replace function public.peut_gerer_annuaire(p_organisation uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select est_exploitant() or exists (
    select 1
    from evenements e
    join membres_evenement m on m.evenement_id = e.id
                            and m.user_id = auth.uid() and m.actif and m.deleted_at is null
    join roles r on r.id = m.role_id and r.deleted_at is null
    where e.organisation_id = p_organisation
      and e.deleted_at is null and not e.archive
      and (r.tout_pouvoir or exists (
            select 1 from role_capacites c
            where c.role_id = r.id and c.ressource = 'referentiels'
              and c.action = 'modifier' and c.phase = e.phase))
  );
$$;

-- Pour l'application : lecture et gestion, en un appel.
create or replace function public.mes_droits_annuaire(p_organisation uuid)
returns table (lire boolean, gerer boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select appartient_organisation(p_organisation), peut_gerer_annuaire(p_organisation);
$$;

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
alter table public.fournisseurs enable row level security;
alter table public.fournisseur_contacts enable row level security;
alter table public.fournisseur_evaluations enable row level security;

do $p$
begin
  if not exists (select 1 from pg_policies where tablename = 'fournisseurs' and policyname = 'fournisseurs_lecture') then
    create policy fournisseurs_lecture on public.fournisseurs for select to authenticated
      using (deleted_at is null and appartient_organisation(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fournisseurs' and policyname = 'fournisseurs_creation') then
    create policy fournisseurs_creation on public.fournisseurs for insert to authenticated
      with check (peut_gerer_annuaire(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fournisseurs' and policyname = 'fournisseurs_modification') then
    create policy fournisseurs_modification on public.fournisseurs for update to authenticated
      using (peut_gerer_annuaire(organisation_id))
      with check (peut_gerer_annuaire(organisation_id));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'fournisseur_contacts' and policyname = 'fournisseur_contacts_lecture') then
    create policy fournisseur_contacts_lecture on public.fournisseur_contacts for select to authenticated
      using (deleted_at is null and exists (
        select 1 from fournisseurs f where f.id = fournisseur_id and appartient_organisation(f.organisation_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fournisseur_contacts' and policyname = 'fournisseur_contacts_creation') then
    create policy fournisseur_contacts_creation on public.fournisseur_contacts for insert to authenticated
      with check (exists (
        select 1 from fournisseurs f where f.id = fournisseur_id and peut_gerer_annuaire(f.organisation_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fournisseur_contacts' and policyname = 'fournisseur_contacts_modification') then
    create policy fournisseur_contacts_modification on public.fournisseur_contacts for update to authenticated
      using (exists (select 1 from fournisseurs f where f.id = fournisseur_id and peut_gerer_annuaire(f.organisation_id)))
      with check (exists (select 1 from fournisseurs f where f.id = fournisseur_id and peut_gerer_annuaire(f.organisation_id)));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'fournisseur_evaluations' and policyname = 'fournisseur_evaluations_lecture') then
    create policy fournisseur_evaluations_lecture on public.fournisseur_evaluations for select to authenticated
      using (deleted_at is null and appartient_organisation((select e.organisation_id from evenements e where e.id = evenement_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fournisseur_evaluations' and policyname = 'fournisseur_evaluations_creation') then
    create policy fournisseur_evaluations_creation on public.fournisseur_evaluations for insert to authenticated
      with check (a_permission(evenement_id, 'analyse', 'creer') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'fournisseur_evaluations' and policyname = 'fournisseur_evaluations_modification') then
    create policy fournisseur_evaluations_modification on public.fournisseur_evaluations for update to authenticated
      using (a_permission(evenement_id, 'analyse', 'creer') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'analyse', 'creer') or a_tout_pouvoir(evenement_id));
  end if;
end $p$;

-- Le fournisseur d'une évaluation appartient à l'organisation de l'événement.
create or replace function public.trg_fournisseur_evaluation_coherente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from fournisseurs f join evenements e on e.organisation_id = f.organisation_id
    where f.id = new.fournisseur_id and e.id = new.evenement_id
  ) then
    raise exception 'Le fournisseur n''appartient pas à l''organisation de l''événement' using errcode = '23514';
  end if;
  return new;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'fournisseur_evaluation_coherente' and tgrelid = 'public.fournisseur_evaluations'::regclass) then
    create trigger fournisseur_evaluation_coherente before insert or update on public.fournisseur_evaluations
      for each row execute function public.trg_fournisseur_evaluation_coherente();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 4. L'annuaire, en lecture
--    Une ligne par fournisseur avec son contact principal, ses
--    évaluations résumées. Les compteurs de consultations arrivent avec
--    la 131, qui redéfinit cette fonction ; ici ils valent 0.
-- ---------------------------------------------------------------------
create or replace function public.annuaire(p_organisation uuid, p_categorie text default null)
returns table (
  id uuid, nom text, tva text, adresse text, site text, telephone text, email text,
  categories text[], zone text, notes text, actif boolean,
  contact_id uuid, contact_nom text, contact_fonction text, contact_telephone text, contact_email text,
  nb_contacts integer, nb_consultations integer, nb_retenues integer,
  note_moyenne numeric, nb_evaluations integer, dernier_verdict text, derniere_evaluation timestamptz, dernier_evenement text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not appartient_organisation(p_organisation) then
    raise exception 'Lecture de l''annuaire non autorisée' using errcode = '42501';
  end if;
  return query
  select f.id, f.nom, f.tva, f.adresse, f.site, f.telephone, f.email, f.categories, f.zone, f.notes, f.actif,
    c.id, c.nom, c.fonction, c.telephone, c.email,
    (select count(*)::int from fournisseur_contacts x where x.fournisseur_id = f.id and x.deleted_at is null),
    0, 0,
    (select round(avg(v.note), 1) from fournisseur_evaluations v where v.fournisseur_id = f.id and v.deleted_at is null),
    (select count(*)::int from fournisseur_evaluations v where v.fournisseur_id = f.id and v.deleted_at is null),
    d.verdict, d.created_at, d.evenement
  from fournisseurs f
  left join lateral (
    select x.* from fournisseur_contacts x
    where x.fournisseur_id = f.id and x.deleted_at is null
    order by x.principal desc, x.created_at limit 1
  ) c on true
  left join lateral (
    select v.verdict, v.created_at, e.nom as evenement
    from fournisseur_evaluations v join evenements e on e.id = v.evenement_id
    where v.fournisseur_id = f.id and v.deleted_at is null
    order by v.created_at desc limit 1
  ) d on true
  where f.organisation_id = p_organisation and f.deleted_at is null
    and (p_categorie is null or p_categorie = any (f.categories))
  order by f.nom;
end $$;

-- ---------------------------------------------------------------------
-- 5. Épingler un fournisseur dans les contacts de l'événement
--    Copie, pas lien : l'opérationnel (Sécurité › Contacts) a besoin
--    d'un nom et d'un numéro, pas d'une fiche d'annuaire. Idempotent :
--    un contact vivant de même société et même courriel suffit.
--    `origine_donnee` n'a pas de valeur « systeme » : on écrit `humain`.
-- ---------------------------------------------------------------------
create or replace function public.epingler_fournisseur(p_evenement uuid, p_fournisseur uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f fournisseurs%rowtype; c fournisseur_contacts%rowtype;
  v_org uuid; v_id uuid; v_email text; v_n int;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Épinglage refusé : droits insuffisants sur les référentiels' using errcode = '42501';
  end if;
  select * into f from fournisseurs where id = p_fournisseur and deleted_at is null;
  select organisation_id into v_org from evenements where id = p_evenement;
  if f.id is null or v_org is null or f.organisation_id <> v_org then
    raise exception 'Fournisseur inconnu dans l''organisation de l''événement' using errcode = 'P0002';
  end if;
  select * into c from fournisseur_contacts
   where fournisseur_id = f.id and deleted_at is null
   order by principal desc, created_at limit 1;
  v_email := coalesce(c.email, f.email);

  select id into v_id from contacts
   where evenement_id = p_evenement and deleted_at is null
     and organisation = f.nom and coalesce(email, '') = coalesce(v_email, '')
   limit 1;
  if v_id is not null then return v_id; end if;

  perform pg_advisory_xact_lock(hashtext('contact-frn:' || p_evenement::text));
  select coalesce(max(substring(code from '^FRN-([0-9]+)$')::int), 0) + 1 into v_n
    from contacts where evenement_id = p_evenement;
  insert into contacts (evenement_id, code, nom, organisation, fonction, telephone, email, categorie, origine)
  values (p_evenement, 'FRN-' || lpad(v_n::text, 2, '0'),
          coalesce(c.nom, f.nom), f.nom, c.fonction,
          coalesce(c.telephone, f.telephone), v_email,
          f.categories[1], 'humain')
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Suppression logique : redéfinie en entier (base : 100 / 110) avec
--    les tables de l'annuaire. Celles-ci n'ont pas d'`evenement_id` :
--    le droit se lit sur l'organisation.
-- ---------------------------------------------------------------------
create or replace function public.supprimer_logiquement(p_table text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ressource text;
  v_evenement uuid;
  v_org       uuid;
  v_touchees  integer;
begin
  -- (130) Niveau organisation : fournisseurs et leurs contacts.
  if p_table = 'fournisseurs' then
    select organisation_id into v_org from fournisseurs where id = p_id and deleted_at is null;
  elsif p_table = 'fournisseur_contacts' then
    select f.organisation_id into v_org from fournisseur_contacts c join fournisseurs f on f.id = c.fournisseur_id
     where c.id = p_id and c.deleted_at is null;
  end if;
  if p_table in ('fournisseurs', 'fournisseur_contacts') then
    if v_org is null then return false; end if;
    if not peut_gerer_annuaire(v_org) then
      raise exception 'Suppression refusée : vous ne gérez pas l''annuaire de cette organisation.'
        using errcode = '42501';
    end if;
    execute format('update %I set deleted_at = now(), updated_by = auth.uid() where id = $1 and deleted_at is null', p_table)
      using p_id;
    get diagnostics v_touchees = row_count;
    return v_touchees > 0;
  end if;

  v_ressource := case p_table
    when 'jalons'                  then 'rh'
    when 'groupes_travail'         then 'rh'
    when 'creneaux'                then 'rh'
    when 'equipes'                 then 'equipes'
    when 'lieux'                   then 'referentiels'
    when 'contacts'                then 'referentiels'
    when 'types_mission'           then 'referentiels'
    when 'materiel'                then 'logistique'
    when 'programme'               then 'referentiels'
    when 'fiches_reflexe'          then 'referentiels'
    when 'membres_evenement'       then 'membres'
    when 'elements_plan'           then 'plan_implantation'
    when 'fournisseur_evaluations' then 'analyse'
    else null
  end;
  if v_ressource is null then
    raise exception 'Suppression logique non prévue pour « % ».', p_table
      using errcode = '42501';
  end if;
  execute format('select evenement_id from %I where id = $1 and deleted_at is null', p_table)
    into v_evenement using p_id;
  if v_evenement is null then
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

-- ---------------------------------------------------------------------
-- 7. Droits : retirer d'abord à PUBLIC et anon (090), puis accorder
-- ---------------------------------------------------------------------
revoke execute on function
  public.peut_gerer_annuaire(uuid),
  public.mes_droits_annuaire(uuid),
  public.annuaire(uuid, text),
  public.epingler_fournisseur(uuid, uuid),
  public.supprimer_logiquement(text, uuid)
from public, anon;

grant execute on function
  public.peut_gerer_annuaire(uuid),
  public.mes_droits_annuaire(uuid),
  public.annuaire(uuid, text),
  public.epingler_fournisseur(uuid, uuid),
  public.supprimer_logiquement(text, uuid)
to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (éditeur SQL, en simulant un coordinateur ; le bloc du
-- README de la 130 rejoue le scénario en transaction annulée)
--   select * from annuaire('<organisation>');
--   select epingler_fournisseur('<evenement>', '<fournisseur>');
-- =====================================================================
