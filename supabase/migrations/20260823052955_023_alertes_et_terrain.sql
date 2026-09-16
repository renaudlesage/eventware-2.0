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
