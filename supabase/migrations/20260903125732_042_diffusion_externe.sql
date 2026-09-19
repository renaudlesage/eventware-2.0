-- =====================================================================
-- Migration 042 : diffusion externe des alertes
-- ---------------------------------------------------------------------
-- Compatibilité avec plateforme-crise et tout autre système : même
-- forme de table que son `canaux_diffusion` / `diffusions`, pour que
-- les deux produits parlent le même contrat sans jamais partager de
-- base. Le pont est un webhook, pas une dépendance d'infrastructure.
--
-- Fondement métier : une alerte urgente sur un événement qui dépasse
-- les moyens propres de l'organisateur est exactement ce qui, côté
-- commune, déclenche la phase communale (AR 16/02/2006, art. 7-8).
-- L'outil doit pouvoir porter ce signal vers l'extérieur.
-- =====================================================================

begin;

create table canaux_diffusion (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,

  libelle       text not null,          -- « Commune de Ferrières », « Astreinte D5 »
  url           text not null,
  secret_entete text,                   -- valeur d'un en-tête d'authentification, optionnel

  -- Niveaux d'alerte qui déclenchent l'envoi. Une simple information ne
  -- doit pas réveiller un système externe ; une urgence ou une
  -- évacuation, si.
  niveaux_declencheurs jsonb not null default '["urgence","evacuation"]'::jsonb,

  actif         boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

comment on column canaux_diffusion.secret_entete is
  'Transmis en en-tête X-Diffusion-Secret. Simple filtre de bruit, pas un mécanisme de sécurité fort — ne rien y mettre de sensible.';

create trigger tracabilite_canaux_diffusion before insert or update on canaux_diffusion
  for each row execute function trg_tracabilite_simple();

create table diffusions (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  alerte_id     uuid references alertes(id) on delete set null,
  canal_id      uuid references canaux_diffusion(id) on delete set null,

  statut        text not null default 'en_attente',  -- en_attente, ok, echec
  code_reponse  integer,
  erreur        text,

  tentee_le     timestamptz not null default clock_timestamp()
);

create index idx_diffusions_ev on diffusions (evenement_id, tentee_le desc);

alter table canaux_diffusion enable row level security;
alter table diffusions enable row level security;

create policy canaux_diffusion_lecture on canaux_diffusion for select to authenticated
  using (a_permission(evenement_id,'alertes','creer') and deleted_at is null);
create policy canaux_diffusion_creation on canaux_diffusion for insert to authenticated
  with check (a_permission(evenement_id,'alertes','creer'));
create policy canaux_diffusion_modification on canaux_diffusion for update to authenticated
  using (a_permission(evenement_id,'alertes','creer'))
  with check (a_permission(evenement_id,'alertes','creer'));

create policy diffusions_lecture on diffusions for select to authenticated
  using (a_permission(evenement_id,'alertes','creer'));

commit;