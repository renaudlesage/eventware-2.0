-- =====================================================================
-- 164 — PRIMA : LA GRILLE D'ÉVALUATION DU RISQUE MÉDICAL DE LA CoAMU
--
-- La CoAMU (clusters BHN-LILU, province de Liège) évalue le risque
-- médical d'une manifestation avec la grille « Plan Risques et
-- Manifestations » (PRIMA, v1.0 janvier 2024, mémento v1.6 mars 2025).
-- Le coordinateur PLANU y reporte les données du formulaire
-- multidisciplinaire (163). Cette migration pose la grille telle
-- qu'elle est dans le classeur Excel de la CoAMU, rien n'est inventé :
--
--   · score de risque = (spectateurs × type de public × âge × groupes à
--     risque × densité + actifs × type d'actifs × âge) × type
--     d'événement × durée × moment × lieux × certitude × VIP × violence
--     × alcool × météo / 10 000 ;
--   · zone : avis d'office (durée ≥ 24 h, > 10 000 personnes, densité
--     très forte, > 500 actifs, certitude très faible, impact riverains),
--     sinon FAIBLE (< 10), MOYEN (10 à 20 : informer la CoAMU), ÉLEVÉ
--     (≥ 20 : avis demandé) ; extrêmement faible selon IAS 2003 ;
--   · niveau du dispositif médical préventif (DMP) 1 à 5 : somme de
--     treize scorings (type ×10, surface, structure, infrastructures,
--     moment, alcool, affluence, VIP, type de public, âge, groupes,
--     durée, violence) contre les seuils 450, 750, 850, 875, 1 000 ;
--     composition de chaque niveau d'après le mémento (chapitre 10).
--
--   · `prima_referentiel` : les coefficients et scorings par famille ;
--   · `prima_seuils` : les cinq niveaux, leur dispositif et composition ;
--   · `prima_saisies` : les entrées d'un événement (ce qui n'est pas saisi
--     vient d'Eventware — `prima_prerempli` — sinon d'une valeur par
--     défaut signalée comme telle) ;
--   · `calcul_prima(evenement)` : entrées, facteurs, score, zone, motifs
--     d'avis d'office, scoring, niveau DMP et dispositif.
-- `deposer_dossier` (157/160) copie désormais le niveau et le score
-- PRIMA dans le dossier ; `instantane_dossier` fige le calcul ;
-- `controle_dossier` signale l'avis CoAMU à demander et le type
-- d'événement à choisir. La grille PLANU 2009 de la 160 reste en base
-- (aucun DROP) mais n'est plus celle du dossier.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Le référentiel PRIMA : coefficients multiplicatifs et scorings DMP
-- ---------------------------------------------------------------------
create table if not exists public.prima_referentiel (
  famille     text not null,
  code        integer not null,
  libelle     text not null,
  groupe      text,                               -- genre d'événement, ou « surface » / « longueur »
  coefficient numeric not null,                   -- multiplicateur du risque
  scoring     numeric,                            -- points pour le niveau DMP (null : la famille n'en a pas)
  defaut      boolean not null default false,     -- valeur prise quand rien n'est saisi ni connu
  note        text,
  primary key (famille, code)
);
comment on table public.prima_referentiel is 'Grille PRIMA de la CoAMU (164, v1.0 janvier 2024) : coefficients multiplicatifs et scorings DMP par famille. Semée par migration, modifiable par l''exploitant.';

insert into public.prima_referentiel (famille, code, libelle, groupe, coefficient, scoring, defaut, note)
select * from (values
  -- Types d'événements (victimes moyennes pour 10 000 participants ; scoring = ×10)
  ('type_evenement', 1,  'Classique, opéra', 'Concert', 2, 20, false, 'Maurer'),
  ('type_evenement', 2,  'Jazz', 'Concert', 2, 20, false, null),
  ('type_evenement', 3,  'Rock, pop, …', 'Concert', 10, 100, false, 'à mi-chemin entre Grange 1999 et Milsten 2003'),
  ('type_evenement', 4,  'Musique du monde', 'Concert', 6, 60, false, null),
  ('type_evenement', 5,  'Hard rock', 'Concert', 10, 100, false, 'Maurer'),
  ('type_evenement', 6,  'Techno, electro', 'Concert', 10, 100, false, null),
  ('type_evenement', 7,  'Hip-hop, R&B, rap, …', 'Concert', 10, 100, false, null),
  ('type_evenement', 8,  'Théâtre, spectacle de rue, arts forains, cirque', 'Spectacle', 5, 50, false, null),
  ('type_evenement', 9,  'Carnaval, cortège, parade folklorique ou culturelle', 'Cortège', 6, 60, false, 'Maurer'),
  ('type_evenement', 10, 'Commémoration historique et/ou patriotique', 'Cortège', 5, 50, false, 'Maurer'),
  ('type_evenement', 11, 'Cortège ou rallye de véhicules anciens', 'Cortège', 3, 30, false, 'Maurer'),
  ('type_evenement', 12, 'Fête de quartier (braderie, brocante, …)', 'Rassemblement', 6, 60, false, 'Maurer'),
  ('type_evenement', 13, 'Fête du personnel (intérieur ou extérieur)', 'Rassemblement', 3, 30, false, 'Maurer'),
  ('type_evenement', 14, 'Fête d''enfants', 'Rassemblement', 3, 30, false, 'Maurer'),
  ('type_evenement', 15, 'Distribution de produits, imprimés, …', 'Rassemblement', 2, 20, false, 'hsg'),
  ('type_evenement', 16, 'Action de sensibilisation', 'Rassemblement', 2, 20, false, 'hsg'),
  ('type_evenement', 17, 'Sommet, réunion internationale, visite de chef d''État', 'Rassemblement', 3, 30, false, 'hsg'),
  ('type_evenement', 18, 'Course d''endurance : semi-marathon, marathon, …', 'Sport', 10, 100, false, '20 × coefficient 5 (amateur entraîné)'),
  ('type_evenement', 19, 'Course d''endurance : course cycliste', 'Sport', 5, 50, false, 'Maurer'),
  ('type_evenement', 20, 'Marche populaire (ex. Adeps), randonnée pédestre', 'Sport', 1, 10, false, 'Maurer'),
  ('type_evenement', 21, 'Randonnée cycliste', 'Sport', 3, 30, false, 'Maurer'),
  ('type_evenement', 22, 'Match de football (pro ou amateur)', 'Sport', 5, 50, false, 'statistiques Croix-Rouge, avec marge'),
  ('type_evenement', 23, 'Rugby et autres sports collectifs de contact', 'Sport', 4, 40, false, null),
  ('type_evenement', 24, 'Sport de combat (karaté, judo, boxe, …)', 'Sport', 5, 50, false, null),
  ('type_evenement', 25, 'Sport mécanique (karting, voiture, moto, …)', 'Sport', 8, 80, false, 'Maurer'),
  ('type_evenement', 26, 'Sports nautiques', 'Sport', 4, 40, false, 'Maurer'),
  ('type_evenement', 27, 'Sports équestres', 'Sport', 1, 10, false, 'Maurer'),
  ('type_evenement', 28, 'Autres manifestations sportives ordinaires', 'Sport', 4, 40, false, 'Maurer'),
  ('type_evenement', 29, 'Exposition statique d''art, publicitaire, …', 'Divers', 1, 10, false, null),
  ('type_evenement', 30, 'Tournage, documentaire, …', 'Divers', 3, 30, false, null),
  ('type_evenement', 31, 'Manifestation revendicatrice à faible risque', 'Manifestation', 5, 50, false, 'Maurer'),
  ('type_evenement', 32, 'Manifestation revendicatrice à risque moyen', 'Manifestation', 6, 60, false, 'hsg'),
  ('type_evenement', 33, 'Manifestation revendicatrice à haut risque', 'Manifestation', 8, 80, false, 'hsg'),
  ('type_evenement', 34, 'Manifestation avec groupes opposés', 'Manifestation', 10, 100, false, 'hsg'),
  ('type_evenement', 35, 'Sport extrême (saut à l''élastique, base jumping, free climbing, …)', 'Sport', 10, 100, false, null),
  ('type_evenement', 36, 'Sport sortant de l''ordinaire (caisse à savon, quad, escalade, …)', 'Sport', 10, 100, false, null),
  -- Lieux : clôture
  ('cloture', 1, 'Zone ouverte', null, 0.75, 75, true, 'moins de problèmes dans les zones ouvertes (Arbon 2001)'),
  ('cloture', 2, 'Zone clôturée (structures existantes)', null, 1, 100, false, null),
  ('cloture', 3, 'Zone clôturée (par Nadar / Heras)', null, 1, 100, false, null),
  ('cloture', 4, 'Zone clôturée (mixte)', null, 1, 100, false, null),
  -- Lieux : surface ou distance
  ('surface', 1, 'Surface < 0,01 km²', 'surface', 0.75, 37.5, false, 'grille Brabant flamand'),
  ('surface', 2, 'Surface entre 0,01 km² et 1 km²', 'surface', 1, 50, true, null),
  ('surface', 3, 'Surface > 1 km²', 'surface', 2, 100, false, null),
  ('surface', 5, 'Longueur < 10 km', 'longueur', 0.75, 37.5, false, null),
  ('surface', 6, 'Longueur entre 10 et 40 km', 'longueur', 1, 50, false, null),
  ('surface', 7, 'Longueur > 40 km', 'longueur', 2, 100, false, null),
  -- Lieux : structures
  ('structure', 1, 'Site existant et prévu à cet effet', null, 1, 66.66, false, null),
  ('structure', 2, 'Site provisoire et/ou non prévu à cet effet', null, 1.5, 100, true, null),
  -- Lieux : infrastructures
  ('infrastructure', 1, 'Terrain plat', null, 1, 66.66, true, null),
  ('infrastructure', 2, 'Chapiteau(x) de plus de 15 m²', null, 1.5, 100, false, null),
  ('infrastructure', 3, 'Podium(s) ouvert(s) / couvert(s)', null, 1.5, 100, false, null),
  ('infrastructure', 4, 'Gradin(s) / tribune(s) provisoire(s)', null, 1.5, 100, false, null),
  -- Moment (le plus élevé des moments cochés)
  ('moment', 1, 'Journée', null, 1, 50, true, null),
  ('moment', 2, 'Soirée', null, 1.5, 75, false, null),
  ('moment', 3, 'Nuit', null, 2, 100, false, null),
  ('moment', 4, 'Multi-jour', null, 2, 100, false, null),
  -- Certitude globale
  ('certitude', 1, 'Forte (organisateur connu, antécédents positifs sur plusieurs années)', null, 1, 10, false, null),
  ('certitude', 2, 'Raisonnable (manifestation similaire déjà organisée, organisateur fiable)', null, 1.5, 15, true, null),
  ('certitude', 3, 'Faible (organisateur inconnu ou non fiable, antécédents négatifs, pas d''historique)', null, 5, 50, false, null),
  ('certitude', 4, 'Très faible (nombre de participants impossible à déterminer, variant d''un facteur 10)', null, 10, 100, false, null),
  -- Spectateurs : type de public
  ('type_public', 1, 'Assis, statique', null, 0.5, 25, false, 'scores français'),
  ('type_public', 2, 'Debout, calme', null, 0.75, 50, false, null),
  ('type_public', 3, 'Debout, dynamique, démonstratif, revendicateur', null, 1.5, 100, false, null),
  ('type_public', 4, 'Mélange', null, 1, 75, true, null),
  -- Spectateurs et actifs : catégorie d'âge
  ('age', 1, 'Enfants', null, 2, 100, false, null),
  ('age', 2, 'Jeunes / jeunes adultes', null, 1.5, 75, false, null),
  ('age', 3, 'Adultes', null, 1, 50, false, null),
  ('age', 4, 'Personnes âgées', null, 2, 100, false, null),
  ('age', 5, 'Public mixte', null, 1, 50, true, null),
  -- Spectateurs : groupes à risque (supporters violents, personnes à risque médical majeur…)
  ('groupes_risque', 1, 'Exclue', null, 1, 50, true, null),
  ('groupes_risque', 2, 'Possible', null, 1.2, 60, false, null),
  ('groupes_risque', 3, 'Probable', null, 1.7, 85, false, null),
  ('groupes_risque', 4, 'Certaine', null, 2, 100, false, null),
  -- Spectateurs : densité maximale
  ('densite', 1, 'Faible (public clairsemé)', null, 0.75, 25, false, null),
  ('densite', 2, 'Moyenne', null, 1, 50, true, null),
  ('densite', 3, 'Forte (progression difficile)', null, 1.25, 75, false, null),
  ('densite', 4, 'Très forte', null, 10, 100, false, 'avis d''office'),
  -- Participants actifs : type
  ('type_actifs', 1, 'Sports — professionnels', null, 1, 25, false, null),
  ('type_actifs', 2, 'Sports — amateurs entraînés', null, 2, 50, false, null),
  ('type_actifs', 3, 'Sports — amateurs non entraînés', null, 5, 100, false, 'multiplie par 5 les traumatismes (Woodall 2010)'),
  ('type_actifs', 4, 'Concert — professionnels', null, 1, 25, false, null),
  ('type_actifs', 5, 'Concert — non professionnels', null, 2, 50, true, null),
  ('type_actifs', 6, 'Rassemblement — acteurs à risques', null, 2, 75, false, null),
  ('type_actifs', 7, 'Rassemblement — acteurs non à risques', null, 1, 25, false, null),
  -- Risques particuliers
  ('violence', 1, 'Exclue', null, 1, 0, true, null),
  ('violence', 2, 'Possible / mineure', null, 1.25, 50, false, null),
  ('violence', 3, 'Probable / médiane', null, 2.5, 75, false, null),
  ('violence', 4, 'Certaine / majeure', null, 5, 100, false, 'victimes possibles RSCA-Standard'),
  ('alcool', 1, 'Exclue', null, 0.8, 0, false, null),
  ('alcool', 2, 'Possible / mineure', null, 1, 50, true, null),
  ('alcool', 3, 'Probable / médiane', null, 2, 75, false, null),
  ('alcool', 4, 'Certaine / majeure', null, 6, 100, false, 'la présence certaine d''alcool ou de drogue multiplie potentiellement par 6 le nombre de victimes'),
  ('meteo', 1, 'Exclue', null, 1, null, false, null),
  ('meteo', 2, 'Possible / mineure', null, 1.25, null, true, null),
  ('meteo', 3, 'Probable / médiane', null, 2, null, false, null),
  ('meteo', 4, 'Certaine / majeure', null, 7, null, false, 'un des principaux déterminants du nombre de victimes (Brabant wallon, Brabant flamand)')
) as r(famille, code, libelle, groupe, coefficient, scoring, defaut, note)
where not exists (select 1 from public.prima_referentiel x where x.famille = r.famille and x.code = r.code);

-- Les niveaux du dispositif médical préventif (scoring additif, seuils du classeur ; composition du mémento, ch. 10).
create table if not exists public.prima_seuils (
  niveau       integer primary key,
  seuil        numeric not null,                  -- scoring à partir duquel le niveau s'applique
  dispositif   text not null,
  composition  text not null
);
insert into public.prima_seuils (niveau, seuil, dispositif, composition)
select * from (values
  (1, 450,  'Point d''alerte (PA)', 'Surveillance et alerte de la CU 112 : 1 DEA enregistré au SPF, GSM ou téléphone, application 112. Pas de dispositif médical préventif.'),
  (2, 750,  'Poste de premiers secours (PPS)', 'Minimum 3 secouristes, 1 DEA, matériel BLS et petits soins, brancard, 2 places assises ; 1 ou plusieurs équipes d''intervention ; absence, 1 ou plusieurs ambulances (petite noria). Prise en charge : 20 impliqués sur la prestation, 2 T3 simultanés dont 1 couché.'),
  (3, 850,  'Poste de soins (PS)', '4 intervenants dont 3 secouristes et 1 secouriste-ambulancier ou 1 infirmier titré SISU ; 1 ou plusieurs équipes d''intervention ; absence, 1 ou plusieurs ambulances (petite noria) ; absence, 1 ou plusieurs ambulances agréées 112. Prise en charge : 20 impliqués, 1 T2 + 3 T3 ou 5 T3 simultanés.'),
  (4, 875,  'Poste de soins médicalisé (PS Med)', '1 médecin SMA/SMU/TPPSU, 1 infirmier titré SISU, 2 secouristes, 2 secouristes-ambulanciers ; 2 ou plusieurs équipes d''intervention ; 1 ou plusieurs ambulances (petite noria) ; 1 ou plusieurs ambulances agréées 112. Prise en charge : 1 T1 + 2 T2 + 5 T3 simultanés (ALS, BLS, EPILS).'),
  (5, 1000, 'Poste médico-chirurgical (PMChir) ou poste de soins médical renforcé (PSMR)', 'Absence, 1 ou plusieurs PS Med + 1 ou plusieurs PMChir/PSMR : médecin coordinateur (CSM/DSM) et adjoint, préposé CU 112, représentant au CCE ; par poste 3 médecins SMA/SMU/TPPSU, 3 infirmiers SISU, 6 à 9 secouristes, 2 secouristes-ambulanciers ; plusieurs équipes d''intervention, plusieurs ambulances (petite noria), plusieurs ambulances agréées 112.')
) as s(niveau, seuil, dispositif, composition)
where not exists (select 1 from public.prima_seuils x where x.niveau = s.niveau);

-- ---------------------------------------------------------------------
-- 2. Les entrées d'un événement
-- ---------------------------------------------------------------------
create table if not exists public.prima_saisies (
  evenement_id     uuid primary key references public.evenements(id) on delete cascade,
  type_evenement   integer,
  duree_h          numeric,                       -- heures par jour (ou totales, pour l'avis d'office ≥ 24 h)
  journee          boolean, soiree boolean, nuit boolean, multijour boolean,
  cloture          integer, surface integer, structure integer, infrastructure integer,
  certitude        integer,
  spectateurs      integer, type_public integer, age_spectateurs integer, groupes_risque integer, densite integer,
  actifs           integer, type_actifs integer, age_actifs integer,
  vip              integer,
  violence         integer, alcool integer, meteo integer,
  impact_riverains boolean,
  remarques        text,
  created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
comment on table public.prima_saisies is 'Entrées PRIMA saisies pour un événement (164). Une colonne nulle vaut ce qu''Eventware sait, sinon la valeur par défaut du référentiel.';
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_prima_saisies') then
    create trigger tracabilite_prima_saisies before insert or update on public.prima_saisies
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 3. Ce qu'Eventware sait déjà pour la grille
-- ---------------------------------------------------------------------
create or replace function public.prima_prerempli(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  rep jsonb;
  v jsonb := '{}'::jsonb;
  v_prog record; v_km numeric; v_etendue record; v_h numeric;
begin
  if not a_permission(p_evenement, 'referentiels', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return v; end if;
  select r.reponses into rep from conformite_reponses r where r.evenement_id = p_evenement;
  rep := coalesce(rep, '{}'::jsonb);

  -- Spectateurs : la fréquentation maximale.
  v := v || jsonb_build_object('spectateurs', ev.frequentation_max);

  -- Durée et moments : le programme (première et dernière heure d'un même jour), les dates.
  select min(pr.debut) as debut, max(pr.debut + make_interval(mins => coalesce(pr.duree_min, 0))) as fin,
         bool_or(extract(hour from pr.debut) between 6 and 17) as journee,
         bool_or(extract(hour from pr.debut) between 18 and 21) as soiree,
         bool_or(extract(hour from pr.debut) >= 22 or extract(hour from pr.debut) < 6) as nuit
    into v_prog from programme pr where pr.evenement_id = p_evenement and pr.deleted_at is null and pr.debut is not null;
  if v_prog.debut is not null then
    v_h := round(extract(epoch from (v_prog.fin - v_prog.debut)) / 3600.0, 1);
    if ev.date_fin > ev.date_debut then v_h := round(v_h / (ev.date_fin - ev.date_debut + 1), 1); end if;
    v := v || jsonb_build_object('duree_h', greatest(v_h, 1), 'journee', v_prog.journee, 'soiree', v_prog.soiree, 'nuit', v_prog.nuit);
  end if;
  v := v || jsonb_build_object('multijour', ev.date_fin is not null and ev.date_debut is not null and ev.date_fin > ev.date_debut);

  -- Lieux : clôture (périmètre de barrières sur le plan), surface ou longueur (parcours, sinon étendue du plan).
  if exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie::text = 'perimetre') then
    v := v || jsonb_build_object('cloture', 3);
  elsif exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null) then
    v := v || jsonb_build_object('cloture', 1);
  end if;
  select max(t.distance_km) into v_km from traces t where t.evenement_id = p_evenement and t.deleted_at is null and t.actif;
  if v_km is null then select sum(s.distance_totale_m) / 1000.0 into v_km from segments_parcours s where s.evenement_id = p_evenement; end if;
  if coalesce(v_km, 0) > 0 then
    v := v || jsonb_build_object('surface', case when v_km < 10 then 5 when v_km <= 40 then 6 else 7 end, 'longueur_km', round(v_km, 1));
  else
    select (max(e.centre_lat) - min(e.centre_lat)) * 111.0 as h, (max(e.centre_lon) - min(e.centre_lon)) * 111.0 * cos(radians(avg(e.centre_lat))) as l, count(*) as n
      into v_etendue from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.centre_lat is not null;
    if v_etendue.n >= 2 then
      v := v || jsonb_build_object('surface', case when v_etendue.h * v_etendue.l < 0.01 then 1 when v_etendue.h * v_etendue.l <= 1 then 2 else 3 end,
                                   'surface_km2', round((v_etendue.h * v_etendue.l)::numeric, 3));
    end if;
  end if;
  -- Structures et infrastructures : le questionnaire de conformité.
  if (rep -> 'structure' ->> 'local_permanent')::boolean then v := v || jsonb_build_object('structure', 1); end if;
  v := v || jsonb_build_object('infrastructure',
    case when (rep -> 'structure' ->> 'tribune')::boolean then 4
         when (rep -> 'structure' ->> 'podium')::boolean then 3
         when (rep -> 'structure' ->> 'chapiteau')::boolean or (rep -> 'structure' ->> 'tente_communautaire')::boolean then 2
         when rep <> '{}'::jsonb then 1 end);
  -- Type d'événement : ce que le questionnaire déclare sans ambiguïté.
  v := v || jsonb_build_object('type_evenement',
    case when (rep -> 'activite' ->> 'course_cycliste')::boolean then 19
         when (rep -> 'activite' ->> 'automobile')::boolean then 25
         when (rep -> 'activite' ->> 'caisse_savon')::boolean then 36
         when (rep -> 'activite' ->> 'aquatique')::boolean then 26
         when (rep -> 'activite' ->> 'cortege')::boolean or (rep -> 'activite' ->> 'cortege_motorise')::boolean then 9
         when (rep -> 'activite' ->> 'balade')::boolean or (rep -> 'activite' ->> 'balade_flambeaux')::boolean then 20
         when (rep -> 'activite' ->> 'divertissement_extreme')::boolean then 35 end);
  -- Certitude : forte si l'organisation a déjà organisé par le passé, raisonnable sinon.
  v := v || jsonb_build_object('certitude', case when exists (select 1 from evenements e2 where e2.organisation_id = ev.organisation_id and e2.id <> ev.id and e2.deleted_at is null and e2.date_debut < ev.date_debut) then 1 else 2 end);
  -- Alcool : un bar sur le plan rend la présence probable.
  if exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie::text in ('bar', 'bar_installation')) then
    v := v || jsonb_build_object('alcool', 3);
  end if;
  -- Personnalités : les contacts marqués VIP.
  v := v || jsonb_build_object('vip', (select count(*) from contacts c where c.evenement_id = p_evenement and c.deleted_at is null and (c.categorie ilike '%vip%' or c.fonction ilike '%vip%') having count(*) > 0));
  return jsonb_strip_nulls(v);
end $$;

-- ---------------------------------------------------------------------
-- 4. Le calcul
-- ---------------------------------------------------------------------
-- Une entrée du référentiel : la saisie, sinon le pré-rempli, sinon le défaut de la famille ; avec sa provenance.
create or replace function public.prima_retenir(p_famille text, p_cle text, p_saisie integer, p_pre jsonb)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare r prima_referentiel%rowtype; src text; c integer;
begin
  if p_saisie is not null then c := p_saisie; src := 'saisie';
  elsif p_pre ? p_cle then c := (p_pre ->> p_cle)::int; src := 'eventware';
  end if;
  if c is not null then select * into r from prima_referentiel x where x.famille = p_famille and x.code = c; end if;
  if r.code is null then select * into r from prima_referentiel x where x.famille = p_famille and x.defaut limit 1; src := 'defaut'; end if;
  return jsonb_build_object('code', r.code, 'libelle', r.libelle, 'coefficient', r.coefficient, 'scoring', r.scoring, 'source', src);
end $$;
revoke execute on function public.prima_retenir(text, text, integer, jsonb) from public, anon;

create or replace function public.calcul_prima(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s prima_saisies%rowtype;
  pre jsonb;
  entrees jsonb := '{}'::jsonb;
  e jsonb;
  -- valeurs retenues
  v_type int; v_duree numeric; v_journee bool; v_soiree bool; v_nuit bool; v_multi bool;
  v_cloture int; v_surface int; v_structure int; v_infra int; v_certitude int;
  v_spect int; v_type_public int; v_age_s int; v_groupes int; v_densite int;
  v_actifs int; v_type_actifs int; v_age_a int; v_vip int; v_violence int; v_alcool int; v_meteo int; v_riverains bool;
  -- facteurs
  f_type numeric; f_duree numeric; f_moment numeric; f_lieux numeric; f_certitude numeric;
  f_spect numeric; f_actifs numeric; f_vip numeric; f_risques numeric; f_spect_n numeric;
  score numeric; v_scoring numeric := 0; sc_moment numeric; sc_affluence numeric; sc_vip numeric; sc_duree numeric;
  zone text; message text; motifs text[] := '{}'; ias boolean; niveau int; v_seuil prima_seuils%rowtype;
  v_rows jsonb := '[]'::jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into s from prima_saisies where evenement_id = p_evenement;
  pre := prima_prerempli(p_evenement);

  -- Nombres et booléens : saisie, sinon Eventware, sinon 0 / faux.
  v_spect := coalesce(s.spectateurs, (pre ->> 'spectateurs')::int, 0);
  entrees := entrees || jsonb_build_object('spectateurs', jsonb_build_object('valeur', v_spect, 'source', case when s.spectateurs is not null then 'saisie' when pre ? 'spectateurs' then 'eventware' else 'defaut' end));
  v_actifs := coalesce(s.actifs, 0);
  entrees := entrees || jsonb_build_object('actifs', jsonb_build_object('valeur', v_actifs, 'source', case when s.actifs is not null then 'saisie' else 'defaut' end));
  v_vip := coalesce(s.vip, (pre ->> 'vip')::int, 0);
  entrees := entrees || jsonb_build_object('vip', jsonb_build_object('valeur', v_vip, 'source', case when s.vip is not null then 'saisie' when pre ? 'vip' then 'eventware' else 'defaut' end));
  v_duree := coalesce(s.duree_h, (pre ->> 'duree_h')::numeric, 6);
  entrees := entrees || jsonb_build_object('duree_h', jsonb_build_object('valeur', v_duree, 'source', case when s.duree_h is not null then 'saisie' when pre ? 'duree_h' then 'eventware' else 'defaut' end));
  v_journee := coalesce(s.journee, (pre ->> 'journee')::boolean, true);
  v_soiree  := coalesce(s.soiree, (pre ->> 'soiree')::boolean, false);
  v_nuit    := coalesce(s.nuit, (pre ->> 'nuit')::boolean, false);
  v_multi   := coalesce(s.multijour, (pre ->> 'multijour')::boolean, false);
  entrees := entrees || jsonb_build_object('moments', jsonb_build_object('journee', v_journee, 'soiree', v_soiree, 'nuit', v_nuit, 'multijour', v_multi,
    'source', case when s.journee is not null or s.soiree is not null or s.nuit is not null or s.multijour is not null then 'saisie' when pre ? 'journee' or pre ? 'multijour' then 'eventware' else 'defaut' end));
  v_riverains := coalesce(s.impact_riverains, false);
  entrees := entrees || jsonb_build_object('impact_riverains', jsonb_build_object('valeur', v_riverains, 'source', case when s.impact_riverains is not null then 'saisie' else 'defaut' end));

  -- Choix dans le référentiel : saisie, sinon Eventware, sinon le défaut de la famille.
  e := prima_retenir('type_evenement', 'type_evenement', s.type_evenement, pre); entrees := entrees || jsonb_build_object('type_evenement', e); v_type := (e ->> 'code')::int;
  e := prima_retenir('cloture', 'cloture', s.cloture, pre); entrees := entrees || jsonb_build_object('cloture', e); v_cloture := (e ->> 'code')::int;
  e := prima_retenir('surface', 'surface', s.surface, pre); entrees := entrees || jsonb_build_object('surface', e); v_surface := (e ->> 'code')::int;
  e := prima_retenir('structure', 'structure', s.structure, pre); entrees := entrees || jsonb_build_object('structure', e); v_structure := (e ->> 'code')::int;
  e := prima_retenir('infrastructure', 'infrastructure', s.infrastructure, pre); entrees := entrees || jsonb_build_object('infrastructure', e); v_infra := (e ->> 'code')::int;
  e := prima_retenir('certitude', 'certitude', s.certitude, pre); entrees := entrees || jsonb_build_object('certitude', e); v_certitude := (e ->> 'code')::int;
  e := prima_retenir('type_public', 'type_public', s.type_public, pre); entrees := entrees || jsonb_build_object('type_public', e); v_type_public := (e ->> 'code')::int;
  e := prima_retenir('age', 'age_spectateurs', s.age_spectateurs, pre); entrees := entrees || jsonb_build_object('age_spectateurs', e); v_age_s := (e ->> 'code')::int;
  e := prima_retenir('groupes_risque', 'groupes_risque', s.groupes_risque, pre); entrees := entrees || jsonb_build_object('groupes_risque', e); v_groupes := (e ->> 'code')::int;
  e := prima_retenir('densite', 'densite', s.densite, pre); entrees := entrees || jsonb_build_object('densite', e); v_densite := (e ->> 'code')::int;
  e := prima_retenir('type_actifs', 'type_actifs', s.type_actifs, pre); entrees := entrees || jsonb_build_object('type_actifs', e); v_type_actifs := (e ->> 'code')::int;
  e := prima_retenir('age', 'age_actifs', s.age_actifs, pre); entrees := entrees || jsonb_build_object('age_actifs', e); v_age_a := (e ->> 'code')::int;
  e := prima_retenir('violence', 'violence', s.violence, pre); entrees := entrees || jsonb_build_object('violence', e); v_violence := (e ->> 'code')::int;
  e := prima_retenir('alcool', 'alcool', s.alcool, pre); entrees := entrees || jsonb_build_object('alcool', e); v_alcool := (e ->> 'code')::int;
  e := prima_retenir('meteo', 'meteo', s.meteo, pre); entrees := entrees || jsonb_build_object('meteo', e); v_meteo := (e ->> 'code')::int;

  -- Les facteurs, comme le classeur (BO15, BO19, BO21, BO28, BO29, BO38, BO43, BO44, BO49).
  f_type := (entrees -> 'type_evenement' ->> 'coefficient')::numeric;
  f_duree := 1 + greatest(0, (v_duree - 6) / 18.0);
  select max(c) into f_moment from (values (case when v_journee then 1 else 0 end * (select coefficient from prima_referentiel where famille = 'moment' and code = 1)),
                                           (case when v_soiree then 1 else 0 end * (select coefficient from prima_referentiel where famille = 'moment' and code = 2)),
                                           (case when v_nuit then 1 else 0 end * (select coefficient from prima_referentiel where famille = 'moment' and code = 3)),
                                           (case when v_multi then 1 else 0 end * (select coefficient from prima_referentiel where famille = 'moment' and code = 4))) m(c);
  if f_moment = 0 then f_moment := 1; end if;
  f_lieux := (entrees -> 'cloture' ->> 'coefficient')::numeric * (entrees -> 'surface' ->> 'coefficient')::numeric
           * (entrees -> 'structure' ->> 'coefficient')::numeric * (entrees -> 'infrastructure' ->> 'coefficient')::numeric;
  f_certitude := (entrees -> 'certitude' ->> 'coefficient')::numeric;
  -- Au-delà de 100 000 spectateurs, le taux de victimes décroît : la moitié des spectateurs supplémentaires compte.
  f_spect_n := case when v_spect < 100000 then v_spect else 100000 + (v_spect - 100000) / 2.0 end;
  f_spect := f_spect_n * (entrees -> 'type_public' ->> 'coefficient')::numeric * (entrees -> 'age_spectateurs' ->> 'coefficient')::numeric
           * (entrees -> 'groupes_risque' ->> 'coefficient')::numeric * (entrees -> 'densite' ->> 'coefficient')::numeric;
  f_actifs := v_actifs * (entrees -> 'type_actifs' ->> 'coefficient')::numeric * (entrees -> 'age_actifs' ->> 'coefficient')::numeric;
  f_vip := 1 + log(1 + 10.0 * v_vip / 50.0);
  f_risques := (entrees -> 'violence' ->> 'coefficient')::numeric * (entrees -> 'alcool' ->> 'coefficient')::numeric * (entrees -> 'meteo' ->> 'coefficient')::numeric;
  score := (f_spect + f_actifs) * f_type * f_duree * f_moment * f_lieux * f_certitude * f_vip * f_risques / 10000.0;

  -- Avis d'office à la CoAMU si un seuil critique est dépassé.
  if v_duree >= 24 then motifs := array_append(motifs, 'durée totale supérieure à 24 heures'); end if;
  if v_spect + v_actifs > 10000 then motifs := array_append(motifs, 'plus de 10 000 personnes présentes simultanément'); end if;
  if v_densite >= 4 then motifs := array_append(motifs, 'densité maximale très élevée'); end if;
  if v_actifs > 500 then motifs := array_append(motifs, 'plus de 500 participants actifs'); end if;
  if v_certitude = 4 then motifs := array_append(motifs, 'certitude globale très faible'); end if;
  if v_riverains then motifs := array_append(motifs, 'impact important sur les riverains'); end if;
  -- IAS 2003 : pas de dispositif requis si tout est petit et calme.
  ias := v_spect < 1500 and v_actifs = 0 and v_densite < 3 and v_duree <= 3 and v_type_public <= 2 and v_groupes = 1;
  if f_type is null then
    -- Sans type d'événement, pas de score : la grille attend ce choix.
    zone := 'incomplet'; message := 'INCOMPLET : choisir le type d''événement pour obtenir le score de risque et le niveau du dispositif.';
  elsif array_length(motifs, 1) > 0 then
    zone := 'avis_office'; message := 'ATTENTION : l''avis de la CoAMU est demandé car au moins un des risques a dépassé un seuil critique (' || array_to_string(motifs, ', ') || ').';
  elsif score >= 20 then zone := 'eleve'; message := 'ÉLEVÉ : risques majeurs — l''avis de la CoAMU est demandé.';
  elsif score >= 10 then zone := 'moyen'; message := 'MOYEN : risques modérés — informer la CoAMU.';
  elsif ias then zone := 'extremement_faible'; message := 'FAIBLE : risques extrêmement faibles (IAS 2003) — l''avis de la CoAMU n''est pas nécessaire.';
  else zone := 'faible'; message := 'FAIBLE : risques faibles — l''avis de la CoAMU n''est pas nécessaire.';
  end if;

  -- Le niveau du dispositif : treize scorings additionnés.
  select max(c) into sc_moment from (values (case when v_journee then (select scoring from prima_referentiel where famille = 'moment' and code = 1) else 0 end),
                                            (case when v_soiree then (select scoring from prima_referentiel where famille = 'moment' and code = 2) else 0 end),
                                            (case when v_nuit then (select scoring from prima_referentiel where famille = 'moment' and code = 3) else 0 end),
                                            (case when v_multi then (select scoring from prima_referentiel where famille = 'moment' and code = 4) else 0 end)) m(c);
  if sc_moment = 0 then sc_moment := 50; end if;
  sc_affluence := case when v_spect + v_actifs + v_vip < 500 then 0 when v_spect + v_actifs + v_vip < 2000 then 20 when v_spect + v_actifs + v_vip < 5000 then 40
                       when v_spect + v_actifs + v_vip < 10000 then 60 when v_spect + v_actifs + v_vip < 30000 then 80 when v_spect + v_actifs + v_vip < 100000 then 100 else 150 end;
  sc_vip := case when f_vip < 1.08 then 43 when f_vip < 1.15 then 46 when f_vip < 1.2 then 49 when f_vip < 1.26 then 51 when f_vip < 1.48 then 54
                 when f_vip < 1.7 then 63 when f_vip < 2.04 then 73 when f_vip < 2.32 then 88 else 100 end;
  sc_duree := case when v_duree < 3 then 25 when v_duree < 6 then 50 when v_duree < 12 then 75 else 100 end;
  v_rows := jsonb_build_array(
    jsonb_build_object('critere', 'Type d''événement', 'points', (entrees -> 'type_evenement' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Surface ou distance', 'points', (entrees -> 'surface' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Structures', 'points', (entrees -> 'structure' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Infrastructures', 'points', (entrees -> 'infrastructure' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Moment', 'points', sc_moment),
    jsonb_build_object('critere', 'Alcool, drogue', 'points', (entrees -> 'alcool' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Affluence', 'points', sc_affluence),
    jsonb_build_object('critere', 'Personnalités', 'points', sc_vip),
    jsonb_build_object('critere', 'Type de public', 'points', (entrees -> 'type_public' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Catégorie d''âge', 'points', (entrees -> 'age_spectateurs' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Groupes à risque', 'points', (entrees -> 'groupes_risque' ->> 'scoring')::numeric),
    jsonb_build_object('critere', 'Durée', 'points', sc_duree),
    jsonb_build_object('critere', 'Violence', 'points', (entrees -> 'violence' ->> 'scoring')::numeric));
  select sum((x ->> 'points')::numeric) into v_scoring from jsonb_array_elements(v_rows) x;
  if f_type is not null then
    select * into v_seuil from prima_seuils p where p.seuil <= v_scoring order by p.niveau desc limit 1;
    niveau := v_seuil.niveau;
  else
    v_scoring := null;
  end if;

  return jsonb_build_object(
    'version', 'PRIMA v1.0 (janvier 2024), mémento v1.6 (mars 2025)',
    'entrees', entrees,
    'facteurs', jsonb_build_object('type', round(f_type, 3), 'duree', round(f_duree, 3), 'moment', f_moment, 'lieux', round(f_lieux, 3), 'certitude', f_certitude,
                                   'spectateurs', round(f_spect, 1), 'actifs', round(f_actifs, 1), 'vip', round(f_vip, 3), 'risques', round(f_risques, 3)),
    'score', round(score, 2),
    'zone', zone, 'message', message, 'motifs_avis_office', to_jsonb(motifs), 'ias2003', ias,
    'avis_coamu', zone in ('eleve', 'avis_office'), 'informer_coamu', zone = 'moyen',
    'scoring', jsonb_build_object('total', v_scoring, 'details', v_rows,
                                  'seuils', (select jsonb_agg(jsonb_build_object('niveau', p.niveau, 'seuil', p.seuil, 'dispositif', p.dispositif) order by p.niveau) from prima_seuils p)),
    'niveau', niveau, 'dispositif', v_seuil.dispositif, 'composition', v_seuil.composition,
    'remarques', s.remarques,
    'a_confirmer', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_each(entrees) e(k, val) where val ->> 'source' = 'defaut' and k in ('type_evenement', 'spectateurs', 'duree_h'))
  );
end $$;

comment on function public.prima_prerempli(uuid) is 'Ce qu''Eventware sait déjà pour la grille PRIMA (164) : public, programme, plan, parcours, conformité, contacts.';
comment on function public.calcul_prima(uuid) is 'Grille PRIMA de la CoAMU (164) : entrées retenues et leur provenance, facteurs, score de risque, zone, motifs d''avis d''office, scoring et niveau DMP.';
revoke execute on function public.prima_prerempli(uuid), public.calcul_prima(uuid) from public, anon;
grant  execute on function public.prima_prerempli(uuid), public.calcul_prima(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Le dossier : dépôt, instantané, contrôles
-- ---------------------------------------------------------------------
-- Le dépôt copie le niveau et le score PRIMA dans le dossier (157/160, redéfinie).
create or replace function public.deposer_dossier(p_evenement uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_dossier dossiers_securite%rowtype;
  v_bloquants text[];
  v_version integer;
  v_nom text;
  v_prima jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Dépôt du dossier non autorisé' using errcode = '42501';
  end if;
  select array_agg(k.titre order by k.code) into v_bloquants from controle_dossier(p_evenement) k where k.gravite = 'bloquant';
  if coalesce(array_length(v_bloquants, 1), 0) > 0 then
    raise exception 'Dépôt refusé : % point(s) bloquant(s) — %', array_length(v_bloquants, 1), array_to_string(v_bloquants, ' ; ')
      using errcode = 'P0010';
  end if;
  insert into dossiers_securite (evenement_id) values (p_evenement) on conflict (evenement_id) do nothing;
  select * into v_dossier from dossiers_securite where evenement_id = p_evenement for update;

  -- (164) La grille PRIMA du moment, copiée dans le dossier avant l'instantané.
  v_prima := calcul_prima(p_evenement);
  update dossiers_securite set niveau_dmp = (v_prima ->> 'niveau')::int, score_dmp = (v_prima ->> 'score')::numeric where id = v_dossier.id;

  v_version := v_dossier.version_courante + 1;
  select m.nom_affiche into v_nom from membres_evenement m where m.evenement_id = p_evenement and m.user_id = auth.uid() and m.deleted_at is null limit 1;
  insert into dossier_versions (dossier_id, version, contenu, auteur, auteur_nom)
  values (v_dossier.id, v_version, instantane_dossier(p_evenement), auth.uid(), v_nom);
  update dossiers_securite set statut = 'depose', version_courante = v_version, depose_le = now(), decide_le = null where id = v_dossier.id;
  perform journaliser(p_evenement, 'securite', 'dossier',
    format('Dossier de sécurité déposé (version %s)', v_version), 'notable', 'dossiers_securite', v_dossier.id, 'v' || v_version);
  return jsonb_build_object('dossier_id', v_dossier.id, 'version', v_version, 'statut', 'depose', 'niveau_dmp', v_prima ->> 'niveau', 'zone_prima', v_prima ->> 'zone');
end $$;

-- L'instantané (157/163, redéfinie) : la grille PRIMA figée avec le reste.
create or replace function public.instantane_dossier(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  zone communes%rowtype;
  v jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then raise exception 'Événement inconnu' using errcode = 'P0002'; end if;
  select * into zone from communes where nom = ev.commune limit 1;
  v := jsonb_build_object(
    'fige_le', now(),
    'evenement', jsonb_build_object(
      'id', ev.id, 'nom', ev.nom, 'commune', ev.commune, 'province', ev.province,
      'zone_police', zone.zone_police, 'zone_secours', zone.zone_secours,
      'date_montage', ev.date_montage, 'date_debut', ev.date_debut, 'date_fin', ev.date_fin, 'date_demontage', ev.date_demontage,
      'frequentation_min', ev.frequentation_min, 'frequentation_max', ev.frequentation_max,
      'point_0', case when ev.point_0_lat is not null then jsonb_build_object('lat', ev.point_0_lat, 'lon', ev.point_0_lon) end),
    'organisateur', (select jsonb_build_object('nom', o.nom, 'contact_nom', o.contact_nom, 'contact_email', o.contact_email, 'contact_tel', o.contact_tel)
                     from organisations o where o.id = ev.organisation_id),
    'profil_securite', (select to_jsonb(p) - 'created_at' - 'updated_at' - 'created_by' - 'updated_by'
                        from organisations_profil_securite p where p.organisation_id = ev.organisation_id),
    'questionnaire', (select r.reponses from conformite_reponses r where r.evenement_id = p_evenement),
    'prescriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'referentiel', r.nom, 'portee', r.portee, 'version', r.version,
               'code', i.code, 'categorie', i.categorie, 'titre', i.titre, 'caractere', i.caractere,
               'dispositions', i.dispositions, 'seuils', i.seuils,
               'complement_local', (select l.complement from referentiel_locaux l
                                     where l.organisation_id = ev.organisation_id and l.referentiel_item_id = i.id limit 1))
             order by r.nom, i.code)
      from referentiel_items i
      join referentiels r on r.id = i.referentiel_id and r.actif
      left join conformite_reponses cr on cr.evenement_id = p_evenement
      where (r.organisation_id is null or r.organisation_id = ev.organisation_id)
        and (coalesce(r.zone_nom, '') = '' or r.zone_nom in (zone.zone_police, zone.zone_secours))
        and (i.toujours_applicable
             or (i.condition_cle is not null
                 and coalesce((cr.reponses -> split_part(i.condition_cle, '.', 1) ->> split_part(i.condition_cle, '.', 2))::boolean, false)))), '[]'::jsonb),
    'lieux', coalesce((select jsonb_agg(jsonb_build_object('code', l.code, 'nom', l.nom, 'type', l.type, 'lat', l.latitude, 'lon', l.longitude) order by l.code)
                       from lieux l where l.evenement_id = p_evenement and l.deleted_at is null), '[]'::jsonb),
    'plan', coalesce((select jsonb_agg(jsonb_build_object('code', e.code, 'nom', e.nom, 'categorie', e.categorie, 'calque', e.calque, 'nature', e.nature,
                                                          'lat', e.centre_lat, 'lon', e.centre_lon, 'largeur_m', e.largeur_m, 'longueur_m', e.longueur_m,
                                                          'quantite', e.quantite, 'confirme', e.confirme) order by e.calque, e.code)
                      from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null), '[]'::jsonb),
    'secours', coalesce((select jsonb_agg(jsonb_build_object('type', m.type, 'quantite', m.quantite, 'commentaire', m.commentaire) order by m.type)
                         from moyens_premiers_secours m where m.evenement_id = p_evenement), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('nom', c.nom, 'organisation', c.organisation, 'fonction', c.fonction, 'telephone', c.telephone,
                                                              'email', c.email, 'categorie', c.categorie, 'role_autorite', c.role_autorite) order by c.categorie, c.nom)
                          from contacts c where c.evenement_id = p_evenement and c.deleted_at is null
                            and (c.visible_autorite or c.role_autorite is not null)), '[]'::jsonb),
    'controles', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'gravite', k.gravite, 'titre', k.titre, 'detail', k.detail) order by k.gravite, k.code)
                           from controle_dossier(p_evenement) k), '[]'::jsonb),
    'dmp', (select jsonb_build_object('niveau', d.niveau_dmp, 'score', d.score_dmp) from dossiers_securite d where d.evenement_id = p_evenement),
    'formulaire', formulaire_dossier(p_evenement),
    'formulaires', coalesce((select jsonb_agg(formulaire_dossier(p_evenement, f.code)) from formulaires_applicables(p_evenement) f), '[]'::jsonb),
    -- (164) La grille PRIMA telle qu'elle se lit au dépôt.
    'prima', calcul_prima(p_evenement)
  );
  return v;
end $$;

-- Les contrôles (156/163, redéfinie) : l'avis CoAMU que la grille demande, le type d'événement à choisir.
create or replace function public.controle_dossier(p_evenement uuid)
returns table (code text, gravite text, titre text, detail text, table_source text, source_id uuid, stimulus text, objectif text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v_manques text[];
  v_reponses jsonb;
  v_form jsonb;
  v_n int;
  v_f formulaires%rowtype;
  v_statut text;
  v_jours int;
  v_prima jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return; end if;
  begin
    return query select a.* from avant_vol(p_evenement) a;
  exception when insufficient_privilege then
    null;
  end;
  if coalesce(ev.commune, '') = '' then
    return query select 'DOS_COMMUNE', 'bloquant', 'Commune non renseignée',
      'Le dossier se dépose auprès d''une commune : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  end if;
  if ev.frequentation_max is null then
    return query select 'DOS_FREQUENTATION', 'bloquant', 'Fréquentation maximale non renseignée',
      'Le niveau du dispositif médical et les prescriptions en dépendent : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  end if;
  if ev.date_debut is null or ev.date_fin is null then
    return query select 'DOS_DATES', 'bloquant', 'Dates de la manifestation non renseignées',
      'Premier et dernier jour : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  elsif ev.date_montage is null or ev.date_demontage is null then
    return query select 'DOS_DATES', 'bloquant', 'Dates de montage et de démontage non renseignées',
      'La commune autorise l''occupation du montage au démontage : Réglages › Dispositif', 'evenements', ev.id, null::text, 'DOSSIER';
  end if;
  if not exists (select 1 from contacts c where c.evenement_id = p_evenement and c.deleted_at is null
                   and c.role_autorite = 'interlocuteur' and coalesce(c.telephone, '') <> '') then
    return query select 'DOS_COORDINATEUR', 'bloquant', 'Coordinateur sécurité non désigné ou sans téléphone',
      'Désigner l''interlocuteur des autorités, avec son numéro : Réglages › Partage › Interlocuteur', 'contacts', null::uuid, null::text, 'DOSSIER';
  end if;
  if not exists (select 1 from lieux l where l.evenement_id = p_evenement and l.deleted_at is null
                   and l.type = 'pc_ops' and l.latitude is not null and l.longitude is not null) then
    return query select 'DOS_PC_OPS', 'bloquant', 'PC-Ops non positionné',
      'Un lieu de type « PC opérationnel » avec ses coordonnées : Préparation › Lieux', 'lieux', null::uuid, null::text, 'DOSSIER';
  end if;
  if not exists (select 1 from contacts c where c.evenement_id = p_evenement and c.deleted_at is null and coalesce(c.telephone, '') <> ''
                   and (c.categorie ilike '%secours%' or c.organisation ilike '%secours%' or c.nom ilike '%secours%'
                        or c.organisation ilike '%dispatch%' or c.nom ilike '%dispatch%' or c.organisation ilike '%pompier%')) then
    return query select 'DOS_TEL_SECOURS', 'bloquant', 'Numéro de la zone de secours absent',
      'Le dispatch de la zone de secours, avec son numéro direct : Mémento › Contacts (catégorie « secours »)', 'contacts', null::uuid, null::text, 'DOSSIER';
  end if;
  if not exists (select 1 from contacts c where c.evenement_id = p_evenement and c.deleted_at is null and coalesce(c.telephone, '') <> ''
                   and (c.categorie ilike '%police%' or c.organisation ilike '%police%' or c.nom ilike '%police%')) then
    return query select 'DOS_TEL_POLICE', 'bloquant', 'Numéro de la police absent',
      'La zone de police, avec un numéro direct : Mémento › Contacts (catégorie « police »)', 'contacts', null::uuid, null::text, 'DOSSIER';
  end if;
  select r.reponses into v_reponses from conformite_reponses r where r.evenement_id = p_evenement;
  if v_reponses is null or v_reponses = '{}'::jsonb then
    return query select 'DOS_QUESTIONNAIRE', 'bloquant', 'Questionnaire de conformité non rempli',
      'Structures, cuisson, gaz, chauffage, activités : Réglages › Conformité › Questionnaire', 'conformite_reponses', null::uuid, null::text, 'DOSSIER';
  end if;
  if ev.organisation_id is null then
    return query select 'DOS_PROFIL', 'bloquant', 'Événement sans organisation',
      'Le profil de sécurité se lit sur l''organisation', 'organisations_profil_securite', null::uuid, null::text, 'DOSSIER';
  else
    v_manques := profil_securite_manques(ev.organisation_id);
    if coalesce(array_length(v_manques, 1), 0) > 0 then
      return query select 'DOS_PROFIL', 'bloquant', 'Profil de sécurité de l''organisation incomplet',
        'Manque : ' || array_to_string(v_manques, ', ') || ' — Réglages › Organisation', 'organisations_profil_securite', null::uuid, null::text, 'DOSSIER';
    end if;
  end if;
  if not exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null) then
    return query select 'DOS_PLAN', 'alerte', 'Plan d''implantation vide',
      'Le dossier joint le plan du site : Implantation', 'elements_plan', null::uuid, null::text, 'DOSSIER';
  end if;
  if not exists (select 1 from moyens_premiers_secours m where m.evenement_id = p_evenement and coalesce(m.quantite, 0) > 0) then
    return query select 'DOS_SECOURS', 'alerte', 'Aucun moyen de premiers secours déclaré',
      'Secouristes, DEA, poste de secours : Réglages › Conformité', 'moyens_premiers_secours', null::uuid, null::text, 'DOSSIER';
  end if;
  -- (163) Chaque formulaire applicable : obligatoires sans réponse, délai de dépôt.
  select d.statut into v_statut from dossiers_securite d where d.evenement_id = p_evenement;
  for v_f in select * from formulaires_applicables(p_evenement) loop
    v_form := formulaire_dossier(p_evenement, v_f.code);
    v_n := jsonb_array_length(v_form -> 'obligatoires_manquantes');
    if v_n > 0 then
      return query select 'DOS_FORMULAIRE', 'alerte', format('%s : %s question(s) obligatoire(s) sans réponse', v_f.libelle, v_n),
        'Questions ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_form -> 'obligatoires_manquantes') x) || ' — Réglages › Dossier de sécurité › Formulaires',
        'formulaire_reponses', v_f.id, null::text, 'DOSSIER';
    end if;
    v_jours := coalesce(ev.date_montage, ev.date_debut) - current_date;
    if v_f.delai_jours is not null and coalesce(v_statut, 'brouillon') in ('brouillon', 'retire') and v_jours < v_f.delai_jours + 14 then
      return query select 'DOS_DELAI', 'alerte',
        case when v_jours < v_f.delai_jours then format('%s : délai de dépôt dépassé', v_f.libelle) else format('%s : délai de dépôt dans %s jour(s)', v_f.libelle, v_jours - v_f.delai_jours) end,
        format('À rentrer %s jours avant la mise en place (%s), soit avant le %s. %s', v_f.delai_jours, to_char(coalesce(ev.date_montage, ev.date_debut), 'DD/MM/YYYY'),
               to_char(coalesce(ev.date_montage, ev.date_debut) - v_f.delai_jours, 'DD/MM/YYYY'), coalesce(v_f.delai_note, '')),
        'formulaires', v_f.id, null::text, 'DOSSIER';
    end if;
  end loop;
  -- (164) La grille PRIMA : le type d'événement à choisir, l'avis CoAMU qu'elle demande.
  v_prima := calcul_prima(p_evenement);
  if v_prima -> 'a_confirmer' ? 'type_evenement' then
    return query select 'DOS_PRIMA_TYPE', 'alerte', 'Grille PRIMA : type d''événement à choisir',
      'Le score de risque et le niveau du dispositif en dépendent : Réglages › Dossier de sécurité › Grille PRIMA', 'prima_saisies', null::uuid, null::text, 'DOSSIER';
  end if;
  if (v_prima ->> 'avis_coamu')::boolean then
    return query select 'DOS_PRIMA_AVIS', 'alerte', 'Grille PRIMA : avis de la CoAMU demandé',
      format('%s Dossier et grille à envoyer via le coordinateur PLANU entre 90 et 60 jours avant l''événement (admin.lie@health.fgov.be) ; notification du dispositif à la CU 112 au moins 10 jours ouvrés avant.', v_prima ->> 'message'),
      'prima_saisies', null::uuid, null::text, 'DOSSIER';
  elsif (v_prima ->> 'informer_coamu')::boolean then
    return query select 'DOS_PRIMA_INFO', 'veille', 'Grille PRIMA : informer la CoAMU',
      v_prima ->> 'message', 'prima_saisies', null::uuid, null::text, 'DOSSIER';
  end if;
  return;
end $$;

-- ---------------------------------------------------------------------
-- 6. RLS : référentiel et seuils lus par tous, édités par l'exploitant ;
--    saisies par les droits « référentiels » (comme conformite_reponses)
-- ---------------------------------------------------------------------
alter table public.prima_referentiel enable row level security;
alter table public.prima_seuils enable row level security;
alter table public.prima_saisies enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'prima_referentiel' and policyname = 'prima_referentiel_lecture') then
    create policy prima_referentiel_lecture on public.prima_referentiel for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prima_referentiel' and policyname = 'prima_referentiel_gestion') then
    create policy prima_referentiel_gestion on public.prima_referentiel for all to authenticated using (est_exploitant()) with check (est_exploitant());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prima_seuils' and policyname = 'prima_seuils_lecture') then
    create policy prima_seuils_lecture on public.prima_seuils for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prima_seuils' and policyname = 'prima_seuils_gestion') then
    create policy prima_seuils_gestion on public.prima_seuils for all to authenticated using (est_exploitant()) with check (est_exploitant());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prima_saisies' and policyname = 'prima_saisies_lecture') then
    create policy prima_saisies_lecture on public.prima_saisies for select to authenticated
      using (a_permission(evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prima_saisies' and policyname = 'prima_saisies_ecriture') then
    create policy prima_saisies_ecriture on public.prima_saisies for all to authenticated
      using (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id));
  end if;
end $p$;
revoke all on public.prima_referentiel, public.prima_seuils, public.prima_saisies from public, anon;
grant select, insert, update, delete on public.prima_referentiel, public.prima_seuils, public.prima_saisies to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/164.sql)
--   select calcul_prima('<evenement>') -> 'score', -> 'zone', -> 'niveau';
--   select * from controle_dossier('<evenement>') where code like 'DOS_PRIMA%';
-- =====================================================================
