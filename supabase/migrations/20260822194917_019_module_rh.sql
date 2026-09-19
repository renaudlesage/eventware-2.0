-- =====================================================================
-- Migration 019 : module RH / BÉNÉVOLES
--   1. creneaux     — besoins en postes, datés
--   2. affectations — qui couvre quoi, avec présence constatée
--   3. jalons       — échéances logistiques et artistes
--
-- Les personnes sont déjà dans membres_evenement : on n'ajoute que ce
-- qui manque, à savoir le temps et la couverture.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Droits. Le bénévole doit pouvoir confirmer sa propre présence :
-- sans ça, le planning reste déclaratif et personne ne sait qui est
-- réellement venu.
-- ---------------------------------------------------------------------
insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, 'rh', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier','supprimer']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('coordinateur','cloture','rh','lire');

insert into matrice_permissions (role, phase, ressource, action)
select 'chef_equipe', p, 'rh', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','creer','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
select 'benevole', p, 'rh', a
from unnest(array['preparation','montage','exploitation','demontage']::phase_evenement[]) p
cross join unnest(array['lire','modifier']::action_permission[]) a;

insert into matrice_permissions (role, phase, ressource, action)
values ('chef_equipe','cloture','rh','lire'),
       ('benevole','cloture','rh','lire');

-- ---------------------------------------------------------------------
-- 2. CRÉNEAUX
-- Un besoin en personnes, sur une plage horaire, à un poste.
-- ---------------------------------------------------------------------
create table creneaux (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  poste         text not null,
  equipe_id     uuid references equipes(id) on delete set null,
  lieu_id       uuid references lieux(id) on delete set null,

  debut         timestamptz not null,
  fin           timestamptz not null,
  phase         phase_evenement,

  besoin        integer not null default 1,
  consignes     text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code),
  check (fin > debut)
);

create index idx_creneaux_ev on creneaux (evenement_id, debut)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- 3. AFFECTATIONS
-- ---------------------------------------------------------------------
create type statut_affectation as enum (
  'propose','confirme','present','absent','annule'
);

create table affectations (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  creneau_id    uuid not null references creneaux(id) on delete cascade,
  membre_id     uuid references membres_evenement(id) on delete cascade,
  personne_libre text,                     -- renfort externe, non inscrit

  statut        statut_affectation not null default 'propose',
  confirme_le   timestamptz,
  pointe_le     timestamptz,
  commentaire   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,

  unique (creneau_id, membre_id)
);

create index idx_affectations_creneau on affectations (creneau_id)
  where deleted_at is null;
create index idx_affectations_membre on affectations (membre_id)
  where deleted_at is null;

create or replace function trg_cycle_affectation()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'confirme' and new.confirme_le is null then
      new.confirme_le := clock_timestamp();
    elsif new.statut = 'present' and new.pointe_le is null then
      new.pointe_le := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create trigger cycle_affectation before update on affectations
  for each row execute function trg_cycle_affectation();

-- ---------------------------------------------------------------------
-- 4. JALONS
-- Échéances datées : livraison chapiteau, arrivée d'un artiste,
-- balisage posé. S'articule avec le planning de montage.
-- ---------------------------------------------------------------------
create type statut_jalon as enum ('a_venir','en_cours','fait','rate','annule');

create table jalons (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  libelle       text not null,
  categorie     text,                      -- logistique, artiste, administratif
  echeance      timestamptz not null,
  lieu_id       uuid references lieux(id) on delete set null,
  responsable   text,
  contact       text,
  statut        statut_jalon not null default 'a_venir',
  fait_le       timestamptz,
  commentaire   text,
  critique      boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_jalons_ev on jalons (evenement_id, echeance)
  where deleted_at is null;

create or replace function trg_journal_jalon()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut
     and new.statut in ('fait','rate') then
    if new.statut = 'fait' and new.fait_le is null then
      update jalons set fait_le = clock_timestamp() where id = new.id;
    end if;
    perform journaliser(new.evenement_id, 'rh', 'jalon',
      'Jalon ' || new.libelle || ' → ' || new.statut,
      (case when new.statut = 'rate' or new.critique then 'notable' else 'routine' end)::importance_journal,
      'jalon', new.id, new.code);
  end if;
  return null;
end;
$$;

create trigger journal_jalon after update on jalons
  for each row execute function trg_journal_jalon();

-- ---------------------------------------------------------------------
-- 5. COUVERTURE DES CRÉNEAUX
-- La question utile n'est pas « qui est bénévole » mais « quel poste
-- n'est pas couvert ». C'est ce qui se règle en amont, ou pas du tout.
-- ---------------------------------------------------------------------
create or replace function couverture_creneaux(
  p_evenement uuid,
  p_depuis timestamptz default null
)
returns table (
  creneau_id uuid, code text, poste text, debut timestamptz, fin timestamptz,
  lieu text, besoin integer, confirmes integer, proposes integer,
  presents integer, manque integer
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  select c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin,
    count(*) filter (where a.statut in ('confirme','present'))::int,
    count(*) filter (where a.statut = 'propose')::int,
    count(*) filter (where a.statut = 'present')::int,
    greatest(c.besoin - count(*) filter (where a.statut in ('confirme','present')), 0)::int
  from creneaux c
  left join lieux l on l.id = c.lieu_id
  left join affectations a
    on a.creneau_id = c.id and a.deleted_at is null and a.statut <> 'annule'
  where c.evenement_id = p_evenement
    and c.deleted_at is null
    and (p_depuis is null or c.fin >= p_depuis)
  group by c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin
  order by c.debut, c.poste;
$$;

grant execute on function couverture_creneaux(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Traçabilité et RLS
-- ---------------------------------------------------------------------
create trigger tracabilite_creneaux before insert or update on creneaux
  for each row execute function trg_tracabilite();
create trigger tracabilite_affectations before insert or update on affectations
  for each row execute function trg_tracabilite_simple();
create trigger tracabilite_jalons before insert or update on jalons
  for each row execute function trg_tracabilite();

alter table creneaux     enable row level security;
alter table affectations enable row level security;
alter table jalons       enable row level security;

create policy creneaux_lecture on creneaux for select to authenticated
  using (a_permission(evenement_id,'rh','lire') and deleted_at is null);
create policy creneaux_creation on creneaux for insert to authenticated
  with check (a_permission(evenement_id,'rh','creer'));
create policy creneaux_modification on creneaux for update to authenticated
  using (a_permission(evenement_id,'rh','modifier'))
  with check (a_permission(evenement_id,'rh','modifier'));

-- Le bénévole peut modifier SA propre affectation (confirmer, se
-- décommander) sans pouvoir toucher à celle des autres.
create policy affectations_lecture on affectations for select to authenticated
  using (a_permission(evenement_id,'rh','lire') and deleted_at is null);

create policy affectations_creation on affectations for insert to authenticated
  with check (a_permission(evenement_id,'rh','creer'));

create policy affectations_modification on affectations for update to authenticated
  using (
    a_permission(evenement_id,'rh','creer')
    or membre_id in (
      select id from membres_evenement
      where evenement_id = affectations.evenement_id and user_id = auth.uid()
    )
  )
  with check (
    a_permission(evenement_id,'rh','creer')
    or membre_id in (
      select id from membres_evenement
      where evenement_id = affectations.evenement_id and user_id = auth.uid()
    )
  );

create policy jalons_lecture on jalons for select to authenticated
  using (a_permission(evenement_id,'rh','lire') and deleted_at is null);
create policy jalons_creation on jalons for insert to authenticated
  with check (a_permission(evenement_id,'rh','creer'));
create policy jalons_modification on jalons for update to authenticated
  using (a_permission(evenement_id,'rh','modifier'))
  with check (a_permission(evenement_id,'rh','modifier'));

commit;