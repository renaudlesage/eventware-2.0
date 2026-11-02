-- =====================================================================
-- 163 — LES FORMULAIRES DE DEMANDE D'AUTORISATION (dossier, suite)
--
-- Chaque autorité a son formulaire. La cellule de sécurité (province de
-- Liège, coordinateur PLANU, CoAMU) demande le « Formulaire
-- multidisciplinaire » fédéral, version octobre 2017 : douze sections,
-- environ deux cents questions, une checklist d'annexes. La commune de
-- Ferrières impose le sien (zone de police du Condroz, zone de secours
-- HEMECO, collège du 16 novembre 2023) : douze rubriques, un délai de
-- 60 jours avant la mise en place (90 si présence policière), une liste
-- de matériel communal. Eventware connaît déjà une bonne part des
-- réponses (dates, lieu, public, structures, contacts, assurances,
-- plan) : chaque formulaire se remplit d'abord tout seul, l'organisateur
-- complète le reste.
--
--   · `formulaires` : les formulaires connus, avec leur portée (fédéral,
--     province, commune), leur délai et leur adresse d'envoi ;
--   · `formulaire_sections`, `formulaire_questions` : le catalogue de
--     chaque formulaire, semé ici d'après les documents, modifiable par
--     l'exploitant (libellé, aide, ordre, obligatoire, actif) ;
--   · `formulaire_reponses` : les réponses d'un événement, une ligne par
--     question, valeur jsonb (texte, nombre, oui/non, liste, contact) ;
--   · `formulaires_applicables(evenement)` : les formulaires qui valent
--     pour la commune, la province, le pays de l'événement ;
--   · `formulaire_prerempli(evenement)` : ce qu'Eventware sait déjà, par
--     code de source ; `formulaire_dossier(evenement, formulaire)` :
--     réponses saisies par-dessus le pré-rempli, section par section,
--     pour l'écran, l'instantané (157) et le PDF.
-- L'instantané du dossier reprend les formulaires applicables ;
-- `controle_dossier` (156) signale les questions obligatoires sans
-- réponse (alerte) et le délai de dépôt qui approche (alerte).
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Les formulaires et leur catalogue
-- ---------------------------------------------------------------------
create table if not exists public.formulaires (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  libelle      text not null,
  autorite     text,                             -- qui le demande
  portee       text not null default 'commune' check (portee in ('federal', 'province', 'commune')),
  province     text,                             -- portée province ou commune
  commune      text,                             -- portée commune
  version      text,
  delai_jours  integer,                          -- à rentrer N jours avant la mise en place
  delai_note   text,
  adresse_envoi text,
  notes        text,
  actif        boolean not null default true
);
comment on table public.formulaires is
  'Formulaires de demande d''autorisation connus (163) : le multidisciplinaire fédéral, ceux des communes. Semés par migration, modifiables par l''exploitant.';

insert into public.formulaires (code, libelle, autorite, portee, province, commune, version, delai_jours, delai_note, adresse_envoi, notes)
select * from (values
  ('FERRIERES_2023', 'Organisation de manifestations publiques — commune de Ferrières', 'Commune de Ferrières, zone de police du Condroz, zone de secours HEMECO',
   'commune', 'Liège', 'Ferrières', 'Collège communal du 16 novembre 2023', 60,
   '60 jours avant la mise en place (zone de secours HEMECO) ; 90 jours si une présence policière est requise (zone de police du Condroz). Les demandes incomplètes sont renvoyées.',
   'manifestations@ferrieres.be ou Place de Chablis 21, 4190 Ferrières',
   'Le RZI (règlement zonal incendie, parties 6, 7 et 8) s''applique à toute manifestation temporaire. Service prévention HEMECO : 085/27 10 00, preventionhemeco@gmail.com. Manifestation en forêt : autorisation du DNF, cantonnement d''Aywaille (04/247 99 90).'),
  ('IBZ_2017', 'Formulaire multidisciplinaire événement', 'Centre de crise national (IBZ), cellule de sécurité communale, coordinateur PLANU, CoAMU',
   'federal', null, null, 'Octobre 2017', 90,
   'Le coordinateur PLANU en reporte les données dans la grille PRIMA de la CoAMU, à envoyer entre 90 et 60 jours avant l''événement ; à moins de 60 jours, la CoAMU ne rend plus d''avis.',
   'via le coordinateur PLANU de la commune ; CoAMU Liège : admin.lie@health.fgov.be',
   null)
) as f(code, libelle, autorite, portee, province, commune, version, delai_jours, delai_note, adresse_envoi, notes)
where not exists (select 1 from public.formulaires x where x.code = f.code);

create table if not exists public.formulaire_sections (
  formulaire_id uuid not null references public.formulaires(id) on delete cascade,
  section       integer not null,
  titre         text not null,
  primary key (formulaire_id, section)
);

create table if not exists public.formulaire_questions (
  id            uuid primary key default gen_random_uuid(),
  formulaire_id uuid not null references public.formulaires(id) on delete cascade,
  code          text not null,
  section       integer not null,                -- numéro de section du formulaire
  sous_section  text,                            -- « 4.1 Public », « Camping »…
  ordre         integer not null default 100,
  libelle       text not null,
  aide          text,
  type          text not null default 'texte' check (type in ('texte', 'nombre', 'oui_non', 'oui_non_explication', 'choix', 'multi', 'date', 'contact', 'annexe')),
  options       text[],                          -- choix et multi
  source        text,                            -- code du pré-remplissage (formulaire_prerempli)
  obligatoire   boolean not null default false,
  actif         boolean not null default true,
  unique (formulaire_id, code)
);
comment on table public.formulaire_questions is
  'Questions des formulaires de demande d''autorisation (163). Semées par migration, modifiables par l''exploitant.';

create table if not exists public.formulaire_reponses (
  evenement_id  uuid not null references public.evenements(id) on delete cascade,
  formulaire_id uuid not null references public.formulaires(id) on delete cascade,
  code          text not null,
  valeur        jsonb,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  primary key (evenement_id, formulaire_id, code),
  foreign key (formulaire_id, code) references public.formulaire_questions(formulaire_id, code) on delete cascade
);
comment on table public.formulaire_reponses is 'Réponses d''un événement à un formulaire (163). Une réponse saisie prime sur le pré-rempli.';
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_formulaire_reponses') then
    create trigger tracabilite_formulaire_reponses before insert or update on public.formulaire_reponses
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- Les sections, pour l'écran et le PDF.
insert into public.formulaire_sections (formulaire_id, section, titre)
select f.id, s.section, s.titre from public.formulaires f, (values
    (1, 'Information générale sur l''événement'), (2, 'Données de l''organisateur'), (3, 'Données sur le public'),
    (4, 'Éléments pour l''analyse du risque'), (5, 'Ordre public, tranquillité et nuisances éventuelles'), (6, 'Mobilité'),
    (7, 'Information et communication'), (8, 'Logistique et restauration'), (9, 'Mesures supplémentaires'),
    (10, 'Contexte local spécifique'), (11, 'Coordonnées de contacts utiles pendant l''événement'), (12, 'Checklist annexes')
  ) as s(section, titre)
where f.code = 'IBZ_2017' and not exists (select 1 from public.formulaire_sections x where x.formulaire_id = f.id and x.section = s.section);
insert into public.formulaire_sections (formulaire_id, section, titre)
select f.id, s.section, s.titre from public.formulaires f, (values
    (1, 'La manifestation'), (2, 'Type de la manifestation'), (3, 'Identification du demandeur'),
    (4, 'Assurances'), (5, 'Description et durée'), (6, 'Public concerné'),
    (7, 'Bal'), (8, 'Encadrement du public'), (9, 'Mesures de police souhaitées'),
    (10, 'Zone de secours : chapiteaux, cuisson, feux d''artifice'), (11, 'Matériel communal souhaité'), (12, 'Documents à joindre et signature')
  ) as s(section, titre)
where f.code = 'FERRIERES_2023' and not exists (select 1 from public.formulaire_sections x where x.formulaire_id = f.id and x.section = s.section);

-- Le formulaire multidisciplinaire fédéral (IBZ, octobre 2017).
insert into public.formulaire_questions (formulaire_id, code, section, sous_section, ordre, libelle, aide, type, options, source, obligatoire)
select (select id from public.formulaires where code = 'IBZ_2017'), q.code, q.section, q.sous_section, q.ordre, q.libelle, q.aide, q.type, q.options, q.source, q.obligatoire from (values
  -- 1. Information générale
  ('1.01', 1, null, 10, 'Dénomination de l''événement', null, 'texte', null, 'nom', true),
  ('1.02', 1, null, 20, 'Abréviation de l''événement', null, 'texte', null, null, false),
  ('1.03', 1, null, 30, 'Lieu où se déroule l''événement', 'Rue, code postal, commune, coordonnées GPS ; plusieurs adresses ou entrées pour les secours si besoin', 'texte', null, 'lieu', true),
  ('1.04', 1, null, 40, 'Domaine public, lieu accessible au public ou terrain privé ?', null, 'choix', array['Domaine public', 'Lieu publiquement accessible', 'Terrain privé'], null, true),
  ('1.05', 1, null, 50, 'Nature de l''événement', null, 'texte', null, null, true),
  ('1.06', 1, null, 60, 'Description détaillée de l''événement', null, 'texte', null, null, true),
  ('1.07', 1, null, 70, 'Description du lieu et de la superficie disponible', 'Indication sur la carte', 'texte', null, null, false),
  ('1.08', 1, null, 80, 'Adresse détaillée de l''événement et des événements connexes', 'Indication sur la carte', 'texte', null, 'adresse', false),
  ('1.09', 1, null, 90, 'Date de début', null, 'date', null, 'date_debut', true),
  ('1.10', 1, null, 100, 'Date de fin', null, 'date', null, 'date_fin', true),
  ('1.11', 1, null, 110, 'Timing de l''événement : heures exactes de début et de fin, durée, interruption', 'Le programme est à joindre en annexe', 'texte', null, 'programme', false),
  ('1.12', 1, null, 120, 'Timing de la préparation et de la clôture', 'Début du montage, rangement prévu… Un timing est à joindre en annexe', 'texte', null, 'montage', false),
  ('1.13', 1, null, 130, 'Autres disciplines auxquelles l''événement est lié', 'ex. camping lors d''un événement de plusieurs jours', 'texte', null, null, false),
  ('1.14', 1, null, 140, 'Demande spéciale pour d''autres événements ?', null, 'oui_non', null, null, false),
  ('1.15', 1, null, 150, 'L''événement est-il accessible au public ?', null, 'oui_non', null, null, true),
  ('1.16', 1, null, 160, 'L''inscription est-elle obligatoire ?', null, 'oui_non', null, null, false),
  ('1.17', 1, null, 170, 'L''événement est-il payant ?', null, 'oui_non', null, null, false),
  ('1.18', 1, null, 180, 'Si payant : prix minimum et maximum (euros)', null, 'texte', null, null, false),
  ('1.19', 1, null, 190, 'L''événement a-t-il déjà été organisé par le passé ?', null, 'oui_non', null, 'deja_organise', false),
  ('1.20', 1, null, 200, 'Si oui, numéro de référence (si connu)', null, 'texte', null, null, false),
  -- 2. Organisateur
  ('2.01', 2, null, 10, 'Nom de l''organisateur', null, 'texte', null, 'organisateur', true),
  ('2.02', 2, null, 20, 'Adresse de l''organisateur', null, 'texte', null, null, true),
  ('2.03', 2, null, 30, 'Téléphone/GSM pendant la préparation', null, 'texte', null, 'organisateur_tel', true),
  ('2.04', 2, null, 40, 'Téléphone/GSM pendant l''événement', null, 'texte', null, 'securite_tel', true),
  ('2.05', 2, null, 50, 'Nationalité de l''organisateur', null, 'texte', null, null, false),
  ('2.06', 2, null, 60, 'Site internet', null, 'texte', null, null, false),
  ('2.07', 2, null, 70, 'Page Facebook', null, 'texte', null, null, false),
  ('2.08', 2, null, 80, 'Compte Twitter', null, 'texte', null, null, false),
  ('2.09', 2, null, 90, 'Statut de l''organisateur', null, 'choix', array['ASBL', 'Autorités', 'SPRL', 'SA', 'Association de fait', 'Personne physique', 'Organisation syndicale'], null, true),
  ('2.10', 2, null, 100, 'Numéro de TVA (si pertinent)', null, 'texte', null, null, false),
  -- 3. Public
  ('3.01', 3, null, 10, 'Nombre total prévu de visiteurs (par jour si plusieurs jours)', null, 'nombre', null, 'frequentation_max', true),
  ('3.02', 3, null, 20, 'Nombre de collaborateurs de l''organisation', null, 'nombre', null, 'membres', false),
  ('3.03', 3, null, 30, 'Nombre de participants (ex. à une marche)', null, 'nombre', null, null, false),
  ('3.04', 3, null, 40, 'Capacité maximale selon l''organisateur', null, 'nombre', null, 'frequentation_max', true),
  ('3.05', 3, null, 50, 'Personnes engagées par l''organisation', 'Joindre en annexe la liste par type d''activité (logistique, sanitaire, restauration, sécurité…) et les fournisseurs prévus', 'nombre', null, 'membres', false),
  ('3.06', 3, null, 60, 'Existe-t-il une liste des données des participants ? Si oui, la joindre', null, 'oui_non', null, null, false),
  ('3.07', 3, null, 70, 'Pourcentage de personnes présentes simultanément (hors camping)', null, 'nombre', null, null, false),
  ('3.08', 3, null, 80, 'Participants attendus par plage horaire, pic de fréquentation', null, 'texte', null, null, false),
  ('3.09', 3, null, 90, 'Pourcentage de la durée de présence du public', null, 'nombre', null, null, false),
  ('3.10', 3, null, 100, 'Participants aux éditions précédentes', null, 'texte', null, null, false),
  ('3.11', 3, null, 110, 'L''événement est-il complet ?', null, 'oui_non', null, null, false),
  ('3.12', 3, null, 120, 'Catégories d''âge du public (pourcentages, total 100 %)', 'Enfants (-10), jeunes (10-18), jeunes adultes (18-30), adultes (30-65), seniors (+65)', 'multi', array['Enfants (-10 ans)', 'Jeunes (10-18)', 'Jeunes adultes (18-30)', 'Adultes (30-65)', 'Seniors (+65)'], null, false),
  ('3.13', 3, null, 130, 'Dynamique du public', null, 'choix', array['Assis / statique', 'Debout / calme', 'Dynamique', 'Déambulant'], null, true),
  -- 4. Analyse du risque
  ('4.00', 4, null, 5, 'Analyse de risque de l''événement : risques les plus pertinents et mesures prises', 'À joindre en annexe', 'annexe', null, null, true),
  ('4.01', 4, '4.1 Public', 10, 'Risque accru de ruée (ex. vers l''attraction phare) ?', null, 'oui_non_explication', null, null, false),
  ('4.02', 4, '4.1 Public', 20, 'Risque accru de violence ?', null, 'oui_non_explication', null, null, false),
  ('4.03', 4, '4.1 Public', 30, 'Risque accru de présence de groupes violents ?', null, 'oui_non_explication', null, null, false),
  ('4.04', 4, '4.1 Public', 40, 'Présence de VIP nécessitant des mesures supplémentaires ?', 'Personnalités, fonctions', 'oui_non_explication', null, null, false),
  ('4.05', 4, '4.1 Public', 50, 'Outil de surveillance du public présent (RFID, bluetooth…) ?', null, 'oui_non_explication', null, null, false),
  ('4.10', 4, '4.2 Risques pour la santé', 100, 'Température et conditions météorologiques prévues', 'Minimum, maximum, humidité, conditions', 'texte', null, null, false),
  ('4.11', 4, '4.2 Risques pour la santé', 110, 'Mesures préventives contre les coups de soleil ?', null, 'oui_non_explication', null, null, false),
  ('4.12', 4, '4.2 Risques pour la santé', 120, 'Abri en cas de conditions météorologiques extrêmes ? Capacité ?', null, 'oui_non_explication', null, null, false),
  ('4.13', 4, '4.2 Risques pour la santé', 130, 'Risque accru lié à la consommation d''alcool ?', null, 'oui_non_explication', null, 'alcool', false),
  ('4.14', 4, '4.2 Risques pour la santé', 140, 'Risque accru lié à la consommation de drogues ?', null, 'oui_non_explication', null, null, false),
  ('4.15', 4, '4.2 Risques pour la santé', 150, 'Risque réel de consommation de GHB ou de nouvelles drogues synthétiques ?', null, 'oui_non_explication', null, null, false),
  ('4.16', 4, '4.2 Risques pour la santé', 160, 'Pathologie de base connue pour au moins 10 % du public ? Laquelle ?', null, 'oui_non_explication', null, null, false),
  ('4.17', 4, '4.2 Risques pour la santé', 170, 'Chaîne du froid respectée par les stands de nourriture ?', null, 'oui_non_explication', null, null, false),
  ('4.18', 4, '4.2 Risques pour la santé', 180, 'Qui se charge de la restauration ?', 'Coordonnées des traiteurs', 'choix', array['Traiteur professionnel', 'Traiteur non professionnel'], null, false),
  ('4.19', 4, '4.2 Risques pour la santé', 190, 'Flyer d''informations médicales remis avec le ticket ?', null, 'oui_non_explication', null, null, false),
  ('4.20', 4, '4.2 Risques pour la santé', 200, 'Activités dynamiques ou physiques à risque accru d''accident (parcours d''équilibre, mur d''escalade…) ?', null, 'oui_non_explication', null, 'activite_dynamique', false),
  ('4.21', 4, '4.2 Risques pour la santé', 210, 'Distance jusqu''aux urgences les plus proches (km), conformément à l''AMU', null, 'nombre', null, null, true),
  ('4.22', 4, '4.2 Risques pour la santé', 220, 'Toilettes mobiles en suffisance ? Combien ? Nettoyage, société ?', null, 'oui_non_explication', null, 'sanitaires', false),
  ('4.23', 4, '4.2 Risques pour la santé', 230, 'Politique spécifique pour les déchets (poubelles, tri, collectes) ?', null, 'oui_non_explication', null, null, false),
  ('4.24', 4, '4.2 Risques pour la santé', 240, 'Accord avec le service communal de collecte des ordures ?', null, 'oui_non_explication', null, null, false),
  ('4.25', 4, '4.2 Risques pour la santé', 250, 'Utilisation d''un hydrant du réseau public ?', null, 'oui_non_explication', null, 'point_eau', false),
  ('4.26', 4, '4.2 Risques pour la santé', 260, 'Dispositions spécifiques pour les personnes handicapées ?', null, 'oui_non_explication', null, null, false),
  ('4.27', 4, '4.2 Risques pour la santé', 270, 'Stands de tatouage ?', null, 'oui_non_explication', null, null, false),
  ('4.28', 4, '4.2 Risques pour la santé', 280, 'Stands de piercing ?', null, 'oui_non_explication', null, null, false),
  ('4.29', 4, '4.2 Risques pour la santé', 290, 'Médecins, infirmiers ou secouristes de l''étranger ou en formation engagés ?', null, 'oui_non_explication', null, null, false),
  ('4.30', 4, '4.3 Éléments particuliers', 300, 'Feux d''artifice ?', 'Artificier, lieu exact, date et heure, accord DG Transport aérien', 'oui_non_explication', null, 'pyrotechnie', false),
  ('4.31', 4, '4.3 Éléments particuliers', 310, 'Effets pyrotechniques (feu de Bengale, pétards, brasero, feu ouvert…) ?', null, 'oui_non_explication', null, 'feu', false),
  ('4.32', 4, '4.3 Éléments particuliers', 320, 'Skytracers ou lasers ?', 'Description, date, accord DG Transport aérien', 'oui_non_explication', null, null, false),
  ('4.33', 4, '4.3 Éléments particuliers', 330, 'Vols de drones ?', 'Classe 1 : à demander (1A) ou signaler (1B). Par qui ?', 'oui_non_explication', null, null, false),
  ('4.34', 4, '4.3 Éléments particuliers', 340, 'Lâcher de ballons ?', 'Nombre, moment, accord DG Transport aérien', 'oui_non_explication', null, 'ballons', false),
  ('4.35', 4, '4.3 Éléments particuliers', 350, 'Présence d''animaux ? Mesures de protection ?', null, 'oui_non_explication', null, 'animaux', false),
  ('4.36', 4, '4.3 Éléments particuliers', 360, 'Attractions de kermesse ? Autorisation des exploitants ?', null, 'oui_non_explication', null, null, false),
  ('4.37', 4, '4.3 Éléments particuliers', 370, 'Armes à feu (lesquelles, quantité, permis) ?', null, 'oui_non_explication', null, null, false),
  ('4.38', 4, '4.3 Éléments particuliers', 380, 'Écrans géants (quantité, lieux, grandeur) ?', 'Hors du lieu principal : analyse de risque séparée par écran', 'oui_non_explication', null, 'ecran_geant', false),
  ('4.40', 4, '4.4 Infrastructure', 400, 'Plan détaillé du terrain, du parcours ou du camping', 'Voies d''évacuation, grillages, postes de premiers secours, sources de risques, dispositifs utilitaires, contrôle d''accès', 'annexe', null, 'plan', true),
  ('4.41', 4, '4.4 Infrastructure', 410, 'Matériaux ou installations provisoires sur la voie publique ou un lieu accessible au public ?', null, 'oui_non_explication', null, null, false),
  ('4.42', 4, '4.4 Infrastructure', 420, 'Activité dans un bâtiment utilisé exceptionnellement comme lieu d''événement ?', null, 'oui_non_explication', null, 'local_permanent', false),
  ('4.43', 4, '4.4 Infrastructure', 430, 'Taille du terrain (brute et accessible au public, m²)', null, 'texte', null, null, false),
  ('4.44', 4, '4.4 Infrastructure', 440, 'Hauteur du terrain', null, 'texte', null, null, false),
  ('4.45', 4, '4.4 Infrastructure', 450, 'Accessibilité aux secours : voies, largeur, indiquées sur la carte', null, 'texte', null, 'voies_secours', true),
  ('4.46', 4, '4.4 Infrastructure', 460, 'Escaliers ?', null, 'oui_non_explication', null, null, false),
  ('4.47', 4, '4.4 Infrastructure', 470, 'Places assises ?', null, 'oui_non_explication', null, null, false),
  ('4.48', 4, '4.4 Infrastructure', 480, 'Structures sur le terrain', null, 'multi', array['Podium', 'Tribune', 'Tente', 'Feu ouvert', 'Attractions de kermesse', 'Stands de nourriture', 'Barbecue', 'Restauration mobile', 'Autres'], 'structures', true),
  ('4.49', 4, '4.4 Infrastructure', 490, 'Sous-sol du terrain et mesures de stabilisation', 'Plaques de roulage, écorce, dalles, sable…', 'texte', null, null, false),
  ('4.50', 4, '4.4 Infrastructure', 500, 'Clôture par barrières ou hautes grilles ? Surveillée ?', 'Nadar, crush barrier, Heras : longueur et nombre, indiqués sur le plan', 'oui_non_explication', null, 'barrieres', false),
  ('4.51', 4, '4.4 Infrastructure', 510, 'Tribunes : nombre et capacité', null, 'texte', null, 'tribune', false),
  ('4.52', 4, '4.4 Infrastructure', 520, 'Podiums : nombre et taille (m²)', null, 'texte', null, 'podium', false),
  ('4.53', 4, '4.4 Infrastructure', 530, 'Tour PA ? Taille ?', null, 'oui_non_explication', null, null, false),
  ('4.54', 4, '4.4 Infrastructure', 540, 'Voies d''évacuation : nombre et largeur', null, 'texte', null, 'evacuation', true),
  ('4.55', 4, '4.4 Marche / manifestation mobile', 550, 'Longueur de la marche (m) et temps estimé', null, 'texte', null, 'parcours', false),
  ('4.56', 4, '4.4 Lieu intérieur', 560, 'Consignes d''incendie respectées ?', null, 'oui_non_explication', null, null, false),
  ('4.57', 4, '4.4 Lieu intérieur', 570, 'Nombre maximum de personnes autorisées ; consignes ARAB respectées ?', null, 'texte', null, null, false),
  ('4.60', 4, '4.4 Tentes', 600, 'Certificat bâche M2 ?', null, 'oui_non_explication', null, null, false),
  ('4.61', 4, '4.4 Tentes', 610, 'Superficie de la tente', null, 'texte', null, 'chapiteau', false),
  ('4.62', 4, '4.4 Tentes', 620, 'Places assises et debout', null, 'texte', null, null, false),
  ('4.63', 4, '4.4 Tentes', 630, 'Accessible au public, ou réservée à l''organisation ?', null, 'texte', null, null, false),
  ('4.64', 4, '4.4 Tentes', 640, 'Tente chauffée ? Comment ?', null, 'texte', null, 'chauffage', false),
  ('4.65', 4, '4.4 Tentes', 650, 'Fabricant des tentes', null, 'texte', null, 'fournisseur_tentes', false),
  ('4.66', 4, '4.4 Tentes', 660, 'Date d''approbation de l''emplacement', null, 'date', null, null, false),
  ('4.67', 4, '4.4 Tentes', 670, 'Vitesse de vent maximale testée (km/h)', null, 'nombre', null, null, false),
  ('4.68', 4, '4.4 Infrastructure', 680, 'Plan de construction des tribunes, podiums, tentes ?', 'À joindre en annexe', 'annexe', null, null, false),
  ('4.70', 4, '4.4 Infrastructure', 700, 'Sources de risques spécifiques (gaz, haute tension…) ?', null, 'oui_non_explication', null, 'risques', false),
  ('4.71', 4, '4.4 Infrastructure', 710, 'Sous-sol de la tente et stabilisation', null, 'texte', null, null, false),
  ('4.72', 4, '4.4 Infrastructure', 720, 'Dispositifs utilitaires présents', null, 'multi', array['Raccordement au gaz', 'Raccordement à l''eau', 'Raccordement à l''électricité', 'Panneaux solaires', 'Groupe électrogène'], 'utilitaires', false),
  ('4.73', 4, '4.4 Infrastructure', 730, 'Groupes électrogènes : nombre et puissance (kW)', null, 'texte', null, 'groupes', false),
  ('4.80', 4, '4.5 Camping', 800, 'Un camping est-il prévu ?', 'Réglementation spécifique éventuelle', 'oui_non', null, 'camping', false),
  ('4.81', 4, '4.5 Camping', 810, 'Superficie totale (m²)', null, 'nombre', null, null, false),
  ('4.82', 4, '4.5 Camping', 820, 'Nombre maximum d''emplacements', null, 'nombre', null, null, false),
  ('4.83', 4, '4.5 Camping', 830, 'Nombre maximum de personnes sur le camping', null, 'nombre', null, null, false),
  ('4.84', 4, '4.5 Camping', 840, 'Personnes présentes en même temps (estimation)', null, 'nombre', null, null, false),
  ('4.85', 4, '4.5 Camping', 850, 'Premiers secours sur le camping ?', null, 'oui_non_explication', null, null, false),
  ('4.86', 4, '4.5 Camping', 860, 'Sécurité incendie du camping ?', null, 'oui_non_explication', null, null, false),
  ('4.87', 4, '4.5 Camping', 870, 'Endroits prévus pour la cuisine ? Combien ?', null, 'oui_non_explication', null, null, false),
  ('4.88', 4, '4.5 Camping', 880, 'Entrées, sorties, voies d''évacuation du camping ; éclairage ?', null, 'oui_non_explication', null, null, false),
  ('4.89', 4, '4.5 Camping', 890, 'Débit d''eau potable suffisant ?', null, 'oui_non_explication', null, null, false),
  ('4.90', 4, '4.5 Camping', 900, 'Toilettes : combien, suffisant ?', null, 'oui_non_explication', null, null, false),
  ('4.91', 4, '4.5 Camping', 910, 'Douches : combien, suffisant ?', null, 'oui_non_explication', null, null, false),
  ('4.92', 4, '4.5 Camping', 920, 'Points de repère pour les campeurs ?', null, 'oui_non_explication', null, null, false),
  ('4.93', 4, '4.5 Camping', 930, 'Point de vente de première nécessité ?', null, 'oui_non_explication', null, null, false),
  -- 5. Ordre public
  ('5.01', 5, '5.1 Gardiennage', 10, 'Entreprise de gardiennage privée pour le contrôle d''accès ?', 'Mission, nombre d''agents, nom, numéro d''autorisation SPF Intérieur', 'oui_non_explication', null, 'gardiennage', false),
  ('5.02', 5, '5.1 Gardiennage', 20, 'Entreprise de gardiennage privée pour la sécurité pendant l''événement ?', 'Mission, nom, nombre d''agents, numéro d''autorisation SPF Intérieur', 'oui_non_explication', null, null, false),
  ('5.03', 5, '5.1 Gardiennage', 30, 'Personnes non habilitées (membres de l''association) engagées pour la surveillance ?', 'Mission, autorisation du bourgmestre, description, nombre, reconnaissables ?', 'oui_non_explication', null, null, false),
  ('5.10', 5, '5.2 Évacuation', 100, 'Plan d''évacuation établi ?', 'À joindre en annexe', 'annexe', null, null, true),
  ('5.11', 5, '5.2 Évacuation', 110, 'Procédures d''évacuation spécifiques (qui décide, comment et quand on communique) ?', null, 'oui_non_explication', null, null, true),
  ('5.12', 5, '5.2 Évacuation', 120, 'Sorties de secours : nombre et largeur', null, 'texte', null, 'sorties_secours', false),
  ('5.13', 5, '5.2 Évacuation', 130, 'Les sorties débouchent-elles sur des voies publiques appropriées ?', null, 'oui_non_explication', null, null, false),
  ('5.14', 5, '5.2 Évacuation', 140, 'Voies d''évacuation suffisamment visibles ? Comment ?', null, 'oui_non_explication', null, null, false),
  ('5.15', 5, '5.2 Évacuation', 150, 'Plan d''évacuation testé avant ou pendant l''événement ?', null, 'oui_non_explication', null, null, false),
  ('5.16', 5, '5.2 Évacuation', 160, 'Procédures en cas d''arrêt de l''événement (communication, évacuation, transports) ?', null, 'oui_non_explication', null, null, false),
  ('5.20', 5, '5.3 Divers', 200, 'Riverains dans le périmètre fermé ? Combien ?', null, 'oui_non_explication', null, null, false),
  ('5.21', 5, '5.3 Divers', 210, 'Riverains informés du périmètre ?', null, 'oui_non_explication', null, null, false),
  ('5.22', 5, '5.3 Divers', 220, 'Laissez-passer remis aux riverains ?', null, 'oui_non_explication', null, null, false),
  ('5.23', 5, '5.3 Divers', 230, 'Maison de repos, hôpital ou institution dans le périmètre ?', null, 'oui_non_explication', null, null, false),
  ('5.24', 5, '5.3 Divers', 240, 'Cabinet médical dans le périmètre ?', null, 'oui_non_explication', null, null, false),
  ('5.25', 5, '5.3 Divers', 250, 'Infirmier à domicile dans le périmètre ?', null, 'oui_non_explication', null, null, false),
  ('5.26', 5, '5.3 Divers', 260, 'Livraison de repas à domicile à prévoir dans le périmètre ?', null, 'oui_non_explication', null, null, false),
  ('5.27', 5, '5.3 Divers', 270, 'Pharmacien dans les environs ?', null, 'oui_non_explication', null, null, false),
  ('5.28', 5, '5.3 Divers', 280, 'Nuisances sonores supplémentaires (musique, véhicules, chants) ?', null, 'oui_non_explication', null, null, false),
  ('5.29', 5, '5.3 Divers', 290, 'Mesures pour limiter les nuisances sonores ?', null, 'oui_non_explication', null, null, false),
  ('5.30', 5, '5.3 Divers', 300, 'Communication prévue à l''attention des riverains ?', null, 'oui_non_explication', null, null, false),
  ('5.31', 5, '5.3 Divers', 310, 'Communication prévue à l''attention de l''horeca et des entreprises ?', null, 'oui_non_explication', null, null, false),
  ('5.32', 5, '5.3 Divers', 320, 'Dérogation pour nuisances sonores demandée (date, décibels, jusqu''à quand) ?', null, 'oui_non_explication', null, null, false),
  -- 6. Mobilité
  ('6.01', 6, null, 10, 'Transports publics suffisants à proximité ?', null, 'oui_non_explication', null, null, false),
  ('6.02', 6, null, 20, 'Transports publics présents', null, 'multi', array['Train', 'Bus', 'Tram', '(Pré)métro', 'Autres'], null, false),
  ('6.03', 6, null, 30, 'Transports publics spécifiques organisés vers l''événement ?', null, 'oui_non_explication', null, null, false),
  ('6.04', 6, null, 40, 'Transports spécifiques organisés sur l''événement ?', null, 'oui_non_explication', null, 'navettes', false),
  ('6.05', 6, null, 50, 'Rues, places ou domaines publics à fermer (liste, moments) ?', null, 'oui_non_explication', null, null, true),
  ('6.06', 6, null, 60, 'Changements à la circulation (lesquels, quand) ?', null, 'oui_non_explication', null, null, false),
  ('6.07', 6, null, 70, 'Interdiction de parking (où, quand) ?', 'Carte', 'oui_non_explication', null, null, false),
  ('6.08', 6, null, 80, 'Transports publics à dévier (lignes, moments, accords) ?', 'Carte', 'oui_non_explication', null, null, false),
  ('6.09', 6, null, 90, 'Mesures pour les départs à la fin de l''événement ?', null, 'oui_non_explication', null, null, false),
  ('6.10', 6, 'Parkings', 100, 'Parkings suffisants dans les environs ?', null, 'oui_non_explication', null, 'parkings', false),
  ('6.11', 6, 'Parkings', 110, 'Parkings par destinataire (organisation, public, payant, VIP, presse, secours, mobilité réduite)', null, 'texte', null, null, false),
  ('6.12', 6, 'Parkings', 120, 'Parkings sur terrain public, privé ou les deux ?', null, 'choix', array['Public', 'Privé', 'Les deux'], null, false),
  ('6.13', 6, 'Parkings', 130, 'Surveillance des parkings ? Par qui, GSM du responsable ?', null, 'oui_non_explication', null, null, false),
  ('6.14', 6, 'Parkings', 140, 'Mesures de sécurité spécifiques (gardiennage, incendie, boue) ?', null, 'oui_non_explication', null, null, false),
  ('6.15', 6, 'Parkings', 150, 'Parkings alternatifs en cas d''impraticabilité ?', null, 'oui_non_explication', null, null, false),
  ('6.16', 6, 'Parkings', 160, 'Navettes du parking vers l''événement (endroits exacts) ?', null, 'oui_non_explication', null, null, false),
  ('6.17', 6, 'Parkings', 170, 'Parkings vélos surveillés ?', null, 'oui_non_explication', null, null, false),
  -- 7. Information et communication
  ('7.01', 7, null, 10, 'Publicité faite pour l''événement', null, 'multi', array['Affiches locales', 'Affiches répandues', 'Radio', 'Télévision', 'Internet', 'Médias sociaux'], null, false),
  ('7.02', 7, null, 20, 'Présence de la presse (quel genre) ?', null, 'oui_non_explication', null, null, false),
  ('7.03', 7, null, 30, 'Responsable des contacts presse prévu ?', 'Coordonnées en section 11', 'oui_non', null, null, false),
  ('7.04', 7, null, 40, 'Au moins 10 % de public allophone (langues, mesures) ?', null, 'oui_non_explication', null, null, false),
  ('7.05', 7, null, 50, 'Dispositifs spécifiques prévus', null, 'multi', array['Accueil', 'Point d''info', 'Enfants perdus', 'Objets perdus', 'Point de recharge GSM', 'Autres'], null, false),
  ('7.06', 7, null, 60, 'Panneaux d''information (sanitaire, programme, règlement) ?', null, 'oui_non_explication', null, null, false),
  ('7.07', 7, null, 70, 'Signalisation d''accès à l''événement (flèches, plan) ?', null, 'oui_non_explication', null, null, false),
  ('7.08', 7, null, 80, 'Messages préparés en cas de surcapacité ?', null, 'oui_non_explication', null, null, false),
  ('7.09', 7, null, 90, 'Signalisation des mesures de sécurité (postes de secours, évacuation) ?', null, 'oui_non_explication', null, null, false),
  ('7.10', 7, null, 100, 'Panneaux lumineux pour communiquer ?', null, 'oui_non_explication', null, null, false),
  ('7.11', 7, null, 110, 'Hashtag de l''événement ?', null, 'oui_non_explication', null, null, false),
  ('7.12', 7, null, 120, 'Messages standards préparés en cas d''incident ?', null, 'oui_non_explication', null, 'messages_incident', true),
  ('7.13', 7, null, 130, 'Accords avec les autorités sur qui communique et quand ?', null, 'oui_non_explication', null, null, false),
  ('7.14', 7, null, 140, 'Dispositifs supplémentaires de communication en cas d''incident ?', null, 'oui_non_explication', null, 'radio', false),
  ('7.15', 7, null, 150, 'Accords avec les opérateurs télécoms pour la capacité d''appel ?', null, 'oui_non_explication', null, null, false),
  ('7.16', 7, null, 160, 'Riverains suffisamment informés (quand) ?', null, 'oui_non_explication', null, null, false),
  -- 8. Logistique et restauration
  ('8.01', 8, null, 10, 'Logement pour le staff (où, quand) ?', null, 'oui_non_explication', null, null, false),
  ('8.02', 8, null, 20, 'Séjour pour une partie des visiteurs (où, quand) ?', null, 'oui_non_explication', null, null, false),
  ('8.03', 8, null, 30, 'Stands de plats chauds ? Appareils de chauffage mobiles (gaz, électrique) ? Prévention incendie ?', null, 'oui_non_explication', null, 'cuisson', false),
  ('8.04', 8, null, 40, 'Barbecue ou feu ouvert pour les repas ?', null, 'oui_non_explication', null, 'barbecue', false),
  ('8.05', 8, null, 50, 'Foodtrucks ?', 'Joindre les certificats d''homologation', 'oui_non_explication', null, 'foodtruck', false),
  ('8.06', 8, null, 60, 'Stock de gaz (max. 130 kg par armoire) ? Lieux sur le plan', null, 'oui_non_explication', null, 'gaz', false),
  ('8.07', 8, null, 70, 'Chauffage (gaz, électrique, parasols chauffants, autres) ?', null, 'oui_non_explication', null, 'chauffage', false),
  ('8.08', 8, null, 80, 'Assurances spécifiques souscrites (risques, institution, numéro ; secouristes couverts ?)', null, 'texte', null, 'assurance', true),
  ('8.09', 8, null, 90, 'Éclairage public à éteindre (quand, mesures en cas d''incident) ?', null, 'oui_non_explication', null, null, false),
  -- 9. Mesures supplémentaires
  ('9.01', 9, null, 10, 'Règlement d''ordre intérieur (où, comment mis à disposition) ?', 'À joindre en annexe, camping compris', 'annexe', null, null, false),
  ('9.02', 9, null, 20, 'Mesures spécifiques de sécurité (premiers soins, extincteurs, seaux, couverture anti-feu…) ?', null, 'oui_non_explication', null, 'moyens_secours', true),
  -- 10. Contexte local
  ('10.01', 10, null, 10, 'Rubriques et questions liées au contexte local spécifique', 'Digue, domaine d''un château, quais, port…', 'texte', null, null, false),
  -- 11. Contacts (GSM obligatoire)
  ('11.01', 11, null, 10, 'Responsable organisation', 'Nom, adresse, fonction pendant l''événement, tél, email, GSM (obligatoire)', 'contact', null, 'responsable_organisation', true),
  ('11.02', 11, null, 20, 'Responsable sécurité événement', 'Nom, adresse, fonction, tél, email, GSM (obligatoire)', 'contact', null, 'responsable_securite', true),
  ('11.03', 11, null, 30, 'Organisation de coordination du secours médical', 'Nom, prénom, fonction, GSM (obligatoire) ; il peut y en avoir plusieurs', 'contact', null, 'coordination_medicale', true),
  ('11.04', 11, null, 40, 'Hôpital le plus proche (conforme AMU)', 'Nom, adresse, contact, informé de l''événement ?, distance (km)', 'contact', null, null, true),
  ('11.05', 11, null, 50, 'Organisation du poste de premiers secours', 'Nom, adresse, responsable pendant l''événement, tél, email, GSM', 'contact', null, 'poste_secours', true),
  ('11.06', 11, null, 60, 'Personne de contact du poste de premiers secours', 'Nom, adresse, email, tél, GSM', 'contact', null, null, false),
  ('11.07', 11, null, 70, 'Responsable communication', 'Nom, adresse, GSM, fonction, email', 'contact', null, null, false),
  ('11.08', 11, null, 80, 'Responsable contact presse', 'Nom, adresse, GSM, fonction, email', 'contact', null, null, false),
  ('11.09', 11, null, 90, 'Responsable parking', 'Nom, adresse, GSM, fonction, email', 'contact', null, null, false),
  ('11.10', 11, null, 100, 'Autre responsable', 'Nom, adresse, GSM, fonction, email', 'contact', null, null, false),
  ('11.11', 11, null, 110, 'Nom, fonction et signature du responsable', null, 'texte', null, null, true),
  -- 12. Checklist annexes
  ('12.01', 12, null, 10, 'Programme', null, 'annexe', null, 'annexe_programme', false),
  ('12.02', 12, null, 20, 'Timing construction et rangement', null, 'annexe', null, 'annexe_timing', false),
  ('12.03', 12, null, 30, 'Liste des participants', null, 'annexe', null, null, false),
  ('12.04', 12, null, 40, 'Analyse de risques', null, 'annexe', null, null, false),
  ('12.05', 12, null, 50, 'Plan détaillé du terrain', null, 'annexe', null, 'annexe_plan', false),
  ('12.06', 12, null, 60, 'Plan de construction tribunes, podiums, tours PA…', null, 'annexe', null, null, false),
  ('12.07', 12, null, 70, 'Plan d''évacuation', null, 'annexe', null, null, false),
  ('12.08', 12, null, 80, 'Procédures d''évacuation', null, 'annexe', null, null, false),
  ('12.09', 12, null, 90, 'Règlement d''ordre interne', null, 'annexe', null, null, false)
) as q(code, section, sous_section, ordre, libelle, aide, type, options, source, obligatoire)
where not exists (select 1 from public.formulaire_questions x where x.formulaire_id = (select id from public.formulaires where code = 'IBZ_2017') and x.code = q.code);

-- Le formulaire de la commune de Ferrières (collège du 16 novembre 2023).
insert into public.formulaire_questions (formulaire_id, code, section, sous_section, ordre, libelle, aide, type, options, source, obligatoire)
select (select id from public.formulaires where code = 'FERRIERES_2023'), q.code, q.section, q.sous_section, q.ordre, q.libelle, q.aide, q.type, q.options, q.source, q.obligatoire from (values
  -- 1. La manifestation
  ('1.01', 1, null, 10, 'Dénomination exacte de la manifestation', null, 'texte', null, 'nom', true),
  ('1.02', 1, null, 20, 'Dates', null, 'texte', null, 'dates', true),
  ('1.03', 1, null, 30, 'Heures (de … à …)', 'Voir le règlement général de police pour l''arrêt de la musique et l''évacuation des lieux', 'texte', null, 'heures', true),
  ('1.04', 1, null, 40, 'Nom de l''organisateur', null, 'texte', null, 'organisateur', true),
  ('1.05', 1, null, 50, 'GSM de contact', null, 'texte', null, 'organisateur_tel', true),
  ('1.06', 1, null, 60, 'Lieu de la manifestation', null, 'texte', null, 'lieu', true),
  ('1.07', 1, null, 70, 'Date de remise de la demande', null, 'date', null, null, false),
  -- 2. Type
  ('2.01', 2, null, 10, 'Type de la manifestation', 'Art. 21 du RGP (plein air), 21.1 (lieu clos ou couvert), 56 à 60 (bals)', 'multi',
    array['Publique en plein air', 'Publique en lieu clos ou couvert', 'Fête locale', 'Bal sous chapiteau', 'Bal dans une salle / en plein air', 'Brocante', 'Souper / dîner', 'Rallye (ancêtres, vitesse)', 'Course cycliste ou autres', 'Fête patriotique', 'Fancy-fair', 'Spectacle', 'Grand feu / feux d''artifice', 'Stages divers', 'Manifestation sportive', 'Tir au clays', 'Autre concours', 'Exposition', 'Marché de Noël', 'Théâtre', 'Concours agricole', 'Fêtes diverses', 'Concert', 'Autre manifestation'], 'type_manifestation', true),
  ('2.02', 2, null, 20, 'Précisions sur le type (sport, fête, concert, autre)', 'Pour les grands feux et feux d''artifice, informer la zone de secours HEMECO. Un plan de situation est à joindre quelle que soit la manifestation.', 'texte', null, null, false),
  -- 3. Demandeur
  ('3.01', 3, '3.1 Organisateur', 10, 'Dénomination (si entreprise ou ASBL)', null, 'texte', null, 'organisateur', true),
  ('3.02', 3, '3.1 Organisateur', 20, 'Numéro d''entreprise ou d''ASBL', null, 'texte', null, null, false),
  ('3.03', 3, '3.1 Organisateur', 30, 'Adresse complète', null, 'texte', null, null, true),
  ('3.10', 3, '3.2 Responsable légal', 100, 'Responsable légal', 'Nom, prénom, adresse complète, téléphone fixe, GSM, e-mail', 'contact', null, 'responsable_legal', true),
  ('3.11', 3, '3.2 Responsable légal', 110, 'Date de naissance du responsable légal', null, 'date', null, null, true),
  ('3.12', 3, '3.2 Responsable légal', 120, 'Numéro national du responsable légal', null, 'texte', null, null, true),
  ('3.20', 3, '3.3 Expérience', 200, 'Première manifestation de l''organisateur ?', null, 'oui_non', null, 'premiere_manifestation', true),
  ('3.21', 3, '3.3 Expérience', 210, 'Si non : dénomination, date et lieu des trois dernières manifestations', null, 'texte', null, 'manifestations_anterieures', false),
  -- 4. Assurances (RC art. 21.4 RGP)
  ('4.01', 4, null, 10, 'Types de contrats souscrits (risques couverts)', null, 'texte', null, null, true),
  ('4.02', 4, null, 20, 'Compagnie d''assurance', null, 'texte', null, 'assurance_compagnie', true),
  ('4.03', 4, null, 30, 'Numéros de polices', null, 'texte', null, 'assurance_police', true),
  -- 5. Description et durée
  ('5.01', 5, null, 10, 'Nom de l''événement', null, 'texte', null, 'nom', true),
  ('5.02', 5, null, 20, 'Site web', null, 'texte', null, null, false),
  ('5.03', 5, null, 30, 'Description', null, 'texte', null, null, true),
  ('5.10', 5, '5.1 Durée', 100, 'Date de début', null, 'date', null, 'date_debut', true),
  ('5.11', 5, '5.1 Durée', 110, 'Date de fin', null, 'date', null, 'date_fin', true),
  ('5.12', 5, '5.1 Durée', 120, 'Heure de début (préparation et mise en place comprises)', null, 'texte', null, 'montage', true),
  ('5.13', 5, '5.1 Durée', 130, 'Heure de fin (nettoyage du site compris)', null, 'texte', null, 'demontage', true),
  ('5.14', 5, '5.1 Durée', 140, 'Programme de l''événement', 'À joindre en annexe', 'annexe', null, 'annexe_programme', false),
  ('5.15', 5, '5.1 Durée', 150, 'Tracé informatisé (kmz, gpx, kml)', 'À joindre en annexe', 'annexe', null, 'annexe_trace', false),
  ('5.20', 5, '5.2 Lieu', 200, 'Location d''une salle ou d''un local : adresse complète', 'Joindre la copie du contrat de location signé', 'texte', null, null, false),
  ('5.21', 5, '5.2 Lieu', 210, 'Contrat de location signé', null, 'annexe', null, null, false),
  ('5.22', 5, '5.2 Lieu', 220, 'Occupation d''un terrain : nom du propriétaire et rue contiguë', 'Joindre l''autorisation écrite du propriétaire et un plan de situation', 'texte', null, null, false),
  ('5.23', 5, '5.2 Lieu', 230, 'Autorisation écrite du propriétaire', null, 'annexe', null, null, false),
  -- 6. Public
  ('6.01', 6, null, 10, 'Nombre de participants par jour (approximation)', 'Pour les enceintes fermées, le nombre et la taille des sorties de secours sont fixés par la zone de secours HEMECO (service prévention, 085/27 10 00)', 'choix',
    array['< 100', '100 – 499', '500 – 999', '1 000 – 1 499', '1 500 – 1 999', '2 000 – 4 999', '5 000 – 10 000', '> 10 000'], 'frequentation_tranche', true),
  ('6.02', 6, null, 20, 'Profil du public', null, 'multi', array['Enfants', 'Adolescents', 'Adultes', 'Seniors', 'Famille', 'Tous', 'Personnes ayant un handicap', 'Autre'], null, true),
  ('6.03', 6, null, 30, 'Précision sur le public (autre)', null, 'texte', null, null, false),
  -- 7. Bal
  ('7.01', 7, null, 10, 'Bal', 'Art. 56 à 60 du RGP', 'multi', array['Bal en salle / en plein air', 'Bal sous chapiteau'], null, false),
  ('7.02', 7, null, 20, 'Responsable de la sono, disc-jockey', 'Nom, adresse, téléphone et GSM', 'contact', null, null, false),
  ('7.03', 7, null, 30, 'Personne présente sur place', 'Nom et GSM', 'contact', null, null, false),
  -- 8. Encadrement du public
  ('8.01', 8, null, 10, 'Perception d''un droit d''entrée pour les spectateurs ?', null, 'oui_non', null, null, true),
  ('8.02', 8, null, 20, 'Contrôle des entrées (fouille, portique…) ?', null, 'oui_non', null, null, true),
  ('8.03', 8, null, 30, 'Signaleurs ? Si oui, nombre de personnes', null, 'oui_non_explication', null, 'signaleurs', true),
  ('8.04', 8, null, 40, 'Service de gardiennage reconnu ? Si oui, société et téléphone d''un responsable', 'Toute entreprise de gardiennage doit être agréée par le SPF Intérieur : nom, numéro d''agréation, nombre de gardiens, tâches', 'oui_non_explication', null, 'gardiennage', true),
  ('8.05', 8, null, 50, 'Gardiennage : nombre de personnes et téléphone du responsable sur place', null, 'texte', null, null, false),
  ('8.06', 8, null, 60, 'Agents de sécurité formés à l''utilisation des moyens de lutte contre l''incendie ? Si oui, société et nombre', null, 'oui_non_explication', null, null, false),
  -- 9. Mesures de police
  ('9.01', 9, null, 10, 'Accompagnement policier souhaité ?', 'Fermeture ou déviation de la circulation, interdiction d''arrêt ou de stationnement, sens unique, encadrement de cortège… Si oui, le formulaire rentre 90 jours avant la mise en place.', 'oui_non', null, null, true),
  ('9.02', 9, null, 20, 'Mesures souhaitées : lieux, jours et heures', 'Joindre un plan précis des barrages et déviations. Un chemin de 4 m de large reste libre pour les véhicules de secours ; bouches et bornes d''incendie dégagées.', 'texte', null, null, false),
  ('9.03', 9, null, 30, 'Plan des barrages et déviations', null, 'annexe', null, null, false),
  ('9.10', 9, null, 100, 'Interdiction de stationnement ? Préciser', null, 'oui_non_explication', null, null, false),
  ('9.11', 9, null, 110, 'Voies à sens unique ? Préciser', null, 'oui_non_explication', null, null, false),
  ('9.12', 9, null, 120, 'Interdiction de circulation ? Préciser', null, 'oui_non_explication', null, null, false),
  ('9.13', 9, null, 130, 'Encadrement de cortège ? Préciser', null, 'oui_non_explication', null, 'cortege', false),
  ('9.14', 9, null, 140, 'Encadrement du public ? Préciser', null, 'oui_non_explication', null, null, false),
  ('9.15', 9, null, 150, 'Autres mesures à définir', null, 'texte', null, null, false),
  -- 10. Zone de secours
  ('10.01', 10, '10.1 Chapiteaux', 10, 'Chapiteaux : nombre et superficie respective', 'Bâches, tentes et tonnelles accueillant du public en classe Cs3d0 au moins (AR du 7 juillet 1994), attestation d''ignifugation à disposition ; haubanage suffisant', 'texte', null, 'chapiteaux', false),
  ('10.02', 10, '10.1 Chapiteaux', 20, 'Attestation de stabilité et de qualité du montage', 'Par un organisme agréé ou un ingénieur en stabilité : au-delà de 250 m² au sol, hauteur de chute ≥ 2 m, ou sur avis motivé de la zone de secours (chapiteaux, tribunes, gradins, échafaudages, portiques)', 'annexe', null, null, false),
  ('10.10', 10, '10.2 Cuisson', 100, 'Points de cuisson : nombre, nature (friteuse, plancha, barbecue…) et énergie (gaz, électricité…) pour chacun', 'Socle incombustible, endroit ventilé, extincteur NBN EN 3 à côté ; friteuses avec thermostat d''arrêt, couverture anti-feu et extincteur CO2 de 5 kg', 'texte', null, 'cuisson_detail', false),
  ('10.20', 10, '10.3 Feux d''artifice', 200, 'Grand feu, tir de feux d''artifice ou objets détonants ?', 'Prendre contact avec le service prévention HEMECO. Météo locale vérifiée le jour même ; mise à feu interrompue au moindre risque.', 'oui_non', null, 'pyrotechnie', false),
  ('10.21', 10, '10.3 Feux d''artifice', 210, 'Technicien responsable du tir', 'Nom, prénom et téléphone', 'contact', null, null, false),
  ('10.22', 10, '10.3 Feux d''artifice', 220, 'Société de l''artificier et adresse', null, 'texte', null, null, false),
  ('10.23', 10, '10.3 Feux d''artifice', 230, 'Estimation de la quantité totale de matériel pyrotechnique actif', null, 'texte', null, null, false),
  ('10.24', 10, '10.3 Feux d''artifice', 240, 'Attestation d''autorisation de stockage (SPF Économie, service des explosifs)', null, 'annexe', null, null, false),
  ('10.25', 10, '10.3 Feux d''artifice', 250, 'Attestation d''assurance RC de l''artificier', null, 'annexe', null, null, false),
  ('10.26', 10, '10.3 Feux d''artifice', 260, 'Autorisation de l''Administration de l''aéronautique', null, 'annexe', null, null, false),
  ('10.27', 10, '10.3 Feux d''artifice', 270, 'Plan-schéma à l''échelle du tir', 'Zone de tir, zone exempte de public, zone de sécurité, moyens de lutte contre l''incendie, ressources en eau, accueil des ambulances, coordinateur sécurité, zones à risque', 'annexe', null, null, false),
  -- 11. Matériel communal
  ('11.01', 11, null, 10, 'Chapiteau communal (8 × 15 m) ?', 'Montage et démontage les jours ouvrables vers 8 h 30 (vendredi et lundi pour un week-end) ; trois adultes à prévoir (montage ± 3 h, démontage ± 2 h). Demandes spécifiques au Collège 60 jours avant.', 'oui_non', null, null, false),
  ('11.02', 11, null, 20, 'Date souhaitée pour le montage du chapiteau', null, 'date', null, null, false),
  ('11.03', 11, null, 30, 'Date souhaitée pour le démontage du chapiteau', null, 'date', null, null, false),
  ('11.10', 11, null, 100, 'Tables type « brasseur » (9 disponibles)', null, 'nombre', null, null, false),
  ('11.11', 11, null, 110, 'Bancs type « brasseur » (18 disponibles)', null, 'nombre', null, null, false),
  ('11.12', 11, null, 120, 'Parasols chauffants sans bonbonnes (4 disponibles)', 'Bonbonne propane avec détendeur Schell', 'nombre', null, null, false),
  ('11.13', 11, null, 130, 'Canon à chaleur sans le plein (gazole de chauffage)', null, 'oui_non', null, null, false),
  ('11.14', 11, null, 140, 'Barrières Nadar (80 disponibles)', null, 'nombre', null, null, false),
  ('11.15', 11, null, 150, 'Barrières Heras (15 disponibles)', null, 'nombre', null, null, false),
  ('11.16', 11, null, 160, 'Guirlande lumineuse (ampoules à placer par l''organisateur)', null, 'oui_non', null, null, false),
  ('11.17', 11, null, 170, 'Stands verts « artisans » à installer par l''organisateur (40 disponibles)', null, 'nombre', null, null, false),
  ('11.18', 11, null, 180, 'Tables « mange-debout » (10 disponibles)', null, 'nombre', null, null, false),
  ('11.19', 11, null, 190, 'Groupe électrogène (essence 95 ou 98)', null, 'oui_non', null, null, false),
  ('11.20', 11, null, 200, 'Coffret électrique (uniquement sans autre alternative)', null, 'oui_non', null, null, false),
  ('11.21', 11, null, 210, 'Gobelets réutilisables de la Province de Liège', 'Si oui, compléter le formulaire de la Province', 'oui_non', null, null, false),
  ('11.22', 11, null, 220, 'Défibrillateur portable', null, 'oui_non', null, null, false),
  ('11.23', 11, null, 230, 'Autres demandes', 'Pas de prêt aux organisations privées ni hors commune ; matériel rendu propre, toute perte facturée', 'texte', null, null, false),
  -- 12. Documents et signature
  ('12.01', 12, null, 10, 'Plan de la manifestation (A3 de préférence)', 'Sans plan précis ni identification des activités, l''avis de la zone de secours HEMECO est réputé négatif', 'annexe', null, 'annexe_plan', true),
  ('12.02', 12, null, 20, 'Programme de la manifestation', null, 'annexe', null, 'annexe_programme', true),
  ('12.03', 12, null, 30, 'Tracé informatisé (kmz, gpx, kml)', null, 'annexe', null, 'annexe_trace', false),
  ('12.04', 12, null, 40, 'Manifestation en forêt (trail, VTT, marche…) : autorisation du DNF, cantonnement d''Aywaille', 'rue du Halage 47, 4920 Aywaille — 04/247 99 90 — aywaille.cantonnement.dnf.dgarne@spw.wallonie.be', 'annexe', null, null, false),
  ('12.10', 12, null, 100, 'Nom de l''organisateur responsable (signataire)', null, 'texte', null, 'responsable_legal_nom', true),
  ('12.11', 12, null, 110, 'Fait à', null, 'texte', null, 'commune', false),
  ('12.12', 12, null, 120, 'Le', null, 'date', null, null, false)
) as q(code, section, sous_section, ordre, libelle, aide, type, options, source, obligatoire)
where not exists (select 1 from public.formulaire_questions x where x.formulaire_id = (select id from public.formulaires where code = 'FERRIERES_2023') and x.code = q.code);

-- Les formulaires qui valent pour un événement : sa commune, sa province, le pays ; la commune d'abord.
create or replace function public.formulaires_applicables(p_evenement uuid)
returns setof public.formulaires language sql stable security definer set search_path = public, pg_temp as $$
  select f.* from formulaires f, evenements ev
  where ev.id = p_evenement and ev.deleted_at is null and f.actif
    and (a_permission(p_evenement, 'referentiels', 'lire') or a_tout_pouvoir(p_evenement))
    and ((f.portee = 'commune' and lower(f.commune) = lower(coalesce(ev.commune, '')))
         or (f.portee = 'province' and lower(f.province) = lower(coalesce(ev.province, '')))
         or f.portee = 'federal')
  order by case f.portee when 'commune' then 1 when 'province' then 2 else 3 end, f.code;
$$;
revoke execute on function public.formulaires_applicables(uuid) from public, anon;
grant  execute on function public.formulaires_applicables(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Le pré-remplissage : ce qu'Eventware sait déjà, par code de source
-- ---------------------------------------------------------------------
create or replace function public.formulaire_prerempli(p_evenement uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  o organisations%rowtype;
  p organisations_profil_securite%rowtype;
  rep jsonb;
  v jsonb := '{}'::jsonb;
  v_membres int; v_programme int; v_plan int; v_secours text; v_structures text[]; v_utilitaires text[];
  v_interlocuteur record; v_parcours record; v_groupes record; v_barrieres record; v_pc record; v_voies record;
  v_oui jsonb := '{"reponse": true}'::jsonb;
begin
  if not a_permission(p_evenement, 'referentiels', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du dossier de sécurité non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then return v; end if;
  select * into o from organisations where id = ev.organisation_id;
  select * into p from organisations_profil_securite where organisation_id = ev.organisation_id;
  select r.reponses into rep from conformite_reponses r where r.evenement_id = p_evenement;
  rep := coalesce(rep, '{}'::jsonb);

  -- Identité et calendrier
  v := v || jsonb_build_object('nom', ev.nom, 'date_debut', ev.date_debut, 'date_fin', ev.date_fin, 'frequentation_max', ev.frequentation_max);
  select l.nom, l.latitude, l.longitude into v_pc from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.type = 'pc_ops' limit 1;
  v := v || jsonb_build_object('lieu', concat_ws(' · ', ev.commune, case when ev.province is not null then 'province de ' || ev.province end,
                                                       case when ev.point_0_lat is not null then format('point 0 : %s, %s', round(ev.point_0_lat::numeric, 5), round(ev.point_0_lon::numeric, 5)) end,
                                                       case when v_pc.nom is not null then 'PC-Ops : ' || v_pc.nom end));
  v := v || jsonb_build_object('adresse', (select string_agg(concat_ws(' — ', l.nom, l.type::text), ' ; ' order by l.code) from lieux l
                                            where l.evenement_id = p_evenement and l.deleted_at is null and l.type in ('entree', 'pc_ops', 'parking', 'poste_secours')));
  select count(*) into v_programme from programme where evenement_id = p_evenement;
  v := v || jsonb_build_object('programme', case when v_programme > 0 then format('%s points de programme encodés dans Eventware (annexe : programme)', v_programme) end,
                               'montage', case when ev.date_montage is not null or ev.date_demontage is not null
                                          then format('Montage dès le %s, démontage jusqu''au %s', coalesce(ev.date_montage::text, '?'), coalesce(ev.date_demontage::text, '?')) end,
                               'annexe_programme', case when v_programme > 0 then v_oui end,
                               'annexe_timing', case when ev.date_montage is not null and ev.date_demontage is not null then v_oui end);
  v := v || jsonb_build_object('deja_organise', case when exists (select 1 from evenements e2 where e2.organisation_id = ev.organisation_id and e2.id <> ev.id and e2.deleted_at is null and e2.date_debut < ev.date_debut) then v_oui end);
  -- (Ferrières) Dates en toutes lettres, heures du programme, montage et démontage séparés, tracé.
  v := v || jsonb_build_object(
    'dates', case when ev.date_debut is not null then case when ev.date_fin is null or ev.date_fin = ev.date_debut then to_char(ev.date_debut, 'DD/MM/YYYY')
                                                            else format('du %s au %s', to_char(ev.date_debut, 'DD/MM/YYYY'), to_char(ev.date_fin, 'DD/MM/YYYY')) end end,
    'heures', (select format('de %s à %s', to_char(min(pr.debut), 'HH24"h"MI'), to_char(max(pr.debut + make_interval(mins => coalesce(pr.duree_min, 0))), 'HH24"h"MI'))
               from programme pr where pr.evenement_id = p_evenement and pr.deleted_at is null and pr.debut is not null having count(*) > 0),
    'demontage', case when ev.date_demontage is not null then format('Démontage et nettoyage jusqu''au %s', to_char(ev.date_demontage, 'DD/MM/YYYY')) end,
    'annexe_trace', (select jsonb_build_object('reponse', true, 'explication', format('%s tracé(s) Eventware, export GPX', count(*))) from traces t
                     where t.evenement_id = p_evenement and t.deleted_at is null and t.actif having count(*) > 0),
    'commune', ev.commune,
    'frequentation_tranche', case when ev.frequentation_max is null then null
      when ev.frequentation_max < 100 then '< 100' when ev.frequentation_max < 500 then '100 – 499' when ev.frequentation_max < 1000 then '500 – 999'
      when ev.frequentation_max < 1500 then '1 000 – 1 499' when ev.frequentation_max < 2000 then '1 500 – 1 999' when ev.frequentation_max < 5000 then '2 000 – 4 999'
      when ev.frequentation_max <= 10000 then '5 000 – 10 000' else '> 10 000' end,
    'premiere_manifestation', jsonb_build_object('reponse', not exists (select 1 from evenements e2 where e2.organisation_id = ev.organisation_id and e2.id <> ev.id and e2.deleted_at is null and e2.date_debut < ev.date_debut)),
    'manifestations_anterieures', (select string_agg(format('%s — %s — %s', e2.nom, to_char(e2.date_debut, 'DD/MM/YYYY'), coalesce(e2.commune, '?')), ' ; ' order by e2.date_debut desc)
                                   from (select * from evenements e3 where e3.organisation_id = ev.organisation_id and e3.id <> ev.id and e3.deleted_at is null and e3.date_debut < ev.date_debut
                                         order by e3.date_debut desc limit 3) e2));

  -- Organisateur, assurances, sécurité
  v := v || jsonb_build_object('organisateur', o.nom, 'organisateur_tel', coalesce(o.contact_tel, p.responsable_legal_tel), 'securite_tel', p.securite_tel,
    'assurance', case when p.assurance_compagnie is not null then concat_ws(' — ', p.assurance_compagnie, 'police ' || p.assurance_police) end,
    'assurance_compagnie', p.assurance_compagnie, 'assurance_police', p.assurance_police,
    'responsable_legal', case when p.responsable_legal is not null then jsonb_build_object('nom', p.responsable_legal, 'gsm', p.responsable_legal_tel, 'email', o.contact_email) end,
    'responsable_legal_nom', p.responsable_legal);

  -- Public
  select count(*) into v_membres from membres_evenement m where m.evenement_id = p_evenement and m.actif and m.deleted_at is null;
  v := v || jsonb_build_object('membres', v_membres);

  -- Questionnaire de conformité → structures, risques
  v_structures := array_remove(array[
    case when (rep -> 'structure' ->> 'podium')::boolean then 'Podium' end,
    case when (rep -> 'structure' ->> 'tribune')::boolean then 'Tribune' end,
    case when (rep -> 'structure' ->> 'chapiteau')::boolean or (rep -> 'structure' ->> 'tonnelle')::boolean or (rep -> 'structure' ->> 'tente_communautaire')::boolean then 'Tente' end,
    case when (rep -> 'activite' ->> 'feu_reduit')::boolean then 'Feu ouvert' end,
    case when (rep -> 'cuisson' ->> 'foodtruck')::boolean then 'Restauration mobile' end,
    case when (rep -> 'cuisson' ->> 'barbecue')::boolean then 'Barbecue' end,
    case when (rep -> 'installation' ->> 'stands')::boolean then 'Stands de nourriture' end
  ], null);
  v_utilitaires := array_remove(array[
    case when (rep -> 'gaz' ->> 'installation_fixe')::boolean or (rep -> 'gaz' ->> 'bouteilles_mobiles')::boolean then 'Raccordement au gaz' end,
    case when exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie in ('point_eau')) then 'Raccordement à l''eau' end,
    case when exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie in ('coffret_electrique', 'cable')) then 'Raccordement à l''électricité' end,
    case when (rep -> 'installation' ->> 'groupe_electrogene')::boolean or exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'groupe_electrogene') then 'Groupe électrogène' end
  ], null);
  v := v || jsonb_build_object('structures', to_jsonb(v_structures), 'utilitaires', to_jsonb(v_utilitaires));
  -- (Ferrières) Le type de manifestation, les chapiteaux, les points de cuisson, le cortège, tels que le questionnaire les déclare.
  v := v || jsonb_build_object(
    'type_manifestation', to_jsonb(array_remove(array[
      case when (rep -> 'activite' ->> 'course_cycliste')::boolean then 'Course cycliste ou autres' end,
      case when (rep -> 'activite' ->> 'automobile')::boolean then 'Rallye (ancêtres, vitesse)' end,
      case when (rep -> 'activite' ->> 'pyrotechnie')::boolean or (rep -> 'activite' ->> 'feu_reduit')::boolean then 'Grand feu / feux d''artifice' end,
      case when (rep -> 'structure' ->> 'local_permanent')::boolean then 'Publique en lieu clos ou couvert' end
    ], null)),
    'chapiteaux', (select format('%s chapiteau(x) : %s', count(*), string_agg(format('%s %s m²', e.nom, round(e.largeur_m * e.longueur_m)), ', ')) from elements_plan e
                   where e.evenement_id = p_evenement and e.deleted_at is null and e.calque = 'infrastructures' and e.largeur_m is not null and e.longueur_m is not null having count(*) > 0),
    'cuisson_detail', nullif(concat_ws(', ', case when (rep -> 'cuisson' ->> 'gaz')::boolean then 'cuisson au gaz' end, case when (rep -> 'cuisson' ->> 'electrique')::boolean then 'cuisson électrique' end,
                                            case when (rep -> 'cuisson' ->> 'barbecue')::boolean then 'barbecue' end, case when (rep -> 'cuisson' ->> 'foodtruck')::boolean then 'foodtruck' end,
                                            case when (rep -> 'cuisson' ->> 'gel_combustible')::boolean then 'gel combustible' end), ''),
    'cortege', case when (rep -> 'activite' ->> 'cortege')::boolean or (rep -> 'activite' ->> 'cortege_motorise')::boolean then v_oui end,
    'signaleurs', (select jsonb_build_object('reponse', true, 'explication', format('%s signaleur(s) dans l''équipe Eventware', count(*))) from membres_evenement m
                   where m.evenement_id = p_evenement and m.deleted_at is null and m.actif and m.role::text ilike '%signaleur%' having count(*) > 0));
  -- Nettoyage : un tableau vide ne pré-remplit rien.
  if v -> 'type_manifestation' = '[]'::jsonb then v := v - 'type_manifestation'; end if;
  if v -> 'structures' = '[]'::jsonb then v := v - 'structures'; end if;
  if v -> 'utilitaires' = '[]'::jsonb then v := v - 'utilitaires'; end if;
  v := v || jsonb_build_object(
    'pyrotechnie', case when (rep -> 'activite' ->> 'pyrotechnie')::boolean then v_oui end,
    'feu', case when (rep -> 'activite' ->> 'feu_reduit')::boolean or (rep -> 'chauffage' ->> 'brasero')::boolean or (rep -> 'activite' ->> 'cracheur_feu')::boolean then v_oui end,
    'ballons', case when (rep -> 'activite' ->> 'lacher_ballons')::boolean or (rep -> 'activite' ->> 'lanternes')::boolean then v_oui end,
    'animaux', case when (rep -> 'activite' ->> 'animaux')::boolean then v_oui end,
    'ecran_geant', case when (rep -> 'structure' ->> 'ecran_geant')::boolean then v_oui end,
    'local_permanent', case when (rep -> 'structure' ->> 'local_permanent')::boolean then v_oui end,
    'camping', case when (rep -> 'activite' ->> 'camping')::boolean or (rep -> 'activite' ->> 'camp_scout')::boolean then v_oui end,
    'activite_dynamique', case when (rep -> 'activite' ->> 'divertissement_actif')::boolean or (rep -> 'activite' ->> 'divertissement_extreme')::boolean then v_oui end,
    'cuisson', case when (rep -> 'cuisson' ->> 'electrique')::boolean or (rep -> 'cuisson' ->> 'gaz')::boolean or (rep -> 'cuisson' ->> 'gel_combustible')::boolean then v_oui end,
    'barbecue', case when (rep -> 'cuisson' ->> 'barbecue')::boolean then v_oui end,
    'foodtruck', case when (rep -> 'cuisson' ->> 'foodtruck')::boolean then v_oui end,
    'gaz', case when (rep -> 'gaz' ->> 'stockage')::boolean or (rep -> 'gaz' ->> 'bouteilles_mobiles')::boolean then v_oui end,
    'chauffage', case when (rep -> 'chauffage' ->> 'champignon_gaz')::boolean or (rep -> 'chauffage' ->> 'canon_chaleur')::boolean or (rep -> 'chauffage' ->> 'poele_pellet_bois')::boolean
      then jsonb_build_object('reponse', true, 'explication', concat_ws(', ', case when (rep -> 'chauffage' ->> 'champignon_gaz')::boolean then 'parasols chauffants au gaz' end,
                                                                        case when (rep -> 'chauffage' ->> 'canon_chaleur')::boolean then 'canon à chaleur' end,
                                                                        case when (rep -> 'chauffage' ->> 'poele_pellet_bois')::boolean then 'poêle à pellets ou bois' end)) end,
    'chapiteau', (select string_agg(format('%s : %s × %s m', e.nom, e.largeur_m, e.longueur_m), ' ; ') from elements_plan e
                   where e.evenement_id = p_evenement and e.deleted_at is null and e.calque = 'infrastructures' and e.largeur_m is not null),
    'podium', (select string_agg(format('%s (%s × %s m)', e.nom, e.largeur_m, e.longueur_m), ' ; ') from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'scene'),
    'risques', case when (rep -> 'gaz' ->> 'installation_fixe')::boolean or exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie in ('stockage_gaz', 'coupure_gaz')) then v_oui end,
    'point_eau', case when exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'point_eau') then v_oui end
  );

  -- Plan, barrières, groupes, voies, parcours
  select count(*) into v_plan from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null;
  v := v || jsonb_build_object('plan', case when v_plan > 0 then jsonb_build_object('reponse', true, 'explication', format('%s objets sur le plan d''implantation Eventware', v_plan)) end,
                               'annexe_plan', case when v_plan > 0 then v_oui end);
  select count(*) as n, sum(coalesce(e.quantite, 1) * coalesce(e.longueur_m, 0)) as longueur into v_barrieres
    from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'perimetre';
  if v_barrieres.n > 0 then
    v := v || jsonb_build_object('barrieres', jsonb_build_object('reponse', true, 'explication', format('%s tronçon(s) de périmètre, environ %s m', v_barrieres.n, round(v_barrieres.longueur))));
  end if;
  select count(*) as n, sum(e.production_kva) as kva into v_groupes from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'groupe_electrogene';
  if v_groupes.n > 0 then v := v || jsonb_build_object('groupes', format('%s groupe(s), %s kVA', v_groupes.n, coalesce(v_groupes.kva, 0))); end if;
  select string_agg(e.nom, ', ') as noms, count(*) as n into v_voies from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie in ('voie_engins', 'point_rencontre_secours', 'prv');
  if v_voies.n > 0 then v := v || jsonb_build_object('voies_secours', format('%s voie(s) et point(s) de rencontre sur le plan : %s', v_voies.n, v_voies.noms)); end if;
  v := v || jsonb_build_object('evacuation', (select string_agg(e.nom, ', ') from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie in ('itineraire_evacuation', 'sortie_secours')),
                               'sorties_secours', (select format('%s sortie(s) de secours sur le plan', count(*)) from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'sortie_secours' having count(*) > 0));
  select sum(s.distance_totale_m) as m, count(*) as n into v_parcours from segments_parcours s where s.evenement_id = p_evenement;
  if coalesce(v_parcours.m, 0) > 0 then v := v || jsonb_build_object('parcours', format('%s m de parcours (%s tronçons)', round(v_parcours.m), v_parcours.n)); end if;
  v := v || jsonb_build_object('parkings', case when exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie = 'parking')
                                                   or exists (select 1 from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.type = 'parking') then v_oui end,
                               'navettes', case when exists (select 1 from membres_evenement m where m.evenement_id = p_evenement and m.est_chauffeur and m.deleted_at is null) then jsonb_build_object('reponse', true, 'explication', 'navettes internes (transports Eventware)') end,
                               'sanitaires', case when exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.calque = 'sanitaires') then v_oui end,
                               'gardiennage', case when exists (select 1 from fournisseurs f where f.organisation_id = ev.organisation_id and f.deleted_at is null and f.actif and 'gardiennage' = any (f.categories)) then v_oui end,
                               'fournisseur_tentes', (select string_agg(f.nom, ', ') from fournisseurs f where f.organisation_id = ev.organisation_id and f.deleted_at is null and f.actif and 'tentes' = any (f.categories)),
                               'radio', case when exists (select 1 from canaux_radio c where c.evenement_id = p_evenement and c.deleted_at is null and c.actif) then jsonb_build_object('reponse', true, 'explication', 'plan radio Eventware') end,
                               'messages_incident', case when exists (select 1 from fiches_reflexe f where f.evenement_id = p_evenement and f.deleted_at is null) then jsonb_build_object('reponse', true, 'explication', 'fiches réflexe Eventware') end,
                               'alcool', case when (rep -> 'cuisson' ->> 'barbecue')::boolean is not null and exists (select 1 from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and e.categorie in ('bar', 'bar_installation')) then v_oui end);
  select string_agg(format('%s × %s', m.quantite, m.type), ', ') into v_secours from moyens_premiers_secours m where m.evenement_id = p_evenement and coalesce(m.quantite, 0) > 0;
  if v_secours is not null then v := v || jsonb_build_object('moyens_secours', jsonb_build_object('reponse', true, 'explication', v_secours)); end if;

  -- Contacts (section 11)
  select c.nom, c.fonction, c.telephone, c.email, c.organisation into v_interlocuteur from contacts c
   where c.evenement_id = p_evenement and c.deleted_at is null and c.role_autorite = 'interlocuteur' limit 1;
  v := v || jsonb_build_object(
    'responsable_organisation', case when p.responsable_legal is not null or v_interlocuteur.nom is not null
      then jsonb_build_object('nom', coalesce(p.responsable_legal, v_interlocuteur.nom), 'fonction', coalesce(v_interlocuteur.fonction, 'responsable légal'),
                              'gsm', coalesce(p.responsable_legal_tel, v_interlocuteur.telephone), 'email', coalesce(v_interlocuteur.email, o.contact_email)) end,
    'responsable_securite', case when p.securite_nom is not null then jsonb_build_object('nom', p.securite_nom, 'fonction', 'responsable sécurité', 'gsm', p.securite_tel) end,
    'coordination_medicale', (select jsonb_build_object('nom', c.nom, 'fonction', c.fonction, 'gsm', c.telephone, 'email', c.email) from contacts c
                               where c.evenement_id = p_evenement and c.deleted_at is null and coalesce(c.telephone, '') <> ''
                                 and (c.categorie ilike '%secours%' or c.categorie ilike '%medic%' or c.organisation ilike '%croix%') order by c.nom limit 1),
    'poste_secours', (select jsonb_build_object('nom', c.organisation, 'responsable', c.nom, 'gsm', c.telephone, 'email', c.email) from contacts c
                       where c.evenement_id = p_evenement and c.deleted_at is null and (c.organisation ilike '%croix%' or c.categorie ilike '%secours%') order by c.nom limit 1)
  );
  return jsonb_strip_nulls(v);
end $$;

-- Un formulaire tel qu'il se lit : chaque question, sa réponse saisie, sinon la pré-remplie.
-- Sans code, le premier formulaire applicable (celui de la commune s'il existe).
create or replace function public.formulaire_dossier(p_evenement uuid, p_formulaire text default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with f as (
    select * from formulaires_applicables(p_evenement) a where p_formulaire is null or a.code = p_formulaire limit 1
  ),
  pre as (select formulaire_prerempli(p_evenement) as v),
  q as (
    select fq.code, fq.section, fq.sous_section, fq.ordre, fq.libelle, fq.aide, fq.type, fq.options, fq.obligatoire,
           r.valeur as saisie, (select pre.v -> fq.source from pre) as prerempli
    from formulaire_questions fq
    join f on f.id = fq.formulaire_id
    left join formulaire_reponses r on r.evenement_id = p_evenement and r.formulaire_id = fq.formulaire_id and r.code = fq.code
    where fq.actif
  )
  select jsonb_build_object(
    'formulaire', (select jsonb_build_object('id', f.id, 'code', f.code, 'libelle', f.libelle, 'autorite', f.autorite, 'portee', f.portee, 'version', f.version,
                                             'delai_jours', f.delai_jours, 'delai_note', f.delai_note, 'adresse_envoi', f.adresse_envoi, 'notes', f.notes) from f),
    'sections', (select jsonb_agg(jsonb_build_object('section', s.section, 'titre', s.titre) order by s.section) from formulaire_sections s join f on f.id = s.formulaire_id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('code', q.code, 'section', q.section, 'sous_section', q.sous_section, 'libelle', q.libelle, 'aide', q.aide,
                                                                'type', q.type, 'options', q.options, 'obligatoire', q.obligatoire,
                                                                'valeur', coalesce(q.saisie, q.prerempli), 'prerempli', q.prerempli, 'saisie', q.saisie)
                                           order by q.section, q.ordre, q.code) from q), '[]'::jsonb),
    'repondues', (select count(*) from q where coalesce(q.saisie, q.prerempli) is not null),
    'total', (select count(*) from q),
    'obligatoires_manquantes', coalesce((select jsonb_agg(q.code order by q.section, q.ordre) from q where q.obligatoire and coalesce(q.saisie, q.prerempli) is null), '[]'::jsonb)
  );
$$;

comment on function public.formulaire_prerempli(uuid) is 'Ce qu''Eventware sait déjà pour les formulaires de demande (163), par code de source.';
comment on function public.formulaire_dossier(uuid, text) is 'Un formulaire de demande d''un événement (163) : questions, réponses saisies ou pré-remplies, manques obligatoires. Sans code : le premier applicable.';
revoke execute on function public.formulaire_prerempli(uuid), public.formulaire_dossier(uuid, text) from public, anon;
grant  execute on function public.formulaire_prerempli(uuid), public.formulaire_dossier(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. L'instantané reprend le formulaire ; le contrôle signale les manques
-- ---------------------------------------------------------------------
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
    -- (163) Les formulaires applicables, tels qu'ils se lisent au dépôt ; « formulaire » : le premier (la commune).
    'formulaire', formulaire_dossier(p_evenement),
    'formulaires', coalesce((select jsonb_agg(formulaire_dossier(p_evenement, f.code)) from formulaires_applicables(p_evenement) f), '[]'::jsonb)
  );
  return v;
end $$;

-- controle_dossier (156) : une alerte si des questions obligatoires du formulaire restent sans réponse.
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
  -- (163) Chaque formulaire applicable : les questions obligatoires sans réponse, et le délai de dépôt qui approche
  -- tant que le dossier n'est pas déposé (à compter de la mise en place : le montage, sinon le premier jour).
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
  return;
end $$;

-- ---------------------------------------------------------------------
-- 4. RLS : catalogue lisible par tous, édité par l'exploitant ;
--    réponses par les droits « référentiels » (comme conformite_reponses)
-- ---------------------------------------------------------------------
alter table public.formulaires enable row level security;
alter table public.formulaire_sections enable row level security;
alter table public.formulaire_questions enable row level security;
alter table public.formulaire_reponses enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'formulaires' and policyname = 'formulaires_lecture') then
    create policy formulaires_lecture on public.formulaires for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'formulaires' and policyname = 'formulaires_gestion') then
    create policy formulaires_gestion on public.formulaires for all to authenticated using (est_exploitant()) with check (est_exploitant());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'formulaire_sections' and policyname = 'formulaire_sections_lecture') then
    create policy formulaire_sections_lecture on public.formulaire_sections for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'formulaire_sections' and policyname = 'formulaire_sections_gestion') then
    create policy formulaire_sections_gestion on public.formulaire_sections for all to authenticated using (est_exploitant()) with check (est_exploitant());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'formulaire_questions' and policyname = 'formulaire_questions_lecture') then
    create policy formulaire_questions_lecture on public.formulaire_questions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'formulaire_questions' and policyname = 'formulaire_questions_gestion') then
    create policy formulaire_questions_gestion on public.formulaire_questions for all to authenticated
      using (est_exploitant()) with check (est_exploitant());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'formulaire_reponses' and policyname = 'formulaire_reponses_lecture') then
    create policy formulaire_reponses_lecture on public.formulaire_reponses for select to authenticated
      using (a_permission(evenement_id, 'referentiels', 'lire') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'formulaire_reponses' and policyname = 'formulaire_reponses_ecriture') then
    create policy formulaire_reponses_ecriture on public.formulaire_reponses for all to authenticated
      using (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'referentiels', 'creer') or a_tout_pouvoir(evenement_id));
  end if;
end $p$;
revoke all on public.formulaires, public.formulaire_sections, public.formulaire_questions, public.formulaire_reponses from public, anon;
grant select, insert, update, delete on public.formulaires, public.formulaire_sections, public.formulaire_questions, public.formulaire_reponses to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/163.sql)
--   select code, libelle from formulaires_applicables('<evenement>');
--   select formulaire_dossier('<evenement>') -> 'repondues';
--   select * from controle_dossier('<evenement>') where code in ('DOS_FORMULAIRE', 'DOS_DELAI');
-- =====================================================================
