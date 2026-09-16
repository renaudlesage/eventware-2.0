-- ============ 013_fix_cast_statut_mission ============
-- Même défaut qu'en 010 : une expression CASE produit du text là où un
-- énuméré est attendu. Postgres ne fait pas la conversion implicite.
-- Règle à appliquer partout : tout CASE alimentant une colonne énumérée
-- doit être casté explicitement.
create or replace function convertir_signalement_en_mission(
  p_signalement uuid,
  p_module      text default 'securite',
  p_priorite    text default 'P2',
  p_equipe      uuid default null
)
returns missions
language plpgsql volatile security invoker
set search_path = public, pg_temp
as $$
declare
  s signalements%rowtype;
  m missions%rowtype;
begin
  select * into s from signalements where id = p_signalement;
  if not found then
    raise exception 'Signalement introuvable' using errcode = 'P0002';
  end if;

  insert into missions (
    evenement_id, module, titre, description, priorite,
    lieu_id, latitude, longitude, equipe_id, signalement_id,
    phase, statut
  ) values (
    s.evenement_id, p_module,
    'Signalement ' || s.reference || ' — ' || s.type,
    s.description, p_priorite::priorite_mission,
    s.lieu_id, s.latitude, s.longitude, p_equipe, s.id,
    (select phase from evenements where id = s.evenement_id),
    (case when p_equipe is null then 'a_traiter' else 'attribuee' end)::statut_mission
  )
  returning * into m;

  update signalements set statut = 'pris_en_charge' where id = s.id;

  return m;
end;
$$;

grant execute on function convertir_signalement_en_mission(uuid, text, text, uuid)
  to authenticated;;
