-- =====================================================================
-- 122 — LA BOUCLE DE RETOUR : ACCUSÉS, ACQUITTEMENT, CYCLE SOS
--
-- Lot 2 du comparatif BFMF 2026 → Eventware 2.0 (17/10). Ce que BFMF
-- faisait et qu'Eventware ne faisait plus : savoir QUI a lu une
-- consigne, distinguer « vu, pris en compte » de « levée », et dater
-- le moyen en route et son arrivée sur un SOS participant.
--
--   1. alertes_accuses — un accusé de lecture nominatif par membre et
--      par alerte (« Bien reçu », bouton du bandeau). Unique par
--      couple : relire n'est pas ré-accuser.
--   2. alertes.acquittee_le / acquittee_par — le PC a vu et pris en
--      compte, sans lever. Une alerte levée est finie ; une alerte
--      acquittée est en traitement.
--   3. signalements.en_route_le / arrive_le — « moyen en route » est
--      posé par le PC (colonne), « sur place » par le passage en
--      en_cours (déclencheur). Le participant les lit par
--      suivre_signalement, dont le type de retour change (drop +
--      create, droits anon regranés).
--   4. situation() — les alertes portent id, message, accusés
--      (nominatifs) et acquittement ; la logistique porte les six
--      prochains transports ; le parcours porte les groupes dehors et
--      les personnes en attente / rentrées.
--   5. situation_autorite() — les alertes portent le nombre d'accusés
--      (jamais les noms) et l'acquittement ; les signalements portent
--      en_route_le / arrive_le ; le compteur de consultations ne
--      s'incrémente plus à chaque rafraîchissement de 20 s mais une
--      fois par visite (10 min sans accès).
--
-- Idempotente sur les DDL (if not exists) ; les fonctions sont
-- redéfinies en entier.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Accusés de lecture
-- ---------------------------------------------------------------------
create table if not exists public.alertes_accuses (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references public.evenements(id) on delete cascade,
  alerte_id     uuid not null references public.alertes(id) on delete cascade,
  membre_id     uuid not null references public.membres_evenement(id) on delete cascade,
  accuse_le     timestamptz not null default clock_timestamp(),
  unique (alerte_id, membre_id)
);

create index if not exists idx_alertes_accuses_alerte on public.alertes_accuses (alerte_id);

comment on table public.alertes_accuses is
  'Accusé de lecture nominatif d''une alerte (« Bien reçu »). Un par membre et par alerte.';

alter table public.alertes_accuses enable row level security;

-- Tout membre voit qui a accusé (c'est le but : le PC sait qui a lu).
-- On n'accuse que pour soi-même.
drop policy if exists alertes_accuses_lecture on public.alertes_accuses;
create policy alertes_accuses_lecture on public.alertes_accuses for select to authenticated
  using (est_membre(evenement_id));
drop policy if exists alertes_accuses_creation on public.alertes_accuses;
create policy alertes_accuses_creation on public.alertes_accuses for insert to authenticated
  with check (
    est_membre(evenement_id)
    and exists (select 1 from membres_evenement m
                where m.id = membre_id and m.user_id = auth.uid()
                  and m.evenement_id = alertes_accuses.evenement_id)
  );

grant select, insert on public.alertes_accuses to authenticated;

-- ---------------------------------------------------------------------
-- 2. Acquittement d'une alerte par le PC
-- ---------------------------------------------------------------------
alter table public.alertes
  add column if not exists acquittee_le  timestamptz,
  add column if not exists acquittee_par uuid references auth.users(id);

comment on column public.alertes.acquittee_le is
  'Le PC a vu et pris en compte, sans lever. Distinct de levee_le : acquittée = en traitement, levée = finie.';

-- Qui a acquitté : posé côté base, comme levee_par (023).
create or replace function public.trg_cycle_alerte()
returns trigger language plpgsql as $$
begin
  if old.active and not new.active and new.levee_le is null then
    new.levee_le := clock_timestamp();
    new.levee_par := auth.uid();
  end if;
  if new.acquittee_le is not null and old.acquittee_le is null then
    new.acquittee_par := coalesce(auth.uid(), new.acquittee_par);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Cycle SOS : moyen en route, sur place
-- ---------------------------------------------------------------------
alter table public.signalements
  add column if not exists en_route_le timestamptz,
  add column if not exists arrive_le   timestamptz;

comment on column public.signalements.en_route_le is
  'Un moyen est parti vers le signalement. Posé par le PC (bouton « Moyen en route »), le statut reste pris_en_charge.';
comment on column public.signalements.arrive_le is
  'Le moyen est sur place. Posé par le déclencheur au passage en en_cours.';

create or replace function public.trg_statut_signalement()
returns trigger language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'pris_en_charge' and new.pris_en_charge_le is null then
      new.pris_en_charge_le := clock_timestamp();
    end if;
    -- « En cours » = sur place. Un moyen qui arrive sans être passé
    -- par « en route » : on pose les deux, le cycle reste lisible.
    if new.statut = 'en_cours' then
      if new.pris_en_charge_le is null then new.pris_en_charge_le := clock_timestamp(); end if;
      if new.en_route_le is null then new.en_route_le := clock_timestamp(); end if;
      if new.arrive_le is null then new.arrive_le := clock_timestamp(); end if;
    end if;
    if new.statut in ('clos','sans_suite') and new.clos_le is null then
      new.clos_le := clock_timestamp();
    end if;
    new.traite_par := coalesce(auth.uid(), new.traite_par);
  end if;
  -- « Moyen en route » posé sans changement de statut : on note aussi
  -- qui l'a fait.
  if new.en_route_le is not null and old.en_route_le is null then
    new.traite_par := coalesce(auth.uid(), new.traite_par);
  end if;
  return new;
end;
$$;

-- Le participant lit les quatre temps. Le type de retour change :
-- drop + create, et les droits de 090 sont reposés (anon y a droit,
-- c'est le parcours participant par jeton).
drop function if exists public.suivre_signalement(uuid, uuid);
create function public.suivre_signalement(
  p_jeton      uuid,
  p_cle_client uuid
)
returns table (
  reference text, statut text, recu_le timestamptz, pris_en_charge_le timestamptz,
  en_route_le timestamptz, arrive_le timestamptz, clos_le timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.reference, s.statut::text, s.recu_le, s.pris_en_charge_le,
         s.en_route_le, s.arrive_le, s.clos_le
  from signalements s
  join evenements e on e.id = s.evenement_id
  where e.jeton_public = p_jeton
    and s.cle_client = p_cle_client
    and s.deleted_at is null;
$$;
revoke execute on function public.suivre_signalement(uuid, uuid) from public;
grant execute on function public.suivre_signalement(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. situation() — redéfinie en entier (base : 069)
-- ---------------------------------------------------------------------
create or replace function public.situation(p_evenement uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if not est_membre(p_evenement) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select jsonb_build_object(

    'evenement', (
      select jsonb_build_object(
        'nom', e.nom, 'phase', e.phase, 'geometrie', e.geometrie,
        'modules', e.modules, 'date_debut', e.date_debut, 'date_fin', e.date_fin)
      from evenements e where e.id = p_evenement
    ),

    -- (122) Avec le message, l'acquittement et les accusés nominatifs :
    -- le PC doit lire la consigne et savoir qui l'a lue.
    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'niveau', a.niveau, 'titre', a.titre, 'message', a.message,
        'consigne', a.consigne, 'emise_le', a.emise_le,
        'acquittee_le', a.acquittee_le,
        'acquittee_par', (select m.nom_affiche from membres_evenement m
                          where m.user_id = a.acquittee_par and m.evenement_id = p_evenement limit 1),
        'accuses', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'nom', coalesce(m.nom_affiche, 'membre sans nom'), 'accuse_le', ac.accuse_le)
            order by ac.accuse_le), '[]'::jsonb)
          from alertes_accuses ac
          left join membres_evenement m on m.id = ac.membre_id
          where ac.alerte_id = a.id),
        -- Le dénominateur : les membres actifs, hors retirés.
        'membres_actifs', (select count(*) from membres_evenement m
                           where m.evenement_id = p_evenement and m.actif and m.deleted_at is null)
        ) order by a.emise_le desc), '[]'::jsonb)
      from alertes a
      where a.evenement_id = p_evenement and a.active and a.deleted_at is null
    ),

    'signalements', (
      select jsonb_build_object(
        'ouverts', count(*) filter (where statut in ('recu','pris_en_charge','en_cours')),
        'non_pris_en_charge', count(*) filter (where statut = 'recu'),
        'total', count(*),
        'derniers', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'reference', s.reference, 'type', s.type, 'statut', s.statut,
            'description', s.description, 'recu_le', s.recu_le,
            'latitude', s.latitude, 'longitude', s.longitude)
            order by s.recu_le desc), '[]'::jsonb)
          from (select * from signalements
                where evenement_id = p_evenement and deleted_at is null
                  and statut in ('recu','pris_en_charge','en_cours')
                order by recu_le desc limit 8) s
        ))
      from signalements
      where evenement_id = p_evenement and deleted_at is null
    ),

    'missions', (
      select jsonb_build_object(
        'ouvertes', count(*) filter (where statut not in ('resolue','annulee')),
        'p1', count(*) filter (where priorite = 'P1' and statut not in ('resolue','annulee')),
        'non_attribuees', count(*) filter (where equipe_id is null and membre_id is null
                                             and statut not in ('resolue','annulee')),
        'resolues', count(*) filter (where statut = 'resolue'),
        'par_statut', (
          select coalesce(jsonb_object_agg(x.statut, x.n), '{}'::jsonb)
          from (select statut::text as statut, count(*) n from missions
                where evenement_id = p_evenement and deleted_at is null
                  and statut not in ('resolue','annulee')
                group by statut) x),
        -- Ventilation : chaque colonne de domaine compte ses propres
        -- demandes au lieu d'afficher le total de tout le monde.
        'par_module', (
          select coalesce(jsonb_object_agg(y.module, jsonb_build_object(
            'ouvertes', y.ouvertes, 'p1', y.p1, 'non_attribuees', y.non_attribuees)), '{}'::jsonb)
          from (select module::text as module,
                  count(*) filter (where statut not in ('resolue','annulee'))::int as ouvertes,
                  count(*) filter (where priorite = 'P1'
                                     and statut not in ('resolue','annulee'))::int as p1,
                  count(*) filter (where equipe_id is null and membre_id is null
                                     and statut not in ('resolue','annulee'))::int as non_attribuees
                from missions
                where evenement_id = p_evenement and deleted_at is null
                group by module) y))
      from missions where evenement_id = p_evenement and deleted_at is null
    ),

    'parcours', (
      select jsonb_build_object(
        'en_route', count(*) filter (where statut in ('parti','en_cours')),
        'arrives', count(*) filter (where statut = 'arrive'),
        'abandons', count(*) filter (where statut = 'abandon'),
        'personnes_sur_parcours', coalesce(sum(coalesce(effectif_reel, effectif_prevu))
                                   filter (where statut in ('parti','en_cours')), 0),
        'sans_nouvelles', (select count(*) from groupes_sans_nouvelles(p_evenement, 45)),
        -- (122) Ce que BFMF affichait en cadrans et qu'on ne comptait
        -- pas : qui attend encore au départ, qui est rentré.
        'personnes_en_attente', coalesce(sum(coalesce(effectif_reel, effectif_prevu))
                                  filter (where statut = 'inscrit'), 0),
        'personnes_rentrees', coalesce(sum(coalesce(effectif_reel, effectif_prevu))
                                 filter (where statut = 'arrive'), 0),
        -- (122) Chaque groupe dehors, pour le moniteur Parcours de la
        -- Situation (la colonne tactique ne vit qu'à partir de 1440 px).
        'groupes', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', g.id, 'code', g.code, 'nom', g.nom,
            'effectif', coalesce(g.effectif_reel, g.effectif_prevu),
            'statut', g.statut,
            'dernier_lieu', l.nom, 'dernier_passage', g.dernier_passage,
            'sans_nouvelles', exists (select 1 from groupes_sans_nouvelles(p_evenement, 45) n
                                      where n.groupe_id = g.id))
            order by l.pk_km nulls first, g.code), '[]'::jsonb)
          from groupes g
          left join lieux l on l.id = g.dernier_lieu_id
          where g.evenement_id = p_evenement and g.deleted_at is null
            and g.statut in ('parti','en_cours')))
      from groupes where evenement_id = p_evenement and deleted_at is null
    ),

    'logistique', jsonb_build_object(
      'jauge', jauge_courante(p_evenement),
      'sous_seuil', (select coalesce(jsonb_agg(jsonb_build_object(
          'nom', m.nom, 'quantite', m.quantite, 'unite', m.unite,
          'seuil', m.seuil_alerte) order by m.nom), '[]'::jsonb)
        from materiel m
        where m.evenement_id = p_evenement and m.deleted_at is null
          and m.seuil_alerte is not null and m.quantite <= m.seuil_alerte),
      'transports_ouverts', (select count(*) from transports
        where evenement_id = p_evenement and deleted_at is null
          and statut not in ('resolue','annulee')),
      -- (122) Les six prochains transports non terminés, pour le
      -- moniteur Logistique : BFMF les montrait avec leur étape, ici
      -- on avait un compteur seul.
      'transports', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', t.id, 'reference', t.reference, 'statut', t.statut, 'priorite', t.priorite,
          'motif', t.motif, 'nb_personnes', t.nb_personnes,
          'depart', coalesce(d.nom, t.depart_libre), 'arrivee', coalesce(ar.nom, t.arrivee_libre),
          'souhaite_pour', t.souhaite_pour, 'prise_en_charge_le', t.prise_en_charge_le,
          'chauffeur', c.nom_affiche, 'vehicule', t.vehicule)
          order by t.statut = 'en_cours' desc, t.souhaite_pour nulls last, t.created_at), '[]'::jsonb)
        from (select * from transports
              where evenement_id = p_evenement and deleted_at is null
                and statut not in ('resolue','annulee')
              order by (statut = 'en_cours') desc, souhaite_pour nulls last, created_at
              limit 6) t
        left join lieux d on d.id = t.depart_lieu_id
        left join lieux ar on ar.id = t.arrivee_lieu_id
        left join membres_evenement c on c.id = t.chauffeur_id),
      'biens_non_rendus', (select count(*) from attributions
        where evenement_id = p_evenement and deleted_at is null and rendu_le is null)
    ),

    'rh', (
      select jsonb_build_object(
        'postes_a_couvrir', coalesce(sum(manque), 0),
        'creneaux_decouverts', count(*) filter (where manque > 0))
      from couverture_creneaux(p_evenement, now())
    ),

    'recherches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', r.reference, 'nom', r.nom, 'description', r.description,
        'dernier_lieu', r.dernier_lieu, 'depuis', r.created_at)
        order by r.created_at desc), '[]'::jsonb)
      from recherches r
      where r.evenement_id = p_evenement and r.statut = 'en_cours' and r.deleted_at is null
    ),

    'jalons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'libelle', j.libelle, 'echeance', j.echeance, 'statut', j.statut,
        'critique', j.critique, 'responsable', j.responsable)
        order by j.echeance), '[]'::jsonb)
      from (select * from jalons
            where evenement_id = p_evenement and deleted_at is null
              and statut in ('a_venir','en_cours')
            order by echeance limit 5) j
    ),

    'journal', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'horodatage', x.horodatage, 'texte', x.texte,
        'importance', x.importance, 'module', x.module, 'source', x.source)
        order by x.horodatage desc), '[]'::jsonb)
      from (select * from journal
            where evenement_id = p_evenement and deleted_at is null
            order by horodatage desc limit 12) x
    )

  ) into v;
  return v;
end;
$function$;
-- ---------------------------------------------------------------------
-- 5. situation_autorite() — redéfinie en entier (base : 109)
-- ---------------------------------------------------------------------
create or replace function situation_autorite(p_jeton uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a    acces_autorite%rowtype;
  e    evenements%rowtype;
  op   boolean;
  v    jsonb;
begin
  select * into a from acces_autorite
  where jeton = p_jeton and deleted_at is null;

  if not found then
    raise exception 'Lien inconnu' using errcode = 'P0002';
  end if;
  if not a.actif then
    raise exception 'Cet accès a été révoqué' using errcode = 'P0005';
  end if;
  if a.expire_le is not null and a.expire_le < now() then
    raise exception 'Cet accès a expiré' using errcode = 'P0006';
  end if;

  -- (122) Une consultation = une visite, pas un rafraîchissement de
  -- 20 s : le compteur ne monte que si le dernier accès date de plus
  -- de dix minutes. L'heure du dernier accès, elle, suit toujours.
  update acces_autorite
  set nb_acces = nb_acces + case when a.dernier_acces is null
                                   or a.dernier_acces < clock_timestamp() - interval '10 minutes'
                                 then 1 else 0 end,
      dernier_acces = clock_timestamp()
  where id = a.id;

  select * into e from evenements where id = a.evenement_id;
  op := a.niveau = 'operationnel';

  select jsonb_build_object(

    'destinataire', jsonb_build_object(
      'libelle', a.libelle, 'organisation', a.organisation, 'niveau', a.niveau),

    'evenement', jsonb_build_object(
      'nom', e.nom, 'phase', e.phase, 'geometrie', e.geometrie,
      'mode_parcours', e.mode_parcours, 'logo_url', e.logo_url,
      'date_debut', e.date_debut, 'date_fin', e.date_fin,
      'commune', e.commune, 'province', e.province,
      'zone_police', (select c.zone_police from communes c where c.nom = e.commune),
      'zone_secours', (select c.zone_secours from communes c where c.nom = e.commune),
      'frequentation_min', e.frequentation_min, 'frequentation_max', e.frequentation_max,
      'point_0', case when e.point_0_lat is not null
                      then jsonb_build_object('lat', e.point_0_lat, 'lon', e.point_0_lon) end),

    -- Les alertes sont faites pour sortir ; celles d'un MAYDAY nomment
    -- une personne et restent au PC (106).
    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', al.niveau, 'titre', al.titre, 'message', al.message,
        'consigne', al.consigne, 'emise_le', al.emise_le,
        -- (122) Combien de postes ont lu, jamais lesquels ; et si le PC
        -- a pris la main.
        'accuses', (select count(*) from alertes_accuses ac where ac.alerte_id = al.id),
        'membres_actifs', (select count(*) from membres_evenement m
                           where m.evenement_id = a.evenement_id and m.actif and m.deleted_at is null),
        'acquittee_le', al.acquittee_le)
        order by al.emise_le desc), '[]'::jsonb)
      from alertes al
      where al.evenement_id = a.evenement_id and al.active and al.deleted_at is null
        and not exists (select 1 from maydays md where md.alerte_id = al.id)),

    'activite', jsonb_build_object(
      'signalements_ouverts', (select count(*) from signalements
        where evenement_id = a.evenement_id and deleted_at is null
          and statut in ('recu','pris_en_charge','en_cours')),
      'signalements_total', (select count(*) from signalements
        where evenement_id = a.evenement_id and deleted_at is null),
      'missions_ouvertes', (select count(*) from missions
        where evenement_id = a.evenement_id and deleted_at is null
          and statut not in ('resolue','annulee')),
      'missions_p1', (select count(*) from missions
        where evenement_id = a.evenement_id and deleted_at is null
          and priorite = 'P1' and statut not in ('resolue','annulee')),
      'recherches_en_cours', (select count(*) from recherches
        where evenement_id = a.evenement_id and deleted_at is null
          and statut = 'en_cours'),
      'maydays_en_cours', (select count(*) from maydays
        where evenement_id = a.evenement_id
          and statut in ('emis','accuse','en_cours'))),

    -- (109) Les interventions une par une. Un signalement ouvert, et une
    -- mission ouverte qui compte pour les secours (P1 ou P2, ou
    -- bloquante) sans être déjà la suite d'un signalement listé.
    -- Jamais `contact`, `traite_par`, `membre_id`, `cle_client`.
    'interventions', (
      select coalesce(jsonb_agg(x order by (x->>'rang')::int desc, x->>'heure' desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'source', 'signalement',
          'reference', s.reference,
          'heure', s.emis_le,
          'nature', s.type,
          'gravite', s.gravite,
          'rang', case s.gravite when 'critique' then 4 when 'grave' then 3
                                 when 'modere' then 2 else 1 end,
          'statut', s.statut,
          'depuis', coalesce(s.pris_en_charge_le, s.recu_le, s.emis_le),
          -- (122) Les temps du cycle, pour que « moyen engagé » et
          -- « sur place » soient des faits horodatés, pas un choix de
          -- liste.
          'pris_en_charge_le', s.pris_en_charge_le,
          'en_route_le', s.en_route_le,
          'arrive_le', s.arrive_le,
          'lieu', l.nom, 'pk_km', l.pk_km,
          'position', case when s.latitude is not null
                           then jsonb_build_object('lat', s.latitude, 'lon', s.longitude)
                           when l.latitude is not null
                           then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
          'description', case when op then s.description end
        ) as x
        from signalements s
        left join lieux l on l.id = s.lieu_id
        where s.evenement_id = a.evenement_id and s.deleted_at is null
          and s.statut in ('recu','pris_en_charge','en_cours')
        union all
        select jsonb_build_object(
          'source', 'mission',
          'reference', m.reference,
          'heure', m.created_at,
          'nature', m.module,
          'priorite', m.priorite,
          'bloquant', m.bloquant,
          'rang', case m.priorite when 'P1' then 4 when 'P2' then 3 else 2 end,
          'statut', m.statut,
          'depuis', coalesce(m.demarree_le, m.attribuee_le, m.created_at),
          'lieu', l.nom, 'pk_km', l.pk_km,
          'position', case when m.latitude is not null
                           then jsonb_build_object('lat', m.latitude, 'lon', m.longitude)
                           when l.latitude is not null
                           then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
          'titre', case when op then m.titre end,
          'description', case when op then m.description end
        )
        from missions m
        left join lieux l on l.id = m.lieu_id
        where m.evenement_id = a.evenement_id and m.deleted_at is null
          and m.statut not in ('resolue','annulee')
          and (m.priorite in ('P1','P2') or coalesce(m.bloquant, false))
          and not exists (select 1 from signalements s
                          where s.id = m.signalement_id
                            and s.deleted_at is null
                            and s.statut in ('recu','pris_en_charge','en_cours'))
      ) t),

    -- (109) Une recherche : où et quand, jamais qui.
    'recherches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', r.reference,
        'depuis', r.created_at,
        'vu_a', r.vu_a,
        'dernier_lieu', coalesce(l.nom, r.dernier_lieu),
        'pk_km', l.pk_km,
        'position', case when l.latitude is not null
                         then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
        'point_regroupement', r.point_regroupement,
        'age_approx', case when op then r.age_approx end,
        'signalement', case when op then r.description end)
        order by r.created_at), '[]'::jsonb)
      from recherches r
      left join lieux l on l.id = r.dernier_lieu_id
      where r.evenement_id = a.evenement_id and r.deleted_at is null
        and r.statut = 'en_cours'),

    'public', jsonb_build_object(
      'jauge', jauge_courante_interne(a.evenement_id),
      'sur_parcours', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut in ('parti','en_cours')),
      'groupes_sans_nouvelles', (
        select count(*) from groupes_sans_nouvelles_interne(a.evenement_id, 45)),
      -- (109) Chaque groupe dehors : où il a été vu, quand. Pas
      -- l'accompagnateur ni son téléphone — le PC les a.
      'groupes', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', g.code, 'nom', g.nom,
          'effectif', coalesce(g.effectif_reel, g.effectif_prevu),
          'statut', g.statut,
          'dernier_lieu', l.nom, 'pk_km', l.pk_km,
          'dernier_passage', g.dernier_passage,
          'sans_nouvelles', exists (select 1 from groupes_sans_nouvelles_interne(a.evenement_id, 45) n
                                    where n.groupe_id = g.id))
          order by l.pk_km nulls first, g.code), '[]'::jsonb)
        from groupes g
        left join lieux l on l.id = g.dernier_lieu_id
        where g.evenement_id = a.evenement_id and g.deleted_at is null
          and g.statut in ('parti','en_cours')),
      'attente', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut = 'inscrit'),
      'arrives', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut = 'arrive')),

    -- (109) La veille météo telle que le PC la voit (critères et seuils).
    -- L'avertissement IRM et les observations se lisent côté page.
    'meteo', jsonb_build_object(
      'criteres', (select coalesce(jsonb_agg(jsonb_build_object(
          'critere', c.critere, 'niveau', c.niveau, 'depuis', c.depuis)
          order by c.critere), '[]'::jsonb)
        from veille_etat_criteres c where c.evenement_id = a.evenement_id),
      'seuils', (select jsonb_build_object(
          'rafale_vigilance_kmh', vm.rafale_vigilance_kmh,
          'rafale_critique_kmh', vm.rafale_critique_kmh)
        from veille_meteo vm where vm.evenement_id = a.evenement_id)),

    -- (109) Accès et commandement : les éléments du plan faits pour ça.
    'acces_secours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', ep.code, 'nom', ep.nom, 'categorie', ep.categorie,
        'description', ep.description, 'position', _point_element(ep.geometrie),
        'confirme', ep.confirme)
        order by array_position(array['point_rencontre_secours','prv','voie_engins','pma',
          'poste_secours','aire_helico','point_transfert','noria','point_rassemblement',
          'sortie_secours','itineraire_evacuation']::text[], ep.categorie::text), ep.code), '[]'::jsonb)
      from elements_plan ep
      where ep.evenement_id = a.evenement_id and ep.deleted_at is null
        and ep.categorie::text in ('point_rencontre_secours','prv','voie_engins','pma',
          'poste_secours','aire_helico','point_transfert','noria','point_rassemblement',
          'sortie_secours','itineraire_evacuation')),

    -- (109) Les lieux qui servent à se repérer et à dire où.
    'reperes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', l.code, 'nom', l.nom, 'type', l.type, 'pk_km', l.pk_km,
        'position', case when l.latitude is not null
                         then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
        'charge', case when l.type = 'etape' then (
          select coalesce(sum(coalesce(g.effectif_reel, g.effectif_prevu)), 0)
          from groupes g where g.dernier_lieu_id = l.id and g.deleted_at is null
            and g.statut in ('parti','en_cours')) end)
        order by l.pk_km nulls last, l.type, l.code), '[]'::jsonb)
      from lieux l
      where l.evenement_id = a.evenement_id and l.deleted_at is null and l.actif
        and l.type in ('pc_ops','poste_secours','entree','etape','point_kilometrique','scene','parking')),

    -- (109) Tronçons : c'est la distance de portage qui dimensionne
    -- l'équipe de brancardage, pas la longueur totale.
    'segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'libelle', sp.libelle,
        'depart', d.nom, 'arrivee', ar.nom,
        'distance_m', sp.distance_totale_m,
        'brancardage_max_m', sp.brancardage_max_m,
        'composition', sp.composition)
        order by d.pk_km nulls last, sp.libelle), '[]'::jsonb)
      from segments_parcours sp
      left join lieux d on d.id = sp.depart_lieu_id
      left join lieux ar on ar.id = sp.arrivee_lieu_id
      where sp.evenement_id = a.evenement_id
        -- une ligne vide (créée puis jamais remplie) ne dit rien
        and (sp.libelle is not null or sp.depart_lieu_id is not null
             or sp.arrivee_lieu_id is not null)),

    'ressources', jsonb_build_object(
      'elements', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', ep.code, 'nom', ep.nom, 'categorie', ep.categorie,
          'description', ep.description, 'position', _point_element(ep.geometrie),
          'confirme', ep.confirme)
          order by ep.categorie, ep.code), '[]'::jsonb)
        from elements_plan ep
        where ep.evenement_id = a.evenement_id and ep.deleted_at is null
          and ep.categorie::text in ('dea','point_eau','coupure_gaz','coffret_electrique')),
      'extincteurs', (select count(*) from elements_plan ep
        where ep.evenement_id = a.evenement_id and ep.deleted_at is null
          and ep.categorie = 'extincteur'),
      'moyens', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'type', ms.type, 'quantite', ms.quantite, 'commentaire', ms.commentaire)
          order by ms.type), '[]'::jsonb)
        from moyens_premiers_secours ms where ms.evenement_id = a.evenement_id)),

    'installations_risque', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', ep.nom, 'categorie', ep.categorie,
        'latitude', (_point_element(ep.geometrie)->>'lat')::double precision,
        'longitude', (_point_element(ep.geometrie)->>'lon')::double precision,
        'description', ep.description,
        'mesures_maitrise', ep.mesures_maitrise,
        'organe_coupure', ep.organe_coupure,
        'moyens_proximite', ep.moyens_proximite,
        'confirme', ep.confirme) order by ep.code), '[]'::jsonb)
      from elements_plan ep
      where ep.evenement_id = a.evenement_id and ep.deleted_at is null
        and ep.est_risque),

    'programme', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'debut', p.debut, 'duree_min', p.duree_min, 'titre', p.titre,
        'categorie', p.categorie, 'lieu', coalesce(l.nom, p.lieu_libre))
        order by p.debut), '[]'::jsonb)
      from programme p
      left join lieux l on l.id = p.lieu_id
      where p.evenement_id = a.evenement_id and p.deleted_at is null),

    'radio', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'numero', cr.numero, 'libelle', cr.libelle, 'bande', cr.bande,
        'frequence_mhz', cr.frequence_mhz, 'sous_ton', cr.sous_ton,
        'usage', cr.usage_prevu, 'urgence', cr.canal_urgence)
        order by cr.ordre, cr.numero), '[]'::jsonb)
      from canaux_radio cr
      where cr.evenement_id = a.evenement_id and cr.deleted_at is null and cr.actif),

    -- (109) Seulement ceux que le coordinateur a désignés.
    'contacts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', ct.nom, 'organisation', ct.organisation, 'fonction', ct.fonction,
        'telephone', ct.telephone, 'email', ct.email,
        'disponibilite', ct.disponibilite, 'categorie', ct.categorie)
        order by ct.categorie nulls last, ct.nom), '[]'::jsonb)
      from contacts ct
      where ct.evenement_id = a.evenement_id and ct.deleted_at is null
        and ct.visible_autorite),

    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'titre', d.titre, 'description', d.description, 'url', d.url)
        order by d.ordre, d.titre), '[]'::jsonb)
      from documents_autorite d
      where d.evenement_id = a.evenement_id),

    'consulte_le', clock_timestamp()

  ) into v;

  return v;
end;
$$;

commit;

-- =====================================================================
-- VÉRIFICATION
--
--   select count(*) from alertes_accuses;                       -- 0 au départ
--   select column_name from information_schema.columns
--   where table_name = 'signalements' and column_name in ('en_route_le','arrive_le');
--   select * from suivre_signalement('<jeton>', '<cle>');       -- 7 colonnes
--   select jsonb_pretty(situation('<evenement>') -> 'alertes');
--   select jsonb_pretty(situation('<evenement>') -> 'logistique' -> 'transports');
--
-- Puis, connecté : bandeau → « Bien reçu » sur une alerte de test ;
-- Situation → « accusé par 1 : Nom (HH:MM) », « Vu, pris en compte » ;
-- PC-OPS → Prendre en charge → Moyen en route → Sur place → Clôturer ;
-- lien participant → les heures apparaissent sous le signalement.
-- =====================================================================
