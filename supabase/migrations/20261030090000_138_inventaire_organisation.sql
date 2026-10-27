-- =====================================================================
-- 138 — INVENTAIRE DE L'ORGANISATION : PRÊT ET LOCATION DE MATÉRIEL
--       (demande de Bucolique Ferrières, 27/10)
--
-- Le matériel que possède l'organisation — tentes, sono, câbles,
-- tables — survit aux événements, comme l'annuaire des fournisseurs
-- (130). Deux tables au niveau de l'organisation :
--
--   inventaire        — une ligne par article : code INV-0001 (automatique),
--                       description, catégorie, quantité, emplacement,
--                       valeur HTVA unitaire, prix de location par jour.
--   prets_inventaire  — une sortie : qui emprunte ou loue (nom libre et
--                       contact), quel article, combien, depuis quand,
--                       retour prévu, retour effectif, prix convenu,
--                       responsable Buco (nom), notes. Prêt ou location.
--
-- Deux vues pour les écrans : `inventaire_etat` (sorti / disponible par
-- article) et `prets_inventaire_vue` (article, statut : sorti, en
-- retard, rendu). Le code INV-xxxx est ce que portent l'étiquette QR et
-- la puce NFC collées sur l'objet (lien ?materiel=INV-0001).
--
-- Droits : lecture pour tout membre d'un événement de l'organisation ;
-- écriture avec le même droit que l'annuaire (`peut_gerer_annuaire` :
-- referentiels:modifier sur un événement actif de l'organisation, ou
-- exploitant). Suppression logique par `supprimer_logiquement`, dont la
-- branche organisation s'élargit aux deux tables. Aucun DROP.
-- =====================================================================

begin;

create table if not exists public.inventaire (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  code            text not null default '',
  description     text not null,
  categorie       text,
  quantite        integer not null default 1 check (quantite >= 0),
  emplacement     text,
  valeur_htva     numeric(10,2) check (valeur_htva is null or valeur_htva >= 0),
  prix_location   numeric(10,2) check (prix_location is null or prix_location >= 0),
  notes           text,
  actif           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  deleted_at      timestamptz,
  origine         public.origine_donnee not null default 'humain'
);
create unique index if not exists inventaire_code_vivant
  on public.inventaire (organisation_id, code) where deleted_at is null;
create index if not exists idx_inventaire_organisation
  on public.inventaire (organisation_id) where deleted_at is null;
comment on table public.inventaire is
  'Matériel de l''organisation (138) : ce qu''elle possède, prête ou loue. Survit aux événements.';
comment on column public.inventaire.valeur_htva is 'Valeur unitaire hors TVA, pour l''assurance et la caution.';
comment on column public.inventaire.prix_location is 'Prix de location par jour, hors TVA ; vide : ne se loue pas.';

create table if not exists public.prets_inventaire (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations(id) on delete cascade,
  inventaire_id      uuid not null references public.inventaire(id) on delete restrict,
  quantite           integer not null default 1 check (quantite > 0),
  nature             text not null default 'pret' check (nature in ('pret', 'location')),
  loueur             text not null,
  loueur_contact     text,
  date_sortie        date not null default current_date,
  date_retour_prevue date,
  date_retour        date,
  prix               numeric(10,2) not null default 0 check (prix >= 0),
  responsable        text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  updated_by         uuid references auth.users(id),
  deleted_at         timestamptz,
  origine            public.origine_donnee not null default 'humain',
  constraint prets_inventaire_dates check (date_retour is null or date_retour >= date_sortie)
);
create index if not exists idx_prets_inventaire_organisation
  on public.prets_inventaire (organisation_id) where deleted_at is null;
create index if not exists idx_prets_inventaire_article
  on public.prets_inventaire (inventaire_id) where deleted_at is null;
comment on table public.prets_inventaire is
  'Sorties de matériel de l''organisation (138) : prêt ou location, retour prévu et effectif, prix convenu.';

-- Le code INV-0001, par organisation, posé à la création quand il manque.
create or replace function public.trg_code_inventaire()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $f$
declare v_n int;
begin
  if coalesce(trim(new.code), '') <> '' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('code_inventaire:' || new.organisation_id::text));
  select coalesce(max((regexp_match(code, '^INV-(\d+)$'))[1]::int), 0) + 1 into v_n
    from inventaire where organisation_id = new.organisation_id;
  new.code := 'INV-' || lpad(v_n::text, 4, '0');
  return new;
end $f$;

create or replace trigger code_inventaire
  before insert on public.inventaire
  for each row execute function public.trg_code_inventaire();
create or replace trigger tracabilite_inventaire
  before insert or update on public.inventaire
  for each row execute function public.trg_tracabilite();
create or replace trigger tracabilite_prets_inventaire
  before insert or update on public.prets_inventaire
  for each row execute function public.trg_tracabilite();

-- Les vues des écrans (droits de l'appelant).
create or replace view public.inventaire_etat
with (security_invoker = true) as
select i.*,
       coalesce(s.sorti, 0)::int as sorti,
       (i.quantite - coalesce(s.sorti, 0))::int as disponible,
       coalesce(n.nb_prets, 0)::int as nb_prets
from public.inventaire i
left join (
  select inventaire_id, sum(quantite) as sorti
  from public.prets_inventaire where deleted_at is null and date_retour is null
  group by inventaire_id
) s on s.inventaire_id = i.id
left join (
  select inventaire_id, count(*) as nb_prets
  from public.prets_inventaire where deleted_at is null
  group by inventaire_id
) n on n.inventaire_id = i.id
where i.deleted_at is null;

create or replace view public.prets_inventaire_vue
with (security_invoker = true) as
select p.*,
       i.code as materiel_code,
       i.description as materiel,
       i.emplacement,
       case
         when p.date_retour is not null then 'rendu'
         when p.date_retour_prevue is not null and p.date_retour_prevue < current_date then 'en_retard'
         else 'sorti'
       end as statut
from public.prets_inventaire p
join public.inventaire i on i.id = p.inventaire_id
where p.deleted_at is null;

-- Droits.
alter table public.inventaire enable row level security;
alter table public.prets_inventaire enable row level security;

do $p$
begin
  if not exists (select 1 from pg_policies where tablename = 'inventaire' and policyname = 'inventaire_lecture') then
    create policy inventaire_lecture on public.inventaire for select to authenticated
      using (appartient_organisation(organisation_id) and deleted_at is null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'inventaire' and policyname = 'inventaire_creation') then
    create policy inventaire_creation on public.inventaire for insert to authenticated
      with check (peut_gerer_annuaire(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'inventaire' and policyname = 'inventaire_modification') then
    create policy inventaire_modification on public.inventaire for update to authenticated
      using (peut_gerer_annuaire(organisation_id))
      with check (peut_gerer_annuaire(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prets_inventaire' and policyname = 'prets_inventaire_lecture') then
    create policy prets_inventaire_lecture on public.prets_inventaire for select to authenticated
      using (appartient_organisation(organisation_id) and deleted_at is null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prets_inventaire' and policyname = 'prets_inventaire_creation') then
    create policy prets_inventaire_creation on public.prets_inventaire for insert to authenticated
      with check (peut_gerer_annuaire(organisation_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prets_inventaire' and policyname = 'prets_inventaire_modification') then
    create policy prets_inventaire_modification on public.prets_inventaire for update to authenticated
      using (peut_gerer_annuaire(organisation_id))
      with check (peut_gerer_annuaire(organisation_id));
  end if;
end $p$;

grant select on public.inventaire_etat, public.prets_inventaire_vue to authenticated;

-- Suppression logique : la branche organisation s'élargit à l'inventaire.
create or replace function public.supprimer_logiquement(p_table text, p_id uuid)
returns boolean
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ressource text;
  v_evenement uuid;
  v_org uuid;
  v_touchees integer;
begin
  if p_table = 'fournisseurs' then
    select organisation_id into v_org from fournisseurs where id = p_id and deleted_at is null;
  elsif p_table = 'fournisseur_contacts' then
    select f.organisation_id into v_org from fournisseur_contacts c join fournisseurs f on f.id = c.fournisseur_id
     where c.id = p_id and c.deleted_at is null;
  elsif p_table = 'inventaire' then
    select organisation_id into v_org from inventaire where id = p_id and deleted_at is null;
  elsif p_table = 'prets_inventaire' then
    select organisation_id into v_org from prets_inventaire where id = p_id and deleted_at is null;
  end if;
  if p_table in ('fournisseurs', 'fournisseur_contacts', 'inventaire', 'prets_inventaire') then
    if v_org is null then return false; end if;
    if not peut_gerer_annuaire(v_org) then
      raise exception 'Suppression refusée : vous ne gérez pas l''annuaire de cette organisation.'
        using errcode = '42501';
    end if;
    -- Un article encore sorti ne se retire pas de l'inventaire.
    if p_table = 'inventaire' and exists (select 1 from prets_inventaire p where p.inventaire_id = p_id and p.deleted_at is null and p.date_retour is null) then
      raise exception 'Cet article est encore sorti : enregistre son retour d''abord.'
        using errcode = '23503';
    end if;
    execute format('update %I set deleted_at = now(), updated_by = auth.uid() where id = $1 and deleted_at is null', p_table)
      using p_id;
    get diagnostics v_touchees = row_count;
    return v_touchees > 0;
  end if;
  v_ressource := case p_table
    when 'jalons' then 'rh'
    when 'groupes_travail' then 'rh'
    when 'creneaux' then 'rh'
    when 'equipes' then 'equipes'
    when 'lieux' then 'referentiels'
    when 'contacts' then 'referentiels'
    when 'types_mission' then 'referentiels'
    when 'materiel' then 'logistique'
    when 'programme' then 'referentiels'
    when 'fiches_reflexe' then 'referentiels'
    when 'membres_evenement' then 'membres'
    when 'elements_plan' then 'plan_implantation'
    when 'fournisseur_evaluations' then 'analyse'
    when 'demandes_prix' then 'logistique'
    when 'demande_prix_lignes' then 'logistique'
    when 'consultations' then 'logistique'
    when 'commandes' then 'logistique'
    else null
  end;
  if v_ressource is null then
    raise exception 'Suppression logique non prévue pour « % ».', p_table
      using errcode = '42501';
  end if;
  if p_table = 'demande_prix_lignes' then
    select d.evenement_id into v_evenement from demande_prix_lignes l join demandes_prix d on d.id = l.demande_id
     where l.id = p_id and l.deleted_at is null;
  else
    execute format('select evenement_id from %I where id = $1 and deleted_at is null', p_table)
      into v_evenement using p_id;
  end if;
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
$function$;

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, description, disponible from inventaire_etat order by code;
--   select materiel_code, loueur, statut from prets_inventaire_vue;
--   insert into inventaire (organisation_id, description) values ('<org>', 'Essai') returning code;  -- INV-0001
-- =====================================================================
