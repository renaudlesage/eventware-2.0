-- ============ 009_module_securite ============
-- =====================================================================
-- Migration 009 : socle du module SÉCURITÉ
--   1. journal      — main courante, alimentée automatiquement
--   2. recherches   — personne recherchée / enfant perdu
--   3. fiches_reflexe — doctrine, conduites à tenir
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. JOURNAL (main courante)
-- Différence majeure avec la v18 : il n'est plus seulement saisi, il est
-- ALIMENTÉ par les autres modules. Le REX généré se construit dessus.
-- ---------------------------------------------------------------------

create type source_journal as enum ('saisie','systeme');

create type importance_journal as enum ('routine','notable','majeur');

create table journal (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,

  horodatage    timestamptz not null default clock_timestamp(),
  source        source_journal not null default 'saisie',
  module        text,                      -- sos, logistique, parcours…
  categorie     text,
  texte         text not null,
  importance    importance_journal not null default 'routine',

  -- Rattachement à l'objet d'origine, sans contrainte forte :
  -- le journal doit survivre à la suppression de ce qu'il raconte.
  objet_type    text,
  objet_id      uuid,
  objet_ref     text,                      -- référence lisible (SOS-K7M2, LOG-012)

  phase         phase_evenement,
  auteur        uuid references auth.users(id),
  auteur_nom    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_journal_ev on journal (evenement_id, horodatage desc)
  where deleted_at is null;
create index idx_journal_objet on journal (objet_type, objet_id);

comment on table journal is
  'Main courante. Une entrée systeme est écrite par trigger ; une entrée saisie vient d''un opérateur. Le REX se génère à partir d''ici.';

create trigger tracabilite_journal before insert or update on journal
  for each row execute function trg_tracabilite_simple();

-- Écriture automatique, hors RLS (appelée par des triggers)
create or replace function journaliser(
  p_evenement uuid, p_module text, p_categorie text, p_texte text,
  p_importance importance_journal default 'routine',
  p_objet_type text default null, p_objet_id uuid default null,
  p_objet_ref text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into journal (evenement_id, source, module, categorie, texte,
                       importance, objet_type, objet_id, objet_ref, phase, auteur)
  values (p_evenement, 'systeme', p_module, p_categorie, p_texte,
          p_importance, p_objet_type, p_objet_id, p_objet_ref,
          (select phase from evenements where id = p_evenement),
          auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- 2. RECHERCHES (personne recherchée / enfant perdu)
-- Objet distinct du signalement : données structurées, diffusion
-- prioritaire, et une clôture qui doit être explicite.
-- ---------------------------------------------------------------------

create type statut_recherche as enum ('en_cours','retrouve','clos');

create table recherches (
  id                uuid primary key default gen_random_uuid(),
  evenement_id      uuid not null references evenements(id) on delete cascade,
  reference         text not null,

  nom               text,
  age_approx        integer,
  description       text not null,        -- vêtements, signes distinctifs
  dernier_lieu      text,
  dernier_lieu_id   uuid references lieux(id) on delete set null,
  vu_a              timestamptz,

  accompagnant_nom  text,
  accompagnant_tel  text,
  point_regroupement text,

  statut            statut_recherche not null default 'en_cours',
  retrouve_le       timestamptz,
  retrouve_par      text,
  circonstances     text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  deleted_at        timestamptz,

  unique (evenement_id, reference)
);

create index idx_recherches_ev on recherches (evenement_id, statut)
  where deleted_at is null;

create trigger tracabilite_recherches before insert or update on recherches
  for each row execute function trg_tracabilite_simple();

-- ---------------------------------------------------------------------
-- 3. FICHES RÉFLEXE (doctrine)
-- Consultables par TOUT membre, en toute phase : une conduite à tenir
-- qu'on ne peut pas lire au moment voulu ne sert à rien.
-- ---------------------------------------------------------------------

create table fiches_reflexe (
  id           uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references evenements(id) on delete cascade,
  code         text not null,
  titre        text not null,
  categorie    text,
  declencheur  text,
  conduite     jsonb not null default '[]'::jsonb,   -- étapes ordonnées
  a_ne_pas_faire jsonb not null default '[]'::jsonb,
  contacts     text,
  ordre        integer not null default 100,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  deleted_at   timestamptz,
  origine      origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_fiches_ev on fiches_reflexe (evenement_id, ordre)
  where deleted_at is null;

create trigger tracabilite_fiches before insert or update on fiches_reflexe
  for each row execute function trg_tracabilite();

-- ---------------------------------------------------------------------
-- 4. ALIMENTATION AUTOMATIQUE DU JOURNAL
-- ---------------------------------------------------------------------

create or replace function trg_journal_signalement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' — ' || new.type ||
      coalesce(' : ' || new.description, ''),
      'notable', 'signalement', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' → ' || new.statut,
      case when new.statut in ('clos','sans_suite') then 'routine' else 'notable' end,
      'signalement', new.id, new.reference);
  end if;
  return null;
end;
$$;

create trigger journal_signalement after insert or update on signalements
  for each row execute function trg_journal_signalement();

create or replace function trg_journal_recherche()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'securite', 'recherche',
      'RECHERCHE ' || new.reference || ' — ' || coalesce(new.nom,'personne non identifiée') ||
      ' : ' || new.description, 'majeur', 'recherche', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'securite', 'recherche',
      'Recherche ' || new.reference || ' → ' || new.statut ||
      coalesce(' (' || new.circonstances || ')', ''),
      'majeur', 'recherche', new.id, new.reference);
  end if;
  return null;
end;
$$;

create trigger journal_recherche after insert or update on recherches
  for each row execute function trg_journal_recherche();

-- Bascule de phase : déjà tracée dans bascule_phase, on la porte aussi
-- au journal pour que la chronologie du REX soit complète.
create or replace function trg_journal_phase()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.phase is distinct from old.phase then
    perform journaliser(new.id, 'noyau', 'phase',
      'Passage en phase ' || new.phase, 'majeur', 'evenement', new.id, null);
  end if;
  return null;
end;
$$;

create trigger journal_phase after update on evenements
  for each row execute function trg_journal_phase();

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------

alter table journal         enable row level security;
alter table recherches      enable row level security;
alter table fiches_reflexe  enable row level security;

-- Journal : lecture toujours ouverte aux membres (règle R2), écriture
-- selon la matrice. Aucune modification ni suppression : une main
-- courante qui se réécrit ne vaut rien.
create policy journal_lecture on journal for select to authenticated
  using (a_permission(evenement_id,'journal','lire') and deleted_at is null);

create policy journal_creation on journal for insert to authenticated
  with check (a_permission(evenement_id,'journal','creer'));

-- Recherches : même urgence que le SOS, donc même ressource.
create policy recherches_lecture on recherches for select to authenticated
  using (a_permission(evenement_id,'sos','lire') and deleted_at is null);

create policy recherches_creation on recherches for insert to authenticated
  with check (a_permission(evenement_id,'sos','creer'));

create policy recherches_modification on recherches for update to authenticated
  using (a_permission(evenement_id,'sos','modifier'))
  with check (a_permission(evenement_id,'sos','modifier'));

-- Fiches réflexe : lecture par TOUT membre en toute phase, sans passer
-- par la matrice. Une doctrine illisible au moment voulu est inutile.
create policy fiches_lecture on fiches_reflexe for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);

create policy fiches_creation on fiches_reflexe for insert to authenticated
  with check (a_permission(evenement_id,'referentiels','creer'));

create policy fiches_modification on fiches_reflexe for update to authenticated
  using (a_permission(evenement_id,'referentiels','modifier'))
  with check (a_permission(evenement_id,'referentiels','modifier'));

commit;;

-- ============ 010_fix_cast_importance_journal ============
-- Défaut trouvé au test : une expression CASE renvoie du text, pas
-- l'énuméré importance_journal. La résolution de surcharge échoue et
-- tout changement de statut d'un signalement plantait.
-- Un littéral simple ('notable') passait, lui, car « unknown » se
-- résout vers l'énuméré. D'où un bug invisible à l'insertion.
create or replace function trg_journal_signalement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' — ' || new.type ||
      coalesce(' : ' || new.description, ''),
      'notable'::importance_journal, 'signalement', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' → ' || new.statut,
      (case when new.statut in ('clos','sans_suite') then 'routine' else 'notable' end)::importance_journal,
      'signalement', new.id, new.reference);
  end if;
  return null;
end;
$$;;

-- ============ 011_moteur_missions ============
-- =====================================================================
-- Migration 011 : moteur de missions
-- ---------------------------------------------------------------------
-- Un seul objet pour ce qui était éclaté en trois apps dans la v18 :
-- missions logistiques, équipe volante, équipe sanitaire. Le module
-- d'où vient la mission n'est qu'un attribut.
--
-- Sert aussi aux phases montage et démontage : même moteur, autre
-- temporalité. C'est ce qui évite d'écrire trois fois le même code.
-- =====================================================================

begin;

create type statut_mission as enum (
  'a_traiter','attribuee','en_cours','resolue','annulee'
);

create table missions (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references evenements(id) on delete cascade,
  reference      text not null,

  -- Module d'origine : securite, logistique, sanitaire, parcours, rh…
  module         text not null default 'logistique',
  type_id        uuid references types_mission(id) on delete set null,
  titre          text not null,
  description    text,

  priorite       priorite_mission not null default 'P3',
  statut         statut_mission not null default 'a_traiter',

  -- Affectation : à une équipe, à une personne, ou aux deux
  equipe_id      uuid references equipes(id) on delete set null,
  membre_id      uuid references membres_evenement(id) on delete set null,

  lieu_id        uuid references lieux(id) on delete set null,
  latitude       double precision,
  longitude      double precision,

  -- Phase de vie : une mission de montage ne se mélange pas à
  -- l'exploitation dans les listes ni dans le REX
  phase          phase_evenement,

  -- Origine : mission née d'un signalement participant, d'un QR
  -- terrain, ou créée à la main
  signalement_id uuid references signalements(id) on delete set null,

  echeance       timestamptz,
  attribuee_le   timestamptz,
  demarree_le    timestamptz,
  resolue_le     timestamptz,
  resolution     text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  deleted_at     timestamptz,
  origine        origine_donnee not null default 'humain',

  unique (evenement_id, reference)
);

create index idx_missions_ev on missions (evenement_id, statut, priorite)
  where deleted_at is null;
create index idx_missions_equipe on missions (equipe_id) where deleted_at is null;
create index idx_missions_membre on missions (membre_id) where deleted_at is null;
create index idx_missions_phase on missions (evenement_id, phase) where deleted_at is null;

create trigger tracabilite_missions before insert or update on missions
  for each row execute function trg_tracabilite();

-- ---------------------------------------------------------------------
-- Référence lisible par module : LOG-012, SEC-004, SAN-003
-- ---------------------------------------------------------------------
create or replace function trg_reference_mission()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  v_prefixe text;
  v_n int;
begin
  if new.reference is not null and new.reference <> '' then
    return new;
  end if;
  v_prefixe := upper(substr(coalesce(new.module,'mis'), 1, 3));
  select coalesce(max(substring(reference from '[0-9]+$')::int), 0) + 1
    into v_n
  from missions
  where evenement_id = new.evenement_id
    and reference like v_prefixe || '-%';
  new.reference := v_prefixe || '-' || lpad(v_n::text, 3, '0');
  return new;
end;
$$;

create trigger reference_mission before insert on missions
  for each row execute function trg_reference_mission();

-- ---------------------------------------------------------------------
-- Horodatage automatique du cycle de vie
-- ---------------------------------------------------------------------
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

create trigger cycle_mission before update on missions
  for each row execute function trg_cycle_mission();

-- ---------------------------------------------------------------------
-- Alimentation du journal
-- ---------------------------------------------------------------------
create or replace function trg_journal_mission()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, new.module, 'mission',
      'Mission ' || new.reference || ' [' || new.priorite || '] ' || new.titre,
      (case when new.priorite in ('P1','P2') then 'majeur' else 'routine' end)::importance_journal,
      'mission', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, new.module, 'mission',
      'Mission ' || new.reference || ' → ' || new.statut ||
      coalesce(' : ' || new.resolution, ''),
      (case when new.priorite in ('P1','P2') then 'notable' else 'routine' end)::importance_journal,
      'mission', new.id, new.reference);
  end if;
  return null;
end;
$$;

create trigger journal_mission after insert or update on missions
  for each row execute function trg_journal_mission();

-- ---------------------------------------------------------------------
-- Vue de pilotage : ce qui est ouvert, par priorité et par ancienneté
-- ---------------------------------------------------------------------
create or replace view v_missions_ouvertes as
select m.*,
       e.nom  as equipe_nom,
       l.nom  as lieu_nom,
       mb.nom_affiche as affecte_a,
       round(extract(epoch from (clock_timestamp() - m.created_at))/60)::int as age_min,
       (m.echeance is not null and m.echeance < clock_timestamp()) as en_retard
from missions m
left join equipes e on e.id = m.equipe_id
left join lieux l on l.id = m.lieu_id
left join membres_evenement mb on mb.id = m.membre_id
where m.deleted_at is null
  and m.statut in ('a_traiter','attribuee','en_cours');

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table missions enable row level security;

create policy missions_lecture on missions for select to authenticated
  using (a_permission(evenement_id,'missions','lire') and deleted_at is null);

create policy missions_creation on missions for insert to authenticated
  with check (a_permission(evenement_id,'missions','creer'));

-- Un bénévole peut faire avancer SA mission, sans en modifier d'autres.
create policy missions_modification on missions for update to authenticated
  using (
    a_permission(evenement_id,'missions','modifier')
    and (
      role_dans(evenement_id) in ('admin','coordinateur','chef_equipe')
      or membre_id in (
        select id from membres_evenement
        where evenement_id = missions.evenement_id and user_id = auth.uid()
      )
    )
  )
  with check (a_permission(evenement_id,'missions','modifier'));

commit;;

-- ============ 012_signalement_lieu_et_conversion ============
-- =====================================================================
-- Migration 012 : QR par lieu + conversion signalement → mission
-- ---------------------------------------------------------------------
-- Reprend le principe du « signalement sanitaire » de la v18 : un QR
-- par bloc sanitaire, qui pré-remplit le lieu. Généralisé à n'importe
-- quel point du dispositif.
-- =====================================================================

begin;

-- Version enrichie du dépôt public : accepte un code de lieu, issu du QR.
create or replace function creer_signalement(
  p_jeton       uuid,
  p_cle_client  uuid,
  p_type        text default 'autre',
  p_description text default null,
  p_contact     text default null,
  p_latitude    double precision default null,
  p_longitude   double precision default null,
  p_precision_m double precision default null,
  p_emis_le     timestamptz default null,
  p_code_lieu   text default null
)
returns table (reference text, statut text, recu_le timestamptz)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_evenement uuid;
  v_phase     phase_evenement;
  v_modules   jsonb;
  v_existant  signalements%rowtype;
  v_ref       text;
  v_lieu      uuid;
  v_lat       double precision := p_latitude;
  v_lon       double precision := p_longitude;
begin
  select e.id, e.phase, e.modules into v_evenement, v_phase, v_modules
  from evenements e
  where e.jeton_public = p_jeton and e.deleted_at is null;

  if v_evenement is null then
    raise exception 'Événement inconnu' using errcode = 'P0002';
  end if;

  if coalesce((v_modules->>'sos_participants')::boolean, false) = false then
    raise exception 'Le signalement participant n''est pas activé sur cet événement'
      using errcode = 'P0003';
  end if;

  if v_phase not in ('montage','exploitation','demontage') then
    raise exception 'L''événement n''est pas en cours' using errcode = 'P0004';
  end if;

  select * into v_existant from signalements s
  where s.evenement_id = v_evenement and s.cle_client = p_cle_client;

  if found then
    return query select v_existant.reference, v_existant.statut::text, v_existant.recu_le;
    return;
  end if;

  -- QR posé sur un point précis : le lieu prime sur un GPS imprécis
  if p_code_lieu is not null then
    select id, coalesce(v_lat, latitude), coalesce(v_lon, longitude)
      into v_lieu, v_lat, v_lon
    from lieux
    where evenement_id = v_evenement and code = p_code_lieu and deleted_at is null;
  end if;

  if p_type not in ('malaise','blessure','danger','materiel','egare','autre') then
    p_type := 'autre';
  end if;

  v_ref := generer_reference_sos(v_evenement);

  insert into signalements (
    evenement_id, reference, cle_client, type, description, contact,
    latitude, longitude, precision_m, emis_le, lieu_id
  ) values (
    v_evenement, v_ref, p_cle_client, p_type::type_signalement,
    nullif(trim(coalesce(p_description,'')), ''),
    nullif(trim(coalesce(p_contact,'')), ''),
    v_lat, v_lon, p_precision_m,
    coalesce(p_emis_le, clock_timestamp()), v_lieu
  );

  return query select s.reference, s.statut::text, s.recu_le
  from signalements s
  where s.evenement_id = v_evenement and s.cle_client = p_cle_client;
end;
$$;

revoke all on function creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) from public;

grant execute on function creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Conversion d'un signalement en mission.
-- Le lien est conservé : le participant continue de suivre son
-- signalement pendant que l'équipe travaille sur la mission.
-- ---------------------------------------------------------------------
create or replace function convertir_signalement_en_mission(
  p_signalement uuid,
  p_module      text default 'securite',
  p_priorite    text default 'P2',
  p_equipe      uuid default null
)
returns missions
language plpgsql volatile security invoker
set search_path = public, pg_temp
as $$
declare
  s signalements%rowtype;
  m missions%rowtype;
begin
  select * into s from signalements where id = p_signalement;
  if not found then
    raise exception 'Signalement introuvable' using errcode = 'P0002';
  end if;

  insert into missions (
    evenement_id, module, titre, description, priorite,
    lieu_id, latitude, longitude, equipe_id, signalement_id,
    phase, statut
  ) values (
    s.evenement_id, p_module,
    'Signalement ' || s.reference || ' — ' || s.type,
    s.description, p_priorite::priorite_mission,
    s.lieu_id, s.latitude, s.longitude, p_equipe, s.id,
    (select phase from evenements where id = s.evenement_id),
    case when p_equipe is null then 'a_traiter' else 'attribuee' end
  )
  returning * into m;

  update signalements set statut = 'pris_en_charge' where id = s.id;

  return m;
end;
$$;

grant execute on function convertir_signalement_en_mission(uuid, text, text, uuid)
  to authenticated;

commit;;

-- ============ 013_fix_cast_statut_mission ============
-- Même défaut qu'en 010 : une expression CASE produit du text là où un
-- énuméré est attendu. Postgres ne fait pas la conversion implicite.
-- Règle à appliquer partout : tout CASE alimentant une colonne énumérée
-- doit être casté explicitement.
create or replace function convertir_signalement_en_mission(
  p_signalement uuid,
  p_module      text default 'securite',
  p_priorite    text default 'P2',
  p_equipe      uuid default null
)
returns missions
language plpgsql volatile security invoker
set search_path = public, pg_temp
as $$
declare
  s signalements%rowtype;
  m missions%rowtype;
begin
  select * into s from signalements where id = p_signalement;
  if not found then
    raise exception 'Signalement introuvable' using errcode = 'P0002';
  end if;

  insert into missions (
    evenement_id, module, titre, description, priorite,
    lieu_id, latitude, longitude, equipe_id, signalement_id,
    phase, statut
  ) values (
    s.evenement_id, p_module,
    'Signalement ' || s.reference || ' — ' || s.type,
    s.description, p_priorite::priorite_mission,
    s.lieu_id, s.latitude, s.longitude, p_equipe, s.id,
    (select phase from evenements where id = s.evenement_id),
    (case when p_equipe is null then 'a_traiter' else 'attribuee' end)::statut_mission
  )
  returning * into m;

  update signalements set statut = 'pris_en_charge' where id = s.id;

  return m;
end;
$$;

grant execute on function convertir_signalement_en_mission(uuid, text, text, uuid)
  to authenticated;;

-- ============ 014_phase_mission_par_defaut ============
-- Une mission naît dans la phase courante de l'événement.
-- Sans cela, les missions créées à la main sortent sans phase et le tri
-- montage / exploitation / démontage devient impossible au REX.
create or replace function trg_reference_mission()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  v_prefixe text;
  v_n int;
begin
  if new.phase is null then
    new.phase := (select phase from evenements where id = new.evenement_id);
  end if;

  if new.reference is not null and new.reference <> '' then
    return new;
  end if;

  v_prefixe := upper(substr(coalesce(new.module,'mis'), 1, 3));
  select coalesce(max(substring(reference from '[0-9]+$')::int), 0) + 1
    into v_n
  from missions
  where evenement_id = new.evenement_id
    and reference like v_prefixe || '-%';
  new.reference := v_prefixe || '-' || lpad(v_n::text, 3, '0');
  return new;
end;
$$;

update missions set phase = (select phase from evenements where id = missions.evenement_id)
where phase is null;;
