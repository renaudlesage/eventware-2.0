-- =====================================================================
-- 120 — EXERCICE SUR MESURE, v1 « sur table » (16/10, concept FERRU)
--
-- L'outil lit ce que l'événement a encodé et en tire un exercice qui
-- teste précisément ce dispositif :
--   1. `avant_vol(ev)` — le contrôle avant-vol : requêtes déterministes
--      qui relèvent les incohérences de configuration (seuils de veille
--      inversés, installation à risque sans mesure de maîtrise, zone
--      d'atterrissage classée DEA, un secouriste pour 1 500 personnes,
--      équipe sans responsable…). Chaque écart cite sa source et propose
--      le stimulus qui le mettrait en scène.
--   2. `exercice_trames` — la bibliothèque de trames rédigées à la main,
--      avec des champs à compléter ({lieu_isole}, {canal_urgence}…).
--   3. `generer_exercice(...)` — choisit les trames selon les objectifs,
--      place les stimuli dans le temps, remplit les champs depuis le
--      dispositif, y glisse les pièges de l'avant-vol, et lie chaque
--      stimulus à l'objet réel qui l'a inspiré (`exercice_sources`).
-- Les sept tables sont celles du concept ; `evenement_id` y rattache
-- le contexte (ce sera `contexte_id` côté Crisiware). Rien ici ne
-- touche aux vraies données : l'exercice v1 se joue sur une page
-- d'animation, pas dans l'outil. L'origine 'exercice' est ajoutée à
-- l'enum pour la v2 (bac à sable) — hors transaction, PostgreSQL
-- l'exige.
-- =====================================================================

alter type public.origine_donnee add value if not exists 'exercice';

begin;

-- ---------------------------------------------------------------------
-- 1. Les sept tables
-- ---------------------------------------------------------------------
create table if not exists public.exercices (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references public.evenements(id) on delete cascade,
  titre          text not null,
  format         text not null default 'table' check (format in ('alerte', 'table', 'outil')),
  date_prevue    timestamptz,
  duree_min      integer not null default 90 check (duree_min between 15 and 600),
  facteur_temps  numeric(4,2) not null default 1,
  statut         text not null default 'preparation' check (statut in ('preparation', 'en_cours', 'termine')),
  bac_a_sable_id uuid references public.evenements(id) on delete set null,
  contexte       jsonb not null default '{}'::jsonb,   -- les champs remplis à la génération
  debut_reel     timestamptz,
  fin_reel       timestamptz,
  synthese       text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid, deleted_at timestamptz
);
create index if not exists idx_exercices_evenement on public.exercices (evenement_id);

create table if not exists public.exercice_objectifs (
  id           uuid primary key default gen_random_uuid(),
  exercice_id  uuid not null references public.exercices(id) on delete cascade,
  code         text not null,
  intitule     text not null,
  discipline   text,
  ordre        integer not null default 0,
  unique (exercice_id, code)
);

create table if not exists public.exercice_stimuli (
  id             uuid primary key default gen_random_uuid(),
  exercice_id    uuid not null references public.exercices(id) on delete cascade,
  ordre          integer not null default 0,
  t_min          integer not null default 0,        -- minute du scénario
  canal          text,                              -- radio, téléphone, 112, témoin, météo, outil
  emetteur       text,
  texte          text not null,                     -- ce que l'animateur lit, tel quel
  note_animateur text,
  piege          boolean not null default false,    -- issu du contrôle avant-vol
  statut         text not null default 'prevu' check (statut in ('prevu', 'lance', 'annule')),
  lance_le       timestamptz
);
create index if not exists idx_stimuli_exercice on public.exercice_stimuli (exercice_id, ordre);

create table if not exists public.exercice_sources (
  id            uuid primary key default gen_random_uuid(),
  stimulus_id   uuid not null references public.exercice_stimuli(id) on delete cascade,
  table_source  text not null,
  source_id     uuid,
  code_controle text,                               -- code de l'écart avant-vol
  detail        text
);

create table if not exists public.exercice_actions_attendues (
  id           uuid primary key default gen_random_uuid(),
  stimulus_id  uuid not null references public.exercice_stimuli(id) on delete cascade,
  objectif_id  uuid references public.exercice_objectifs(id) on delete set null,
  action       text not null,
  outil        text,                                -- où ça se fait dans Eventware
  critere_auto text,                                -- v2 : « mission P1 créée sous 5 min »
  ordre        integer not null default 0
);

create table if not exists public.exercice_observations (
  id          uuid primary key default gen_random_uuid(),
  exercice_id uuid not null references public.exercices(id) on delete cascade,
  action_id   uuid not null references public.exercice_actions_attendues(id) on delete cascade,
  faite       boolean,
  observe_par text,
  observe_le  timestamptz not null default now(),
  note        text,
  created_by  uuid default auth.uid(),
  unique (action_id, created_by)
);

create table if not exists public.exercice_ecarts (
  id                uuid primary key default gen_random_uuid(),
  exercice_id       uuid not null references public.exercices(id) on delete cascade,
  action_id         uuid references public.exercice_actions_attendues(id) on delete set null,
  constat           text not null,
  gravite           text not null default 'majeur' check (gravite in ('mineur', 'majeur', 'critique')),
  action_corrective text,
  responsable       text,
  echeance          date,
  statut            text not null default 'ouvert' check (statut in ('ouvert', 'en_cours', 'ferme')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);

-- La bibliothèque de trames : commune à tous les événements, lisible par tous.
create table if not exists public.exercice_trames (
  code      text primary key,
  produit   text not null default 'eventware',
  titre     text not null,
  risque    text,
  objectifs text[] not null default '{}',           -- codes d'objectifs servis
  pieges_couverts text[] not null default '{}',     -- écarts avant-vol que la trame joue déjà
  stimuli   jsonb not null,                         -- [{t, canal, emetteur, texte, note, actions:[{action, objectif, outil, critere}]}]
  ordre     integer not null default 100
);

-- ---------------------------------------------------------------------
-- 2. Droits : ressource `exercices` (coordinateur, toutes phases sauf clôture)
-- ---------------------------------------------------------------------
insert into public.matrice_permissions (role, phase, ressource, action)
select 'coordinateur', ph::phase_evenement, 'exercices', ac::action_permission
from unnest(array['preparation','montage','exploitation','demontage']) ph,
     unnest(array['lire','creer','modifier','supprimer']) ac
where not exists (select 1 from public.matrice_permissions m
                  where m.role = 'coordinateur' and m.phase = ph::phase_evenement
                    and m.ressource = 'exercices' and m.action = ac::action_permission);

alter table public.exercices                 enable row level security;
alter table public.exercice_objectifs        enable row level security;
alter table public.exercice_stimuli          enable row level security;
alter table public.exercice_sources          enable row level security;
alter table public.exercice_actions_attendues enable row level security;
alter table public.exercice_observations     enable row level security;
alter table public.exercice_ecarts           enable row level security;
alter table public.exercice_trames           enable row level security;

create policy exercices_lecture on public.exercices for select to authenticated
  using (deleted_at is null and a_permission(evenement_id, 'exercices', 'lire'));
create policy exercices_creation on public.exercices for insert to authenticated
  with check (a_permission(evenement_id, 'exercices', 'creer'));
create policy exercices_modification on public.exercices for update to authenticated
  using (a_permission(evenement_id, 'exercices', 'modifier')) with check (a_permission(evenement_id, 'exercices', 'modifier'));
create policy exercices_suppression on public.exercices for delete to authenticated
  using (a_permission(evenement_id, 'exercices', 'supprimer'));

-- Les tables filles passent par l'exercice.
create or replace function public.exercice_permet(p_exercice uuid, p_action action_permission)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from exercices e where e.id = p_exercice and e.deleted_at is null and a_permission(e.evenement_id, 'exercices', p_action));
$$;

do $d$
declare t text;
begin
  foreach t in array array['exercice_objectifs', 'exercice_stimuli', 'exercice_actions_attendues', 'exercice_observations', 'exercice_ecarts'] loop
    if t = 'exercice_actions_attendues' then
      execute format('create policy %I_lecture on public.%I for select to authenticated using (exercice_permet((select s.exercice_id from exercice_stimuli s where s.id = stimulus_id), ''lire''))', t, t);
      execute format('create policy %I_creation on public.%I for insert to authenticated with check (exercice_permet((select s.exercice_id from exercice_stimuli s where s.id = stimulus_id), ''modifier''))', t, t);
      execute format('create policy %I_modification on public.%I for update to authenticated using (exercice_permet((select s.exercice_id from exercice_stimuli s where s.id = stimulus_id), ''modifier''))', t, t);
      execute format('create policy %I_suppression on public.%I for delete to authenticated using (exercice_permet((select s.exercice_id from exercice_stimuli s where s.id = stimulus_id), ''modifier''))', t, t);
    else
      execute format('create policy %I_lecture on public.%I for select to authenticated using (exercice_permet(exercice_id, ''lire''))', t, t);
      execute format('create policy %I_creation on public.%I for insert to authenticated with check (exercice_permet(exercice_id, ''modifier''))', t, t);
      execute format('create policy %I_modification on public.%I for update to authenticated using (exercice_permet(exercice_id, ''modifier''))', t, t);
      execute format('create policy %I_suppression on public.%I for delete to authenticated using (exercice_permet(exercice_id, ''modifier''))', t, t);
    end if;
  end loop;
end $d$;

create policy exercice_sources_lecture on public.exercice_sources for select to authenticated
  using (exercice_permet((select s.exercice_id from exercice_stimuli s where s.id = stimulus_id), 'lire'));
create policy exercice_sources_gestion_ins on public.exercice_sources for insert to authenticated
  with check (exercice_permet((select s.exercice_id from exercice_stimuli s where s.id = stimulus_id), 'modifier'));
create policy exercice_sources_gestion_del on public.exercice_sources for delete to authenticated
  using (exercice_permet((select s.exercice_id from exercice_stimuli s where s.id = stimulus_id), 'modifier'));
create policy exercice_trames_lecture on public.exercice_trames for select to authenticated using (true);
-- Les trames standard ne se modifient que par migration.

grant select, insert, update, delete on public.exercices, public.exercice_objectifs, public.exercice_stimuli,
  public.exercice_sources, public.exercice_actions_attendues, public.exercice_observations, public.exercice_ecarts to authenticated;
grant select on public.exercice_trames to authenticated;

-- Horodatage de `updated_at` (113) sur les tables qui en ont un.
create trigger horodatage_exercices before update on public.exercices for each row execute function trg_horodatage();
create trigger horodatage_exercice_ecarts before update on public.exercice_ecarts for each row execute function trg_horodatage();

-- ---------------------------------------------------------------------
-- 3. Les objectifs du catalogue (codes stables, repris dans les trames)
-- ---------------------------------------------------------------------
create or replace function public.exercice_objectifs_catalogue()
returns table (code text, intitule text, discipline text) language sql immutable as $$
  select * from (values
    ('ALERTE',    'Remonter et qualifier une alerte en moins de 3 minutes', 'QG'),
    ('MISSION',   'Créer, prioriser et attribuer une demande dans l''outil', 'QG'),
    ('RADIO',     'Communiquer sur le bon canal, avec le bon message', 'Terrain'),
    ('SECOURS',   'Prendre en charge une victime jusqu''à la remise aux secours', 'Secours'),
    ('METEO',     'Appliquer les seuils de veille et leurs consignes', 'QG'),
    ('EVAC',      'Décider et conduire une mise à l''abri ou une évacuation', 'Direction'),
    ('RECHERCHE', 'Déclencher et conduire la recherche d''une personne', 'Terrain'),
    ('TECH',      'Traiter un incident technique (gaz, énergie, structure)', 'Logistique'),
    ('INFO',      'Informer le public, les autorités et la direction', 'Direction'),
    ('LOG',       'Tenir la logistique sous charge', 'Logistique')
  ) v(code, intitule, discipline);
$$;

-- ---------------------------------------------------------------------
-- 4. Le contrôle avant-vol
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

  -- Point de rencontre des secours
  if not exists (select 1 from elements_plan where evenement_id = p_evenement and deleted_at is null and categorie = 'point_rencontre_secours') then
    return query select 'SANS_POINT_RENCONTRE', 'chaud', 'Aucun point de rencontre des secours sur le plan', 'Les secours extérieurs ne sauront pas où se présenter', 'elements_plan', null::uuid,
      'L''ambulance appelle : « on est à l''entrée du village, on vous attend où ? »', 'SECOURS';
  end if;
  return;
end $$;

-- ---------------------------------------------------------------------
-- 5. Les trames v1 (rédigées à la main, champs à compléter)
-- t : position relative dans l'exercice (0 = début, 1 = fin)
-- ---------------------------------------------------------------------
insert into public.exercice_trames (code, titre, risque, objectifs, pieges_couverts, ordre, stimuli) values
('VICTIME_PARCOURS', 'Victime sur un parcours non carrossable', 'chute, malaise', array['SECOURS','RADIO','MISSION','ALERTE'], array['SANS_POINT_RENCONTRE','LIEUX_SANS_POSITION'], 10, '[
  {"t":0.08,"canal":"radio","emetteur":"Bénévole de parcours","texte":"Radio, canal {canal_urgence} : « Chute d''un participant à {lieu_isole}. Il ne peut plus bouger la jambe, ça saigne pas mal. Qu''est-ce que je fais ? »","note":"Attendre que le QG qualifie (conscient ? respire ?) avant de donner la suite. S''il ne demande pas, c''est un constat.",
   "actions":[{"action":"Qualifier l''alerte : conscience, respiration, localisation exacte","objectif":"ALERTE","outil":"Radio / main courante"},{"action":"Créer une demande P1 avec le lieu","objectif":"MISSION","outil":"Sécurité → Demande urgente","critere":"mission P1 créée sous 5 min"},{"action":"Envoyer le secouriste et prévenir le 112 si nécessaire","objectif":"SECOURS","outil":"Radio canal {canal_urgence}"}]},
  {"t":0.2,"canal":"radio","emetteur":"Secouriste","texte":"« Je suis sur place. Suspicion de fracture ouverte. Il faut un brancard et on est à {brancardage} du chemin carrossable. Il me faut du monde. »","note":"Le brancardage se calcule depuis le plan. Qui envoie-t-on, par quel chemin, combien de temps ?",
   "actions":[{"action":"Décider du brancardage : équipe, itinéraire, point de reprise","objectif":"SECOURS","outil":"Carte / Parcours"},{"action":"Informer la direction de l''événement","objectif":"INFO","outil":"Téléphone"}]},
  {"t":0.35,"canal":"telephone","emetteur":"Centrale 112","texte":"« 112, bonjour. Une ambulance est en route. Vous me confirmez le point de rendez-vous et un guide sur place ? »","note":"Le point de rencontre des secours doit être sur le plan et quelqu''un doit y aller.",
   "actions":[{"action":"Donner le point de rencontre des secours et y envoyer un guide","objectif":"SECOURS","outil":"Plan d''implantation"},{"action":"Consigner l''heure de prise en charge dans la main courante","objectif":"MISSION","outil":"Main courante"}]}
]'::jsonb),
('GAZ_RESTAURATION', 'Fuite de gaz en zone de restauration', 'gaz, incendie', array['TECH','EVAC','ALERTE','RADIO'], array['RISQUE_SANS_MAITRISE','FICHE_MANQUANTE'], 20, '[
  {"t":0.3,"canal":"temoin","emetteur":"Bénévole bar","texte":"« Ça sent fort le gaz derrière {risque_gaz}. Le gars du stand dit que c''est normal. »","note":"Mesure de maîtrise encodée : {maitrise_gaz}. Le QG la connaît-il ?",
   "actions":[{"action":"Faire couper la vanne et éloigner toute flamme","objectif":"TECH","outil":"Fiche réflexe gaz"},{"action":"Établir un périmètre et tenir le public à distance","objectif":"EVAC","outil":"Radio"},{"action":"Créer une demande P1 et prévenir les pompiers si la fuite persiste","objectif":"MISSION","outil":"Sécurité → Demande urgente"}]},
  {"t":0.42,"canal":"radio","emetteur":"Sécurité","texte":"« Le responsable du stand ne trouve pas la vanne principale. Et il y a un barbecue allumé à dix mètres. »",
   "actions":[{"action":"Faire éteindre le barbecue, étendre le périmètre","objectif":"TECH","outil":"Radio"},{"action":"Décider : évacuation partielle de la zone restauration ?","objectif":"EVAC","outil":"Direction"}]}
]'::jsonb),
('METEO_STRUCTURES', 'Intempéries et structures légères', 'vent, orage', array['METEO','EVAC','INFO','ALERTE'], array['SEUIL_VENT_INVERSE','SEUIL_PLUIE_INVERSE','VEILLE_INACTIVE'], 30, '[
  {"t":0.12,"canal":"meteo","emetteur":"Veille météo","texte":"L''IRM passe en jaune pour la province : rafales jusqu''à {rafale_test} km/h attendues dans deux heures, orages possibles.","note":"Seuils encodés : vigilance {rafale_vigilance} km/h, critique {rafale_critique} km/h. L''outil doit-il déjà réagir ?",
   "actions":[{"action":"Comparer aux seuils de veille et appliquer la consigne de vigilance","objectif":"METEO","outil":"Situation → Veille"},{"action":"Diffuser une alerte vigilance aux équipes","objectif":"INFO","outil":"Alertes"}]},
  {"t":0.5,"canal":"radio","emetteur":"Logistique","texte":"« Rafale mesurée {rafale_mesuree} km/h. La tonnelle du bar vient de se soulever, personne de blessé pour l''instant. »",
   "actions":[{"action":"Passer en critique : évacuer les structures légères, ouvrir la mise à l''abri","objectif":"EVAC","outil":"Alertes → niveau urgence"},{"action":"Informer le public et les artistes","objectif":"INFO","outil":"Sono / page publique"}]},
  {"t":0.7,"canal":"telephone","emetteur":"Bourgmestre","texte":"« J''ai vu l''alerte orange sur mon téléphone. Vous arrêtez ou vous continuez ? Je veux une réponse maintenant. »",
   "actions":[{"action":"Donner une décision argumentée à l''autorité","objectif":"INFO","outil":"Téléphone / page autorité"}]}
]'::jsonb),
('ENFANT_PERDU', 'Enfant perdu', 'disparition', array['RECHERCHE','INFO','RADIO','MISSION'], array[]::text[], 40, '[
  {"t":0.25,"canal":"temoin","emetteur":"Une maman, à l''accueil","texte":"« Mon fils de 6 ans, Léo, blond, t-shirt rouge, a disparu il y a dix minutes près de {lieu_public}. »",
   "actions":[{"action":"Déclarer la recherche avec le signalement complet","objectif":"RECHERCHE","outil":"Sécurité → Recherche"},{"action":"Diffuser le signalement sur le canal général et aux entrées","objectif":"RADIO","outil":"Radio"},{"action":"Garder la maman au QG avec un bénévole","objectif":"INFO","outil":"Accueil"}]},
  {"t":0.4,"canal":"radio","emetteur":"Bénévole parking","texte":"« Je crois avoir vu un petit en rouge monter dans une voiture grise avec un adulte, il y a cinq minutes. »","note":"Le QG doit décider s''il appelle la police. Il n''a aucune certitude.",
   "actions":[{"action":"Décider d''appeler la police (101) et bloquer les sorties","objectif":"RECHERCHE","outil":"Téléphone"},{"action":"Informer la direction","objectif":"INFO","outil":"Téléphone"}]},
  {"t":0.55,"canal":"radio","emetteur":"Bénévole scène","texte":"« On a Léo. Il était au stand de maquillage. Tout va bien. »",
   "actions":[{"action":"Clôturer la recherche et lever l''alerte sur tous les canaux","objectif":"RECHERCHE","outil":"Sécurité → Recherche"},{"action":"Consigner dans la main courante","objectif":"MISSION","outil":"Main courante"}]}
]'::jsonb),
('PANNE_ENERGIE', 'Panne du groupe électrogène', 'énergie', array['TECH','LOG','INFO'], array[]::text[], 50, '[
  {"t":0.45,"canal":"radio","emetteur":"Régie","texte":"« {groupe} vient de s''arrêter. Plus de son, plus de lumière sur la scène. {nb_public} personnes devant. »","note":"Ce qui pend sous ce groupe d''après le plan : {alimentes}.",
   "actions":[{"action":"Sécuriser la scène : lumière de secours, pas de mouvement de foule","objectif":"TECH","outil":"Radio"},{"action":"Créer la demande et envoyer le technicien","objectif":"LOG","outil":"Logistique → Demande"},{"action":"Faire parler l''animateur de scène au public","objectif":"INFO","outil":"Sono de secours"}]},
  {"t":0.6,"canal":"radio","emetteur":"Technicien","texte":"« Le groupe redémarre mais il sent le chaud, et le bidon de carburant est à côté. »",
   "actions":[{"action":"Décider : redémarrer ou basculer ? Appliquer la distance de sécurité","objectif":"TECH","outil":"Plan → Bilans énergie"}]}
]'::jsonb),
('GROUPE_NUIT', 'Groupe sans nouvelles à la tombée de la nuit', 'retard, froid', array['RECHERCHE','RADIO','METEO','INFO'], array['GROUPE_INCOHERENT'], 60, '[
  {"t":0.55,"canal":"outil","emetteur":"Parcours","texte":"Il est {coucher_soleil} : le soleil est couché. « {groupe_retard} » n''a pas pointé depuis {dernier_lieu} et ne répond pas au téléphone.","note":"Effectif encodé : {effectif_groupe}. Lampes ? Froid ? Qui décide d''envoyer quelqu''un ?",
   "actions":[{"action":"Vérifier le dernier pointage et l''effectif dans Parcours","objectif":"RECHERCHE","outil":"Parcours"},{"action":"Envoyer une équipe à leur rencontre par le tronçon suivant","objectif":"RECHERCHE","outil":"Radio"},{"action":"Prévenir la direction et préparer l''appel aux secours","objectif":"INFO","outil":"Téléphone"}]},
  {"t":0.72,"canal":"telephone","emetteur":"Un participant du groupe","texte":"« On est au bord du chemin, une dame est épuisée, on n''a plus de lampe et il fait 3 degrés. »",
   "actions":[{"action":"Localiser (point kilométrique, lieu le plus proche) et envoyer les secours","objectif":"SECOURS","outil":"Parcours / Carte"},{"action":"Appliquer la consigne froid de la veille","objectif":"METEO","outil":"Veille"}]}
]'::jsonb),
('FOULE_SCENE', 'Mouvement de foule devant une scène', 'foule', array['EVAC','SECOURS','INFO','RADIO'], array['SECOURISTES_INSUFFISANTS','DEA_INCOHERENT'], 70, '[
  {"t":0.65,"canal":"radio","emetteur":"Sécurité scène","texte":"« Ça pousse fort devant la scène, les barrières plient, j''ai des gens qui crient. »",
   "actions":[{"action":"Faire arrêter la musique et faire parler l''artiste","objectif":"EVAC","outil":"Régie"},{"action":"Ouvrir les dégagements latéraux, envoyer la volante","objectif":"EVAC","outil":"Radio"},{"action":"Pré-alerter les secours et le PMA","objectif":"SECOURS","outil":"Téléphone / Radio"}]},
  {"t":0.78,"canal":"radio","emetteur":"Volante","texte":"« Trois personnes au sol, une ne répond pas. »",
   "actions":[{"action":"Déclencher le MAYDAY et appeler le 112 avec le point de rencontre","objectif":"ALERTE","outil":"MAYDAY"},{"action":"Informer la direction et préparer la communication","objectif":"INFO","outil":"Téléphone"}]}
]'::jsonb)
on conflict (code) do update set titre = excluded.titre, risque = excluded.risque, objectifs = excluded.objectifs, pieges_couverts = excluded.pieges_couverts, stimuli = excluded.stimuli, ordre = excluded.ordre;

-- ---------------------------------------------------------------------
-- 6. Le générateur
-- ---------------------------------------------------------------------
create or replace function public.remplir_champs(p_texte text, p_contexte jsonb)
returns text language sql immutable as $$
  select coalesce((select string_agg(
    case when m[1] is not null then coalesce(p_contexte ->> m[1], '{' || m[1] || '}') else m[2] end, '' order by ord)
   from regexp_matches(p_texte, '\{([a-z_]+)\}|([^{]+|\{)', 'g') with ordinality as t(m, ord)), p_texte);
$$;

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
begin
  if not a_permission(p_evenement, 'exercices', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Création d''exercice non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then raise exception 'Événement inconnu'; end if;
  if ev.phase = 'exploitation' and p_format = 'outil' then
    raise exception 'Pas d''exercice dans l''outil pendant l''exploitation réelle';
  end if;

  -- Le contexte : ce que le dispositif encodé apporte au scénario.
  select * into v from veille_meteo where evenement_id = p_evenement;
  select coalesce(nullif(l.nom, ''), 'un point isolé du parcours') into v_lieu
    from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.actif and l.latitude is not null
    order by coalesce(l.pk_km, 0) desc,
             ((l.latitude - coalesce(ev.point_0_lat, l.latitude))^2 + (l.longitude - coalesce(ev.point_0_lon, l.longitude))^2) desc limit 1;
  select nom into v_lieu_public from lieux where evenement_id = p_evenement and deleted_at is null and actif and (public or type::text in ('scene','entree','bar')) order by public desc limit 1;
  select numero into v_canal from canaux_radio where evenement_id = p_evenement and deleted_at is null and actif order by canal_urgence desc, ordre limit 1;
  select nom, mesures_maitrise into v_gaz from elements_plan where evenement_id = p_evenement and deleted_at is null and (categorie = 'stockage_gaz' or (est_risque and categorie in ('foodtruck','feu','bar_installation'))) order by (categorie = 'stockage_gaz') desc limit 1;
  select e.nom, (select string_agg(x.nom, ', ') from elements_plan x where x.alimente_par = e.id and x.deleted_at is null) as alimentes
    into v_ge from elements_plan e where e.evenement_id = p_evenement and e.deleted_at is null and (e.categorie = 'groupe_electrogene' or e.production_kva > 0) order by e.production_kva desc nulls last limit 1;
  select g.nom, g.effectif_prevu, l.nom as dernier into v_groupe from groupes g left join lieux l on l.id = g.dernier_lieu_id where g.evenement_id = p_evenement and g.deleted_at is null order by g.depart_prevu desc nulls last limit 1;

  ctx := jsonb_build_object(
    'lieu_isole', coalesce(v_lieu, 'un point isolé du parcours'),
    'lieu_public', coalesce(v_lieu_public, 'l''entrée'),
    'canal_urgence', coalesce(v_canal, '—'),
    'brancardage', '400 m',
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
    'nb_participants', coalesce(ev.frequentation_max::text, '?')
  );

  insert into exercices (evenement_id, titre, format, duree_min, date_prevue, contexte, created_by)
  values (p_evenement, p_titre, p_format, p_duree_min, p_date, ctx, auth.uid()) returning id into v_ex;

  -- Les objectifs choisis, dans l'ordre du catalogue.
  insert into exercice_objectifs (exercice_id, code, intitule, discipline, ordre)
  select v_ex, c.code, c.intitule, c.discipline, row_number() over ()
    from exercice_objectifs_catalogue() c where c.code = any (p_objectifs);

  -- Les trames qui servent ces objectifs, les mieux couvertes d'abord ; 2 à 4 selon la durée.
  for r in select t.*, cardinality(array(select unnest(t.objectifs) intersect select unnest(p_objectifs))) as couverture
             from exercice_trames t where t.produit = 'eventware' and t.objectifs && p_objectifs
            order by couverture desc, t.ordre
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

grant execute on function public.avant_vol(uuid), public.exercice_objectifs_catalogue(), public.remplir_champs(text, jsonb),
  public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer), public.exercice_permet(uuid, action_permission) to authenticated;

commit;
