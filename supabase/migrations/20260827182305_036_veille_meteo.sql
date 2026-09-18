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
