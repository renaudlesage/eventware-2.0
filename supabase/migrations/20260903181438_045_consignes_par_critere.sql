-- =====================================================================
-- Migration 045 : une consigne par critère surveillé
-- ---------------------------------------------------------------------
-- Défaut trouvé à l'usage : une seule consigne pour tout franchissement
-- de seuil, quel que soit le phénomène. La conduite à tenir face à un
-- orage n'est pas celle d'une canicule.
--
-- JSONB plutôt que des colonnes typées par critère : plus simple à
-- étendre plus tard (un critère de plus, une clé de plus) sans nouvelle
-- migration à chaque fois.
--
-- Chaque critère n'a la consigne que pour le(s) niveau(x) qu'il connaît
-- réellement : vent et pluie ont alerte + alarme (deux seuils saisis),
-- chaleur et froid n'ont qu'alerte (un seul seuil), orage ne connaît
-- que l'alarme (déclenchement direct, pas de palier intermédiaire).
-- =====================================================================

alter table veille_meteo add column consignes jsonb not null default '{}'::jsonb;

comment on column veille_meteo.consignes is
  'Consigne par critère et par niveau — clés : vent_alerte, vent_alarme, pluie_alerte, pluie_alarme, chaleur_alerte, froid_alerte, orage_alarme.';

-- Reprise des anciennes consignes globales comme point de départ,
-- plutôt que de repartir de zéro pour les événements déjà réglés.
update veille_meteo set consignes = jsonb_build_object(
  'vent_alerte', consigne_vigilance,
  'vent_alarme', consigne_critique,
  'pluie_alerte', consigne_vigilance,
  'pluie_alarme', consigne_critique,
  'chaleur_alerte', consigne_vigilance,
  'froid_alerte', consigne_vigilance,
  'orage_alarme', consigne_critique
)
where consigne_vigilance is not null or consigne_critique is not null;