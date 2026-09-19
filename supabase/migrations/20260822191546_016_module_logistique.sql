-- =====================================================================
-- Migration 016 : module LOGISTIQUE
--   1. ressource 'logistique' dans la matrice
--   2. mouvements_stock  — traçabilité des stocks (bars, étapes)
--   3. attributions      — clefier ET parc radio, objet unique
--   4. comptages         — jauge par point d'accès
--   5. transports        — demandes et courses
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Droits. Le bénévole peut SAISIR en phases terrain (comptage,
-- mouvement de stock, retour de clé) sans pouvoir rien supprimer :
-- c'est lui qui est devant l'objet, pas le coordinateur.
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, 'logistique', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier','supprimer']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('coordinateur','cloture','logistique','lire');

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'logistique', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'logistique', 'lire'
from unnest(array['preparation','cloture']::phase_evenement[]) p;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'logistique', a
from unnest(array['montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'logistique', 'lire'
from unnest(array['preparation','cloture']::phase_evenement[]) p;

insert into matrice_permissions (role, phase, ressource, action)
values ('observateur','exploitation','logistique','lire'),
       ('observateur','cloture','logistique','lire');

-- ---------------------------------------------------------------------
-- 2. MOUVEMENTS DE STOCK
-- materiel porte l'état courant ; ici on garde le fil de ce qui l'a
-- fait bouger. Sans ce fil, un écart d'inventaire est indébrouillable.
-- ---------------------------------------------------------------------
create type sens_mouvement as enum ('entree','sortie','ajustement','transfert');

create table mouvements_stock (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  materiel_id   uuid not null references materiel(id) on delete cascade,
  sens          sens_mouvement not null,
  quantite      numeric(10,2) not null,
  lieu_id       uuid references lieux(id) on delete set null,
  lieu_vers_id  uuid references lieux(id) on delete set null,
  motif         text,
  horodatage    timestamptz not null default clock_timestamp(),
  membre_id     uuid references membres_evenement(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_mouvements_ev on mouvements_stock (evenement_id, horodatage desc);
create index idx_mouvements_mat on mouvements_stock (materiel_id, horodatage desc);

-- Le stock courant suit le mouvement : une seule vérité.
create or replace function trg_appliquer_mouvement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_delta numeric(10,2);
begin
  v_delta := case new.sens
    when 'entree' then new.quantite
    when 'sortie' then -new.quantite
    when 'ajustement' then new.quantite      -- signé par l'appelant
    else 0 end;

  if v_delta <> 0 then
    update materiel set quantite = quantite + v_delta where id = new.materiel_id;
  end if;
  return null;
end;
$$;

create trigger appliquer_mouvement after insert on mouvements_stock
  for each row execute function trg_appliquer_mouvement();

-- Alerte au franchissement de seuil : le REX 2026 a montré que le
-- réapprovisionnement des étapes distantes pesait ~43 % de la charge.
create or replace function trg_alerte_seuil()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.seuil_alerte is not null
     and new.quantite <= new.seuil_alerte
     and (old.quantite is null or old.quantite > new.seuil_alerte) then
    perform journaliser(new.evenement_id, 'logistique', 'seuil',
      'Seuil atteint : ' || new.nom || ' (' || new.quantite ||
      coalesce(' ' || new.unite, '') || ', seuil ' || new.seuil_alerte || ')',
      'notable'::importance_journal, 'materiel', new.id, new.code);
  end if;
  return null;
end;
$$;

create trigger alerte_seuil after update on materiel
  for each row execute function trg_alerte_seuil();

-- ---------------------------------------------------------------------
-- 3. ATTRIBUTIONS — clefier et parc radio fusionnés
-- Même objet : un bien confié, un porteur, un retour attendu.
-- Couvre aussi gilets, badges, talkies, véhicules.
-- ---------------------------------------------------------------------
create type nature_attribution as enum ('cle','radio','equipement','vehicule','autre');

create table attributions (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references evenements(id) on delete cascade,
  nature         nature_attribution not null default 'equipement',
  code           text not null,               -- N° de clé, indicatif radio
  libelle        text not null,
  detail         text,                        -- canal, local ouvert…

  materiel_id    uuid references materiel(id) on delete set null,
  membre_id      uuid references membres_evenement(id) on delete set null,
  equipe_id      uuid references equipes(id) on delete set null,
  porteur_libre  text,                        -- externe, prestataire

  remis_le       timestamptz,
  rendu_le       timestamptz,
  etat_retour    text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz,
  origine        origine_donnee not null default 'humain'
);

create index idx_attributions_ev on attributions (evenement_id, nature)
  where deleted_at is null;
create index idx_attributions_encours on attributions (evenement_id)
  where deleted_at is null and rendu_le is null;

comment on table attributions is
  'Clefier et parc radio fusionnés : un bien confié, un porteur, un retour attendu. rendu_le NULL = toujours dehors.';

-- ---------------------------------------------------------------------
-- 4. COMPTAGES (jauge)
-- Écriture par lots : sur le terrain on saisit +5, pas cinq fois +1.
-- ---------------------------------------------------------------------
create table comptages (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  lieu_id       uuid references lieux(id) on delete set null,
  sens          sens_mouvement not null default 'entree',
  nombre        integer not null default 1,
  horodatage    timestamptz not null default clock_timestamp(),
  membre_id     uuid references membres_evenement(id) on delete set null,
  commentaire   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_comptages_ev on comptages (evenement_id, horodatage desc)
  where deleted_at is null;

-- Jauge instantanée par événement
create or replace function jauge_courante(p_evenement uuid)
returns integer
language sql stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(case when sens = 'entree' then nombre else -nombre end), 0)::int
  from comptages
  where evenement_id = p_evenement and deleted_at is null;
$$;

grant execute on function jauge_courante(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. TRANSPORTS
-- Cycle aligné sur les missions, mais objet distinct : un transport
-- porte un nombre de personnes, un départ et une arrivée.
-- ---------------------------------------------------------------------
create table transports (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references evenements(id) on delete cascade,
  reference      text not null,

  depart_lieu_id uuid references lieux(id) on delete set null,
  depart_libre   text,
  arrivee_lieu_id uuid references lieux(id) on delete set null,
  arrivee_libre  text,

  nb_personnes   integer not null default 1,
  motif          text,
  demandeur      text,
  contact        text,

  priorite       priorite_mission not null default 'P3',
  statut         statut_mission not null default 'a_traiter',
  chauffeur_id   uuid references membres_evenement(id) on delete set null,
  vehicule       text,

  souhaite_pour  timestamptz,
  prise_en_charge_le timestamptz,
  termine_le     timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz,
  origine        origine_donnee not null default 'humain',

  unique (evenement_id, reference)
);

create index idx_transports_ev on transports (evenement_id, statut)
  where deleted_at is null;

create or replace function trg_reference_transport()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare v_num int;
begin
  if new.reference is not null and new.reference <> '' then return new; end if;
  select coalesce(max(substring(reference from '[0-9]+$')::int), 0) + 1
    into v_num from transports where evenement_id = new.evenement_id;
  new.reference := 'TRSP-' || lpad(v_num::text, 3, '0');
  return new;
end;
$$;

create trigger reference_transport before insert on transports
  for each row execute function trg_reference_transport();

create or replace function trg_cycle_transport()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'en_cours' and new.prise_en_charge_le is null then
      new.prise_en_charge_le := clock_timestamp();
    elsif new.statut in ('resolue','annulee') and new.termine_le is null then
      new.termine_le := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create trigger cycle_transport before update on transports
  for each row execute function trg_cycle_transport();

-- ---------------------------------------------------------------------
-- 6. Traçabilité et journalisation
-- ---------------------------------------------------------------------
create trigger tracabilite_mouvements before insert or update on mouvements_stock
  for each row execute function trg_tracabilite_simple();
create trigger tracabilite_attributions before insert or update on attributions
  for each row execute function trg_tracabilite();
create trigger tracabilite_comptages before insert or update on comptages
  for each row execute function trg_tracabilite_simple();
create trigger tracabilite_transports before insert or update on transports
  for each row execute function trg_tracabilite();

create or replace function trg_journal_transport()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'logistique', 'transport',
      new.reference || ' — ' || new.nb_personnes || ' pers. ' ||
      coalesce(new.depart_libre,'?') || ' → ' || coalesce(new.arrivee_libre,'?'),
      'routine'::importance_journal, 'transport', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'logistique', 'transport',
      new.reference || ' → ' || new.statut,
      'routine'::importance_journal, 'transport', new.id, new.reference);
  end if;
  return null;
end;
$$;

create trigger journal_transport after insert or update on transports
  for each row execute function trg_journal_transport();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table mouvements_stock enable row level security;
alter table attributions     enable row level security;
alter table comptages        enable row level security;
alter table transports       enable row level security;

create policy mouvements_lecture on mouvements_stock for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy mouvements_creation on mouvements_stock for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));

create policy attributions_lecture on attributions for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy attributions_creation on attributions for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));
create policy attributions_modification on attributions for update to authenticated
  using (a_permission(evenement_id,'logistique','modifier'))
  with check (a_permission(evenement_id,'logistique','modifier'));

create policy comptages_lecture on comptages for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy comptages_creation on comptages for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));

create policy transports_lecture on transports for select to authenticated
  using (a_permission(evenement_id,'logistique','lire') and deleted_at is null);
create policy transports_creation on transports for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));
create policy transports_modification on transports for update to authenticated
  using (a_permission(evenement_id,'logistique','modifier'))
  with check (a_permission(evenement_id,'logistique','modifier'));

commit;