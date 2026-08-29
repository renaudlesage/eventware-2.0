-- ============ 032_exploitant_rejoint_evenement ============
-- =====================================================================
-- Migration 032 : l'exploitant peut se rattacher à un événement
-- ---------------------------------------------------------------------
-- L'exploitant VOIT tous les événements sans en être membre — c'est
-- nécessaire au support. Mais il ne pouvait pas s'y rattacher : la
-- policy d'ajout de membre exige d'être déjà membre. Sélectionner un
-- événement dont il n'était pas membre menait donc à un cul-de-sac.
--
-- Le rattachement est journalisé : une intervention de l'éditeur dans
-- le dispositif d'un client doit laisser une trace chez le client.
-- =====================================================================

create or replace function rejoindre_evenement(
  p_evenement uuid,
  p_role_code text default 'coordinateur'
)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_role uuid;
  v_id uuid;
begin
  if not est_exploitant() then
    raise exception 'Réservé à l''exploitant de la plateforme' using errcode = '42501';
  end if;

  select id into v_role from roles
  where evenement_id = p_evenement and code = p_role_code and deleted_at is null;

  if v_role is null then
    raise exception 'Rôle « % » inexistant sur cet événement', p_role_code
      using errcode = 'P0002';
  end if;

  insert into membres_evenement (evenement_id, user_id, role, role_id, nom_affiche, origine)
  values (p_evenement, auth.uid(),
          case when p_role_code in ('coordinateur','chef_equipe','benevole','observateur')
               then p_role_code::role_evenement else 'coordinateur' end,
          v_role, 'Éditeur (support)', 'humain')
  on conflict (evenement_id, user_id)
    do update set role_id = excluded.role_id, actif = true
  returning id into v_id;

  perform journaliser(p_evenement, 'noyau', 'acces',
    'Rattachement de l''éditeur au dispositif, rôle ' || p_role_code,
    'notable'::importance_journal, 'membre', v_id, null);

  return v_id;
end;
$$;

grant execute on function rejoindre_evenement(uuid, text) to authenticated;;

-- ============ 033_acces_secours ============
-- =====================================================================
-- Migration 033 : catégories d'accès et de dispositif de secours
-- ---------------------------------------------------------------------
-- Vocabulaire de la doctrine belge plutôt que termes génériques : c'est
-- ce que les intervenants cherchent sur un plan, et l'écart de langage
-- coûte des minutes au moment où il ne faut pas en perdre.
--
--   PRV  — point de regroupement des victimes
--   PMA  — poste médical avancé
--   noria — trajet PRV → PMA (petite) ou PMA → hôpital (grande)
-- =====================================================================

alter type categorie_element add value if not exists 'point_rassemblement';
alter type categorie_element add value if not exists 'prv';
alter type categorie_element add value if not exists 'pma';
alter type categorie_element add value if not exists 'aire_helico';
alter type categorie_element add value if not exists 'point_transfert';
alter type categorie_element add value if not exists 'noria';
alter type categorie_element add value if not exists 'point_rencontre_secours';;

-- ============ 034_matrice_radio ============
-- =====================================================================
-- Migration 034 : matrice radio
-- ---------------------------------------------------------------------
-- Deux objets distincts, souvent confondus :
--
--   le CANAL — une fréquence, un sous-ton, un usage. Il appartient au
--   dispositif et sert de plan de programmation des postes.
--
--   l'ATTRIBUTION — un poste confié à quelqu'un, avec son indicatif.
--   Elle existe déjà (table `attributions`, fusionnée avec le clefier).
--
-- Les confondre, c'est reprogrammer tous les postes quand une équipe
-- change de porteur.
--
-- Le sous-ton (CTCSS/DCS) ne filtre que l'écoute : il ne protège de
-- rien et n'empêche pas d'être entendu. Rappelé dans l'interface.
-- =====================================================================

begin;

create type bande_radio as enum ('pmr446', 'vhf', 'uhf', 'dmr', 'autre');

create table canaux_radio (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,

  numero        text not null,            -- « 3 », « CH7 », « A »
  libelle       text not null,            -- « Sécurité », « Logistique »
  bande         bande_radio not null default 'pmr446',
  frequence_mhz numeric(9,4),
  sous_ton      text,                     -- CTCSS 88.5 / DCS 023
  usage_prevu   text,
  equipe_id     uuid references equipes(id) on delete set null,

  -- Un canal doit rester libre de tout trafic courant.
  canal_urgence boolean not null default false,
  actif         boolean not null default true,
  ordre         integer not null default 100,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, numero)
);

create index idx_canaux_ev on canaux_radio (evenement_id, ordre)
  where deleted_at is null;

comment on column canaux_radio.sous_ton is
  'CTCSS ou DCS. Filtre l''écoute, ne chiffre rien : le trafic reste audible de quiconque écoute la fréquence sans sous-ton.';
comment on column canaux_radio.canal_urgence is
  'Canal réservé. Doit rester libre de tout trafic courant.';

-- L'attribution d'un poste porte désormais son indicatif et son canal
alter table attributions
  add column indicatif text,
  add column canal_id uuid references canaux_radio(id) on delete set null;

comment on column attributions.indicatif is
  'Indicatif d''appel du porteur — ALPHA 3, LOG 2. Suit la personne, pas le poste.';

create trigger tracabilite_canaux before insert or update on canaux_radio
  for each row execute function trg_tracabilite();

alter table canaux_radio enable row level security;

create policy canaux_lecture on canaux_radio for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);
create policy canaux_creation on canaux_radio for insert to authenticated
  with check (a_permission(evenement_id,'logistique','creer'));
create policy canaux_modification on canaux_radio for update to authenticated
  using (a_permission(evenement_id,'logistique','modifier'))
  with check (a_permission(evenement_id,'logistique','modifier'));

commit;;

-- ============ 035_mayday_intervenant ============
-- =====================================================================
-- Migration 035 : Mayday intervenant
-- ---------------------------------------------------------------------
-- Objet distinct du signalement : ce n'est pas un incident constaté,
-- c'est l'émetteur lui-même qui est en difficulté. Conséquences :
--
--   TOUT membre peut en émettre un, quel que soit son rôle. On ne
--   subordonne pas un appel au secours à une capacité — c'est la seule
--   écriture du système qui ignore la matrice.
--
--   Il crée automatiquement une alerte d'urgence : l'information doit
--   s'imposer à tous les écrans, pas attendre qu'on la consulte.
--
--   Il porte le canal radio de l'émetteur : le PC doit savoir sur quelle
--   fréquence le rappeler, et c'est la première chose qu'on cherche.
-- =====================================================================

begin;

create type statut_mayday as enum ('emis', 'accuse', 'en_cours', 'clos', 'annule');

create table maydays (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  reference     text not null,

  membre_id     uuid references membres_evenement(id) on delete set null,
  emetteur_nom  text,
  indicatif     text,
  canal         text,

  motif         text,
  latitude      double precision,
  longitude     double precision,
  precision_m   double precision,

  statut        statut_mayday not null default 'emis',
  emis_le       timestamptz not null default clock_timestamp(),
  accuse_le     timestamptz,
  accuse_par    uuid references auth.users(id),
  clos_le       timestamptz,
  resolution    text,

  alerte_id     uuid references alertes(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),

  unique (evenement_id, reference)
);

create index idx_maydays_ouverts on maydays (evenement_id, emis_le desc)
  where statut in ('emis','accuse','en_cours');

create trigger tracabilite_maydays before insert or update on maydays
  for each row execute function trg_tracabilite_simple();

-- ---------------------------------------------------------------------
-- Émission — accessible à tout membre, sans condition de rôle
-- ---------------------------------------------------------------------
create or replace function emettre_mayday(
  p_evenement uuid,
  p_motif text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_precision_m double precision default null
)
returns table (reference text, emis_le timestamptz)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m membres_evenement%rowtype;
  v_ref text;
  v_alerte uuid;
  v_indicatif text;
  v_canal text;
  v_id uuid;
begin
  select * into m from membres_evenement
  where evenement_id = p_evenement and user_id = auth.uid()
    and actif and deleted_at is null;

  if not found then
    raise exception 'Non membre de cet événement' using errcode = '42501';
  end if;

  -- Indicatif et canal, repris du poste radio attribué s'il y en a un
  select a.indicatif, 'CH ' || c.numero into v_indicatif, v_canal
  from attributions a
  left join canaux_radio c on c.id = a.canal_id
  where a.evenement_id = p_evenement and a.membre_id = m.id
    and a.nature = 'radio' and a.rendu_le is null and a.deleted_at is null
  limit 1;

  select 'MAYDAY-' || lpad((count(*) + 1)::text, 2, '0') into v_ref
  from maydays where evenement_id = p_evenement;

  insert into alertes (evenement_id, niveau, titre, message, consigne)
  values (p_evenement, 'urgence',
    'MAYDAY — ' || coalesce(m.nom_affiche, 'intervenant') ||
      coalesce(' (' || v_indicatif || ')', ''),
    coalesce(p_motif, 'Intervenant en difficulté, motif non précisé') ||
      coalesce(' — position ' || round(p_latitude::numeric, 5) || ' / ' ||
               round(p_longitude::numeric, 5), ' — position inconnue'),
    'Le PC prend la main. Ne pas saturer la radio' ||
      coalesce(' — rappel sur ' || v_canal, '') || '.')
  returning id into v_alerte;

  insert into maydays (evenement_id, reference, membre_id, emetteur_nom,
                       indicatif, canal, motif, latitude, longitude,
                       precision_m, alerte_id)
  values (p_evenement, v_ref, m.id, m.nom_affiche, v_indicatif, v_canal,
          p_motif, p_latitude, p_longitude, p_precision_m, v_alerte)
  returning id into v_id;

  perform journaliser(p_evenement, 'securite', 'mayday',
    v_ref || ' émis par ' || coalesce(m.nom_affiche, 'intervenant') ||
    coalesce(' (' || v_indicatif || ')', '') ||
    coalesce(' : ' || p_motif, ''),
    'majeur'::importance_journal, 'mayday', v_id, v_ref);

  return query
    select mm.reference, mm.emis_le from maydays mm where mm.id = v_id;
end;
$$;

grant execute on function emettre_mayday(
  uuid, text, double precision, double precision, double precision
) to authenticated;

-- ---------------------------------------------------------------------
-- RLS : lecture par tout membre, traitement par l'encadrement
-- ---------------------------------------------------------------------
alter table maydays enable row level security;

create policy maydays_lecture on maydays for select to authenticated
  using (est_membre(evenement_id));

create policy maydays_modification on maydays for update to authenticated
  using (a_permission(evenement_id,'sos','modifier'))
  with check (a_permission(evenement_id,'sos','modifier'));

-- Clôture : lève l'alerte associée dans le même mouvement, pour qu'un
-- bandeau d'urgence ne survive jamais à la situation qui l'a causé.
create or replace function trg_cycle_mayday()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'accuse' and new.accuse_le is null then
      new.accuse_le := clock_timestamp();
      new.accuse_par := auth.uid();
    end if;
    if new.statut in ('clos','annule') then
      new.clos_le := coalesce(new.clos_le, clock_timestamp());
      if new.alerte_id is not null then
        update alertes set active = false,
               motif_levee = coalesce(new.resolution, 'Mayday clôturé')
        where id = new.alerte_id and active;
      end if;
    end if;
    perform journaliser(new.evenement_id, 'securite', 'mayday',
      new.reference || ' → ' || new.statut ||
      coalesce(' : ' || new.resolution, ''),
      'majeur'::importance_journal, 'mayday', new.id, new.reference);
  end if;
  return new;
end;
$$;

create trigger cycle_mayday before update on maydays
  for each row execute function trg_cycle_mayday();

commit;;

-- ============ 036_veille_meteo ============
-- =====================================================================
-- Migration 036 : veille météo à seuils
-- ---------------------------------------------------------------------
-- La fiche réflexe STD-05 dit de fixer le seuil de décision AVANT que le
-- phénomène arrive. Encore faut-il que ce seuil soit écrit quelque part,
-- et pas dans la tête du coordinateur.
--
-- Les valeurs par défaut viennent des pratiques usuelles du montage de
-- structures temporaires. Elles ne remplacent ni les prescriptions du
-- fabricant du chapiteau, ni l'avis de la zone de secours : ce sont des
-- points de départ à ajuster.
-- =====================================================================

begin;

create table veille_meteo (
  evenement_id  uuid primary key references evenements(id) on delete cascade,

  active        boolean not null default true,

  -- Vent : le facteur qui décide du sort des structures légères
  rafale_vigilance_kmh   integer not null default 50,
  rafale_critique_kmh    integer not null default 70,

  -- Précipitations horaires
  pluie_vigilance_mm     numeric(5,1) not null default 5,
  pluie_critique_mm      numeric(5,1) not null default 15,

  -- Températures
  temp_max_vigilance     integer not null default 30,
  temp_min_vigilance     integer not null default 2,

  alerte_orage           boolean not null default true,

  -- Conduites décidées à froid, affichées au moment du franchissement
  consigne_vigilance     text default 'Sécuriser bâches et structures légères, surveiller l''évolution, préparer la mise à l''abri.',
  consigne_critique      text default 'Évacuer les structures légères, interrompre les activités en hauteur, ouvrir les points de mise à l''abri.',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

comment on table veille_meteo is
  'Seuils de décision fixés à froid. Les valeurs par défaut sont des points de départ : elles ne remplacent ni les prescriptions du fabricant de structure, ni l''avis de la zone de secours.';

create trigger tracabilite_veille before insert or update on veille_meteo
  for each row execute function trg_tracabilite_simple();

alter table veille_meteo enable row level security;

create policy veille_lecture on veille_meteo for select to authenticated
  using (est_membre(evenement_id));
create policy veille_creation on veille_meteo for insert to authenticated
  with check (a_permission(evenement_id,'alertes','creer'));
create policy veille_modification on veille_meteo for update to authenticated
  using (a_permission(evenement_id,'alertes','creer'))
  with check (a_permission(evenement_id,'alertes','creer'));

-- Seuils par défaut pour les événements existants
insert into veille_meteo (evenement_id)
select id from evenements where deleted_at is null
on conflict (evenement_id) do nothing;

commit;;
