-- ============ 030_coordinateur_pilote_evenement ============
-- =====================================================================
-- Migration 030 : le coordinateur pilote l'événement
-- ---------------------------------------------------------------------
-- Le tout-pouvoir OPÉRATIONNEL passe de « admin » à « coordinateur ».
-- Le rôle « admin » disparaît du vocabulaire événement : au niveau
-- d'un événement, il n'y a plus d'administrateur — il y a un
-- coordinateur qui pilote, et un exploitant qui, lui, n'est pas
-- membre de l'événement.
--
-- Ce qui reste hors de portée du coordinateur, et qui est contrôlé en
-- base et non dans l'interface :
--   - l'activation des modules (c'est la licence)
--   - le rattachement à une organisation
-- =====================================================================

begin;

-- Le coordinateur devient le rôle qui passe partout dans son événement
update roles set tout_pouvoir = true, ordre = 10,
  description = 'Pilote l''événement : dispositif, équipes, rôles, phases, référentiels.'
where code = 'coordinateur';

-- L'ancien admin devient un rôle de reprise, sans pouvoir opérationnel
-- particulier. Il n'est pas supprimé : des membres y sont rattachés.
update roles set tout_pouvoir = false,
  libelle = 'Administrateur (hérité)',
  description = 'Rôle de la version précédente. À remplacer par Coordinateur.',
  ordre = 90
where code = 'admin';

-- Les membres qui étaient admin deviennent coordinateurs de leur événement
update membres_evenement m
set role_id = c.id
from roles a, roles c
where m.role_id = a.id
  and a.code = 'admin'
  and c.evenement_id = a.evenement_id
  and c.code = 'coordinateur';

-- Le gabarit produit suit, pour les événements à venir
update matrice_permissions set role = 'coordinateur' where role = 'admin';

-- Le semis initial doit désormais donner le tout-pouvoir au coordinateur
create or replace function installer_roles_standard(p_evenement uuid)
returns integer
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_role role_evenement;
  v_id uuid;
  v_n integer := 0;
  v_libelles constant jsonb := '{
    "coordinateur": {"libelle":"Coordinateur","ordre":10,
                     "description":"Pilote l''événement : dispositif, équipes, rôles, phases, référentiels."},
    "chef_equipe":  {"libelle":"Chef d''équipe","ordre":20,
                     "description":"Son périmètre : son équipe, ses missions, édition sur le terrain."},
    "benevole":     {"libelle":"Bénévole","ordre":30,
                     "description":"Exécution : ses missions, sa fiche, sa carte."},
    "observateur":  {"libelle":"Observateur","ordre":40,
                     "description":"Lecture seule — commune, zone de secours, prestataire."}
  }'::jsonb;
begin
  foreach v_role in array enum_range(null::role_evenement)
  loop
    -- « admin » n'existe plus au niveau d'un événement
    continue when v_role = 'admin';

    insert into roles (evenement_id, code, libelle, description, systeme,
                       tout_pouvoir, ordre, origine)
    values (
      p_evenement, v_role::text,
      v_libelles -> v_role::text ->> 'libelle',
      v_libelles -> v_role::text ->> 'description',
      true,
      v_role = 'coordinateur',
      (v_libelles -> v_role::text ->> 'ordre')::int,
      'seed'
    )
    on conflict (evenement_id, code) do nothing
    returning id into v_id;

    if v_id is not null then
      v_n := v_n + 1;
      insert into role_capacites (role_id, ressource, action, phase)
      select v_id, mp.ressource, mp.action, mp.phase
      from matrice_permissions mp where mp.role = v_role
      on conflict do nothing;
    end if;
    v_id := null;
  end loop;

  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Le créateur d'un événement en devient COORDINATEUR
-- ---------------------------------------------------------------------
create or replace function trg_admin_createur()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_role uuid;
begin
  if auth.uid() is null then return new; end if;

  select id into v_role from roles
  where evenement_id = new.id and code = 'coordinateur';

  insert into membres_evenement (evenement_id, user_id, role, role_id, origine)
  values (new.id, auth.uid(), 'coordinateur', v_role, 'humain')
  on conflict (evenement_id, user_id) do nothing;

  return new;
end;
$$;

-- Ordre des triggers : les rôles doivent exister avant l'affectation.
drop trigger if exists admin_createur on evenements;
drop trigger if exists roles_nouvel_evenement on evenements;

create trigger a_roles_nouvel_evenement after insert on evenements
  for each row execute function trg_roles_nouvel_evenement();
create trigger b_coordinateur_createur after insert on evenements
  for each row execute function trg_admin_createur();

commit;;
