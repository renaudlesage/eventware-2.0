-- =====================================================================
-- Migration 050 : questionnaire, modèles de check-list, sessions
-- ---------------------------------------------------------------------
-- Le questionnaire répond aux critères qui déclenchent les items du
-- référentiel — quelles structures, quelles activités, quels risques.
-- Le bilan qui en sort n'est jamais stocké : il se recalcule à la
-- volée en croisant les réponses avec referentiel_items, pour ne
-- jamais afficher un bilan périmé après une modification du
-- référentiel ou des réponses.
--
-- Les check-lists, elles, reprennent le patron exact des quatre
-- documents 2026 : trois états par point (OK / à corriger / bloquant),
-- une synthèse chiffrée, une décision GO / GO sous réserve / NO-GO.
-- =====================================================================

begin;

create table conformite_reponses (
  evenement_id  uuid primary key references evenements(id) on delete cascade,
  reponses      jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

comment on table conformite_reponses is
  'Réponses au questionnaire de conformité — structures, activités et risques présents sur cet événement, plus les valeurs numériques (surfaces, distances) nécessaires au calcul des seuils.';

-- ---------------------------------------------------------------------
-- Modèles de check-list — le contenu FIXE, opérationnel, indépendant
-- du référentiel légal (repris des quatre documents BFMF 2026).
-- ---------------------------------------------------------------------
create table checklist_modeles (
  id      uuid primary key default gen_random_uuid(),
  code    text not null unique,   -- 'generale', 'police', 'pompiers', 'qg'
  libelle text not null,
  ordre   integer not null default 100
);

create table checklist_modele_items (
  id         uuid primary key default gen_random_uuid(),
  modele_id  uuid not null references checklist_modeles(id) on delete cascade,
  section    text not null,
  ordre_section integer not null,
  ordre_item integer not null,
  libelle    text not null
);

-- ---------------------------------------------------------------------
-- Une session = un contrôle réel, à une date et une heure données —
-- avant l'ouverture, ou avant chaque départ de balade. Reproduit
-- exactement l'en-tête des documents papier.
-- ---------------------------------------------------------------------
create type decision_ouverture as enum ('go', 'go_sous_reserve', 'no_go');

create table controles_sessions (
  id              uuid primary key default gen_random_uuid(),
  evenement_id    uuid not null references evenements(id) on delete cascade,
  modele_id       uuid not null references checklist_modeles(id),

  date_controle   date not null default current_date,
  sequence        text,             -- 'Jour 1 — avant balade 13h', 'Ouverture soirée'...
  heure_debut     timestamptz not null default clock_timestamp(),
  heure_fin       timestamptz,
  controleur      text,
  presences       jsonb default '{}'::jsonb,  -- {organisation, autorite}

  decision        decision_ouverture,
  mesures_compensatoires text,
  observation_libre text,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create table controles_lignes (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references controles_sessions(id) on delete cascade,
  section          text not null,
  ordre_section    integer not null default 100,
  ordre_item       integer not null default 100,
  libelle          text not null,

  -- Traçabilité : d'où vient cette ligne — un modèle fixe, ou un item
  -- du référentiel déclenché par le questionnaire.
  modele_item_id       uuid references checklist_modele_items(id),
  referentiel_item_id  uuid references referentiel_items(id),

  statut       text not null default 'a_faire',  -- a_faire, ok, a_corriger, bloquant
  observation  text,
  responsable  text,
  heure        timestamptz
);

create index idx_controles_lignes_session on controles_lignes(session_id);

alter table conformite_reponses enable row level security;
alter table checklist_modeles enable row level security;
alter table checklist_modele_items enable row level security;
alter table controles_sessions enable row level security;
alter table controles_lignes enable row level security;

create policy conformite_reponses_lecture on conformite_reponses for select to authenticated
  using (a_permission(evenement_id,'referentiels','creer'));
create policy conformite_reponses_ecriture on conformite_reponses for all to authenticated
  using (a_permission(evenement_id,'referentiels','creer'))
  with check (a_permission(evenement_id,'referentiels','creer'));

create policy checklist_modeles_lecture on checklist_modeles for select to authenticated using (true);
create policy checklist_modele_items_lecture on checklist_modele_items for select to authenticated using (true);

create policy controles_sessions_lecture on controles_sessions for select to authenticated
  using (a_permission(evenement_id,'referentiels','creer'));
create policy controles_sessions_ecriture on controles_sessions for all to authenticated
  using (a_permission(evenement_id,'referentiels','creer'))
  with check (a_permission(evenement_id,'referentiels','creer'));

create policy controles_lignes_lecture on controles_lignes for select to authenticated
  using (exists (select 1 from controles_sessions s
                 where s.id = controles_lignes.session_id
                   and a_permission(s.evenement_id,'referentiels','creer')));
create policy controles_lignes_ecriture on controles_lignes for all to authenticated
  using (exists (select 1 from controles_sessions s
                 where s.id = controles_lignes.session_id
                   and a_permission(s.evenement_id,'referentiels','creer')))
  with check (exists (select 1 from controles_sessions s
                       where s.id = controles_lignes.session_id
                         and a_permission(s.evenement_id,'referentiels','creer')));

-- ---------------------------------------------------------------------
-- Démarrer une session : copie les lignes du modèle fixe, PUIS ajoute
-- les lignes issues du référentiel dont la condition est remplie par
-- les réponses au questionnaire de cet événement.
-- ---------------------------------------------------------------------
create or replace function demarrer_controle(p_evenement uuid, p_modele_code text, p_sequence text default null)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_modele uuid;
  v_session uuid;
  v_reponses jsonb;
begin
  select id into v_modele from checklist_modeles where code = p_modele_code;
  if v_modele is null then
    raise exception 'Modèle de check-list inconnu : %', p_modele_code;
  end if;

  insert into controles_sessions (evenement_id, modele_id, sequence)
  values (p_evenement, v_modele, p_sequence)
  returning id into v_session;

  insert into controles_lignes (session_id, section, ordre_section, ordre_item, libelle, modele_item_id)
  select v_session, mi.section, mi.ordre_section, mi.ordre_item, mi.libelle, mi.id
  from checklist_modele_items mi
  where mi.modele_id = v_modele;

  -- Lignes légales : items dont la condition figure dans les réponses
  -- au questionnaire de l'événement, ou toujours applicables.
  select reponses into v_reponses from conformite_reponses where evenement_id = p_evenement;

  insert into controles_lignes (session_id, section, ordre_section, ordre_item, libelle, referentiel_item_id)
  select v_session, 'Exigences légales (référentiel)', 999,
         row_number() over (order by ri.code),
         ri.code || ' — ' || ri.titre,
         ri.id
  from referentiel_items ri
  join referentiels r on r.id = ri.referentiel_id and r.actif
  where ri.toujours_applicable
     or (v_reponses is not null and ri.condition_cle is not null
         and (v_reponses -> split_part(ri.condition_cle,'.',1) ? split_part(ri.condition_cle,'.',2)));

  return v_session;
end;
$$;

grant execute on function demarrer_controle(uuid, text, text) to authenticated;

commit;