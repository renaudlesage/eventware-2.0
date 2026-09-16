-- ============ 012_signalement_lieu_et_conversion ============
-- =====================================================================
-- Migration 012 : QR par lieu + conversion signalement → mission
-- ---------------------------------------------------------------------
-- Reprend le principe du « signalement sanitaire » de la v18 : un QR
-- par bloc sanitaire, qui pré-remplit le lieu. Généralisé à n'importe
-- quel point du dispositif.
-- =====================================================================

begin;

-- Version enrichie du dépôt public : accepte un code de lieu, issu du QR.
create or replace function creer_signalement(
  p_jeton       uuid,
  p_cle_client  uuid,
  p_type        text default 'autre',
  p_description text default null,
  p_contact     text default null,
  p_latitude    double precision default null,
  p_longitude   double precision default null,
  p_precision_m double precision default null,
  p_emis_le     timestamptz default null,
  p_code_lieu   text default null
)
returns table (reference text, statut text, recu_le timestamptz)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_evenement uuid;
  v_phase     phase_evenement;
  v_modules   jsonb;
  v_existant  signalements%rowtype;
  v_ref       text;
  v_lieu      uuid;
  v_lat       double precision := p_latitude;
  v_lon       double precision := p_longitude;
begin
  select e.id, e.phase, e.modules into v_evenement, v_phase, v_modules
  from evenements e
  where e.jeton_public = p_jeton and e.deleted_at is null;

  if v_evenement is null then
    raise exception 'Événement inconnu' using errcode = 'P0002';
  end if;

  if coalesce((v_modules->>'sos_participants')::boolean, false) = false then
    raise exception 'Le signalement participant n''est pas activé sur cet événement'
      using errcode = 'P0003';
  end if;

  if v_phase not in ('montage','exploitation','demontage') then
    raise exception 'L''événement n''est pas en cours' using errcode = 'P0004';
  end if;

  select * into v_existant from signalements s
  where s.evenement_id = v_evenement and s.cle_client = p_cle_client;

  if found then
    return query select v_existant.reference, v_existant.statut::text, v_existant.recu_le;
    return;
  end if;

  -- QR posé sur un point précis : le lieu prime sur un GPS imprécis
  if p_code_lieu is not null then
    select id, coalesce(v_lat, latitude), coalesce(v_lon, longitude)
      into v_lieu, v_lat, v_lon
    from lieux
    where evenement_id = v_evenement and code = p_code_lieu and deleted_at is null;
  end if;

  if p_type not in ('malaise','blessure','danger','materiel','egare','autre') then
    p_type := 'autre';
  end if;

  v_ref := generer_reference_sos(v_evenement);

  insert into signalements (
    evenement_id, reference, cle_client, type, description, contact,
    latitude, longitude, precision_m, emis_le, lieu_id
  ) values (
    v_evenement, v_ref, p_cle_client, p_type::type_signalement,
    nullif(trim(coalesce(p_description,'')), ''),
    nullif(trim(coalesce(p_contact,'')), ''),
    v_lat, v_lon, p_precision_m,
    coalesce(p_emis_le, clock_timestamp()), v_lieu
  );

  return query select s.reference, s.statut::text, s.recu_le
  from signalements s
  where s.evenement_id = v_evenement and s.cle_client = p_cle_client;
end;
$$;

revoke all on function creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) from public;

grant execute on function creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Conversion d'un signalement en mission.
-- Le lien est conservé : le participant continue de suivre son
-- signalement pendant que l'équipe travaille sur la mission.
-- ---------------------------------------------------------------------
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
    case when p_equipe is null then 'a_traiter' else 'attribuee' end
  )
  returning * into m;

  update signalements set statut = 'pris_en_charge' where id = s.id;

  return m;
end;
$$;

grant execute on function convertir_signalement_en_mission(uuid, text, text, uuid)
  to authenticated;

commit;;
