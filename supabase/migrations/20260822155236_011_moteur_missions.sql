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
