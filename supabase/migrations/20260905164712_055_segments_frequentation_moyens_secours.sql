-- =====================================================================
-- Migration 055 : segments de parcours, fréquentation, moyens de
-- secours dénombrés — les trois manques identifiés dans l'analyse de
-- faisabilité du dossier de sécurité.
-- =====================================================================

begin;

-- §9 du dossier — composition du chemin et distance de brancardage,
-- pas seulement une distance point à point.
create table segments_parcours (
  id                  uuid primary key default gen_random_uuid(),
  evenement_id        uuid not null references evenements(id) on delete cascade,
  depart_lieu_id      uuid references lieux(id),
  arrivee_lieu_id     uuid references lieux(id),
  libelle             text,
  distance_totale_m   integer,
  brancardage_max_m   integer,
  composition         jsonb not null default '[]'::jsonb,
  -- ex: [{"type":"chemin_forestier","distance_m":850},{"type":"voirie","distance_m":200}]
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_by          uuid references auth.users(id)
);

comment on column segments_parcours.brancardage_max_m is
  'Distance maximale à porter un blessé avant d''atteindre un point d''évacuation — indicateur direct de temps de réponse, pas une donnée décorative.';

-- §4.1 — fréquentation du site principal, distincte des effectifs de
-- balade déjà suivis par groupe.
alter table evenements add column frequentation_min integer;
alter table evenements add column frequentation_max integer;

-- §4.2 et §8 — un ratio d'encadrement cible, distinct de
-- l'accompagnateur nommé (une personne) déjà suivi par groupe.
alter table groupes add column ratio_encadrement integer;
comment on column groupes.ratio_encadrement is
  'Nombre de personnes d''encadrement visé pour ce groupe — distinct de accompagnateur_id, qui ne nomme qu''une seule personne responsable.';

-- §10 — moyens de première intervention dénombrés, distincts des
-- points DEA/extincteur déjà localisés sur le plan.
create table moyens_premiers_secours (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  type          text not null,   -- 'secouriste', 'trousse', 'ambulance', ...
  quantite      integer not null default 0,
  commentaire   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table segments_parcours enable row level security;
alter table moyens_premiers_secours enable row level security;

create policy segments_lecture on segments_parcours for select to authenticated
  using (est_membre(evenement_id));
create policy segments_ecriture on segments_parcours for all to authenticated
  using (a_permission(evenement_id,'lieux','creer'))
  with check (a_permission(evenement_id,'lieux','creer'));

create policy moyens_secours_lecture on moyens_premiers_secours for select to authenticated
  using (est_membre(evenement_id));
create policy moyens_secours_ecriture on moyens_premiers_secours for all to authenticated
  using (a_permission(evenement_id,'lieux','creer'))
  with check (a_permission(evenement_id,'lieux','creer'));

commit;