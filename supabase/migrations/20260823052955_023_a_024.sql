-- ============ 023_alertes_et_terrain ============
-- =====================================================================
-- Migration 023 : alertes transverses + rattachement d'équipe + vue terrain
-- ---------------------------------------------------------------------
-- Lacune trouvée en écrivant mon_terrain() : un membre n'était rattaché
-- à aucune équipe. `equipes` portait un responsable, mais rien ne
-- disait qui en faisait partie — donc impossible d'afficher « les
-- missions de mon équipe », qui est la question de base sur le terrain.
-- =====================================================================

begin;

alter table membres_evenement
  add column equipe_id uuid references equipes(id) on delete set null;

create index idx_membres_equipe on membres_evenement (equipe_id)
  where deleted_at is null;

comment on column membres_evenement.equipe_id is
  'Équipe de rattachement. Détermine les missions qui apparaissent dans la vue terrain.';

-- ---------------------------------------------------------------------
-- ALERTES
-- ---------------------------------------------------------------------
create type niveau_alerte as enum ('information','vigilance','urgence','evacuation');

create table alertes (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  niveau        niveau_alerte not null default 'information',
  titre         text not null,
  message       text,
  consigne      text,
  lieu_id       uuid references lieux(id) on delete set null,
  perimetre     text,
  active        boolean not null default true,
  emise_le      timestamptz not null default clock_timestamp(),
  levee_le      timestamptz,
  levee_par     uuid references auth.users(id),
  motif_levee   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_alertes_actives on alertes (evenement_id, emise_le desc)
  where deleted_at is null and active;

comment on column alertes.consigne is
  'Ce qu''il faut FAIRE. Une alerte qui décrit sans prescrire laisse chacun improviser.';

create trigger tracabilite_alertes before insert or update on alertes
  for each row execute function trg_tracabilite_simple();

create or replace function trg_cycle_alerte()
returns trigger language plpgsql as $$
begin
  if old.active and not new.active and new.levee_le is null then
    new.levee_le := clock_timestamp();
    new.levee_par := auth.uid();
  end if;
  return new;
end;
$$;

create trigger cycle_alerte before update on alertes
  for each row execute function trg_cycle_alerte();

create or replace function trg_journal_alerte()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'noyau', 'alerte',
      'ALERTE ' || upper(new.niveau::text) || ' — ' || new.titre ||
      coalesce(' : ' || new.consigne, ''),
      'majeur'::importance_journal, 'alerte', new.id, null);
  elsif old.active and not new.active then
    perform journaliser(new.evenement_id, 'noyau', 'alerte',
      'Levée de l''alerte « ' || new.titre || ' »' ||
      coalesce(' — ' || new.motif_levee, ''),
      'majeur'::importance_journal, 'alerte', new.id, null);
  end if;
  return null;
end;
$$;

create trigger journal_alerte after insert or update on alertes
  for each row execute function trg_journal_alerte();

alter table alertes enable row level security;

create policy alertes_lecture on alertes for select to authenticated
  using (a_permission(evenement_id,'alertes','lire') and deleted_at is null);
create policy alertes_creation on alertes for insert to authenticated
  with check (a_permission(evenement_id,'alertes','creer'));
create policy alertes_modification on alertes for update to authenticated
  using (a_permission(evenement_id,'alertes','modifier'))
  with check (a_permission(evenement_id,'alertes','modifier'));

-- ---------------------------------------------------------------------
-- VUE TERRAIN
-- Remplace quatre écrans de la v18 — volante, chauffeur, balade-light,
-- tâches sanitaires — qui posaient tous la même question : qu'est-ce
-- qui m'attend, maintenant ?
--
-- L'ORDER BY porte sur les colonnes de sortie de l'UNION, pas sur les
-- colonnes sources : il faut donc les désigner par leur position.
-- ---------------------------------------------------------------------
create or replace function mon_terrain(p_evenement uuid)
returns table (
  genre text, id uuid, reference text, titre text, detail text,
  priorite text, statut text,
  latitude double precision, longitude double precision,
  pour_moi boolean, horodatage timestamptz
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  with moi as (
    select m.id, m.equipe_id
    from membres_evenement m
    where m.evenement_id = p_evenement and m.user_id = auth.uid()
      and m.actif and m.deleted_at is null
    limit 1
  ),
  tout as (
    select 'mission'::text as genre, m.id, m.reference, m.titre, m.description as detail,
           m.priorite::text as priorite, m.statut::text as statut,
           m.latitude, m.longitude,
           coalesce(m.membre_id = (select id from moi), false) as pour_moi,
           m.created_at as horodatage
    from missions m
    where m.evenement_id = p_evenement and m.deleted_at is null
      and m.statut not in ('resolue','annulee')
      and (
        m.membre_id = (select id from moi)
        or (m.equipe_id is not null and m.equipe_id = (select equipe_id from moi))
        or (m.membre_id is null and m.equipe_id is null)
      )

    union all

    select 'transport', t.id, t.reference,
           coalesce(t.depart_libre,'?') || ' → ' || coalesce(t.arrivee_libre,'?'),
           t.nb_personnes || ' pers. ' || coalesce(t.motif,''),
           t.priorite::text, t.statut::text, null, null,
           coalesce(t.chauffeur_id = (select id from moi), false),
           t.created_at
    from transports t
    where t.evenement_id = p_evenement and t.deleted_at is null
      and t.statut not in ('resolue','annulee')
      and (t.chauffeur_id = (select id from moi) or t.chauffeur_id is null)
  )
  select * from tout
  order by pour_moi desc, priorite, horodatage;
$$;

grant execute on function mon_terrain(uuid) to authenticated;

commit;;

-- ============ 024_pack_fiches_reflexe ============
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

grant execute on function installer_fiches_standard(uuid) to authenticated;;
