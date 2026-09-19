-- =====================================================================
-- Migration 020 : module ANALYSE / REX
--   1. rex_entrees   — constats remontés à chaud, pendant l'événement
--   2. rex_synthese  — métriques calculées sur les données réelles
--
-- Le REX 2026 a été produit à la main, trois semaines après, à partir
-- d'un export sans horodatage ni assignataire. Ici tout est déjà là.
-- =====================================================================

begin;

insert into matrice_permissions (role, phase, ressource, action)
select r, p, 'analyse', a
from unnest(array['coordinateur','chef_equipe','benevole']::role_evenement[]) r
cross join unnest(array['preparation','montage','exploitation','demontage','cloture']::phase_evenement[]) p
cross join unnest(array['lire','creer']::action_permission[]) a
on conflict do nothing;

insert into matrice_permissions (role, phase, ressource, action)
select 'coordinateur', p, 'analyse', a
from unnest(array['preparation','montage','exploitation','demontage','cloture']::phase_evenement[]) p
cross join unnest(array['modifier','supprimer']::action_permission[]) a
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. REX À CHAUD
-- Remontable depuis n'importe quel écran, par n'importe quel membre.
-- Un constat noté sur le moment vaut dix reconstitués de mémoire.
-- ---------------------------------------------------------------------
create type impact_rex as enum ('mineur','gene','bloquant','dangereux');
create type nature_rex as enum ('dysfonctionnement','reussite','suggestion','risque');

create table rex_entrees (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,

  nature        nature_rex not null default 'dysfonctionnement',
  module        text,
  constat       text not null,
  impact        impact_rex not null default 'gene',
  proposition   text,

  phase         phase_evenement,
  lieu_id       uuid references lieux(id) on delete set null,
  objet_type    text,
  objet_id      uuid,
  objet_ref     text,

  -- Suivi de la suite donnée, d'une édition à l'autre
  retenu        boolean,
  traite_le     timestamptz,
  suite         text,

  membre_id     uuid references membres_evenement(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_rex_ev on rex_entrees (evenement_id, created_at desc)
  where deleted_at is null;

create trigger tracabilite_rex before insert or update on rex_entrees
  for each row execute function trg_tracabilite_simple();

create or replace function trg_journal_rex()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.impact in ('bloquant','dangereux') then
    perform journaliser(new.evenement_id, 'analyse', 'rex',
      'REX ' || new.impact || ' : ' || new.constat,
      'notable'::importance_journal, 'rex', new.id, null);
  end if;
  return null;
end;
$$;

create trigger journal_rex after insert on rex_entrees
  for each row execute function trg_journal_rex();

alter table rex_entrees enable row level security;

create policy rex_lecture on rex_entrees for select to authenticated
  using (a_permission(evenement_id,'analyse','lire') and deleted_at is null);
create policy rex_creation on rex_entrees for insert to authenticated
  with check (a_permission(evenement_id,'analyse','creer'));
create policy rex_modification on rex_entrees for update to authenticated
  using (a_permission(evenement_id,'analyse','modifier'))
  with check (a_permission(evenement_id,'analyse','modifier'));

-- ---------------------------------------------------------------------
-- 2. SYNTHÈSE
-- Toutes les métriques que l'export BFMF 2026 ne permettait pas de
-- calculer, faute d'horodatage et d'assignataire.
-- ---------------------------------------------------------------------
create or replace function rex_synthese(p_evenement uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not est_membre(p_evenement) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select jsonb_build_object(

    'signalements', (
      select jsonb_build_object(
        'total', count(*),
        'par_type', coalesce(jsonb_object_agg(t.type, t.n) filter (where t.type is not null), '{}'::jsonb),
        'delai_median_prise_en_charge_min', (
          select round(percentile_cont(0.5) within group (
            order by extract(epoch from (pris_en_charge_le - recu_le))/60))
          from signalements
          where evenement_id = p_evenement and pris_en_charge_le is not null
        ),
        'sans_position', (
          select count(*) from signalements
          where evenement_id = p_evenement and latitude is null and deleted_at is null
        ),
        'minutes_file_attente_max', (
          select round(max(extract(epoch from (recu_le - emis_le))/60))
          from signalements where evenement_id = p_evenement and emis_le is not null
        )
      )
      from (
        select type::text as type, count(*) as n
        from signalements where evenement_id = p_evenement and deleted_at is null
        group by type
      ) t
    ),

    'missions', (
      select jsonb_build_object(
        'total', count(*),
        'ouvertes', count(*) filter (where statut not in ('resolue','annulee')),
        'annulees', count(*) filter (where statut = 'annulee'),
        'part_p1_pct', round(100.0 * count(*) filter (where priorite = 'P1')
                             / greatest(count(*), 1)),
        'delai_median_min', round(percentile_cont(0.5) within group (
                              order by delai_reel_min) filter (where delai_reel_min is not null)),
        'delai_max_min', max(delai_reel_min),
        'par_module', (
          select coalesce(jsonb_object_agg(m.module, m.n), '{}'::jsonb)
          from (select module, count(*) n from missions
                where evenement_id = p_evenement and deleted_at is null
                group by module) m
        ),
        'non_attribuees', count(*) filter (where equipe_id is null and membre_id is null
                                             and statut not in ('resolue','annulee'))
      )
      from missions where evenement_id = p_evenement and deleted_at is null
    ),

    'logistique', (
      select jsonb_build_object(
        'mouvements', (select count(*) from mouvements_stock where evenement_id = p_evenement),
        'articles_sous_seuil', (
          select count(*) from materiel
          where evenement_id = p_evenement and deleted_at is null
            and seuil_alerte is not null and quantite <= seuil_alerte
        ),
        'biens_non_rendus', (
          select count(*) from attributions
          where evenement_id = p_evenement and deleted_at is null and rendu_le is null
        ),
        'transports', (select count(*) from transports
                       where evenement_id = p_evenement and deleted_at is null),
        'jauge_max', (
          select coalesce(max(cumul), 0) from (
            select sum(case when sens='entree' then nombre else -nombre end)
                   over (order by horodatage) as cumul
            from comptages where evenement_id = p_evenement and deleted_at is null
          ) c
        )
      )
    ),

    'parcours', (
      select jsonb_build_object(
        'groupes', count(*),
        'arrives', count(*) filter (where statut = 'arrive'),
        'abandons', count(*) filter (where statut = 'abandon'),
        'passages', (select count(*) from passages where evenement_id = p_evenement),
        'groupes_sans_pointage', count(*) filter (where dernier_passage is null
                                                    and statut in ('parti','en_cours'))
      )
      from groupes where evenement_id = p_evenement and deleted_at is null
    ),

    'rh', (
      select jsonb_build_object(
        'creneaux', (select count(*) from creneaux
                     where evenement_id = p_evenement and deleted_at is null),
        'besoin_total', (select coalesce(sum(besoin),0) from creneaux
                         where evenement_id = p_evenement and deleted_at is null),
        'confirmes', count(*) filter (where statut in ('confirme','present')),
        'presents', count(*) filter (where statut = 'present'),
        'defections', count(*) filter (where statut in ('absent','annule')),
        'taux_presence_pct', round(100.0 * count(*) filter (where statut = 'present')
                                   / greatest(count(*) filter (where statut in ('confirme','present')), 1))
      )
      from affectations where evenement_id = p_evenement and deleted_at is null
    ),

    'journal', (
      select jsonb_build_object(
        'entrees', count(*),
        'saisies', count(*) filter (where source = 'saisie'),
        'automatiques', count(*) filter (where source = 'systeme'),
        'majeures', count(*) filter (where importance = 'majeur'),
        'debut', min(horodatage),
        'fin', max(horodatage)
      )
      from journal where evenement_id = p_evenement and deleted_at is null
    ),

    'rex', (
      select jsonb_build_object(
        'entrees', count(*),
        'bloquants', count(*) filter (where impact in ('bloquant','dangereux')),
        'par_nature', (
          select coalesce(jsonb_object_agg(n.nature, n.c), '{}'::jsonb)
          from (select nature::text as nature, count(*) c from rex_entrees
                where evenement_id = p_evenement and deleted_at is null
                group by nature) n
        )
      )
      from rex_entrees where evenement_id = p_evenement and deleted_at is null
    )

  ) into v;

  return v;
end;
$$;

grant execute on function rex_synthese(uuid) to authenticated;

commit;