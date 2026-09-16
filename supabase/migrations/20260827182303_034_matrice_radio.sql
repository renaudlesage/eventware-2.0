-- ============ 034_matrice_radio ============
-- =====================================================================
-- Migration 034 : matrice radio
-- ---------------------------------------------------------------------
-- Deux objets distincts, souvent confondus :
--
--   le CANAL — une fréquence, un sous-ton, un usage. Il appartient au
--   dispositif et sert de plan de programmation des postes.
--
--   l'ATTRIBUTION — un poste confié à quelqu'un, avec son indicatif.
--   Elle existe déjà (table `attributions`, fusionnée avec le clefier).
--
-- Les confondre, c'est reprogrammer tous les postes quand une équipe
-- change de porteur.
--
-- Le sous-ton (CTCSS/DCS) ne filtre que l'écoute : il ne protège de
-- rien et n'empêche pas d'être entendu. Rappelé dans l'interface.
-- =====================================================================

begin;

create type bande_radio as enum ('pmr446', 'vhf', 'uhf', 'dmr', 'autre');

create table canaux_radio (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,

  numero        text not null,            -- « 3 », « CH7 », « A »
  libelle       text not null,            -- « Sécurité », « Logistique »
  bande         bande_radio not null default 'pmr446',
  frequence_mhz numeric(9,4),
  sous_ton      text,                     -- CTCSS 88.5 / DCS 023
  usage_prevu   text,
  equipe_id     uuid references equipes(id) on delete set null,

  -- Un canal doit rester libre de tout trafic courant.
  canal_urgence boolean not null default false,
  actif         boolean not null default true,
  ordre         integer not null default 100,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, numero)
);

create index idx_canaux_ev on canaux_radio (evenement_id, ordre)
  where deleted_at is null;

comment on column canaux_radio.sous_ton is
  'CTCSS ou DCS. Filtre l''écoute, ne chiffre rien : le trafic reste audible de quiconque écoute la fréquence sans sous-ton.';
comment on column canaux_radio.canal_urgence is
  'Canal réservé. Doit rester libre de tout trafic courant.';

-- L'attribution d'un poste porte désormais son indicatif et son canal
alter table attributions
  add column indicatif text,
  add column canal_id uuid references canaux_radio(id) on delete set null;

comment on column attributions.indicatif is
  'Indicatif d''appel du porteur — ALPHA 3, LOG 2. Suit la personne, pas le poste.';

create trigger tracabilite_canaux before insert or update on canaux_radio
  for each row execute function trg_tracabilite();

alter table canaux_radio enable row level security;

create policy canaux_lecture on canaux_radio for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);
create policy canaux_creation on canaux_radio for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));
create policy canaux_modification on canaux_radio for update to authenticated
  using (a_permission(evenement_id,'logistique','modifier'))
  with check (a_permission(evenement_id,'logistique','modifier'));

commit;;
