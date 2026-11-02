-- =====================================================================
-- 155 — PROFIL DE SÉCURITÉ DE L'ORGANISATION (dossier de sécurité, étape 1)
--
-- Le dossier de sécurité d'une manifestation commence par
-- l'organisateur : son responsable légal, son assureur et son numéro de
-- police, son responsable sécurité joignable. Ces données ne changent
-- pas d'un événement à l'autre : elles vivent au niveau de
-- l'organisation, dans une table à part. `organisations` reste la table
-- du locataire, gérée par l'éditeur (statut, quota) : on n'y touche pas.
--
-- Qui lit : tout membre d'un événement de l'organisation
-- (`appartient_organisation`, 092). Qui écrit : qui gère les données
-- d'organisation — exploitant, ou membre d'un événement vivant dont le
-- rôle a tout pouvoir ou `referentiels : modifier` (même règle que
-- l'annuaire, 130). Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------
create table if not exists public.organisations_profil_securite (
  organisation_id      uuid primary key references public.organisations(id) on delete cascade,
  responsable_legal    text,          -- nom du responsable légal (président, gérant…)
  responsable_legal_tel text,
  assurance_compagnie  text,          -- compagnie d'assurance RC organisateur
  assurance_police     text,          -- numéro de police
  securite_nom         text,          -- responsable sécurité de l'organisation
  securite_tel         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  updated_by           uuid references auth.users(id)
);

comment on table public.organisations_profil_securite is
  'Profil de sécurité de l''organisation (155) : responsable légal, assurance, responsable sécurité. Repris dans chaque dossier de sécurité.';

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_profil_securite') then
    create trigger tracabilite_profil_securite before insert or update on public.organisations_profil_securite
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 2. Qui gère les données d'organisation
--    La règle est celle de l'annuaire (130) : une seule définition à
--    faire évoluer le jour où les deux divergent.
-- ---------------------------------------------------------------------
create or replace function public.peut_gerer_organisation(p_organisation uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select peut_gerer_annuaire(p_organisation);
$$;

create or replace function public.mes_droits_organisation(p_organisation uuid)
returns table (lire boolean, gerer boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select appartient_organisation(p_organisation), peut_gerer_organisation(p_organisation);
$$;

-- Le profil est-il complet ? Lu par les contrôles du dossier (156).
create or replace function public.profil_securite_manques(p_organisation uuid)
returns text[] language sql stable security invoker set search_path = public, pg_temp as $$
  select array_remove(array[
    case when coalesce(p.responsable_legal, '') = '' then 'responsable légal' end,
    case when coalesce(p.responsable_legal_tel, '') = '' then 'téléphone du responsable légal' end,
    case when coalesce(p.assurance_compagnie, '') = '' then 'compagnie d''assurance' end,
    case when coalesce(p.assurance_police, '') = '' then 'numéro de police' end,
    case when coalesce(p.securite_nom, '') = '' then 'responsable sécurité' end,
    case when coalesce(p.securite_tel, '') = '' then 'téléphone du responsable sécurité' end
  ], null)
  from (select * from organisations_profil_securite where organisation_id = p_organisation
        union all select p_organisation, null, null, null, null, null, null, now(), now(), null, null
        limit 1) p;
$$;

revoke execute on function public.peut_gerer_organisation(uuid), public.mes_droits_organisation(uuid),
                          public.profil_securite_manques(uuid) from public, anon;
grant  execute on function public.peut_gerer_organisation(uuid), public.mes_droits_organisation(uuid),
                          public.profil_securite_manques(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
alter table public.organisations_profil_securite enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'organisations_profil_securite' and policyname = 'profil_securite_lecture') then
    create policy profil_securite_lecture on public.organisations_profil_securite for select to authenticated
      using (appartient_organisation(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'organisations_profil_securite' and policyname = 'profil_securite_creation') then
    create policy profil_securite_creation on public.organisations_profil_securite for insert to authenticated
      with check (peut_gerer_organisation(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'organisations_profil_securite' and policyname = 'profil_securite_modification') then
    create policy profil_securite_modification on public.organisations_profil_securite for update to authenticated
      using (peut_gerer_organisation(organisation_id)) with check (peut_gerer_organisation(organisation_id));
  end if;
end $p$;

revoke all on public.organisations_profil_securite from public, anon;
grant select, insert, update on public.organisations_profil_securite to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/155.sql)
--   select * from mes_droits_organisation('<organisation>');
--   select profil_securite_manques('<organisation>');   -- {} quand tout est rempli
-- =====================================================================
