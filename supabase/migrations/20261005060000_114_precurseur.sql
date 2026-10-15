-- =====================================================================
-- 114 — PRÉCURSEUR (module livré par Ren le 05/10, fichier d'origine
-- `20261004_precurseur_module_eventware.sql`, repris tel quel sauf trois
-- retouches signalées « 114 : » plus bas) :
--
--   a. `prc_actualiser_grappes` prend un verrou par événement : deux
--      demandes clôturées au même instant recalculaient en parallèle et
--      la seconde heurtait la clé primaire de `prc_grappes_actives` —
--      ce qui aurait fait ÉCHOUER la clôture de la demande elle-même.
--   b. Le déclencheur sur `missions` ne peut plus jamais bloquer une
--      demande : une erreur du calcul devient un avertissement. Une
--      demande perdue au PC coûte plus qu'une grappe non signalée.
--   c. La ressource `precurseur` entre dans `matrice_permissions`
--      (coordinateur, toutes phases sauf clôture) : l'écran Rôles la
--      montre, et l'assertion du bloc A de droits.sql (« aucune policy
--      ne cite une ressource inconnue ») reste vraie.
--
-- Encadrée d'une transaction, comme les autres migrations du dépôt.
-- =====================================================================

begin;

-- =====================================================================
-- PRÉCURSEUR — module Eventware
-- La charge des lieux, calculée à partir des demandes logistique et sécurité.
--
-- Aucune saisie propre : les "grains" sont les MISSIONS existantes.
--   * une demande OUVERTE (a_traiter, attribuee, en_cours) pèse selon sa
--     priorité, davantage si elle dépasse son délai cible ou si elle est
--     bloquante ;
--   * une demande RÉSOLUE laisse un résidu qui s'estompe (demi-vie) :
--     cinq réappros au même bar en deux heures, c'est une zone sous tension
--     même si chacune a été traitée ;
--   * un lieu reporte sa charge sur les lieux qui en dépendent ;
--   * niveau 0..3 selon la capacité du lieu ; une GRAPPE = des lieux
--     dépendants tous au niveau >= 2 ; son apparition et sa disparition
--     s'écrivent dans la main courante.
--
-- Dépend du socle Eventware : evenements, lieux, missions, types_mission,
-- journal, a_permission(), est_membre(), journaliser(), trg_tracabilite().
-- Droits : lecture = a_permission(ev, 'missions', 'lire') ;
--          réglages = a_permission(ev, 'precurseur', creer|modifier|supprimer)
--          (le coordinateur, tout_pouvoir, a tout d'office).
-- Rejouable : peut être exécutée plusieurs fois.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Réglages (une ligne par événement, facultative : défauts sinon)
-- ---------------------------------------------------------------------
create table if not exists public.prc_reglages (
  evenement_id        uuid primary key references public.evenements(id) on delete cascade,
  modules             text[] not null default '{logistique,securite}',
  poids_bloquant      numeric not null default 1   check (poids_bloquant >= 0),
  facteur_retard      numeric not null default 1.5 check (facteur_retard >= 1),
  -- Une demande résolue garde cette part de son poids, puis s'estompe
  part_residu         numeric not null default 0.5 check (part_residu between 0 and 1),
  niveau_grappe       smallint not null default 2  check (niveau_grappe between 1 and 3),
  -- Ce qu'on appelle "incident" pour la mémoire des précurseurs
  modules_incident    text[] not null default '{securite}',
  priorites_incident  public.priorite_mission[] not null default '{P1}',
  fenetre_memoire_h   numeric not null default 3 check (fenetre_memoire_h > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  origine public.origine_donnee not null default 'humain'
);

alter table public.prc_reglages
  add column if not exists part_residu numeric not null default 0.5
  check (part_residu between 0 and 1);

-- Pondération par priorité. Absence de ligne = valeur par défaut :
--   P1 poids 3   délai 10 min  résidu demi-vie 2 h
--   P2 poids 2   délai 20 min  résidu demi-vie 1,5 h
--   P3 poids 1   délai 45 min  résidu demi-vie 1 h
--   P4 poids 0,5 délai 60 min  résidu demi-vie 0,5 h
-- demi_vie_residu_h NULL sur une ligne saisie = pas de résidu.
create table if not exists public.prc_ponderations (
  evenement_id       uuid not null references public.evenements(id) on delete cascade,
  priorite           public.priorite_mission not null,
  poids              numeric not null check (poids >= 0),
  delai_defaut_min   integer not null check (delai_defaut_min > 0),
  demi_vie_residu_h  numeric check (demi_vie_residu_h is null or demi_vie_residu_h > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  origine public.origine_donnee not null default 'humain',
  primary key (evenement_id, priorite)
);

-- ---------------------------------------------------------------------
-- 2. Capacité des lieux et dépendances entre lieux
-- ---------------------------------------------------------------------
-- Absence de ligne = capacité 3.
create table if not exists public.prc_capacites (
  lieu_id       uuid primary key references public.lieux(id) on delete cascade,
  evenement_id  uuid not null references public.evenements(id) on delete cascade,
  capacite      numeric(4,1) not null default 3 check (capacite > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  origine public.origine_donnee not null default 'humain'
);

-- "aval dépend de amont" : la charge propre d'amont se reporte sur aval × poids.
create table if not exists public.prc_dependances (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references public.evenements(id) on delete cascade,
  amont_lieu_id  uuid not null references public.lieux(id) on delete cascade,
  aval_lieu_id   uuid not null references public.lieux(id) on delete cascade,
  poids          numeric(3,2) not null default 0.5 check (poids > 0 and poids <= 1),
  note           text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  origine public.origine_donnee not null default 'humain',
  check (amont_lieu_id <> aval_lieu_id),
  unique (amont_lieu_id, aval_lieu_id)
);
create index if not exists prc_dependances_ev   on public.prc_dependances (evenement_id);
create index if not exists prc_dependances_aval on public.prc_dependances (aval_lieu_id);

-- Les lieux cités doivent appartenir à l'événement de la ligne.
create or replace function public.prc_verifier_lieux()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  if tg_table_name = 'prc_dependances' then
    v_ids := array[new.amont_lieu_id, new.aval_lieu_id];
  else
    v_ids := array[new.lieu_id];
  end if;
  if (select count(*) from lieux
      where id = any(v_ids) and evenement_id = new.evenement_id)
     <> cardinality(v_ids) then
    raise exception 'Précurseur : lieu hors de l''événement' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists prc_verif_lieux on public.prc_dependances;
create trigger prc_verif_lieux before insert or update on public.prc_dependances
  for each row execute function public.prc_verifier_lieux();
drop trigger if exists prc_verif_lieux on public.prc_capacites;
create trigger prc_verif_lieux before insert or update on public.prc_capacites
  for each row execute function public.prc_verifier_lieux();

-- Traçabilité du socle (created_by, updated_by, origine)
do $$
declare t text;
begin
  foreach t in array array['prc_reglages','prc_ponderations','prc_capacites','prc_dependances'] loop
    execute format('drop trigger if exists tracabilite_%1$s on public.%1$s', t);
    execute format('create trigger tracabilite_%1$s before insert or update on public.%1$s
                    for each row execute function public.trg_tracabilite()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Contribution de chaque demande (le "grain")
-- ---------------------------------------------------------------------
create or replace view public.prc_contributions
with (security_invoker = true) as
with defaut(priorite, poids, delai, demi_vie) as (
  values ('P1'::public.priorite_mission, 3::numeric,   10, 2.0::numeric),
         ('P2'::public.priorite_mission, 2::numeric,   20, 1.5::numeric),
         ('P3'::public.priorite_mission, 1::numeric,   45, 1.0::numeric),
         ('P4'::public.priorite_mission, 0.5::numeric, 60, 0.5::numeric)
)
select
  m.id            as mission_id,
  m.evenement_id,
  m.lieu_id,
  m.reference,
  m.titre,
  m.module,
  m.priorite,
  m.statut,
  m.bloquant,
  tm.libelle      as type_libelle,
  m.created_at,
  m.resolue_le,
  a.echeance      as echeance_effective,
  case when a.ouverte then 'ouverte' else 'residu' end as etat,
  (a.ouverte and now() > a.echeance)                   as en_retard,
  round(w.poids, 2)                                    as poids
from public.missions m
join defaut d on d.priorite = m.priorite
left join public.prc_ponderations p
       on p.evenement_id = m.evenement_id and p.priorite = m.priorite
left join public.prc_reglages r on r.evenement_id = m.evenement_id
left join public.types_mission tm on tm.id = m.type_id
cross join lateral (
  select
    m.statut in ('a_traiter','attribuee','en_cours')             as ouverte,
    coalesce(p.poids, d.poids)                                   as base,
    case when p.evenement_id is null then d.demi_vie
         else p.demi_vie_residu_h end                            as demi_vie,
    coalesce(m.echeance,
             m.created_at + make_interval(
               mins => coalesce(tm.delai_cible_min, p.delai_defaut_min, d.delai))) as echeance
) a
cross join lateral (
  select case
    when a.ouverte then
      a.base * (case when now() > a.echeance then coalesce(r.facteur_retard, 1.5) else 1 end)
      + (case when m.bloquant then coalesce(r.poids_bloquant, 1) else 0 end)
    when m.statut = 'resolue' and m.resolue_le is not null and a.demi_vie is not null then
      a.base * coalesce(r.part_residu, 0.5)
             * power(0.5, extract(epoch from (now() - m.resolue_le)) / 3600.0 / a.demi_vie)
    else 0
  end as poids
) w
where m.deleted_at is null
  and m.module = any(coalesce(r.modules, '{logistique,securite}'::text[]))
  and (a.ouverte
       or (m.statut = 'resolue' and m.resolue_le > now() - interval '48 hours'))
  and w.poids >= 0.05;

-- ---------------------------------------------------------------------
-- 4. Charge par lieu
-- ---------------------------------------------------------------------
create or replace view public.prc_charge_lieu
with (security_invoker = true) as
with propre as (
  select l.id as lieu_id,
         coalesce(sum(c.poids), 0)                               as charge_propre,
         count(c.mission_id) filter (where c.etat = 'ouverte')   as demandes_ouvertes,
         count(c.mission_id) filter (where c.en_retard)          as demandes_en_retard,
         count(c.mission_id) filter (where c.etat = 'residu')    as residus
  from public.lieux l
  left join public.prc_contributions c on c.lieu_id = l.id
  where l.deleted_at is null and l.actif
  group by l.id
),
induite as (
  select d.aval_lieu_id as lieu_id, sum(pr.charge_propre * d.poids) as charge_induite
  from public.prc_dependances d
  join propre pr on pr.lieu_id = d.amont_lieu_id
  group by d.aval_lieu_id
)
select
  l.id as lieu_id, l.evenement_id, l.code, l.nom, l.type, l.latitude, l.longitude,
  coalesce(k.capacite, 3)::numeric(4,1)                           as capacite,
  round(pr.charge_propre, 2)                                      as charge_propre,
  round(coalesce(i.charge_induite, 0), 2)                         as charge_induite,
  round(pr.charge_propre + coalesce(i.charge_induite, 0), 2)      as charge_totale,
  least(3, floor(3 * (pr.charge_propre + coalesce(i.charge_induite, 0))
                 / coalesce(k.capacite, 3)))::smallint            as niveau,
  pr.demandes_ouvertes, pr.demandes_en_retard, pr.residus
from public.lieux l
join propre pr on pr.lieu_id = l.id
left join induite i on i.lieu_id = l.id
left join public.prc_capacites k on k.lieu_id = l.id;

-- ---------------------------------------------------------------------
-- 5. Grappes
-- ---------------------------------------------------------------------
create or replace function public.prc_grappes(p_evenement uuid, p_niveau_min int default null)
returns table (grappe_id uuid, lieux uuid[], noms text[],
               charge_totale numeric, niveau_max smallint, taille int)
language sql stable security invoker set search_path = public, pg_temp
as $$
  with recursive seuil as (
    select coalesce(p_niveau_min,
                    (select niveau_grappe from prc_reglages where evenement_id = p_evenement),
                    2) as n
  ),
  chauds as (
    select c.lieu_id, c.nom, c.charge_totale, c.niveau
    from prc_charge_lieu c, seuil
    where c.evenement_id = p_evenement and c.niveau >= seuil.n
  ),
  aretes as (
    select d.amont_lieu_id as a, d.aval_lieu_id as b
    from prc_dependances d
    join chauds c1 on c1.lieu_id = d.amont_lieu_id
    join chauds c2 on c2.lieu_id = d.aval_lieu_id
    union
    select d.aval_lieu_id, d.amont_lieu_id
    from prc_dependances d
    join chauds c1 on c1.lieu_id = d.amont_lieu_id
    join chauds c2 on c2.lieu_id = d.aval_lieu_id
  ),
  atteint(origine, lieu) as (
    select lieu_id, lieu_id from chauds
    union
    select at.origine, ar.b from atteint at join aretes ar on ar.a = at.lieu
  ),
  composante as (
    select lieu, min(origine::text)::uuid as gid from atteint group by lieu
  )
  select co.gid,
         array_agg(ch.lieu_id order by ch.charge_totale desc),
         array_agg(ch.nom     order by ch.charge_totale desc),
         sum(ch.charge_totale),
         max(ch.niveau)::smallint,
         count(*)::int
  from composante co
  join chauds ch on ch.lieu_id = co.lieu
  group by co.gid
  having count(*) >= 2
  order by sum(ch.charge_totale) desc;
$$;

-- ---------------------------------------------------------------------
-- 6. Synthèse (les quatre cadrans du poste)
-- ---------------------------------------------------------------------
create or replace function public.prc_synthese(p_evenement uuid)
returns table (lieux_niveau_3 int, grappes int, demandes_ouvertes int,
               demandes_en_retard int, demandes_sans_lieu int, charge_totale numeric)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select
    (select count(*)::int from prc_charge_lieu where evenement_id = p_evenement and niveau = 3),
    (select count(*)::int from prc_grappes(p_evenement)),
    (select count(*)::int from prc_contributions where evenement_id = p_evenement and etat = 'ouverte'),
    (select count(*)::int from prc_contributions where evenement_id = p_evenement and en_retard),
    -- Une demande sans lieu ne charge aucune zone : à surveiller, c'est un angle mort.
    (select count(*)::int from prc_contributions
      where evenement_id = p_evenement and etat = 'ouverte' and lieu_id is null),
    (select coalesce(round(sum(charge_totale), 2), 0) from prc_charge_lieu where evenement_id = p_evenement);
$$;

-- ---------------------------------------------------------------------
-- 7. Mémoire : quelles demandes précèdent les incidents
--    Incident = mission d'un module/priorité "incident" (défaut : sécurité P1).
--    Précurseur = autre demande créée dans la fenêtre précédente (défaut 3 h)
--    sur le même lieu ou sur un lieu dont il dépend.
-- ---------------------------------------------------------------------
create or replace view public.prc_memoire_liens
with (security_invoker = true) as
select
  i.evenement_id,
  i.id         as incident_id,
  i.reference  as incident_ref,
  i.titre      as incident_titre,
  i.created_at as incident_le,
  p.id         as precurseur_id,
  p.reference  as precurseur_ref,
  p.module     as precurseur_module,
  p.priorite   as precurseur_priorite,
  coalesce(tm.libelle,
           case p.module when 'securite' then 'Sécurité' when 'logistique' then 'Logistique'
                         else initcap(p.module) end || ' ' || p.priorite) as precurseur_type,
  case when p.lieu_id = i.lieu_id then 'meme_lieu' else 'lieu_amont' end as relation,
  round(extract(epoch from (i.created_at - p.created_at)) / 60)::int     as avance_min
from public.missions i
left join public.prc_reglages r on r.evenement_id = i.evenement_id
join public.missions p
  on p.evenement_id = i.evenement_id
 and p.id <> i.id
 and p.deleted_at is null
 and p.lieu_id is not null
 and p.module = any(coalesce(r.modules, '{logistique,securite}'::text[]))
 and p.created_at <  i.created_at
 and p.created_at >= i.created_at - make_interval(secs => coalesce(r.fenetre_memoire_h, 3) * 3600)
 and (p.lieu_id = i.lieu_id
      or exists (select 1 from public.prc_dependances d
                 where d.amont_lieu_id = p.lieu_id and d.aval_lieu_id = i.lieu_id))
left join public.types_mission tm on tm.id = p.type_id
where i.deleted_at is null
  and i.lieu_id is not null
  and i.statut <> 'annulee'
  and i.module   = any(coalesce(r.modules_incident,   '{securite}'::text[]))
  and i.priorite = any(coalesce(r.priorites_incident, '{P1}'::public.priorite_mission[]));

create or replace view public.prc_memoire_types
with (security_invoker = true) as
select evenement_id, precurseur_type,
       count(distinct incident_id) as incidents_precedes,
       count(*)                    as liens,
       round(avg(avance_min))::int as avance_moyenne_min
from public.prc_memoire_liens
group by evenement_id, precurseur_type;

-- ---------------------------------------------------------------------
-- 8. Grappes dans la main courante
-- ---------------------------------------------------------------------
create table if not exists public.prc_grappes_actives (
  evenement_id  uuid not null references public.evenements(id) on delete cascade,
  signature     text not null,             -- ids des lieux triés
  lieux         uuid[] not null,
  noms          text[] not null,
  charge        numeric not null,
  depuis        timestamptz not null default now(),
  primary key (evenement_id, signature)
);

create or replace function public.prc_actualiser_grappes(p_evenement uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  g        record;
  a        record;
  v_sig    text;
  v_vues   text[] := '{}';
  v_noms   text;
begin
  -- 114 : un calcul à la fois par événement (voir l'en-tête, point a).
  perform pg_advisory_xact_lock(hashtext('precurseur:' || p_evenement::text));

  if auth.uid() is not null and not est_membre(p_evenement) then
    raise exception 'Précurseur : vous n''êtes pas membre de cet événement'
      using errcode = '42501';
  end if;

  for g in select * from prc_grappes(p_evenement) loop
    v_sig  := array_to_string(array(select x::text from unnest(g.lieux) x order by 1), ',');
    v_vues := v_vues || v_sig;
    v_noms := array_to_string(g.noms, ' · ');

    if exists (select 1 from prc_grappes_actives
               where evenement_id = p_evenement and signature = v_sig) then
      update prc_grappes_actives set charge = g.charge_totale, noms = g.noms
       where evenement_id = p_evenement and signature = v_sig;

    elsif exists (select 1 from prc_grappes_actives
                  where evenement_id = p_evenement and lieux && g.lieux) then
      -- Une grappe connue a gagné ou perdu des lieux
      delete from prc_grappes_actives
       where evenement_id = p_evenement and lieux && g.lieux;
      insert into prc_grappes_actives (evenement_id, signature, lieux, noms, charge)
      values (p_evenement, v_sig, g.lieux, g.noms, g.charge_totale);
      perform journaliser(p_evenement, 'precurseur', 'grappe',
        'Grappe modifiée : ' || v_noms || ' (charge ' || round(g.charge_totale, 1) || ')',
        'majeur', 'grappe', null, null);

    else
      insert into prc_grappes_actives (evenement_id, signature, lieux, noms, charge)
      values (p_evenement, v_sig, g.lieux, g.noms, g.charge_totale);
      perform journaliser(p_evenement, 'precurseur', 'grappe',
        'Grappe détectée : ' || v_noms || ' (charge ' || round(g.charge_totale, 1) ||
        ') — risque de cascade', 'majeur', 'grappe', null, null);
    end if;
  end loop;

  for a in delete from prc_grappes_actives
           where evenement_id = p_evenement and not (signature = any(v_vues))
           returning * loop
    perform journaliser(p_evenement, 'precurseur', 'grappe',
      'Grappe résorbée : ' || array_to_string(a.noms, ' · ') ||
      ' (active depuis ' || to_char(a.depuis at time zone 'Europe/Brussels', 'HH24:MI') || ')',
      'notable', 'grappe', null, null);
  end loop;
end $$;

-- Recalcul à chaque mouvement d'une demande ou d'un réglage.
-- Les résidus s'estompent aussi avec le temps : le poste appelle
-- rpc('prc_actualiser_grappes') à son rafraîchissement (ex. toutes les 2 min).
-- Missions : seulement si un champ qui pèse sur la charge a changé.
create or replace function public.prc_trg_recalcul_mission()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.statut     is not distinct from old.statut
       and new.lieu_id    is not distinct from old.lieu_id
       and new.priorite   is not distinct from old.priorite
       and new.bloquant   is not distinct from old.bloquant
       and new.module     is not distinct from old.module
       and new.echeance   is not distinct from old.echeance
       and new.deleted_at is not distinct from old.deleted_at then
      return null;   -- rien qui change la charge
    end if;
  end if;
  -- 114 : le calcul ne bloque jamais la demande (voir l'en-tête, point b).
  begin
    perform prc_actualiser_grappes(new.evenement_id);
  exception when others then
    raise warning 'Précurseur : recalcul impossible pour %, demande enregistrée quand même (%)',
      new.evenement_id, sqlerrm;
  end;
  return null;
end $$;

-- Réglages, capacités, dépendances, pondérations.
create or replace function public.prc_trg_recalcul()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform prc_actualiser_grappes(old.evenement_id);
  else
    perform prc_actualiser_grappes(new.evenement_id);
  end if;
  return null;
end $$;

drop trigger if exists prc_recalcul on public.missions;
create trigger prc_recalcul after insert or update on public.missions
  for each row execute function public.prc_trg_recalcul_mission();

do $$
declare t text;
begin
  foreach t in array array['prc_reglages','prc_ponderations','prc_capacites','prc_dependances'] loop
    execute format('drop trigger if exists prc_recalcul on public.%I', t);
    execute format('create trigger prc_recalcul after insert or update or delete on public.%I
                    for each row execute function public.prc_trg_recalcul()', t);
  end loop;
end $$;

-- =====================================================================
-- 9. Sécurité
-- =====================================================================
alter table public.prc_reglages        enable row level security;
alter table public.prc_ponderations    enable row level security;
alter table public.prc_capacites       enable row level security;
alter table public.prc_dependances     enable row level security;
alter table public.prc_grappes_actives enable row level security;

do $$
declare t text;
begin
  foreach t in array array['prc_reglages','prc_ponderations','prc_capacites','prc_dependances'] loop
    execute format('drop policy if exists %1$s_lecture on public.%1$s', t);
    execute format('drop policy if exists %1$s_creation on public.%1$s', t);
    execute format('drop policy if exists %1$s_modification on public.%1$s', t);
    execute format('drop policy if exists %1$s_suppression on public.%1$s', t);
    execute format($p$create policy %1$s_lecture on public.%1$s for select to authenticated
      using (a_permission(evenement_id, 'missions', 'lire'))$p$, t);
    execute format($p$create policy %1$s_creation on public.%1$s for insert to authenticated
      with check (a_permission(evenement_id, 'precurseur', 'creer'))$p$, t);
    execute format($p$create policy %1$s_modification on public.%1$s for update to authenticated
      using (a_permission(evenement_id, 'precurseur', 'modifier'))
      with check (a_permission(evenement_id, 'precurseur', 'modifier'))$p$, t);
    execute format($p$create policy %1$s_suppression on public.%1$s for delete to authenticated
      using (a_permission(evenement_id, 'precurseur', 'supprimer'))$p$, t);
  end loop;
end $$;

drop policy if exists prc_grappes_actives_lecture on public.prc_grappes_actives;
create policy prc_grappes_actives_lecture on public.prc_grappes_actives
  for select to authenticated using (a_permission(evenement_id, 'missions', 'lire'));
-- Écriture uniquement par prc_actualiser_grappes (security definer).

grant select, insert, update, delete on public.prc_reglages, public.prc_ponderations,
  public.prc_capacites, public.prc_dependances to authenticated;
grant select on public.prc_grappes_actives, public.prc_contributions, public.prc_charge_lieu,
  public.prc_memoire_liens, public.prc_memoire_types to authenticated;

revoke all on function public.prc_actualiser_grappes(uuid) from public, anon;
grant execute on function public.prc_actualiser_grappes(uuid) to authenticated;
grant execute on function public.prc_grappes(uuid, int), public.prc_synthese(uuid) to authenticated;

-- Temps réel : le poste se met à jour quand une grappe naît ou se résorbe.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'prc_grappes_actives') then
    execute 'alter publication supabase_realtime add table public.prc_grappes_actives';
  end if;
end $$;

-- 114 : la ressource `precurseur` dans le modèle de matrice (point c).
insert into public.matrice_permissions (role, phase, ressource, action)
select 'coordinateur', ph::phase_evenement, 'precurseur', ac::action_permission
from unnest(array['preparation','montage','exploitation','demontage']) ph,
     unnest(array['lire','creer','modifier','supprimer']) ac
where not exists (select 1 from public.matrice_permissions m
                  where m.role = 'coordinateur' and m.phase = ph::phase_evenement
                    and m.ressource = 'precurseur' and m.action = ac::action_permission);

commit;
