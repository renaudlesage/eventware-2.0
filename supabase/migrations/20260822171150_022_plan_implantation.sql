-- ============ 022_plan_implantation ============
-- =====================================================================
-- Migration 022 : PLAN D'IMPLANTATION « as built »
-- ---------------------------------------------------------------------
-- Un seul objet pour l'élément de plan ET l'installation à risque :
-- un foodtruck est un point de la carte qui porte des attributs de
-- risque. Deux tables obligeraient à saisir deux fois et à les tenir
-- synchronisées — ce qui ne tient pas un vendredi de montage.
--
-- Principe de saisie : on est sur place, donc on ne dessine pas, on se
-- POSITIONNE. Le GPS donne le point, on confirme, on qualifie.
-- =====================================================================

begin;

create type forme_element as enum ('point','ligne','zone');

create type categorie_element as enum (
  -- Points à risque
  'foodtruck','groupe_electrogene','stockage_gaz','bar_installation','feu',
  -- Moyens de secours
  'extincteur','dea','point_eau','poste_secours','coupure_gaz','coffret_electrique',
  -- Circulation et évacuation
  'sortie_secours','cheminement','itineraire_evacuation','voie_engins',
  -- Réseaux
  'cable','tuyau',
  -- Zones
  'scene','bar','camping','parking','perimetre','zone_interdite',
  'autre'
);

create table elements_plan (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  nom           text not null,

  forme         forme_element not null default 'point',
  categorie     categorie_element not null default 'autre',

  -- [[lat,lon], …] — un seul couple pour un point
  geometrie     jsonb not null default '[]'::jsonb,
  precision_m   double precision,

  -- Attributs de risque. Renseignés seulement quand ils ont un sens :
  -- un extincteur n'a pas de mesure de maîtrise, un foodtruck oui.
  est_risque      boolean not null default false,
  description     text,
  mesures_maitrise text,
  organe_coupure  text,
  moyens_proximite text,
  responsable     text,
  contact         text,
  fiche_reflexe_id uuid references fiches_reflexe(id) on delete set null,

  -- Cycle « as built » : un élément prévu devient constaté sur site.
  confirme        boolean not null default false,
  confirme_le     timestamptz,
  confirme_par    uuid references membres_evenement(id) on delete set null,
  ecart_constate  text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_elements_ev on elements_plan (evenement_id, categorie)
  where deleted_at is null;
create index idx_elements_risque on elements_plan (evenement_id)
  where deleted_at is null and est_risque;
create index idx_elements_a_confirmer on elements_plan (evenement_id)
  where deleted_at is null and not confirme;

comment on column elements_plan.precision_m is
  'Précision GPS annoncée. 5 à 10 m sur téléphone, davantage sous couvert forestier — ne jamais laisser croire à une précision qu''on n''a pas.';
comment on column elements_plan.confirme is
  'false = prévu sur plan. true = constaté sur site lors de la tournée de reconnaissance.';

create trigger tracabilite_elements before insert or update on elements_plan
  for each row execute function trg_tracabilite();

-- Confirmation : horodatage automatique + trace au journal pour les
-- éléments à risque, qui sont ceux qui comptent en cas d'incident.
create or replace function trg_confirmation_element()
returns trigger language plpgsql as $$
begin
  if new.confirme and not old.confirme and new.confirme_le is null then
    new.confirme_le := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger confirmation_element before update on elements_plan
  for each row execute function trg_confirmation_element();

create or replace function trg_journal_element()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.est_risque and (tg_op = 'INSERT' or (new.confirme and not old.confirme)) then
    perform journaliser(new.evenement_id, 'securite', 'implantation',
      'Installation à risque ' ||
      (case when tg_op = 'INSERT' then 'déclarée' else 'confirmée sur site' end) ||
      ' : ' || new.nom || ' (' || new.categorie || ')',
      'notable'::importance_journal, 'element_plan', new.id, new.code);
  end if;
  return null;
end;
$$;

create trigger journal_element after insert or update on elements_plan
  for each row execute function trg_journal_element();

-- ---------------------------------------------------------------------
-- Tournée de reconnaissance : ce qui reste à confirmer sur site.
-- ---------------------------------------------------------------------
create or replace function plan_a_confirmer(p_evenement uuid)
returns table (
  id uuid, code text, nom text, categorie text,
  est_risque boolean, a_position boolean
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  select e.id, e.code, e.nom, e.categorie::text, e.est_risque,
         jsonb_array_length(e.geometrie) > 0
  from elements_plan e
  where e.evenement_id = p_evenement
    and e.deleted_at is null
    and not e.confirme
  order by e.est_risque desc, e.categorie, e.code;
$$;

grant execute on function plan_a_confirmer(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS — ressource 'plan_implantation', déjà dans la matrice.
-- Le chef d'équipe peut créer et confirmer en phases terrain : c'est
-- toute l'idée de déléguer la tournée de reconnaissance.
-- ---------------------------------------------------------------------
alter table elements_plan enable row level security;

create policy elements_lecture on elements_plan for select to authenticated
  using (a_permission(evenement_id,'plan_implantation','lire') and deleted_at is null);
create policy elements_creation on elements_plan for insert to authenticated
  with check (a_permission(evenement_id,'plan_implantation','creer'));
create policy elements_modification on elements_plan for update to authenticated
  using (a_permission(evenement_id,'plan_implantation','modifier'))
  with check (a_permission(evenement_id,'plan_implantation','modifier'));

commit;;
