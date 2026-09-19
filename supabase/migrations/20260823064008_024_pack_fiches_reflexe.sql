-- =====================================================================
-- Migration 024 : pack de fiches réflexe standard
-- ---------------------------------------------------------------------
-- Contenu de PRODUIT, pas de client : un organisateur qui démarre ne
-- doit pas partir d'une page blanche. Les fiches sont copiées dans son
-- événement avec origine = 'seed' — dès qu'il en modifie une, elle
-- passe en 'humain' et devient intouchable par un réimport.
--
-- Préfixe STD- pour distinguer d'emblée ce qui vient du produit de ce
-- que le client a écrit lui-même.
-- =====================================================================

create or replace function installer_fiches_standard(p_evenement uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') then
    raise exception 'Droit insuffisant' using errcode = '42501';
  end if;

  insert into fiches_reflexe (evenement_id, code, titre, categorie, declencheur,
                              conduite, a_ne_pas_faire, contacts, ordre, origine)
  values

  (p_evenement, 'STD-01', 'Début d''incendie', 'incendie',
   'Flammes, fumée, odeur de brûlé',
   '["Donner l''alerte au PC-Ops : lieu précis, nature, ampleur",
     "Appeler le 112 — ne pas attendre l''autorisation de quelqu''un",
     "Couper l''énergie concernée si l''organe de coupure est identifié et accessible",
     "Attaquer avec l''extincteur adapté uniquement si le feu est naissant et qu''une issue reste derrière soi",
     "Éloigner le public dans le sens opposé au vent",
     "Envoyer quelqu''un guider les secours à l''entrée"]'::jsonb,
   '["Attaquer un feu de friteuse à l''eau",
     "Ouvrir une porte chaude",
     "Rester seul face au feu sans avoir donné l''alerte",
     "Retourner chercher un objet"]'::jsonb,
   '112 — PC-Ops', 10, 'seed'),

  (p_evenement, 'STD-02', 'Malaise ou blessure', 'sanitaire',
   'Personne au sol, inconsciente, blessée ou en détresse',
   '["Sécuriser les lieux avant d''approcher",
     "Évaluer la conscience et la respiration",
     "Alerter le PC-Ops avec la position précise (point kilométrique, repère visible)",
     "Appeler le 112 si inconscience, détresse respiratoire, saignement abondant ou doute",
     "Ne pas déplacer la personne sauf danger immédiat",
     "Envoyer quelqu''un attendre les secours à l''accès véhicule le plus proche",
     "Rester avec la personne jusqu''à la relève"]'::jsonb,
   '["Donner à boire ou à manger",
     "Retirer un casque sans nécessité vitale",
     "Laisser la personne seule",
     "Diffuser des informations sur son identité ou son état"]'::jsonb,
   '112 — poste de secours', 20, 'seed'),

  (p_evenement, 'STD-03', 'Personne disparue ou enfant perdu', 'securite',
   'Un accompagnant signale la disparition d''une personne',
   '["Noter immédiatement : description physique, VÊTEMENTS, âge, dernier lieu vu, heure",
     "Déclarer la recherche dans l''application — la diffusion est instantanée à toutes les équipes",
     "Faire rester l''accompagnant à un point fixe identifié",
     "Faire surveiller les sorties et les points d''eau en priorité",
     "Si la personne n''est pas retrouvée dans les 15 minutes, appeler la police",
     "Clôturer explicitement la recherche une fois la personne retrouvée"]'::jsonb,
   '["Diffuser une photo sans accord de la famille",
     "Confier l''enfant retrouvé à quelqu''un sans vérification",
     "Oublier de lever la diffusion après retrouvailles"]'::jsonb,
   '101 — PC-Ops', 30, 'seed'),

  (p_evenement, 'STD-04', 'Fuite de gaz', 'technique',
   'Odeur de gaz, sifflement, bonbonne endommagée',
   '["Ne toucher à AUCUN interrupteur, téléphone ou véhicule à proximité",
     "Couper la vanne si elle est accessible sans risque",
     "Éloigner le public à 50 m au minimum, au vent",
     "Interdire toute flamme et toute cigarette dans le périmètre",
     "Alerter le PC-Ops depuis une position éloignée",
     "Appeler le 112"]'::jsonb,
   '["Actionner un interrupteur ou démarrer un véhicule dans le périmètre",
     "Utiliser un téléphone à proximité de la fuite",
     "Rentrer dans un local confiné pour vérifier"]'::jsonb,
   '112', 40, 'seed'),

  (p_evenement, 'STD-05', 'Intempéries et vent fort', 'meteo',
   'Alerte météo, rafales, orage annoncé',
   '["Consulter l''avis officiel et fixer un seuil de décision AVANT que ça arrive",
     "Sécuriser bâches, banderoles, parasols et structures légères",
     "Éloigner le public des structures démontables et des arbres",
     "Couper l''alimentation des installations extérieures si l''orage approche",
     "Préparer les points de mise à l''abri et les annoncer",
     "Décider de l''interruption avant l''arrivée du phénomène, pas pendant"]'::jsonb,
   '["Attendre le premier coup de vent pour décider",
     "Laisser le public sous des structures légères",
     "Maintenir une activité en hauteur"]'::jsonb,
   'PC-Ops — bourgmestre', 50, 'seed'),

  (p_evenement, 'STD-06', 'Évacuation', 'evacuation',
   'Décision d''évacuation prise par le PC-Ops ou les secours',
   '["Confirmer la décision et son périmètre auprès du PC-Ops",
     "Diffuser l''alerte dans l''application, avec la consigne et la direction",
     "Couper la musique et prendre la parole au micro",
     "Ouvrir toutes les issues et retirer les barrières amovibles",
     "Guider vers les points de rassemblement, en donnant une direction, pas une interdiction",
     "Faire remonter par chaque chef d''équipe que sa zone est vide",
     "Ne rouvrir que sur décision explicite"]'::jsonb,
   '["Annoncer une évacuation sans indiquer où aller",
     "Laisser une issue fermée",
     "Faire rebrousser chemin un flux déjà engagé",
     "Rouvrir sans confirmation formelle"]'::jsonb,
   '112 — PC-Ops — Dir-PC-Ops', 60, 'seed'),

  (p_evenement, 'STD-07', 'Altercation ou comportement agressif', 'securite',
   'Bagarre, menace, personne très alcoolisée ou agitée',
   '["Ne pas intervenir seul — se signaler au PC-Ops d''abord",
     "Se placer en retrait, sans contact physique",
     "Éloigner le public et retirer ce qui peut servir de projectile",
     "Laisser une porte de sortie à la personne agitée",
     "Appeler la police si menace, arme ou refus persistant",
     "Consigner les faits dans la main courante immédiatement après"]'::jsonb,
   '["Répondre à la provocation",
     "Intervenir physiquement à un contre un",
     "Enfermer ou acculer la personne",
     "Attendre le lendemain pour écrire ce qui s''est passé"]'::jsonb,
   '101 — PC-Ops', 70, 'seed'),

  (p_evenement, 'STD-08', 'Accident de circulation sur le site', 'circulation',
   'Collision, renversement, véhicule contre piéton',
   '["Sécuriser la zone : baliser, arrêter tout autre mouvement de véhicule",
     "Couper le contact du véhicule impliqué",
     "Appliquer la fiche Malaise ou blessure pour les victimes",
     "Alerter le PC-Ops et le 112",
     "Ne rien déplacer si quelqu''un est blessé",
     "Relever les identités et les témoins",
     "Photographier la position avant tout dégagement"]'::jsonb,
   '["Déplacer un véhicule avant l''arrivée des secours en cas de blessé",
     "Laisser repartir un conducteur impliqué",
     "Rouvrir la circulation sans accord du PC-Ops"]'::jsonb,
   '112 — 101 — PC-Ops', 80, 'seed')

  on conflict (evenement_id, code) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function installer_fiches_standard(uuid) to authenticated;