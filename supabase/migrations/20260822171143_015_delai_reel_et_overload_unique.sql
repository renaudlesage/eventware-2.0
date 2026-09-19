-- =====================================================================
-- Migration 015
--   1. delai_reel_min sur missions — mesure absente de l'export BFMF 2026
--   2. suppression de la surcharge obsolète de creer_signalement
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Délai réel de traitement.
-- Constat REX 2026 : l'export ne portait ni horodatage ni assignataire,
-- ce qui interdisait toute métrique quantitative. Comparé au
-- delai_cible_min du type de mission, ce champ rend le REX chiffrable.
-- ---------------------------------------------------------------------
alter table missions add column delai_reel_min integer;

comment on column missions.delai_reel_min is
  'Minutes entre création et clôture. Comparé à types_mission.delai_cible_min, alimente le REX généré.';

-- Reprise intégrale de la logique existante, avec le calcul en plus.
create or replace function trg_cycle_mission()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'attribuee' and new.attribuee_le is null then
      new.attribuee_le := clock_timestamp();
    elsif new.statut = 'en_cours' and new.demarree_le is null then
      new.demarree_le := clock_timestamp();
    elsif new.statut in ('resolue','annulee') and new.resolue_le is null then
      new.resolue_le := clock_timestamp();
      new.delai_reel_min :=
        round(extract(epoch from (clock_timestamp() - new.created_at)) / 60);
    end if;
  end if;
  -- Une mission attribuée sans l'être formellement : on aligne le statut
  if tg_op = 'UPDATE'
     and new.statut = 'a_traiter'
     and (new.equipe_id is not null or new.membre_id is not null)
     and (old.equipe_id is null and old.membre_id is null) then
    new.statut := 'attribuee';
    new.attribuee_le := clock_timestamp();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Deux surcharges de creer_signalement coexistaient : celle à 9
-- arguments et la nouvelle à 10 (avec p_code_lieu, pour les QR par bloc).
-- PostgREST résout par NOM d'argument : un appel du front à 9 paramètres
-- correspond aux deux, et peut renvoyer « function is not unique ».
-- Le SOS public tomberait alors en panne sans qu'on comprenne pourquoi.
-- La version à 10 arguments a un défaut sur p_code_lieu : elle absorbe
-- les appels à 9 paramètres sans rien changer pour eux.
-- ---------------------------------------------------------------------
drop function if exists creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision, double precision, timestamptz
);

commit;