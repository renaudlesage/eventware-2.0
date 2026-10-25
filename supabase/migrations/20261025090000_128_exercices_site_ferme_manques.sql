-- =====================================================================
-- 128 — EXERCICES : SITE FERMÉ, MANQUES VISIBLES, DEA ÉLOIGNÉ
--
-- Test du module « Exercices sur mesure » sur le Concert Buco
-- (28/11/2026, une soirée en salle) — briefing du 25/10. Quatre
-- manques :
--
--   1. Les trames se choisissaient par objectifs seulement : une salle
--      pouvait tirer « Victime sur un parcours non carrossable ».
--      `exercice_trames.geometries` dit pour quelles géométries une
--      trame a été écrite ; `generer_exercice` filtre dessus, et à
--      couverture égale préfère la trame la plus spécifique.
--   2. Aucune trame ne couvrait une soirée en salle : deux nouvelles,
--      ARRET_CARDIAQUE_SALLE et FEU_CUISINE_EVACUATION, pour
--      {site_ferme,hybride}. Leurs `t` évitent ceux des autres trames.
--   3. Quand le dispositif ne contenait pas une information, le
--      contexte la remplaçait en silence (« — », « ? », « quelques
--      centaines de », et un brancardage codé en dur à 400 m).
--      `exercices.contexte->'manques'` liste désormais les clés
--      remplacées ; le brancardage vient des tronçons encodés, et
--      `avant_vol` relève un brancardage plus long que son tronçon
--      (BRANCARDAGE_INCOHERENT).
--   4. `avant_vol` comparait le nombre de DEA, jamais la distance : au
--      Buco, le seul DEA du plan est à 190 m du point 0, trois minutes
--      aller-retour pendant un massage. DEA_ELOIGNE, et de nouvelles
--      clés de contexte lues sur le plan (dea, sortie(s),
--      rassemblement, borne, extincteur), tous suivis dans `manques`.
--
-- Les éléments du plan supprimés (`deleted_at`) sont exclus partout.
-- Idempotente, sans aucun DROP, sans `not null` sans défaut : les deux
-- exercices déjà en base restent lisibles (pas de clé `manques` chez
-- eux, le front s'en passe). Les fonctions sont réécrites en entier
-- (base : 120), signatures inchangées — Exercices.jsx ne change pas
-- d'appel.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Les géométries d'une trame
-- ---------------------------------------------------------------------
alter table public.exercice_trames
  add column if not exists geometries public.type_geometrie[] not null default '{site_ferme,parcours,hybride}';
comment on column public.exercice_trames.geometries is
  'Géométries d''événement pour lesquelles la trame a été écrite. generer_exercice ne tire que les trames compatibles avec evenements.geometrie.';

update public.exercice_trames set geometries = '{parcours,hybride}'
 where code in ('VICTIME_PARCOURS', 'GROUPE_NUIT') and geometries <> '{parcours,hybride}';

-- ---------------------------------------------------------------------
-- 2. Distance en mètres entre deux points (haversine, rayon moyen)
-- ---------------------------------------------------------------------
create or replace function public.distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable strict set search_path = public, pg_temp as $$
  select 2 * 6371008.8 * asin(least(1.0, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2)));
$$;
comment on function public.distance_m(double precision, double precision, double precision, double precision) is
  'Distance en mètres entre deux positions (lat, lon) en degrés — haversine.';

-- ---------------------------------------------------------------------
-- 3. Le contrôle avant-vol — redéfini en entier (base : 120)
--    + BRANCARDAGE_INCOHERENT, + DEA_ELOIGNE
-- ---------------------------------------------------------------------
create or replace function public.avant_vol(p_evenement uuid)
returns table (code text, gravite text, titre text, detail text, table_source text, source_id uuid, stimulus text, objectif text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v veille_meteo%rowtype;
  r record;
  n int; m int;
begin
  if not a_permission(p_evenement, 'exercices', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture des exercices non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement;
  if ev.id is null then return; end if;

  -- Veille météo
  select * into v from veille_meteo where evenement_id = p_evenement;
  if v.evenement_id is null or not coalesce(v.active, false) then
    return query select 'VEILLE_INACTIVE', 'veille', 'Veille météo inactive', 'Aucun seuil ne déclenchera rien', 'veille_meteo', null::uuid,
      'Météo : l''IRM annonce des rafales de 90 km/h pour cet après-midi. Que fait le QG ?', 'METEO';
  else
    if v.rafale_vigilance_kmh >= v.rafale_critique_kmh then
      return query select 'SEUIL_VENT_INVERSE', 'chaud', 'Seuils de vent inversés',
        format('Vigilance à %s km/h, critique à %s km/h : l''outil reste au vert quand le vent passe le seuil critique', v.rafale_vigilance_kmh, v.rafale_critique_kmh),
        'veille_meteo', null::uuid,
        format('Météo : rafale mesurée %s km/h sur site, l''outil n''a rien signalé. Un chapiteau se soulève.', v.rafale_critique_kmh + 5), 'METEO';
    end if;
    if v.pluie_vigilance_mm >= v.pluie_critique_mm then
      return query select 'SEUIL_PLUIE_INVERSE', 'chaud', 'Seuils de pluie inversés',
        format('Vigilance à %s mm, critique à %s mm', v.pluie_vigilance_mm, v.pluie_critique_mm), 'veille_meteo', null::uuid,
        format('Météo : %s mm tombés en une heure, le parking est un bourbier.', v.pluie_critique_mm + 5), 'METEO';
    end if;
  end if;

  -- Installations à risque sans mesure de maîtrise
  for r in select id, nom, categorie from elements_plan where evenement_id = p_evenement and deleted_at is null and est_risque and coalesce(mesures_maitrise, '') = '' loop
    return query select 'RISQUE_SANS_MAITRISE', 'chaud', 'Installation à risque sans mesure de maîtrise', r.nom || ' (' || r.categorie || ')', 'elements_plan', r.id,
      format('Un bénévole signale une forte odeur de gaz près de « %s ». Personne ne sait où est la vanne.', r.nom), 'TECH';
  end loop;

  -- Catégories du plan incohérentes avec le nom (regroupées par nom et catégorie)
  for r in select (array_agg(id order by created_at))[1] as id, nom, categorie, count(*) as nb from elements_plan where evenement_id = p_evenement and deleted_at is null
            and ((nom ilike '%atterrissage%' and categorie <> 'aire_helico') or (nom ilike '%bouche%incendie%' and categorie not in ('point_eau')) or (nom ilike '%cabinet%' and categorie = 'dea'))
           group by nom, categorie order by count(*) desc loop
    return query select 'PLAN_CATEGORIE', 'veille', 'Catégorie du plan incohérente',
      format('« %s » classé %s%s', r.nom, r.categorie, case when r.nb > 1 then ' (× ' || r.nb || ')' else '' end), 'elements_plan', r.id,
      case when r.nom ilike '%atterrissage%' then format('Le 112 demande une zone d''atterrissage pour l''hélicoptère : le QG lit le plan. « %s » y est classé %s.', r.nom, r.categorie)
           else format('Le QG cherche un %s sur le plan : « %s » y est classé %s.', replace(r.categorie::text, '_', ' '), r.nom, r.categorie) end, 'SECOURS';
  end loop;

  -- Secouristes vs fréquentation
  select coalesce(sum(quantite), 0) into n from moyens_premiers_secours where evenement_id = p_evenement and type = 'secouriste';
  if coalesce(ev.frequentation_max, 0) > 0 and n * 500 < ev.frequentation_max then
    return query select 'SECOURISTES_INSUFFISANTS', 'chaud', 'Secouristes insuffisants',
      format('%s secouriste(s) pour %s à %s participants (repère : 1 pour 500)', n, ev.frequentation_min, ev.frequentation_max), 'moyens_premiers_secours', null::uuid,
      'Deux victimes en même temps à deux endroits du site : un malaise au bar, une chute sur le parcours.', 'SECOURS';
  end if;
  select coalesce(sum(quantite), 0) into n from moyens_premiers_secours where evenement_id = p_evenement and type = 'dea';
  select count(*) into m from elements_plan where evenement_id = p_evenement and deleted_at is null and categorie = 'dea' and nom not ilike '%atterrissage%' and nom not ilike '%cabinet%';
  if n <> m then
    return query select 'DEA_INCOHERENT', 'veille', 'DEA : moyens et plan ne disent pas la même chose',
      format('%s DEA déclarés en moyens, %s sur le plan', n, m), 'moyens_premiers_secours', null::uuid,
      'Arrêt cardiaque devant la scène : où est le DEA le plus proche ?', 'SECOURS';
  end if;

  -- (128) DEA éloigné : le DEA du plan le plus proche du point 0 est à
  -- plus de 120 m — en courant, c'est trois minutes aller-retour
  -- pendant un massage. Compter les DEA ne le disait pas.
  if ev.point_0_lat is not null and ev.point_0_lon is not null then
    select e.id, coalesce(nullif(e.code, ''), e.nom) as libelle,
           distance_m(ev.point_0_lat, ev.point_0_lon,
                      coalesce(e.centre_lat, (_point_element(e.geometrie) ->> 'lat')::double precision),
                      coalesce(e.centre_lon, (_point_element(e.geometrie) ->> 'lon')::double precision)) as d
      into r
      from elements_plan e
     where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'dea'
       and e.nom not ilike '%atterrissage%' and e.nom not ilike '%cabinet%'
     order by d asc nulls last limit 1;
    if r.id is not null and r.d > 120 then
      return query select 'DEA_ELOIGNE', 'veille', 'DEA éloigné du point 0',
        format('%s à %s m du point 0 (≈ %s min aller-retour)', r.libelle, round(r.d)::int, greatest(1, round(2 * r.d / 120))::int),
        'elements_plan', r.id,
        format('Arrêt cardiaque à l''accueil : le DEA le plus proche est à %s m. Qui part le chercher ?', round(r.d)::int), 'SECOURS';
    end if;
  end if;

  -- Équipes sans responsable, sans membre
  for r in select e.id, e.nom, (select count(*) from membres_evenement m where m.equipe_id = e.id and m.deleted_at is null and m.actif) as nb
             from equipes e where e.evenement_id = p_evenement and e.deleted_at is null and e.responsable_id is null loop
    return query select 'EQUIPE_SANS_RESPONSABLE', 'veille', 'Équipe sans responsable', format('« %s » (%s membre(s))', r.nom, r.nb), 'equipes', r.id,
      format('Le QG doit joindre le responsable de l''équipe « %s » : qui appelle-t-on ?', r.nom), 'RADIO';
  end loop;

  -- Radio
  if not exists (select 1 from canaux_radio where evenement_id = p_evenement and deleted_at is null and canal_urgence and actif) then
    return query select 'RADIO_SANS_URGENCE', 'chaud', 'Aucun canal radio d''urgence', 'Un MAYDAY arrive sur le canal de la logistique', 'canaux_radio', null::uuid,
      'Radio, canal logistique, voix paniquée : « il y a quelqu''un par terre, il ne bouge plus ».', 'RADIO';
  end if;

  -- Groupes
  for r in select id, nom, effectif_prevu, depart_prevu from groupes where evenement_id = p_evenement and deleted_at is null
            and (effectif_prevu is null or depart_prevu is null or depart_prevu::date not between ev.date_debut and coalesce(ev.date_fin, ev.date_debut)) loop
    return query select 'GROUPE_INCOHERENT', 'veille', 'Groupe incomplet ou daté hors événement',
      format('« %s » : effectif %s, départ %s', r.nom, coalesce(r.effectif_prevu::text, '?'), coalesce(to_char(r.depart_prevu, 'DD/MM HH24:MI'), '?')), 'groupes', r.id,
      format('À la tombée de la nuit, le groupe « %s » n''est pas rentré et personne ne sait combien ils sont.', r.nom), 'RECHERCHE';
  end loop;

  -- Fiches réflexes manquantes pour les catégories à risque présentes
  for r in select distinct categorie from elements_plan where evenement_id = p_evenement and deleted_at is null and est_risque and fiche_reflexe_id is null loop
    if not exists (select 1 from fiches_reflexe f where f.evenement_id = p_evenement and f.deleted_at is null and (f.categorie ilike '%' || r.categorie || '%' or f.titre ilike '%' || replace(r.categorie::text, '_', ' ') || '%')) then
      return query select 'FICHE_MANQUANTE', 'veille', 'Pas de fiche réflexe pour une catégorie à risque', r.categorie::text, 'fiches_reflexe', null::uuid,
        format('Incident sur une installation « %s » : le QG cherche la conduite à tenir.', replace(r.categorie::text, '_', ' ')), 'TECH';
    end if;
  end loop;

  -- Contacts sans téléphone
  for r in select id, nom from contacts where evenement_id = p_evenement and deleted_at is null and coalesce(telephone, '') = '' loop
    return query select 'CONTACT_SANS_TEL', 'veille', 'Contact sans téléphone', r.nom, 'contacts', r.id,
      format('Le QG doit appeler %s maintenant.', r.nom), 'INFO';
  end loop;

  -- Lieux sans position
  select count(*) into n from lieux where evenement_id = p_evenement and deleted_at is null and actif and (latitude is null or longitude is null);
  if n > 0 then
    return query select 'LIEUX_SANS_POSITION', 'veille', 'Lieux sans coordonnées', format('%s lieu(x) actif(s) sans position : invisibles sur la carte et pour les secours', n), 'lieux', null::uuid,
      'Le 112 demande les coordonnées GPS du point de rendez-vous des secours.', 'SECOURS';
  end if;

  -- (128) Brancardage plus long que son tronçon : une donnée fausse,
  -- que le générateur ne doit pas reprendre (Rando VTT : 12 588 m
  -- pour un tronçon de 5 810 m).
  for r in select id, coalesce(libelle, 'tronçon sans libellé') as libelle, distance_totale_m, brancardage_max_m
             from segments_parcours where evenement_id = p_evenement
              and brancardage_max_m is not null and distance_totale_m is not null and brancardage_max_m > distance_totale_m loop
    return query select 'BRANCARDAGE_INCOHERENT', 'veille', 'Brancardage plus long que le tronçon',
      format('« %s » : brancardage %s m pour un tronçon de %s m', r.libelle, r.brancardage_max_m, r.distance_totale_m), 'segments_parcours', r.id,
      format('Le secouriste demande combien de temps de brancardage sur « %s » : le plan dit %s m pour un tronçon de %s m.', r.libelle, r.brancardage_max_m, r.distance_totale_m), 'SECOURS';
  end loop;

  -- Point de rencontre des secours
  if not exists (select 1 from elements_plan where evenement_id = p_evenement and deleted_at is null and categorie = 'point_rencontre_secours') then
    return query select 'SANS_POINT_RENCONTRE', 'chaud', 'Aucun point de rencontre des secours sur le plan', 'Les secours extérieurs ne sauront pas où se présenter', 'elements_plan', null::uuid,
      'L''ambulance appelle : « on est à l''entrée du village, on vous attend où ? »', 'SECOURS';
  end if;
  return;
end $$;

-- ---------------------------------------------------------------------
-- 4. Deux trames « site fermé »
-- t : fraction de la durée totale, sans décalage par trame. Choisis
-- hors des t des sept trames en place (0.08 0.12 0.2 0.25 0.3 0.35
-- 0.4 0.42 0.45 0.5 0.55 0.6 0.65 0.7 0.72 0.78) et des pièges
-- (0.29 0.43 0.57 0.71).
-- ---------------------------------------------------------------------
insert into public.exercice_trames (code, titre, risque, objectifs, pieges_couverts, geometries, ordre, stimuli) values
('ARRET_CARDIAQUE_SALLE', 'Arrêt cardiaque pendant une soirée en salle', 'malaise',
 array['SECOURS','ALERTE','MISSION','INFO'], array['DEA_INCOHERENT','DEA_ELOIGNE','SECOURISTES_INSUFFISANTS'], '{site_ferme,hybride}', 80, '[
 {
  "t": 0.15,
  "canal": "temoin",
  "emetteur": "Bénévole bar",
  "texte": "« QG ! Un homme vient de s''effondrer devant {lieu_public}, il ne bouge plus et respire bizarrement. Les gens font cercle. »",
  "note": "Arrêt cardiaque suspecté. DEA encodé le plus proche : {dea}, {dea_distance}. Noter qui part le chercher, à quelle minute, et à quelle minute il arrive. Le massage ne s''interrompt pas.",
  "actions": [
   {
    "action": "Appeler le 112 immédiatement (arrêt cardiaque suspecté)",
    "objectif": "ALERTE",
    "outil": "Téléphone",
    "critere": "112 appelé moins d''1 min après l''alerte"
   },
   {
    "action": "Faire démarrer le massage par une personne formée et noter l''heure",
    "objectif": "SECOURS",
    "outil": "Main courante"
   },
   {
    "action": "Envoyer chercher {dea}",
    "objectif": "SECOURS",
    "outil": "Plan d''implantation"
   },
   {
    "action": "Couper la musique, allumer la salle, écarter le cercle",
    "objectif": "INFO",
    "outil": "Radio / régie"
   }
  ]
 },
 {
  "t": 0.22,
  "canal": "radio",
  "emetteur": "Entrée",
  "texte": "« L''ambulance arrive dans deux minutes. On la fait entrer par où ? »",
  "note": "Accès des secours prévu : {sortie}. Point de rassemblement si la salle doit être vidée : {rassemblement}. Observer si le QG le sait sans chercher.",
  "actions": [
   {
    "action": "Envoyer un guide à {sortie} et dégager l''accès",
    "objectif": "SECOURS",
    "outil": "Plan d''implantation"
   },
   {
    "action": "Créer une demande P1 et la suivre jusqu''à la remise aux secours",
    "objectif": "MISSION",
    "outil": "Sécurité → Demande urgente",
    "critere": "mission P1 créée sous 3 min"
   }
  ]
 }
]'::jsonb),
('FEU_CUISINE_EVACUATION', 'Feu en cuisine et évacuation de la salle', 'incendie',
 array['TECH','EVAC','ALERTE','RECHERCHE'], array[]::text[], '{site_ferme,hybride}', 90, '[
 {
  "t": 0.48,
  "canal": "radio",
  "emetteur": "Cuisine",
  "texte": "« Une friteuse a pris feu, quelqu''un a jeté de l''eau dessus et c''est pire ! »",
  "note": "Feu d''huile : jamais d''eau. La consigne doit tomber dans les 30 premières secondes.",
  "actions": [
   {
    "action": "Consigne : plus d''eau, couper gaz et électricité, étouffer (couvercle, couverture anti-feu) ou utiliser {extincteur}",
    "objectif": "TECH",
    "outil": "Radio",
    "critere": "consigne donnée sous 30 s"
   },
   {
    "action": "Appeler le 112 si le feu n''est pas éteint dans les premières secondes",
    "objectif": "ALERTE",
    "outil": "Téléphone"
   }
  ]
 },
 {
  "t": 0.58,
  "canal": "temoin",
  "emetteur": "Chef de salle",
  "texte": "« La fumée gagne la salle, des gens toussent et se pressent vers l''entrée. On évacue ? »",
  "note": "Sorties encodées : {sorties}. Point de rassemblement : {rassemblement}. Observer si le QG décide ou laisse la foule décider.",
  "actions": [
   {
    "action": "Décider l''évacuation et l''annoncer clairement (micro, lumière)",
    "objectif": "EVAC",
    "outil": "Alertes"
   },
   {
    "action": "Faire ouvrir et tenir {sorties}",
    "objectif": "EVAC",
    "outil": "Plan d''implantation"
   },
   {
    "action": "Diriger le public vers {rassemblement}",
    "objectif": "EVAC",
    "outil": "Plan d''implantation"
   },
   {
    "action": "Accueillir les pompiers et leur indiquer {borne}",
    "objectif": "ALERTE",
    "outil": "Plan d''implantation"
   }
  ]
 },
 {
  "t": 0.74,
  "canal": "temoin",
  "emetteur": "Mère d''une participante",
  "texte": "« Ma fille de 14 ans était aux toilettes au moment de l''évacuation. Je ne la trouve pas. »",
  "note": "Aucun bénévole ne retourne dans un bâtiment enfumé : noter si quelqu''un le propose.",
  "actions": [
   {
    "action": "Prendre la description complète et la transmettre aux pompiers",
    "objectif": "RECHERCHE",
    "outil": "Recherches"
   },
   {
    "action": "Clore formellement la recherche quand l''adolescente est retrouvée",
    "objectif": "RECHERCHE",
    "outil": "Main courante"
   }
  ]
 }
]'::jsonb)
on conflict (code) do update set titre = excluded.titre, risque = excluded.risque, objectifs = excluded.objectifs,
  pieges_couverts = excluded.pieges_couverts, geometries = excluded.geometries, stimuli = excluded.stimuli, ordre = excluded.ordre;

-- ---------------------------------------------------------------------
-- 5. Le générateur — redéfini en entier (base : 120), signature inchangée
-- ---------------------------------------------------------------------
create or replace function public.generer_exercice(
  p_evenement uuid, p_titre text, p_format text default 'table', p_duree_min integer default 90,
  p_objectifs text[] default array['ALERTE','MISSION','SECOURS','RADIO'], p_date timestamptz default null, p_max_pieges integer default 4)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v veille_meteo%rowtype;
  ctx jsonb := '{}'::jsonb;
  v_ex uuid;
  v_obj record; r record; st jsonb; ac jsonb;
  v_stim uuid; v_ordre int := 0; v_t int; n int := 0;
  v_lieu text; v_gaz record; v_groupe record; v_ge record; v_lieu_public text; v_canal text; v_dernier text;
  v_couverts text[] := '{}'; v_premier uuid; ecart record;
  -- (128) Ce que le plan apporte à une salle, et ce qui manque.
  v_site boolean; v_branc int; v_dea record; v_sortie text; v_sorties text; v_rassemblement text; v_borne text; v_extincteur text;
  v_manques text[] := '{}';
begin
  if not a_permission(p_evenement, 'exercices', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Création d''exercice non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then raise exception 'Événement inconnu'; end if;
  if ev.phase = 'exploitation' and p_format = 'outil' then
    raise exception 'Pas d''exercice dans l''outil pendant l''exploitation réelle';
  end if;
  v_site := ev.geometrie = 'site_ferme';

  -- Le contexte : ce que le dispositif encodé apporte au scénario.
  select * into v from veille_meteo where evenement_id = p_evenement;
  select nullif(l.nom, '') into v_lieu
    from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.actif and l.latitude is not null
    order by coalesce(l.pk_km, 0) desc,
             ((l.latitude - coalesce(ev.point_0_lat, l.latitude))^2 + (l.longitude - coalesce(ev.point_0_lon, l.longitude))^2) desc limit 1;
  select nom into v_lieu_public from lieux where evenement_id = p_evenement and deleted_at is null and actif and (public or type::text in ('scene','entree','bar')) order by public desc limit 1;
  select numero into v_canal from canaux_radio where evenement_id = p_evenement and deleted_at is null and actif order by canal_urgence desc, ordre limit 1;
  select nom, mesures_maitrise into v_gaz from elements_plan where evenement_id = p_evenement and deleted_at is null and (categorie = 'stockage_gaz' or (est_risque and categorie in ('foodtruck','feu','bar_installation'))) order by (categorie = 'stockage_gaz') desc limit 1;
  select e.nom, (select string_agg(x.nom, ', ') from elements_plan x where x.alimente_par = e.id and x.deleted_at is null) as alimentes
    into v_ge from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and (e.categorie = 'groupe_electrogene' or e.production_kva > 0) order by e.production_kva desc nulls last limit 1;
  select g.nom, g.effectif_prevu, l.nom as dernier into v_groupe from groupes g left join lieux l on l.id = g.dernier_lieu_id where g.evenement_id = p_evenement and g.deleted_at is null order by g.depart_prevu desc nulls last limit 1;

  -- (128) Le brancardage vient des tronçons encodés — le plus long qui
  -- tienne dans son tronçon ; un brancardage plus long que le tronçon
  -- est une donnée fausse, relevée par l'avant-vol, pas reprise ici.
  select max(brancardage_max_m) into v_branc from segments_parcours
   where evenement_id = p_evenement and brancardage_max_m is not null
     and (distance_totale_m is null or brancardage_max_m <= distance_totale_m);

  -- (128) Ce que le plan dit à une salle : le DEA le plus proche du
  -- point 0 et sa distance, les sorties de secours, le point de
  -- rassemblement, la borne incendie et l'extincteur les plus proches.
  -- Jamais un élément supprimé.
  select e.id, coalesce(nullif(e.code, ''), e.nom) as libelle,
         distance_m(ev.point_0_lat, ev.point_0_lon,
                    coalesce(e.centre_lat, (_point_element(e.geometrie) ->> 'lat')::double precision),
                    coalesce(e.centre_lon, (_point_element(e.geometrie) ->> 'lon')::double precision)) as d
    into v_dea
    from elements_plan e
   where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'dea'
     and e.nom not ilike '%atterrissage%' and e.nom not ilike '%cabinet%'
   order by d asc nulls last, e.code limit 1;
  select min(coalesce(nullif(code, ''), nom)), string_agg(coalesce(nullif(code, ''), nom), ', ' order by coalesce(nullif(code, ''), nom))
    into v_sortie, v_sorties
    from elements_plan where evenement_id = p_evenement and deleted_at is null and categorie = 'sortie_secours';
  select coalesce(nullif(code, ''), nom) into v_rassemblement
    from elements_plan where evenement_id = p_evenement and deleted_at is null and categorie = 'point_rassemblement' order by code limit 1;
  select coalesce(nullif(e.code, ''), e.nom) into v_borne
    from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'point_eau'
   order by distance_m(ev.point_0_lat, ev.point_0_lon,
                       coalesce(e.centre_lat, (_point_element(e.geometrie) ->> 'lat')::double precision),
                       coalesce(e.centre_lon, (_point_element(e.geometrie) ->> 'lon')::double precision)) asc nulls last, e.code limit 1;
  select coalesce(nullif(e.code, ''), e.nom) into v_extincteur
    from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'extincteur'
   order by distance_m(ev.point_0_lat, ev.point_0_lon,
                       coalesce(e.centre_lat, (_point_element(e.geometrie) ->> 'lat')::double precision),
                       coalesce(e.centre_lon, (_point_element(e.geometrie) ->> 'lon')::double precision)) asc nulls last, e.code limit 1;

  -- (128) Chaque repli est noté dans `manques` : l'animateur doit voir
  -- ce que le dispositif n'a pas encodé — c'est un résultat de
  -- l'exercice en soi. Les clés propres au parcours ne comptent pas
  -- pour une salle.
  if v_lieu is null and not v_site then v_manques := array_append(v_manques, 'lieu_isole'); end if;
  if v_lieu_public is null then v_manques := array_append(v_manques, 'lieu_public'); end if;
  if v_canal is null then v_manques := array_append(v_manques, 'canal_urgence'); end if;
  if v_branc is null and not v_site then v_manques := array_append(v_manques, 'brancardage'); end if;
  if v_gaz.nom is null then v_manques := array_append(v_manques, 'risque_gaz'); end if;
  if coalesce(v_gaz.mesures_maitrise, '') = '' then v_manques := array_append(v_manques, 'maitrise_gaz'); end if;
  if v.rafale_vigilance_kmh is null or v.rafale_critique_kmh is null then v_manques := array_append(v_manques, 'rafales'); end if;
  if v_ge.nom is null then v_manques := array_append(v_manques, 'groupe'); end if;
  if v_ge.nom is not null and v_ge.alimentes is null then v_manques := array_append(v_manques, 'alimentes'); end if;
  if ev.frequentation_max is null then v_manques := array_append(v_manques, 'nb_public'); end if;
  if v_groupe.nom is null and not v_site then v_manques := array_append(v_manques, 'groupe_retard'); end if;
  if v_groupe.nom is not null and v_groupe.effectif_prevu is null then v_manques := array_append(v_manques, 'effectif_groupe'); end if;
  if v_groupe.nom is not null and v_groupe.dernier is null and not v_site then v_manques := array_append(v_manques, 'dernier_lieu'); end if;
  if v_dea.id is null then v_manques := array_append(v_manques, 'dea'); end if;
  if v_dea.id is not null and v_dea.d is null then v_manques := array_append(v_manques, 'dea_distance'); end if;
  if v_sortie is null then v_manques := array_append(v_manques, 'sortie'); end if;
  if v_rassemblement is null then v_manques := array_append(v_manques, 'rassemblement'); end if;
  if v_borne is null then v_manques := array_append(v_manques, 'borne'); end if;
  if v_extincteur is null then v_manques := array_append(v_manques, 'extincteur'); end if;
  if ev.point_0_lat is null then v_manques := array_append(v_manques, 'point_0'); end if;

  ctx := jsonb_build_object(
    'lieu_isole', coalesce(v_lieu, 'un point isolé du parcours'),
    'lieu_public', coalesce(v_lieu_public, 'l''entrée'),
    'canal_urgence', coalesce(v_canal, '—'),
    'brancardage', coalesce(v_branc::text || ' m', '400 m'),
    'risque_gaz', coalesce(v_gaz.nom, 'le stand de restauration'),
    'maitrise_gaz', coalesce(nullif(v_gaz.mesures_maitrise, ''), 'aucune mesure encodée'),
    'rafale_vigilance', coalesce(v.rafale_vigilance_kmh::text, '?'),
    'rafale_critique', coalesce(v.rafale_critique_kmh::text, '?'),
    'rafale_test', coalesce((least(v.rafale_vigilance_kmh, v.rafale_critique_kmh) + 5)::text, '80'),
    'rafale_mesuree', coalesce((greatest(v.rafale_vigilance_kmh, v.rafale_critique_kmh) + 10)::text, '95'),
    'groupe', coalesce(v_ge.nom, 'le groupe électrogène'),
    'alimentes', coalesce(v_ge.alimentes, 'rien de raccordé sur le plan'),
    'nb_public', coalesce(ev.frequentation_max::text, 'quelques centaines de'),
    'groupe_retard', coalesce(v_groupe.nom, 'le dernier groupe parti'),
    'effectif_groupe', coalesce(v_groupe.effectif_prevu::text, 'inconnu'),
    'dernier_lieu', coalesce(v_groupe.dernier, 'le départ'),
    'coucher_soleil', case extract(month from coalesce(ev.date_debut, current_date))::int
                        when 11 then '17h10' when 12 then '16h40' when 1 then '17h00' when 2 then '17h50' when 3 then '18h40'
                        when 10 then '18h50' when 9 then '19h50' when 4 then '20h30' when 8 then '20h50' else '21h40' end,
    'nb_participants', coalesce(ev.frequentation_max::text, '?'),
    'dea', coalesce(v_dea.libelle, 'aucun DEA sur le plan'),
    'dea_distance', case when v_dea.d is not null then format('à %s m du point 0 (≈ %s min aller-retour)', round(v_dea.d)::int, greatest(1, round(2 * v_dea.d / 120))::int) else 'distance inconnue' end,
    'sortie', coalesce(v_sortie, 'la sortie de secours (non encodée)'),
    'sorties', coalesce(v_sorties, 'les sorties de secours (non encodées)'),
    'rassemblement', coalesce(v_rassemblement, 'le point de rassemblement (non encodé)'),
    'borne', coalesce(v_borne, 'la borne incendie la plus proche (non encodée)'),
    'extincteur', coalesce(v_extincteur, 'l''extincteur le plus proche (non encodé)'),
    'manques', to_jsonb(v_manques)
  );

  insert into exercices (evenement_id, titre, format, duree_min, date_prevue, contexte, created_by)
  values (p_evenement, p_titre, p_format, p_duree_min, p_date, ctx, auth.uid()) returning id into v_ex;

  -- Les objectifs choisis, dans l'ordre du catalogue.
  insert into exercice_objectifs (exercice_id, code, intitule, discipline, ordre)
  select v_ex, c.code, c.intitule, c.discipline, row_number() over ()
    from exercice_objectifs_catalogue() c where c.code = any (p_objectifs);

  -- Les trames qui servent ces objectifs ET conviennent à la géométrie
  -- de l'événement ; les mieux couvertes d'abord, à couverture égale la
  -- plus spécifique (écrite pour moins de géométries) ; 2 à 4 selon la durée.
  for r in select t.*, cardinality(array(select unnest(t.objectifs) intersect select unnest(p_objectifs))) as couverture
             from exercice_trames t
            where t.produit = 'eventware' and t.objectifs && p_objectifs and ev.geometrie = any (t.geometries)
            order by couverture desc, cardinality(t.geometries), t.ordre
            limit greatest(2, least(4, p_duree_min / 30)) loop
    n := n + 1;
    v_premier := null;
    v_couverts := v_couverts || r.pieges_couverts;
    for st in select * from jsonb_array_elements(r.stimuli) loop
      v_ordre := v_ordre + 1;
      v_t := round((st ->> 't')::numeric * p_duree_min);
      insert into exercice_stimuli (exercice_id, ordre, t_min, canal, emetteur, texte, note_animateur)
      values (v_ex, v_ordre, v_t, st ->> 'canal', st ->> 'emetteur', remplir_champs(st ->> 'texte', ctx), remplir_champs(st ->> 'note', ctx))
      returning id into v_stim;
      insert into exercice_sources (stimulus_id, table_source, code_controle, detail) values (v_stim, 'exercice_trames', r.code, r.titre);
      if v_premier is null then
        v_premier := v_stim;
        -- La trame joue déjà ces écarts : on les lui rattache, pour la traçabilité.
        for ecart in select * from avant_vol(p_evenement) a where a.code = any (r.pieges_couverts) loop
          insert into exercice_sources (stimulus_id, table_source, source_id, code_controle, detail) values (v_stim, ecart.table_source, ecart.source_id, ecart.code, ecart.titre || ' — ' || ecart.detail);
        end loop;
      end if;
      for ac in select * from jsonb_array_elements(coalesce(st -> 'actions', '[]'::jsonb)) loop
        insert into exercice_actions_attendues (stimulus_id, objectif_id, action, outil, critere_auto, ordre)
        values (v_stim, (select id from exercice_objectifs o where o.exercice_id = v_ex and o.code = ac ->> 'objectif'),
                remplir_champs(ac ->> 'action', ctx), remplir_champs(ac ->> 'outil', ctx), ac ->> 'critere', v_ordre);
      end loop;
    end loop;
  end loop;

  -- Les pièges : les écarts de l'avant-vol qui servent un objectif choisi,
  -- glissés entre les stimuli de trame, les plus graves d'abord.
  n := 0;
  for r in select * from (select distinct on (a.code) a.* from avant_vol(p_evenement) a
                            where a.stimulus is not null and (a.objectif = any (p_objectifs) or a.gravite = 'chaud') and not (a.code = any (v_couverts))
                            order by a.code, a.gravite) d
            order by (d.gravite = 'chaud') desc, d.code loop
    exit when n >= p_max_pieges;
    n := n + 1;
    v_ordre := v_ordre + 1;
    v_t := round(p_duree_min * (0.15 + 0.7 * n / (p_max_pieges + 1)));
    insert into exercice_stimuli (exercice_id, ordre, t_min, canal, emetteur, texte, note_animateur, piege)
    values (v_ex, v_ordre, v_t, 'temoin', 'Animation', r.stimulus, 'Piège issu du contrôle avant-vol : ' || r.titre || ' — ' || r.detail || '. Observer si le QG détecte l''écart.', true)
    returning id into v_stim;
    insert into exercice_sources (stimulus_id, table_source, source_id, code_controle, detail) values (v_stim, r.table_source, r.source_id, r.code, r.titre || ' — ' || r.detail);
    insert into exercice_actions_attendues (stimulus_id, objectif_id, action, outil, ordre)
    values (v_stim, (select id from exercice_objectifs o where o.exercice_id = v_ex and o.code = r.objectif), 'Détecter l''écart « ' || r.titre || ' » et le traiter', 'Écran concerné : ' || r.table_source, v_ordre);
  end loop;

  -- Renuméroter dans l'ordre du temps.
  update exercice_stimuli s set ordre = x.rn from (select id, row_number() over (order by t_min, ordre) rn from exercice_stimuli where exercice_id = v_ex) x where x.id = s.id;
  return v_ex;
end $$;

-- ---------------------------------------------------------------------
-- 6. Droits : retirer d'abord à PUBLIC et anon (090, 121), puis accorder
-- ---------------------------------------------------------------------
revoke execute on function
  public.avant_vol(uuid),
  public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer),
  public.distance_m(double precision, double precision, double precision, double precision)
from public, anon;

grant execute on function
  public.avant_vol(uuid),
  public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer),
  public.distance_m(double precision, double precision, double precision, double precision)
to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (éditeur SQL, en simulant un coordinateur ; tout est
-- annulé par le rollback final)
--
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<uid de Ren>","role":"authenticated"}';
-- select code, detail from avant_vol('c0ae8b79-e502-4907-8b41-f3a3324e3507') where code = 'DEA_ELOIGNE';
-- select code, detail from avant_vol('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6') where code = 'BRANCARDAGE_INCOHERENT';
-- select generer_exercice('c0ae8b79-e502-4907-8b41-f3a3324e3507', 'Essai 128', p_objectifs => array['SECOURS','EVAC','ALERTE','RADIO']);
-- select s.t_min, s.texte from exercice_stimuli s join exercices e on e.id = s.exercice_id where e.titre = 'Essai 128' order by s.ordre;
-- select contexte -> 'manques' from exercices where titre = 'Essai 128';
-- select count(*) from exercice_stimuli where texte ~ '\{[a-z_]+\}';   -- 0
-- rollback;
-- =====================================================================
