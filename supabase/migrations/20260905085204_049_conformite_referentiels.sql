-- =====================================================================
-- Migration 049 : conformité et contrôles préalables — le référentiel
-- ---------------------------------------------------------------------
-- Architecture en deux couches, confirmée par la lecture du référentiel
-- RezonWal et des quatre check-lists BFMF 2026 :
--
--   RÉFÉRENTIEL (ce que dit la règle) : items numérotés, structurés
--   comme RezonWal lui-même (I/II/III/IV/V, avec sous-points [A][B]...).
--   Chaque item porte SA PROPRE condition de déclenchement — quel
--   critère du questionnaire le rend applicable — et, s'il y a lieu, un
--   seuil calculable (ex. 1 extincteur par 150 m²).
--
--   ANCRAGE LOCAL : le référentiel lui-même réserve une place à ça — la
--   section « Références locales » de chaque item RezonWal renvoie
--   explicitement au règlement de la zone de secours et à celui de la
--   commune. Une organisation peut compléter ou durcir un item du
--   référentiel national avec sa propre règle locale, sans jamais
--   modifier le texte source.
-- =====================================================================

begin;

create type portee_referentiel as enum ('national', 'zone_secours', 'zone_police', 'commune');

create table referentiels (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,        -- 'rezonwal', 'zs-vesdre-hoegne-poudre'...
  nom         text not null,
  portee      portee_referentiel not null,
  zone_nom    text,                        -- nom de la zone si portée locale
  version     text,
  actif       boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table referentiels is
  'Une source normative — RezonWal (base wallonne) ou le règlement propre à une zone de secours, une zone de police, une commune.';

create table referentiel_items (
  id              uuid primary key default gen_random_uuid(),
  referentiel_id  uuid not null references referentiels(id) on delete cascade,
  parent_id       uuid references referentiel_items(id) on delete cascade,

  code            text not null,     -- 'II.004.D', 'III.002.C'
  categorie       text not null,     -- 'generale' | 'structure' | 'activite' | 'risque'
  titre           text not null,

  -- Quel critère de questionnaire déclenche cet item. Vide + toujours_applicable
  -- = s'applique à tout événement, sans condition (section II du référentiel).
  toujours_applicable boolean not null default false,
  condition_cle   text,              -- 'structure.groupe_electrogene', 'activite.balade'...

  dispositions    text not null,     -- le texte normatif, tel quel
  seuils          jsonb,             -- ex. {"unite":"extincteur","par_m2":150}

  origine_page    integer,           -- traçabilité vers le PDF source
  created_at      timestamptz not null default now(),

  unique (referentiel_id, code)
);

comment on column referentiel_items.dispositions is
  'Texte normatif repris du référentiel. Ne jamais reformuler : c''est la formulation qui fait foi en cas de contrôle.';

-- Complément ou durcissement local d'un item — jamais une modification
-- du texte source, toujours un ajout à côté.
create table referentiel_locaux (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id) on delete cascade,
  referentiel_item_id uuid not null references referentiel_items(id) on delete cascade,

  zone_secours        text,
  zone_police         text,
  complement          text not null,
  renforce            boolean not null default true,  -- durcit (true) ou assouplit (false, rare)

  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),

  unique (organisation_id, referentiel_item_id)
);

comment on table referentiel_locaux is
  'L''ancrage local que le référentiel RezonWal réserve explicitement : le règlement propre à la zone de secours ou à la commune, en complément d''un item national.';

alter table referentiels enable row level security;
alter table referentiel_items enable row level security;
alter table referentiel_locaux enable row level security;

-- Le référentiel national est un bien commun : lecture ouverte à tout
-- membre authentifié, écriture réservée à l'exploitant (c'est un contenu
-- de plateforme, pas d'événement).
create policy referentiels_lecture on referentiels for select to authenticated using (true);
create policy referentiels_ecriture on referentiels for all to authenticated
  using (est_exploitant()) with check (est_exploitant());

create policy referentiel_items_lecture on referentiel_items for select to authenticated using (true);
create policy referentiel_items_ecriture on referentiel_items for all to authenticated
  using (est_exploitant()) with check (est_exploitant());

-- L'ancrage local, lui, appartient à l'organisation cliente.
create policy referentiel_locaux_lecture on referentiel_locaux for select to authenticated
  using (
    est_exploitant() or
    exists (select 1 from evenements e where e.organisation_id = referentiel_locaux.organisation_id and est_membre(e.id))
  );
create policy referentiel_locaux_ecriture on referentiel_locaux for all to authenticated
  using (
    est_exploitant() or
    exists (select 1 from evenements e where e.organisation_id = referentiel_locaux.organisation_id
            and a_permission(e.id,'referentiels','creer'))
  );

commit;