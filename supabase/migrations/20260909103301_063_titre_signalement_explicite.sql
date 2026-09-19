-- =====================================================================
-- Migration 063 : titre explicite pour une mission issue d'un
-- signalement.
-- ---------------------------------------------------------------------
-- Le descriptif existait déjà dans la mission créée — juste jamais
-- dans son titre, le seul champ visible en liste repliée. Un
-- opérateur devait ouvrir chaque ligne pour savoir de quoi il
-- s'agissait, alors qu'une mission saisie à la main ("Balisage
-- arraché au km 5") le dit d'un coup d'œil. Même principe que pour les
-- missions issues de types_mission : le titre porte l'essentiel, la
-- description reste le détail.
-- =====================================================================

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
    initcap(s.type) || coalesce(' — ' || s.description, ' — ' || s.reference),
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