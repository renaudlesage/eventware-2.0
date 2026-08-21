-- =====================================================================
-- Migration 006 : signalements SOS participants
-- ---------------------------------------------------------------------
-- Seul endroit du système où du public écrit dans la base.
-- L'écriture passe exclusivement par creer_signalement() (migration 007) :
-- le rôle anon n'a AUCUN droit sur la table elle-même.
-- =====================================================================

begin;

-- Jeton public de l'événement — encodé dans le QR code.
-- Ne donne aucun droit de lecture, seulement celui de déposer.
alter table evenements
  add column jeton_public uuid not null default gen_random_uuid();

alter table evenements
  add constraint evenements_jeton_public_unique unique (jeton_public);

create type type_signalement as enum (
  'malaise','blessure','danger','materiel','egare','autre'
);

create type statut_signalement as enum (
  'recu','pris_en_charge','en_cours','clos','sans_suite'
);

create type gravite_signalement as enum ('mineur','modere','grave','critique');

create table signalements (
  id                uuid primary key default gen_random_uuid(),
  evenement_id      uuid not null references evenements(id) on delete cascade,

  -- Référence courte et lisible, à annoncer à la radio
  reference         text not null,

  -- Clé générée par le téléphone AVANT envoi.
  -- Garantit qu'un renvoi après coupure réseau ne crée pas de doublon.
  cle_client        uuid not null,

  type              type_signalement not null default 'autre',
  description       text,
  contact           text,

  latitude          double precision,
  longitude         double precision,
  precision_m       double precision,
  lieu_id           uuid references lieux(id) on delete set null,

  statut            statut_signalement not null default 'recu',
  gravite           gravite_signalement,

  emis_le           timestamptz,   -- heure du téléphone
  recu_le           timestamptz not null default clock_timestamp(),
  pris_en_charge_le timestamptz,
  clos_le           timestamptz,

  traite_par        uuid references auth.users(id),
  commentaire       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  deleted_at        timestamptz,

  unique (evenement_id, cle_client),
  unique (evenement_id, reference)
);

create index idx_signalements_ev on signalements (evenement_id, recu_le desc)
  where deleted_at is null;
create index idx_signalements_ouverts on signalements (evenement_id, statut)
  where deleted_at is null and statut in ('recu','pris_en_charge','en_cours');

comment on column signalements.emis_le is
  'Heure déclarée par le téléphone. L''écart avec recu_le mesure le temps passé en file d''attente hors réseau.';

create trigger tracabilite_signalements before insert or update on signalements
  for each row execute function trg_tracabilite_simple();

-- ---------------------------------------------------------------------
-- Horodatage automatique des changements de statut
-- ---------------------------------------------------------------------
create or replace function trg_statut_signalement()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'pris_en_charge' and new.pris_en_charge_le is null then
      new.pris_en_charge_le := clock_timestamp();
    end if;
    if new.statut in ('clos','sans_suite') and new.clos_le is null then
      new.clos_le := clock_timestamp();
    end if;
    new.traite_par := coalesce(auth.uid(), new.traite_par);
  end if;
  return new;
end;
$$;

create trigger statut_signalement before update on signalements
  for each row execute function trg_statut_signalement();

-- ---------------------------------------------------------------------
-- RLS : lecture et traitement par les membres, selon la matrice.
-- Rappel règle R2 : la lecture du SOS est toujours ouverte aux membres,
-- quelle que soit la phase. Aucune policy d'insertion pour anon :
-- le dépôt passe uniquement par la fonction de la migration 007.
-- ---------------------------------------------------------------------
alter table signalements enable row level security;

create policy signalements_lecture on signalements for select to authenticated
  using (a_permission(evenement_id,'sos','lire') and deleted_at is null);

create policy signalements_creation on signalements for insert to authenticated
  with check (a_permission(evenement_id,'sos','creer'));

create policy signalements_modification on signalements for update to authenticated
  using (a_permission(evenement_id,'sos','modifier'))
  with check (a_permission(evenement_id,'sos','modifier'));

commit;
