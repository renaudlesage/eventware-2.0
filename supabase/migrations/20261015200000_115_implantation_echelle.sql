-- =====================================================================
-- 115 — IMPLANTATION À L'ÉCHELLE (demande de Ren, 15/10)
--
-- « Placer à l'échelle, sur son lieu d'événement, les équipements mobiles
-- (groupe électrogène, remorque frigo, loges…) et les infrastructures
-- (chapiteau, scène, tonnelle, régie, foodtrucks…) ; un catalogue
-- d'équipements plaçables ; les dimensionner ; travailler par calques. »
-- Choix de Ren : on ÉTEND le plan d'implantation existant (une seule
-- carte du site), sur fond carte + plan calé, avec dès la première
-- version bilan énergie, réseau d'eau, contrôles de distances et métré.
--
-- 1. CATALOGUE (`catalogue_equipements`) : ce qu'on peut placer, avec
--    ses dimensions par défaut, son calque, sa catégorie du plan, sa
--    puissance (consommée ou produite), ses besoins en eau, s'il reçoit
--    du public, sa distance de sécurité. Deux étages : le catalogue
--    standard (organisation_id nul, tenu par l'exploitant) et celui de
--    chaque organisation (ses propres chapiteaux, ses remorques).
--
-- 2. OBJETS À L'ÉCHELLE : ce sont des `elements_plan`, pas une table à
--    côté. Ils gagnent un centre, une largeur, une longueur, une rotation
--    et les champs des bilans. `geometrie` garde le polygone calculé :
--    la vue secours, la page autorité, le dossier de sécurité et la
--    colonne de Situation, qui lisent déjà `elements_plan`, voient donc
--    les objets placés sans une ligne de code de plus.
--
-- 3. FONDS CALÉS (`fonds_plan` + compartiment privé `plans`) : une image
--    du terrain posée sur la carte par trois coins (nord-ouest,
--    nord-est, sud-ouest), avec une opacité.
--
-- 4. Codes : `unique (evenement_id, code)` compte aussi les lignes
--    supprimées, que l'application ne voit pas. Plutôt que de deviner un
--    code libre côté client (collision assurée après une suppression,
--    cf. 4.9 de l'audit), la base attribue le code d'un objet placé
--    sans code, sous verrou, comme à la 110.
--
-- 5. `supprimer_logiquement` accepte `elements_plan` (plan_implantation).
--
-- Aucun DROP (l'outil de Claude les refuse depuis le 14/10) : tout est
-- création ou remplacement.
-- =====================================================================

begin;

-- 1. Catalogue ---------------------------------------------------------

create table if not exists public.catalogue_equipements (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid references public.organisations(id) on delete cascade,
  code                text not null,
  libelle             text not null,
  calque              text not null default 'infrastructures'
                      check (calque in ('infrastructures','restauration','energie','eau','sanitaires','logistique','securite','circulation')),
  categorie           public.categorie_element not null default 'autre',
  forme               text not null default 'rect' check (forme in ('rect','cercle')),
  largeur_m           numeric(6,2) not null check (largeur_m > 0),
  longueur_m          numeric(6,2) not null check (longueur_m > 0),
  hauteur_m           numeric(6,2) check (hauteur_m is null or hauteur_m > 0),
  puissance_kw        numeric(7,2) not null default 0 check (puissance_kw >= 0),
  production_kva      numeric(7,1) not null default 0 check (production_kva >= 0),
  besoin_eau          boolean not null default false,
  source_eau          boolean not null default false,
  accueil_public      boolean not null default false,
  distance_securite_m numeric(5,1) not null default 0 check (distance_securite_m >= 0),
  est_risque          boolean not null default false,
  description         text,
  ordre               integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create unique index if not exists catalogue_code_standard on public.catalogue_equipements (code) where organisation_id is null;
create unique index if not exists catalogue_code_organisation on public.catalogue_equipements (organisation_id, code) where organisation_id is not null;

create trigger horodatage_catalogue_equipements before update on public.catalogue_equipements
  for each row execute function public.trg_horodatage();

alter table public.catalogue_equipements enable row level security;

create policy catalogue_equipements_lecture on public.catalogue_equipements for select to authenticated
  using (organisation_id is null or est_exploitant() or appartient_organisation(organisation_id));

-- Écrire : le standard, l'exploitant ; celui d'une organisation, qui peut
-- créer dans le plan d'implantation d'au moins un de ses événements.
create or replace function public.peut_ecrire_catalogue(p_organisation uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select est_exploitant()
      or (p_organisation is not null and exists (
            select 1 from evenements e
             where e.organisation_id = p_organisation and e.deleted_at is null
               and a_permission(e.id, 'plan_implantation', 'creer')));
$$;
revoke all on function public.peut_ecrire_catalogue(uuid) from public, anon;
grant execute on function public.peut_ecrire_catalogue(uuid) to authenticated;

create policy catalogue_equipements_creation on public.catalogue_equipements for insert to authenticated
  with check (peut_ecrire_catalogue(organisation_id));
create policy catalogue_equipements_modification on public.catalogue_equipements for update to authenticated
  using (peut_ecrire_catalogue(organisation_id)) with check (peut_ecrire_catalogue(organisation_id));
create policy catalogue_equipements_suppression on public.catalogue_equipements for delete to authenticated
  using (peut_ecrire_catalogue(organisation_id));

grant select, insert, update, delete on public.catalogue_equipements to authenticated;

-- Le catalogue standard. Dimensions et puissances courantes du marché
-- belge de la location événementielle : des valeurs de départ, que
-- chaque objet placé peut corriger.
insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, hauteur_m, puissance_kw, production_kva, besoin_eau, source_eau, accueil_public, distance_securite_m, est_risque, ordre, description)
values
  -- Infrastructures
  ('CHAP6x12',  'Chapiteau 6 × 12 m',          'infrastructures', 'autre', 'rect',  6, 12, 5, 0, 0, false, false, true, 0, false, 10, 'Structure aluminium, bâche ; 72 m², ~70 places assises'),
  ('CHAP10x20', 'Chapiteau 10 × 20 m',         'infrastructures', 'autre', 'rect', 10, 20, 6, 0, 0, false, false, true, 0, false, 11, '200 m², ~200 places assises'),
  ('CHAP15x30', 'Chapiteau 15 × 30 m',         'infrastructures', 'autre', 'rect', 15, 30, 7, 0, 0, false, false, true, 0, false, 12, '450 m²'),
  ('PAGODE5',   'Pagode 5 × 5 m',              'infrastructures', 'autre', 'rect',  5,  5, 5, 0, 0, false, false, true, 0, false, 13, null),
  ('TONN3x3',   'Tonnelle 3 × 3 m',            'infrastructures', 'autre', 'rect',  3,  3, 3, 0, 0, false, false, true, 0, false, 14, 'Tente pliante'),
  ('TONN3x6',   'Tonnelle 3 × 6 m',            'infrastructures', 'autre', 'rect',  3,  6, 3, 0, 0, false, false, true, 0, false, 15, null),
  ('SCENE8x6',  'Scène 8 × 6 m',               'infrastructures', 'scene', 'rect',  8,  6, 1.2, 0, 0, false, false, true, 0, false, 20, 'Praticables, hors couverture'),
  ('SCENE12x10','Scène couverte 12 × 10 m',    'infrastructures', 'scene', 'rect', 12, 10, 9, 0, 0, false, false, true, 0, false, 21, 'Avec toit et ailes'),
  ('PODIUM4x3', 'Podium 4 × 3 m',              'infrastructures', 'scene', 'rect',  4,  3, 0.8, 0, 0, false, false, true, 0, false, 22, null),
  ('REGIE',     'Régie son et lumière',        'infrastructures', 'autre', 'rect',  3,  3, 2.5, 3, 0, false, false, false, 0, false, 23, 'Tour ou praticable couvert, en fond de public'),
  ('SONO',      'Sonorisation façade (par côté)','infrastructures','autre','rect',  2,  2, 6, 8, 0, false, false, false, 0, false, 24, 'Puissance indicative par côté'),
  ('TRIBUNE',   'Tribune 10 × 5 m',            'infrastructures', 'autre', 'rect', 10,  5, 3, 0, 0, false, false, true, 0, false, 25, null),
  -- Restauration
  ('FOODTRUCK', 'Foodtruck',                   'restauration', 'foodtruck', 'rect', 2.5, 6, 3, 6, 0, true, false, false, 3, true, 30, 'Gaz à bord : 3 m des espaces public'),
  ('BAR6x3',    'Bar 6 × 3 m',                 'restauration', 'bar_installation', 'rect', 6, 3, 2.5, 5, 0, true, false, true, 0, false, 31, 'Tireuses, frigos de comptoir'),
  ('BAR10x3',   'Bar 10 × 3 m',                'restauration', 'bar_installation', 'rect', 10, 3, 2.5, 8, 0, true, false, true, 0, false, 32, null),
  ('BARCONT',   'Bar container 6 m',           'restauration', 'bar_installation', 'rect', 6, 2.4, 2.6, 6, 0, true, false, true, 0, false, 33, null),
  ('FRIGO',     'Remorque frigorifique',       'restauration', 'autre', 'rect', 2.5, 6, 3.5, 4, 0, false, false, false, 0, false, 34, 'Groupe froid 400 V'),
  ('BBQ',       'Barbecue / brasero',          'restauration', 'feu', 'rect', 1, 2, 1, 0, 0, false, false, false, 5, true, 35, 'Flamme nue : 5 m des toiles et du public'),
  -- Énergie
  ('GE20',      'Groupe électrogène 20 kVA',   'energie', 'groupe_electrogene', 'rect', 1.1, 2.5, 1.5, 0, 20, false, false, false, 3, true, 40, 'Insonorisé, ~600 kg'),
  ('GE60',      'Groupe électrogène 60 kVA',   'energie', 'groupe_electrogene', 'rect', 1.3, 3.3, 1.8, 0, 60, false, false, false, 3, true, 41, '~1,5 t'),
  ('GE100',     'Groupe électrogène 100 kVA',  'energie', 'groupe_electrogene', 'rect', 1.5, 4, 2, 0, 100, false, false, false, 3, true, 42, '~2,5 t, sur remorque'),
  ('GE200',     'Groupe électrogène 200 kVA',  'energie', 'groupe_electrogene', 'rect', 1.8, 4.8, 2.3, 0, 200, false, false, false, 3, true, 43, '~4 t, accès poids lourd'),
  ('ARMOIRE',   'Armoire de distribution',     'energie', 'coffret_electrique', 'rect', 0.8, 0.5, 1.5, 0, 0, false, false, false, 0, false, 44, 'Tableau divisionnaire, différentiels'),
  -- Eau
  ('BORNE',     'Point d''eau / borne',        'eau', 'point_eau', 'cercle', 0.6, 0.6, null, 0, 0, false, true, false, 0, false, 50, 'Raccord réseau'),
  ('CIT1000',   'Citerne 1 000 l',             'eau', 'point_eau', 'rect', 1, 1.2, 1.2, 0, 0, false, true, false, 0, false, 51, 'IBC'),
  ('CIT5000',   'Citerne 5 000 l',             'eau', 'point_eau', 'rect', 2, 2.5, 1.8, 0, 0, false, true, false, 0, false, 52, null),
  -- Sanitaires
  ('WC',        'Cabine WC autonome',          'sanitaires', 'autre', 'rect', 1.2, 1.2, 2.3, 0, 0, false, false, false, 0, false, 60, 'Sans raccord'),
  ('WCREM',     'Remorque sanitaire',          'sanitaires', 'autre', 'rect', 2.5, 6, 3, 2, 0, true, false, false, 0, false, 61, '4 à 6 WC, raccord eau'),
  ('DOUCHES',   'Remorque douches',            'sanitaires', 'autre', 'rect', 2.5, 6, 3, 9, 0, true, false, false, 0, false, 62, 'Chauffe-eau électrique'),
  ('LAVABO',    'Lave-mains',                  'sanitaires', 'autre', 'rect', 0.6, 1.5, 1, 0, 0, true, false, false, 0, false, 63, null),
  -- Logistique
  ('LOGE',      'Loge artistes (container)',   'logistique', 'autre', 'rect', 2.4, 6, 2.6, 3, 0, false, false, false, 0, false, 70, null),
  ('BUREAU',    'Bureau de chantier',          'logistique', 'autre', 'rect', 2.4, 6, 2.6, 3, 0, false, false, false, 0, false, 71, 'PC, accueil, caisse'),
  ('CONT20',    'Container 20 pieds',          'logistique', 'autre', 'rect', 2.44, 6.06, 2.6, 0, 0, false, false, false, 0, false, 72, 'Stockage'),
  ('CONT10',    'Container 10 pieds',          'logistique', 'autre', 'rect', 2.44, 2.99, 2.6, 0, 0, false, false, false, 0, false, 73, null),
  ('POUB1100',  'Conteneur déchets 1 100 l',   'logistique', 'autre', 'rect', 1.1, 1.4, 1.5, 0, 0, false, false, false, 0, false, 74, null),
  ('BENNE',     'Benne',                       'logistique', 'autre', 'rect', 2.5, 6, 2, 0, 0, false, false, false, 0, false, 75, null),
  -- Sécurité
  ('PS',        'Poste de secours (tente)',    'securite', 'poste_secours', 'rect', 3, 6, 3, 2, 0, true, false, false, 0, false, 80, null),
  ('PMA',       'PMA — poste médical avancé',  'securite', 'pma', 'rect', 5, 10, 3, 3, 0, true, false, false, 0, false, 81, null),
  ('EXTINCT',   'Extincteur',                  'securite', 'extincteur', 'cercle', 0.4, 0.4, null, 0, 0, false, false, false, 0, false, 82, null),
  ('DEA',       'DEA',                         'securite', 'dea', 'cercle', 0.5, 0.5, null, 0, 0, false, false, false, 0, false, 83, null),
  ('GAZ',       'Stockage gaz (cage)',         'securite', 'stockage_gaz', 'rect', 1, 2, 2, 0, 0, false, false, false, 5, true, 84, 'Bouteilles : 5 m du public et des toiles'),
  -- Circulation
  ('HERAS',     'Barrière Heras (3,5 m)',      'circulation', 'perimetre', 'rect', 3.5, 0.2, 2, 0, 0, false, false, false, 0, false, 90, null),
  ('NADAR',     'Barrière Nadar (2 m)',        'circulation', 'perimetre', 'rect', 2, 0.5, 1.1, 0, 0, false, false, false, 0, false, 91, null),
  ('CRASH',     'Crash barrier (1 m)',         'circulation', 'perimetre', 'rect', 1, 1.2, 1.2, 0, 0, false, false, false, 0, false, 92, 'Devant scène')
on conflict do nothing;

-- 2. Objets à l'échelle dans le plan ------------------------------------

alter table public.elements_plan
  add column if not exists catalogue_id        uuid references public.catalogue_equipements(id) on delete set null,
  add column if not exists calque              text check (calque is null or calque in ('infrastructures','restauration','energie','eau','sanitaires','logistique','securite','circulation')),
  add column if not exists forme_echelle       text check (forme_echelle is null or forme_echelle in ('rect','cercle')),
  add column if not exists centre_lat          double precision,
  add column if not exists centre_lon          double precision,
  add column if not exists largeur_m           numeric(6,2) check (largeur_m is null or largeur_m > 0),
  add column if not exists longueur_m          numeric(6,2) check (longueur_m is null or longueur_m > 0),
  add column if not exists rotation_deg        numeric(5,1) not null default 0,
  add column if not exists hauteur_m           numeric(6,2),
  add column if not exists puissance_kw        numeric(7,2) not null default 0 check (puissance_kw >= 0),
  add column if not exists production_kva      numeric(7,1) not null default 0 check (production_kva >= 0),
  add column if not exists alimente_par        uuid references public.elements_plan(id) on delete set null,
  add column if not exists besoin_eau          boolean not null default false,
  add column if not exists source_eau          boolean not null default false,
  add column if not exists raccord_eau         uuid references public.elements_plan(id) on delete set null,
  add column if not exists accueil_public      boolean not null default false,
  add column if not exists distance_securite_m numeric(5,1) not null default 0,
  add column if not exists fournisseur         text;

create index if not exists idx_elements_catalogue    on public.elements_plan (catalogue_id);
create index if not exists idx_elements_alimente_par on public.elements_plan (alimente_par);
create index if not exists idx_elements_raccord_eau  on public.elements_plan (raccord_eau);

-- Code attribué par la base pour un objet placé sans code (voir en-tête, 4).
-- security definer : la recherche du dernier numéro doit voir AUSSI les
-- lignes supprimées, que la policy de lecture cache à l'auteur (essai du
-- 15/10 : sans lui, le code d'un objet retiré était réattribué → 23505).
create or replace function public.trg_code_element_plan()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prefixe text;
  v_n int;
begin
  if coalesce(trim(new.code), '') <> '' then
    return new;
  end if;
  select upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')) into v_prefixe
    from catalogue_equipements where id = new.catalogue_id;
  v_prefixe := coalesce(nullif(left(v_prefixe, 8), ''), 'OBJ');
  perform pg_advisory_xact_lock(hashtext('code_element:' || new.evenement_id::text));
  select coalesce(max((regexp_match(code, '-(\d+)$'))[1]::int), 0) + 1 into v_n
    from elements_plan
   where evenement_id = new.evenement_id and code ~ ('^' || v_prefixe || '-\d+$');
  new.code := v_prefixe || '-' || lpad(v_n::text, 2, '0');
  return new;
end $$;

create trigger code_element_plan before insert on public.elements_plan
  for each row execute function public.trg_code_element_plan();

-- 3. Fonds calés ---------------------------------------------------------

create table if not exists public.fonds_plan (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references public.evenements(id) on delete cascade,
  nom           text not null,
  chemin        text not null,
  -- {"no":[lat,lon],"ne":[lat,lon],"so":[lat,lon]}
  coins         jsonb not null,
  opacite       numeric(3,2) not null default 0.6 check (opacite between 0 and 1),
  visible       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index if not exists idx_fonds_plan_evenement on public.fonds_plan (evenement_id);
create trigger horodatage_fonds_plan before update on public.fonds_plan
  for each row execute function public.trg_horodatage();
alter table public.fonds_plan enable row level security;
create policy fonds_plan_lecture on public.fonds_plan for select to authenticated
  using (a_permission(evenement_id, 'plan_implantation', 'lire'));
create policy fonds_plan_creation on public.fonds_plan for insert to authenticated
  with check (a_permission(evenement_id, 'plan_implantation', 'creer'));
create policy fonds_plan_modification on public.fonds_plan for update to authenticated
  using (a_permission(evenement_id, 'plan_implantation', 'modifier'))
  with check (a_permission(evenement_id, 'plan_implantation', 'modifier'));
create policy fonds_plan_suppression on public.fonds_plan for delete to authenticated
  using (a_permission(evenement_id, 'plan_implantation', 'modifier'));
grant select, insert, update, delete on public.fonds_plan to authenticated;

-- Compartiment privé : un plan de terrain n'a pas à se lire sur simple
-- connaissance de son adresse. Chemin : <evenement_id>/<fichier>.
-- Policy SELECT présente : l'écriture en upsert en a besoin (règle 4.12).
insert into storage.buckets (id, name, public) values ('plans', 'plans', false)
on conflict (id) do nothing;
create policy plans_lecture on storage.objects for select to authenticated
  using (bucket_id = 'plans' and est_membre(((storage.foldername(name))[1])::uuid));
create policy plans_ecriture on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and a_permission(((storage.foldername(name))[1])::uuid, 'plan_implantation', 'creer'));
create policy plans_remplacement on storage.objects for update to authenticated
  using (bucket_id = 'plans' and a_permission(((storage.foldername(name))[1])::uuid, 'plan_implantation', 'modifier'));
create policy plans_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and a_permission(((storage.foldername(name))[1])::uuid, 'plan_implantation', 'modifier'));

-- 5. Retirer un objet du plan -------------------------------------------

create or replace function public.supprimer_logiquement(p_table text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ressource text;
  v_evenement uuid;
  v_touchees  integer;
begin
  -- Liste blanche : table -> ressource contrôlée par a_permission.
  v_ressource := case p_table
    when 'jalons'            then 'rh'
    when 'groupes_travail'   then 'rh'
    when 'creneaux'          then 'rh'
    when 'equipes'           then 'equipes'
    when 'lieux'             then 'referentiels'
    when 'contacts'          then 'referentiels'
    when 'types_mission'     then 'referentiels'
    when 'materiel'          then 'logistique'
    when 'programme'         then 'referentiels'
    when 'fiches_reflexe'    then 'referentiels'
    when 'membres_evenement' then 'membres'
    when 'elements_plan'     then 'plan_implantation'   -- 115
    else null
  end;

  if v_ressource is null then
    raise exception 'Suppression logique non prévue pour « % ».', p_table
      using errcode = '42501';
  end if;

  execute format('select evenement_id from %I where id = $1 and deleted_at is null', p_table)
    into v_evenement using p_id;

  if v_evenement is null then
    -- Déjà supprimée, ou inexistante : rien à faire, et surtout rien à
    -- dire de plus — on ne renseigne pas un appelant sur l'existence
    -- d'un objet qu'il n'a peut-être pas le droit de voir.
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
