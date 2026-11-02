-- =====================================================================
-- 154 — POULS DU QG : des seuils de prise en charge appris du passé
--
-- Constat sur le BFMF 2026 (68 demandes logistiques, heures réelles) :
--   · le QG n'a jamais saturé : jusqu'à 9 demandes ouvertes à la fois,
--     le délai de prise en charge ne dépend pas de la charge
--     (corrélation de rang −0,10) ni des temps morts (+0,07) ;
--   · P1 : médiane 5 min, 9 sur 10 prises en charge en 13 min ;
--   · le trou est ailleurs : 10 demandes n'ont aucune trace de prise en
--     charge, dont 4 P1 (jusqu'à 130 min entre création et clôture).
--     Personne ne les a vues attendre, parce que rien ne mesure
--     l'attente : `en_retard` (011) ne regarde que l'échéance, rarement
--     saisie.
--
-- Cette migration ajoute :
--   1. `seuils_prise_en_charge(organisation)` : pour chaque priorité, le
--      délai sous lequel 9 demandes sur 10 ont été prises en charge
--      lors des événements CLOS de l'organisation (attribution ou
--      démarrage, le premier des deux). Moins de 10 mesures : valeur par
--      défaut, signalée comme telle. Borné entre 3 et 240 min, et
--      jamais plus court que celui d'une priorité plus urgente.
--      Sur l'historique actuel (BFMF 2026) : P1 15 min, P2 32 min,
--      P3 32 min (26 appris, relevé au niveau de P2), P4 120 min (défaut).
--   2. `missions_en_souffrance(evenement)` : les demandes ouvertes, ni
--      attribuées ni démarrées, qui attendent depuis plus que ce seuil.
--      À afficher en tête du PC opérations, à rafraîchir chaque minute.
--      (Le module — sécurité ou logistique — est renvoyé pour ouvrir la
--      bonne liste depuis la Situation.)
--
-- Lecture seule, security invoker : la RLS des missions s'applique.
-- Rejouable.
-- =====================================================================

begin;

create or replace function public.seuils_prise_en_charge(p_organisation uuid)
returns table (priorite text, seuil_min integer, mesures integer, source text)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with defaut(priorite, seuil) as (values ('P1', 10), ('P2', 30), ('P3', 60), ('P4', 120)),
  passe as (
    select m.priorite::text as priorite,
           extract(epoch from least(m.attribuee_le, m.demarree_le) - m.created_at) / 60 as delai  -- least() ignore les null
      from missions m
      join evenements e on e.id = m.evenement_id
     where e.organisation_id = p_organisation
       and e.deleted_at is null
       and (e.archive or e.phase = 'cloture')
       and m.deleted_at is null
       and coalesce(m.attribuee_le, m.demarree_le) is not null
       and least(m.attribuee_le, m.demarree_le) >= m.created_at
  ),
  appris as (
    select p.priorite, count(*)::int as n,
           percentile_cont(0.9) within group (order by p.delai) as p90
      from passe p group by p.priorite
  ),
  brut as (
    select d.priorite,
           case when a.n >= 10 then least(240, greatest(3, ceil(a.p90)))::int else d.seuil end as seuil,
           coalesce(a.n, 0) as n,
           a.n >= 10 as est_appris
      from defaut d left join appris a using (priorite)
  )
  -- Une priorité moins urgente n'a jamais un seuil plus court que la précédente.
  select b.priorite,
         max(b.seuil) over (order by b.priorite rows unbounded preceding),
         b.n::int,
         case when b.est_appris and b.seuil >= max(b.seuil) over (order by b.priorite rows unbounded preceding)
                then 'appris : 9 demandes sur 10 prises en charge sous ce délai'
              when b.est_appris then 'appris, relevé au niveau de la priorité plus urgente'
              else 'par défaut : moins de 10 mesures dans les événements clos' end
    from brut b
   order by b.priorite;
$$;

create or replace function public.missions_en_souffrance(p_evenement uuid)
returns table (mission_id uuid, reference text, titre text, priorite text, module text,
               attente_min integer, seuil_min integer, depassement numeric)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select m.id, m.reference, m.titre, m.priorite::text, m.module::text,
         floor(extract(epoch from now() - m.created_at) / 60)::int,
         s.seuil_min,
         round((extract(epoch from now() - m.created_at) / 60 / s.seuil_min)::numeric, 1)
    from missions m
    join evenements e on e.id = m.evenement_id
    join seuils_prise_en_charge(e.organisation_id) s on s.priorite = m.priorite::text
   where m.evenement_id = p_evenement
     and m.deleted_at is null
     and m.statut = 'a_traiter'
     and m.attribuee_le is null and m.demarree_le is null
     and now() - m.created_at > make_interval(mins => s.seuil_min)
   order by m.priorite, m.created_at;
$$;

comment on function public.seuils_prise_en_charge(uuid) is
  'Délai de prise en charge (min) sous lequel 9 demandes sur 10 ont été prises en charge, par priorité, lors des événements clos de l''organisation. Valeur par défaut sous 10 mesures.';
comment on function public.missions_en_souffrance(uuid) is
  'Demandes à traiter, ni attribuées ni démarrées, qui attendent depuis plus que le seuil appris de leur priorité.';

revoke execute on function public.seuils_prise_en_charge(uuid), public.missions_en_souffrance(uuid) from public, anon;
grant  execute on function public.seuils_prise_en_charge(uuid), public.missions_en_souffrance(uuid) to authenticated;

commit;
