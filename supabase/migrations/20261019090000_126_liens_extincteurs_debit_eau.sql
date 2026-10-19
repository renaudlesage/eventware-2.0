-- =====================================================================
-- 126 — LIENS ENTRE OBJETS DU PLAN, EXTINCTEURS QUALIFIÉS, DÉBIT D'EAU
--
-- Retour de Ren sur l'éditeur d'implantation (19/10) :
--
--   1. liens_plan — un lien libre entre deux objets du plan (« ce bar
--      dépend de ce groupe », « cette tente est la régie de cette
--      scène »), avec une nature et une note. Les câbles et conduites
--      restent les liens techniques (118) ; ceci est le lien de bon
--      sens qu'on dessine au crayon sur un plan papier.
--   2. elements_plan.agent_extinction / capacite_extinction — un
--      extincteur a un agent (poudre ABC, CO2, eau + additif…) et une
--      capacité (kg ou L selon l'agent). Le catalogue en propose les
--      variantes courantes, à côté de l'extincteur générique.
--   3. elements_plan.debit_l_min — ce qu'un point d'eau fournit, ce
--      qu'un poste demande : le réseau d'eau se lit alors comme
--      l'unifilaire, avec une charge par source.
--
-- Idempotente (if not exists, create or replace), sans aucun DROP.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Liens libres entre objets
-- ---------------------------------------------------------------------
create table if not exists public.liens_plan (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references public.evenements(id) on delete cascade,
  de_id         uuid not null references public.elements_plan(id) on delete cascade,
  vers_id       uuid not null references public.elements_plan(id) on delete cascade,
  nature        text not null default 'lie'
                check (nature in ('lie','alimente','dessert','fait_partie','acces')),
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  check (de_id <> vers_id),
  unique (de_id, vers_id)
);
create index if not exists idx_liens_plan_evenement on public.liens_plan (evenement_id);
comment on table public.liens_plan is
  'Lien libre entre deux objets du plan d''implantation (nature : lie, alimente, dessert, fait_partie, acces). Les câbles et conduites sont des elements_plan de nature ligne, pas des liens.';

alter table public.liens_plan enable row level security;
do $p$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'liens_plan' and policyname = 'liens_plan_lecture') then
    create policy liens_plan_lecture on public.liens_plan for select to authenticated
      using (a_permission(evenement_id, 'plan_implantation', 'lire'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'liens_plan' and policyname = 'liens_plan_creation') then
    create policy liens_plan_creation on public.liens_plan for insert to authenticated
      with check (a_permission(evenement_id, 'plan_implantation', 'modifier'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'liens_plan' and policyname = 'liens_plan_modification') then
    create policy liens_plan_modification on public.liens_plan for update to authenticated
      using (a_permission(evenement_id, 'plan_implantation', 'modifier'))
      with check (a_permission(evenement_id, 'plan_implantation', 'modifier'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'liens_plan' and policyname = 'liens_plan_suppression') then
    create policy liens_plan_suppression on public.liens_plan for delete to authenticated
      using (a_permission(evenement_id, 'plan_implantation', 'modifier'));
  end if;
end $p$;
grant select, insert, update, delete on public.liens_plan to authenticated;

-- ---------------------------------------------------------------------
-- 2. Extincteurs : agent et capacité
-- ---------------------------------------------------------------------
alter table public.elements_plan
  add column if not exists agent_extinction     text
    check (agent_extinction is null or agent_extinction in ('eau','eau_additif','poudre_abc','poudre_bc','co2','mousse','classe_f','autre')),
  add column if not exists capacite_extinction  numeric(5,1) check (capacite_extinction is null or capacite_extinction > 0);
comment on column public.elements_plan.agent_extinction is
  'Extincteur : agent — eau (pulvérisée), eau_additif, poudre_abc, poudre_bc, co2, mousse, classe_f (huiles de friture), autre.';
comment on column public.elements_plan.capacite_extinction is
  'Extincteur : capacité, en kg (poudre, CO2) ou en litres (eau, eau + additif, mousse, classe F).';

alter table public.catalogue_equipements
  add column if not exists agent_extinction     text
    check (agent_extinction is null or agent_extinction in ('eau','eau_additif','poudre_abc','poudre_bc','co2','mousse','classe_f','autre')),
  add column if not exists capacite_extinction  numeric(5,1) check (capacite_extinction is null or capacite_extinction > 0);

-- Les variantes courantes, à côté de l'extincteur générique (EXTINCT, 115)
-- et du pictogramme (EXTPICTO, 117). Un pictogramme par variante : sur
-- le plan, c'est le panneau qu'on pose, et il porte ses propriétés.
insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, nature, picto, agent_extinction, capacite_extinction, ordre, description)
values
  ('EXT6ABC',  'Extincteur poudre ABC 6 kg',      'securite', 'extincteur', 'cercle', 0.5, 0.5, 'picto', 'extincteur', 'poudre_abc',  6, 89, 'Polyvalent : feux secs, liquides, gaz. Le standard des chapiteaux et bars'),
  ('EXT9ABC',  'Extincteur poudre ABC 9 kg',      'securite', 'extincteur', 'cercle', 0.5, 0.5, 'picto', 'extincteur', 'poudre_abc',  9, 89, 'Groupes électrogènes, stockage gaz'),
  ('EXT6EA',   'Extincteur eau + additif 6 L',    'securite', 'extincteur', 'cercle', 0.5, 0.5, 'picto', 'extincteur', 'eau_additif', 6, 89, 'Feux de solides et liquides, sans poudre : scènes, régies'),
  ('EXT2CO2',  'Extincteur CO2 2 kg',             'securite', 'extincteur', 'cercle', 0.5, 0.5, 'picto', 'extincteur', 'co2',         2, 89, 'Armoires et coffrets électriques'),
  ('EXT5CO2',  'Extincteur CO2 5 kg',             'securite', 'extincteur', 'cercle', 0.5, 0.5, 'picto', 'extincteur', 'co2',         5, 89, 'Régies, groupes électrogènes'),
  ('EXTF',     'Extincteur classe F 6 L',         'securite', 'extincteur', 'cercle', 0.5, 0.5, 'picto', 'extincteur', 'classe_f',    6, 89, 'Huiles et graisses de friture : foodtrucks, friteries')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Débit d'eau
-- ---------------------------------------------------------------------
alter table public.elements_plan
  add column if not exists debit_l_min numeric(7,1) check (debit_l_min is null or debit_l_min >= 0);
alter table public.catalogue_equipements
  add column if not exists debit_l_min numeric(7,1) check (debit_l_min is null or debit_l_min >= 0);
comment on column public.elements_plan.debit_l_min is
  'Eau, en l/min : ce qu''un point d''eau fournit (source_eau) ou ce qu''un poste demande (besoin_eau). Le réseau d''eau en fait une charge par source.';

commit;

-- =====================================================================
-- VÉRIFICATION
--   select count(*) from catalogue_equipements where agent_extinction is not null;  -- 6
--   insert into liens_plan (evenement_id, de_id, vers_id) values (...);           -- membre avec plan_implantation:modifier
-- =====================================================================
