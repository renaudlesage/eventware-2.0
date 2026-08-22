-- =====================================================================
-- Migration 007 : point d'entrée public du SOS
-- ---------------------------------------------------------------------
-- Deux fonctions appelables par le rôle anon, et rien d'autre.
-- Elles sont la seule surface publique de tout le système.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Référence courte, lisible à la radio : SOS-K7M2
-- Alphabet sans I, O, 0, 1 — une confusion à l'oral coûte cher quand
-- une équipe cherche un blessé.
-- ---------------------------------------------------------------------
create or replace function generer_reference_sos(p_evenement uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidat text;
  essai int := 0;
begin
  loop
    candidat := 'SOS-' ||
      substr(alphabet, 1 + floor(random()*32)::int, 1) ||
      substr(alphabet, 1 + floor(random()*32)::int, 1) ||
      substr(alphabet, 1 + floor(random()*32)::int, 1) ||
      substr(alphabet, 1 + floor(random()*32)::int, 1);
    exit when not exists (
      select 1 from signalements
      where evenement_id = p_evenement and reference = candidat
    );
    essai := essai + 1;
    if essai > 50 then
      candidat := 'SOS-' || substr(gen_random_uuid()::text, 1, 8);
      exit;
    end if;
  end loop;
  return candidat;
end;
$$;

-- ---------------------------------------------------------------------
-- Dépôt d'un signalement.
--
-- Idempotente : deux appels avec la même cle_client renvoient le même
-- signalement sans en créer un second. C'est ce qui rend la file
-- d'attente hors réseau sûre — un renvoi ne duplique jamais, et un
-- doublon au PC pendant un incident envoie deux équipes au même endroit.
--
-- Refuse explicitement plutôt que d'accepter en silence : le participant
-- doit savoir si son signalement est parti ou non.
-- ---------------------------------------------------------------------
create or replace function creer_signalement(
  p_jeton       uuid,
  p_cle_client  uuid,
  p_type        text default 'autre',
  p_description text default null,
  p_contact     text default null,
  p_latitude    double precision default null,
  p_longitude   double precision default null,
  p_precision_m double precision default null,
  p_emis_le     timestamptz default null
)
returns table (reference text, statut text, recu_le timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_evenement uuid;
  v_phase     phase_evenement;
  v_modules   jsonb;
  v_existant  signalements%rowtype;
  v_ref       text;
begin
  select e.id, e.phase, e.modules
    into v_evenement, v_phase, v_modules
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

  -- Idempotence : un renvoi retourne l'existant, sans doublon
  select * into v_existant from signalements s
  where s.evenement_id = v_evenement and s.cle_client = p_cle_client;

  if found then
    return query select v_existant.reference, v_existant.statut::text, v_existant.recu_le;
    return;
  end if;

  if p_type not in ('malaise','blessure','danger','materiel','egare','autre') then
    p_type := 'autre';
  end if;

  v_ref := generer_reference_sos(v_evenement);

  insert into signalements (
    evenement_id, reference, cle_client, type, description, contact,
    latitude, longitude, precision_m, emis_le
  ) values (
    v_evenement, v_ref, p_cle_client, p_type::type_signalement,
    nullif(trim(coalesce(p_description,'')), ''),
    nullif(trim(coalesce(p_contact,'')), ''),
    p_latitude, p_longitude, p_precision_m,
    coalesce(p_emis_le, clock_timestamp())
  );

  return query
    select s.reference, s.statut::text, s.recu_le
    from signalements s
    where s.evenement_id = v_evenement and s.cle_client = p_cle_client;
end;
$$;

-- ---------------------------------------------------------------------
-- Suivi par le participant.
-- Ne renvoie que l'état, jamais les données d'autrui : la clé du
-- signalement fait office de secret.
-- ---------------------------------------------------------------------
create or replace function suivre_signalement(
  p_jeton      uuid,
  p_cle_client uuid
)
returns table (reference text, statut text, recu_le timestamptz, pris_en_charge_le timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.reference, s.statut::text, s.recu_le, s.pris_en_charge_le
  from signalements s
  join evenements e on e.id = s.evenement_id
  where e.jeton_public = p_jeton
    and s.cle_client = p_cle_client
    and s.deleted_at is null;
$$;

-- ---------------------------------------------------------------------
-- Droits : anon ne peut appeler QUE ces deux fonctions.
-- Aucun accès direct aux tables.
-- ---------------------------------------------------------------------
revoke all on function creer_signalement from public;
revoke all on function suivre_signalement from public;
revoke all on function generer_reference_sos from public, anon, authenticated;

grant execute on function creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision, double precision, timestamptz
) to anon, authenticated;

grant execute on function suivre_signalement(uuid, uuid) to anon, authenticated;

commit;
