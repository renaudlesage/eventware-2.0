-- =====================================================================
-- Migration 009 : socle du module SÉCURITÉ
--   1. journal      — main courante, alimentée automatiquement
--   2. recherches   — personne recherchée / enfant perdu
--   3. fiches_reflexe — doctrine, conduites à tenir
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. JOURNAL (main courante)
-- Différence majeure avec la v18 : il n'est plus seulement saisi, il est
-- ALIMENTÉ par les autres modules. Le REX généré se construit dessus.
-- ---------------------------------------------------------------------

create type source_journal as enum ('saisie','systeme');

create type importance_journal as enum ('routine','notable','majeur');

create table journal (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,

  horodatage    timestamptz not null default clock_timestamp(),
  source        source_journal not null default 'saisie',
  module        text,                      -- sos, logistique, parcours…
  categorie     text,
  texte         text not null,
  importance    importance_journal not null default 'routine',

  -- Rattachement à l'objet d'origine, sans contrainte forte :
  -- le journal doit survivre à la suppression de ce qu'il raconte.
  objet_type    text,
  objet_id      uuid,
  objet_ref     text,                      -- référence lisible (SOS-K7M2, LOG-012)

  phase         phase_evenement,
  auteur        uuid references auth.users(id),
  auteur_nom    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_journal_ev on journal (evenement_id, horodatage desc)
  where deleted_at is null;
create index idx_journal_objet on journal (objet_type, objet_id);

comment on table journal is
  'Main courante. Une entrée systeme est écrite par trigger ; une entrée saisie vient d''un opérateur. Le REX se génère à partir d''ici.';

create trigger tracabilite_journal before insert or update on journal
  for each row execute function trg_tracabilite_simple();

-- Écriture automatique, hors RLS (appelée par des triggers)
create or replace function journaliser(
  p_evenement uuid, p_module text, p_categorie text, p_texte text,
  p_importance importance_journal default 'routine',
  p_objet_type text default null, p_objet_id uuid default null,
  p_objet_ref text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into journal (evenement_id, source, module, categorie, texte,
                       importance, objet_type, objet_id, objet_ref, phase, auteur)
  values (p_evenement, 'systeme', p_module, p_categorie, p_texte,
          p_importance, p_objet_type, p_objet_id, p_objet_ref,
          (select phase from evenements where id = p_evenement),
          auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- 2. RECHERCHES (personne recherchée / enfant perdu)
-- Objet distinct du signalement : données structurées, diffusion
-- prioritaire, et une clôture qui doit être explicite.
-- ---------------------------------------------------------------------

create type statut_recherche as enum ('en_cours','retrouve','clos');

create table recherches (
  id                uuid primary key default gen_random_uuid(),
  evenement_id      uuid not null references evenements(id) on delete cascade,
  reference         text not null,

  nom               text,
  age_approx        integer,
  description       text not null,        -- vêtements, signes distinctifs
  dernier_lieu      text,
  dernier_lieu_id   uuid references lieux(id) on delete set null,
  vu_a              timestamptz,

  accompagnant_nom  text,
  accompagnant_tel  text,
  point_regroupement text,

  statut            statut_recherche not null default 'en_cours',
  retrouve_le       timestamptz,
  retrouve_par      text,
  circonstances     text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  deleted_at        timestamptz,

  unique (evenement_id, reference)
);

create index idx_recherches_ev on recherches (evenement_id, statut)
  where deleted_at is null;

create trigger tracabilite_recherches before insert or update on recherches
  for each row execute function trg_tracabilite_simple();

-- ---------------------------------------------------------------------
-- 3. FICHES RÉFLEXE (doctrine)
-- Consultables par TOUT membre, en toute phase : une conduite à tenir
-- qu'on ne peut pas lire au moment voulu ne sert à rien.
-- ---------------------------------------------------------------------

create table fiches_reflexe (
  id           uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements(id) on delete cascade,
  code         text not null,
  titre        text not null,
  categorie    text,
  declencheur  text,
  conduite     jsonb not null default '[]'::jsonb,   -- étapes ordonnées
  a_ne_pas_faire jsonb not null default '[]'::jsonb,
  contacts     text,
  ordre        integer not null default 100,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz,
  origine      origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_fiches_ev on fiches_reflexe (evenement_id, ordre)
  where deleted_at is null;

create trigger tracabilite_fiches before insert or update on fiches_reflexe
  for each row execute function trg_tracabilite();

-- ---------------------------------------------------------------------
-- 4. ALIMENTATION AUTOMATIQUE DU JOURNAL
-- ---------------------------------------------------------------------

create or replace function trg_journal_signalement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' — ' || new.type ||
      coalesce(' : ' || new.description, ''),
      'notable', 'signalement', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' → ' || new.statut,
      case when new.statut in ('clos','sans_suite') then 'routine' else 'notable' end,
      'signalement', new.id, new.reference);
  end if;
  return null;
end;
$$;

create trigger journal_signalement after insert or update on signalements
  for each row execute function trg_journal_signalement();

create or replace function trg_journal_recherche()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'securite', 'recherche',
      'RECHERCHE ' || new.reference || ' — ' || coalesce(new.nom,'personne non identifiée') ||
      ' : ' || new.description, 'majeur', 'recherche', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'securite', 'recherche',
      'Recherche ' || new.reference || ' → ' || new.statut ||
      coalesce(' (' || new.circonstances || ')', ''),
      'majeur', 'recherche', new.id, new.reference);
  end if;
  return null;
end;
$$;

create trigger journal_recherche after insert or update on recherches
  for each row execute function trg_journal_recherche();

-- Bascule de phase : déjà tracée dans bascule_phase, on la porte aussi
-- au journal pour que la chronologie du REX soit complète.
create or replace function trg_journal_phase()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.phase is distinct from old.phase then
    perform journaliser(new.id, 'noyau', 'phase',
      'Passage en phase ' || new.phase, 'majeur', 'evenement', new.id, null);
  end if;
  return null;
end;
$$;

create trigger journal_phase after update on evenements
  for each row execute function trg_journal_phase();

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------

alter table journal         enable row level security;
alter table recherches      enable row level security;
alter table fiches_reflexe  enable row level security;

-- Journal : lecture toujours ouverte aux membres (règle R2), écriture
-- selon la matrice. Aucune modification ni suppression : une main
-- courante qui se réécrit ne vaut rien.
create policy journal_lecture on journal for select to authenticated
  using (a_permission(evenement_id,'journal','lire') and deleted_at is null);

create policy journal_creation on journal for insert to authenticated
  with check (a_permission(evenement_id,'journal','creer'));

-- Recherches : même urgence que le SOS, donc même ressource.
create policy recherches_lecture on recherches for select to authenticated
  using (a_permission(evenement_id,'sos','lire') and deleted_at is null);

create policy recherches_creation on recherches for insert to authenticated
  with check (a_permission(evenement_id,'sos','creer'));

create policy recherches_modification on recherches for update to authenticated
  using (a_permission(evenement_id,'sos','modifier'))
  with check (a_permission(evenement_id,'sos','modifier'));

-- Fiches réflexe : lecture par TOUT membre en toute phase, sans passer
-- par la matrice. Une doctrine illisible au moment voulu est inutile.
create policy fiches_lecture on fiches_reflexe for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);

create policy fiches_creation on fiches_reflexe for insert to authenticated
  with check (a_permission(evenement_id,'referentiels','creer'));

create policy fiches_modification on fiches_reflexe for update to authenticated
  using (a_permission(evenement_id,'referentiels','modifier'))
  with check (a_permission(evenement_id,'referentiels','modifier'));

commit;