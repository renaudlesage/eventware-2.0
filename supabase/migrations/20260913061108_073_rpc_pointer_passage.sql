-- Pointage public, calqué sur creer_signalement : jeton d'événement,
-- clé d'idempotence, position facultative. Aucune authentification —
-- c'est un participant avec un téléphone, pas un membre.
create or replace function public.pointer_passage(
  p_jeton uuid,
  p_cle_client uuid,
  p_code_lieu text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_precision_m double precision default null,
  p_emis_le timestamp with time zone default null
)
returns table(lieu text, horodatage timestamp with time zone, deja_pointe boolean)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_evenement uuid;
  v_phase     phase_evenement;
  v_lieu      uuid;
  v_nom       text;
  v_existant  comptages_parcours%rowtype;
begin
  select e.id, e.phase into v_evenement, v_phase
  from evenements e
  where e.jeton_public = p_jeton and e.deleted_at is null;

  if v_evenement is null then
    raise exception 'Événement inconnu' using errcode = 'P0002';
  end if;

  if v_phase not in ('montage','exploitation','demontage') then
    raise exception 'L''événement n''est pas en cours' using errcode = 'P0004';
  end if;

  -- Rejeu d'un envoi mis en file hors-ligne : on renvoie le pointage
  -- d'origine au lieu d'en créer un second.
  select * into v_existant from comptages_parcours c
  where c.evenement_id = v_evenement and c.cle_client = p_cle_client;

  if found then
    select l.nom into v_nom from lieux l where l.id = v_existant.lieu_id;
    return query select v_nom, v_existant.horodatage, true;
    return;
  end if;

  select l.id, l.nom into v_lieu, v_nom
  from lieux l
  where l.evenement_id = v_evenement and l.code = p_code_lieu and l.deleted_at is null;

  if v_lieu is null then
    raise exception 'Borne inconnue' using errcode = 'P0002';
  end if;

  insert into comptages_parcours (
    evenement_id, lieu_id, nombre, source, cle_client,
    latitude, longitude, precision_m, horodatage
  ) values (
    v_evenement, v_lieu, 1, 'scan', p_cle_client,
    p_latitude, p_longitude, p_precision_m,
    coalesce(p_emis_le, clock_timestamp())
  );

  return query select v_nom, clock_timestamp(), false;
end;
$function$;

grant execute on function public.pointer_passage(uuid, uuid, text, double precision, double precision, double precision, timestamp with time zone) to anon, authenticated;