-- Correction : initcap() ne connaît pas les accents français
-- ('materiel' → 'Materiel', pas 'Matériel'). Même liste que TYPES
-- dans PcOps.jsx, pour que la base et l'écran disent la même chose —
-- sans ça, c'est exactement la duplication qui a déjà divergé deux
-- fois dans ce projet.
create or replace function convertir_signalement_en_mission(
  p_signalement uuid,
  p_module text default 'securite',
  p_priorite text default 'P2',
  p_equipe uuid default null
)
returns missions
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  s signalements%rowtype;
  m missions%rowtype;
  v_type_libelle text;
begin
  select * into s from signalements where id = p_signalement;
  if not found then
    raise exception 'Signalement introuvable' using errcode = 'P0002';
  end if;

  v_type_libelle := case s.type
    when 'malaise' then 'Malaise'
    when 'blessure' then 'Blessure'
    when 'danger' then 'Danger'
    when 'materiel' then 'Matériel'
    when 'egare' then 'Égaré'
    else 'Autre'
  end;

  insert into missions (
    evenement_id, module, titre, description, priorite,
    lieu_id, latitude, longitude, equipe_id, signalement_id,
    phase, statut
  ) values (
    s.evenement_id, p_module,
    v_type_libelle || coalesce(' — ' || nullif(s.description, ''), ' — ' || s.reference),
    s.description, p_priorite::priorite_mission,
    s.lieu_id, s.latitude, s.longitude, p_equipe, s.id,
    (select phase from evenements where id = s.evenement_id),
    (case when p_equipe is null then 'a_traiter' else 'attribuee' end)::statut_mission
  )
  returning * into m;

  update signalements set statut = 'pris_en_charge' where id = s.id;

  return m;
end;
$function$;