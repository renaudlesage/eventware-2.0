-- =====================================================================
-- Migration 025 : rôles personnalisables
-- ---------------------------------------------------------------------
-- Séparation de deux choses qui étaient fusionnées à tort :
--
--   Les CAPACITÉS (ressource × action × phase) restent figées au niveau
--   produit. C'est le vocabulaire du système, il ne s'invente pas.
--
--   Les RÔLES deviennent des données : un intitulé libre choisi par le
--   client — « Chef d'étape », « Dir-PC-Ops », « Responsable bar » — et
--   un paquet de capacités.
--
-- Le client compose avec ses mots, sans pouvoir inventer une capacité
-- inexistante : c'est ce qui évite le sur-mesure infini.
--
-- matrice_permissions n'est pas supprimée : elle devient le GABARIT
-- produit à partir duquel les rôles standard sont semés.
-- =====================================================================

begin;

create table roles (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  libelle       text not null,
  description   text,

  -- Rôle issu du gabarit produit. Renommable, mais non supprimable :
  -- supprimer « admin » enfermerait tout le monde dehors.
  systeme       boolean not null default false,

  -- Court-circuite toute vérification. Un seul rôle devrait le porter.
  tout_pouvoir  boolean not null default false,

  ordre         integer not null default 100,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_roles_ev on roles (evenement_id, ordre) where deleted_at is null;

create table role_capacites (
  role_id   uuid not null references roles(id) on delete cascade,
  ressource text not null,
  action    action_permission not null,
  phase     phase_evenement not null,
  primary key (role_id, ressource, action, phase)
);

create index idx_capacites_role on role_capacites (role_id);

comment on table role_capacites is
  'Droits ouverts pour un rôle. Absence de ligne = droit refusé.';

alter table membres_evenement
  add column role_id uuid references roles(id) on delete restrict;

create index idx_membres_role on membres_evenement (role_id);

-- ---------------------------------------------------------------------
-- Semis des rôles standard à partir du gabarit produit
-- ---------------------------------------------------------------------
create or replace function installer_roles_standard(p_evenement uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_role role_evenement;
  v_id uuid;
  v_n integer := 0;
  v_libelles constant jsonb := '{
    "admin":        {"libelle":"Administrateur","ordre":10,
                     "description":"Configure l''événement, les modules et les rôles."},
    "coordinateur": {"libelle":"Coordinateur","ordre":20,
                     "description":"Vue opérationnelle complète, décisions, main courante."},
    "chef_equipe":  {"libelle":"Chef d''équipe","ordre":30,
                     "description":"Son périmètre : son équipe, ses missions, édition sur le terrain."},
    "benevole":     {"libelle":"Bénévole","ordre":40,
                     "description":"Exécution : ses missions, sa fiche, sa carte."},
    "observateur":  {"libelle":"Observateur","ordre":50,
                     "description":"Lecture seule — commune, zone de secours, prestataire."}
  }'::jsonb;
begin
  foreach v_role in array enum_range(null::role_evenement)
  loop
    insert into roles (evenement_id, code, libelle, description, systeme,
                       tout_pouvoir, ordre, origine)
    values (
      p_evenement, v_role::text,
      v_libelles -> v_role::text ->> 'libelle',
      v_libelles -> v_role::text ->> 'description',
      true,
      v_role = 'admin',
      (v_libelles -> v_role::text ->> 'ordre')::int,
      'seed'
    )
    on conflict (evenement_id, code) do nothing
    returning id into v_id;

    if v_id is not null then
      v_n := v_n + 1;
      insert into role_capacites (role_id, ressource, action, phase)
      select v_id, mp.ressource, mp.action, mp.phase
      from matrice_permissions mp
      where mp.role = v_role
      on conflict do nothing;
    end if;
    v_id := null;
  end loop;

  return v_n;
end;
$$;

grant execute on function installer_roles_standard(uuid) to authenticated;

-- Tout nouvel événement reçoit les rôles standard
create or replace function trg_roles_nouvel_evenement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  perform installer_roles_standard(new.id);
  return null;
end;
$$;

create trigger roles_nouvel_evenement after insert on evenements
  for each row execute function trg_roles_nouvel_evenement();

-- ---------------------------------------------------------------------
-- Reprise de l'existant
-- ---------------------------------------------------------------------
do $$
declare e record;
begin
  for e in select id from evenements loop
    perform installer_roles_standard(e.id);
  end loop;
end $$;

update membres_evenement m
set role_id = r.id
from roles r
where r.evenement_id = m.evenement_id
  and r.code = m.role::text
  and m.role_id is null;

commit;