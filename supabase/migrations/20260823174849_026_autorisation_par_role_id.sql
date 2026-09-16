-- ============ 026_autorisation_par_role_id ============
-- =====================================================================
-- Migration 026 : l'autorisation s'appuie sur role_id
-- ---------------------------------------------------------------------
-- a_permission garde sa signature : toutes les policies existantes
-- continuent de fonctionner sans être réécrites. Seule sa mécanique
-- interne change — elle interroge role_capacites au lieu de la matrice
-- produit.
--
-- Les trois règles de sûreté restent codées en dur, pas paramétrables :
--   R1 — un rôle « tout pouvoir » n'est jamais bloqué
--   R2 — la lecture de sos, alertes et journal est toujours ouverte
--   R3 — la phase ne restreint jamais la lecture du critique
-- Un client qui compose ses rôles ne peut donc pas, par maladresse,
-- enfermer quelqu'un dehors au pire moment.
-- =====================================================================

begin;

create or replace function role_id_dans(p_evenement uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role_id from membres_evenement m
  where m.evenement_id = p_evenement and m.user_id = auth.uid()
    and m.actif = true and m.deleted_at is null
  limit 1;
$$;

create or replace function a_tout_pouvoir(p_evenement uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select r.tout_pouvoir from roles r
    where r.id = role_id_dans(p_evenement) and r.deleted_at is null
  ), false);
$$;

create or replace function a_permission(
  p_evenement uuid,
  p_ressource text,
  p_action    action_permission
)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_role  uuid;
  v_phase phase_evenement;
begin
  v_role := role_id_dans(p_evenement);
  if v_role is null then
    return false;
  end if;

  -- R1
  if (select tout_pouvoir from roles where id = v_role) then
    return true;
  end if;

  -- R2 / R3
  if p_action = 'lire' and p_ressource in ('sos', 'alertes', 'journal') then
    return true;
  end if;

  v_phase := phase_courante(p_evenement);

  return exists (
    select 1 from role_capacites c
    where c.role_id = v_role
      and c.ressource = p_ressource
      and c.action = p_action
      and c.phase = v_phase
  );
end;
$$;

-- Les deux policies qui comparaient l'énuméré directement
drop policy if exists evenements_modification on evenements;
create policy evenements_modification on evenements for update to authenticated
  using (a_tout_pouvoir(id))
  with check (a_tout_pouvoir(id));

-- Gestion des rôles : réservée au rôle qui a tout pouvoir.
alter table roles          enable row level security;
alter table role_capacites enable row level security;

create policy roles_lecture on roles for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);
create policy roles_creation on roles for insert to authenticated
  with check (a_tout_pouvoir(evenement_id));
create policy roles_modification on roles for update to authenticated
  using (a_tout_pouvoir(evenement_id))
  with check (a_tout_pouvoir(evenement_id));

create policy capacites_lecture on role_capacites for select to authenticated
  using (exists (select 1 from roles r
                 where r.id = role_capacites.role_id and est_membre(r.evenement_id)));
create policy capacites_creation on role_capacites for insert to authenticated
  with check (exists (select 1 from roles r
                      where r.id = role_capacites.role_id and a_tout_pouvoir(r.evenement_id)));
create policy capacites_suppression on role_capacites for delete to authenticated
  using (exists (select 1 from roles r
                 where r.id = role_capacites.role_id and a_tout_pouvoir(r.evenement_id)));

-- ---------------------------------------------------------------------
-- Ce que je peux faire, ici et maintenant.
-- Permet à l'interface de se composer d'après les capacités réelles
-- plutôt que d'après une liste de rôles codée en dur — sinon un rôle
-- créé par le client n'aurait aucun écran.
-- ---------------------------------------------------------------------
create or replace function mes_capacites(p_evenement uuid)
returns table (ressource text, action text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with r as (select role_id_dans(p_evenement) as id),
       p as (select phase_courante(p_evenement) as phase)
  select distinct c.ressource, c.action::text
  from role_capacites c, r, p
  where c.role_id = r.id and c.phase = p.phase
    and not (select a_tout_pouvoir(p_evenement))

  union all

  -- Tout pouvoir : on renvoie l'univers des capacités connues
  select distinct mp.ressource, mp.action::text
  from matrice_permissions mp
  where (select a_tout_pouvoir(p_evenement))

  union all

  -- Règle R2, toujours vraie
  select x, 'lire' from unnest(array['sos','alertes','journal']) x
  where est_membre(p_evenement);
$$;

grant execute on function mes_capacites(uuid) to authenticated;

commit;;
