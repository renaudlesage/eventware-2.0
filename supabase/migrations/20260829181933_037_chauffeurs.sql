-- =====================================================================
-- Migration 037 : chauffeurs comme catégorie de bénévole
-- ---------------------------------------------------------------------
-- Pas un rôle à part entière — un chauffeur reste bénévole, chef
-- d'équipe ou autre pour ses capacités. C'est une AFFECTATION en plus,
-- comme on rattache quelqu'un à une équipe. Deux personnes ne
-- deviennent pas incompatibles parce que l'une conduit et l'autre pas.
-- =====================================================================

alter table membres_evenement
  add column est_chauffeur boolean not null default false,
  add column type_vehicule text;

comment on column membres_evenement.est_chauffeur is
  'Peut se voir attribuer un transport. Catégorie, pas un rôle : un chauffeur garde ses capacités habituelles.';

-- ---------------------------------------------------------------------
-- Chauffeurs disponibles pour attribution — ceux qui n'ont pas déjà
-- une course en cours, pour ne pas proposer d'attribuer quelqu'un qui
-- roule déjà.
-- ---------------------------------------------------------------------
create or replace function chauffeurs_disponibles(p_evenement uuid)
returns table (
  membre_id uuid, nom text, type_vehicule text, en_course boolean
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.id, m.nom_affiche, m.type_vehicule,
         exists (
           select 1 from transports t
           where t.chauffeur_id = m.id and t.deleted_at is null
             and t.statut in ('attribuee','en_cours')
         )
  from membres_evenement m
  where m.evenement_id = p_evenement and m.est_chauffeur
    and m.actif and m.deleted_at is null
  order by m.nom_affiche;
$$;

grant execute on function chauffeurs_disponibles(uuid) to authenticated;