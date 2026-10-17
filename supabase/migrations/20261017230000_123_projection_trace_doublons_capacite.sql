-- =====================================================================
-- 123 — OÙ, SUR LE PARCOURS : PROJECTION SUR LA TRACE, DOUBLONS, CAPACITÉ
--
-- Lot 3 du comparatif BFMF 2026 → Eventware 2.0 (17/10). BFMF disait
-- « km 3,2, entre E2 et E3 » ; Eventware donnait deux coordonnées.
--
--   1. lieux.capacite — la capacité d'accueil d'une étape, en face de
--      sa charge (personnes dont c'est le dernier pointage).
--   2. signalements.doublon_de — un SOS participant absorbé par un
--      autre, ouvert, de même nature au même lieu (QR) depuis moins de
--      deux heures. Reprise de la déduplication sanitaire de BFMF.
--   3. projeter_sur_trace(evenement, lat, lon) — le km sur la trace la
--      plus proche, l'écart en mètres, et les deux repères (lieux avec
--      pk_km) qui encadrent. Même calcul que geometrie.js côté client.
--   4. suivi_signalement_interne(id) — le cycle d'un signalement, ou
--      de son original s'il est un doublon ; suivi_signalement (122)
--      et creer_signalement (012) passent par elle.
--   5. situation() — les doublons ne comptent plus comme SOS à
--      traiter ; chaque dernier signalement porte son nombre de
--      doublons.
--   6. situation_autorite() — `sur_trace` sur chaque intervention et
--      recherche, `doublons` sur les signalements, `capacite` sur les
--      repères, et `traces` (400 points au plus) pour une carte
--      vectorielle qui marche hors ligne.
--   7. contenu_public() — `traces`, pour que le participant lise où
--      il est sur le parcours.
--
-- Idempotente (if not exists, create or replace), sans aucun DROP.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1-2. Capacité des lieux, doublons de signalement
-- ---------------------------------------------------------------------
alter table public.lieux
  add column if not exists capacite integer;
comment on column public.lieux.capacite is
  'Capacité d''accueil (personnes) — une étape, un parking, une salle. Nul : non renseignée.';

alter table public.signalements
  add column if not exists doublon_de uuid references public.signalements(id) on delete set null;
create index if not exists idx_signalements_doublon_de on public.signalements (doublon_de)
  where doublon_de is not null;
comment on column public.signalements.doublon_de is
  'Signalement original que celui-ci double (même lieu, même nature, moins de deux heures). Posé par creer_signalement.';

-- ---------------------------------------------------------------------
-- 3. projeter_sur_trace()
-- ---------------------------------------------------------------------
-- Même calcul que projeterSurTrace / situerSurTrace (src/geometrie.js) :
-- repère local équirectangulaire centré sur le point, segment le plus
-- proche, abscisse curviligne. Les repères viennent de lieux.pk_km —
-- la référence que tout le monde a sous les yeux — et non d'une
-- projection des lieux, pour que l'autorité et le PC lisent pareil.
-- Nul sans trace active ou sans point.
create or replace function public.projeter_sur_trace(
  p_evenement uuid,
  p_lat       double precision,
  p_lon       double precision
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  t         record;
  pts       jsonb;
  n         int;
  i         int;
  m_lat     constant double precision := 111320;
  m_lon     double precision;
  ax double precision; ay double precision;
  bx double precision; b_y double precision;
  vx double precision; vy double precision;
  l2 double precision; lg double precision;
  tt double precision; px double precision; py double precision; d double precision;
  cumul     double precision;
  d_min     double precision;
  km_min    double precision;
  a_nom     text[] := '{}';
  a_d       double precision[] := '{}';
  a_km      double precision[] := '{}';
  a_len     double precision[] := '{}';
  len_max   double precision;
  best_d    double precision;
  best_km   double precision;
  best_nom  text;
  nb        int := 0;
  av        record;
  ap        record;
begin
  if p_lat is null or p_lon is null then
    return null;
  end if;
  m_lon := m_lat * cos(radians(p_lat));

  -- Première passe : chaque trace, sa longueur et la projection dessus.
  -- Un KML importé range aussi dans `traces` les zones 30 et les voies
  -- d'accès (Rando VTT : 93 points de parcours, puis 6 lignes de 4 à
  -- 11 points) : un km sur une voie d'accès de 200 m ne veut rien
  -- dire. On ne retient que les traces d'au moins un quart de la plus
  -- longue — les boucles d'un événement à plusieurs circuits restent
  -- toutes candidates, les tronçons annexes sortent.
  for t in
    select nom, points from traces
    where evenement_id = p_evenement and deleted_at is null and actif
  loop
    pts := t.points;
    n := jsonb_array_length(pts);
    if n < 2 then
      continue;
    end if;
    cumul := 0;
    d_min := null;
    ax := ((pts->0->>1)::double precision - p_lon) * m_lon;
    ay := ((pts->0->>0)::double precision - p_lat) * m_lat;
    for i in 1..n-1 loop
      bx := ((pts->i->>1)::double precision - p_lon) * m_lon;
      b_y := ((pts->i->>0)::double precision - p_lat) * m_lat;
      vx := bx - ax;
      vy := b_y - ay;
      l2 := vx*vx + vy*vy;
      lg := sqrt(l2);
      -- Le point projeté est à l'origine : t = -(a·v) / |v|².
      tt := case when l2 > 0 then -(ax*vx + ay*vy) / l2 else 0 end;
      tt := greatest(0, least(1, tt));
      px := ax + tt*vx;
      py := ay + tt*vy;
      d := sqrt(px*px + py*py);
      if d_min is null or d < d_min then
        d_min := d;
        km_min := (cumul + tt*lg) / 1000;
      end if;
      cumul := cumul + lg;
      ax := bx;
      ay := b_y;
    end loop;
    a_nom := a_nom || t.nom;
    a_d := a_d || d_min;
    a_km := a_km || km_min;
    a_len := a_len || cumul;
    if len_max is null or cumul > len_max then
      len_max := cumul;
    end if;
  end loop;

  if len_max is null then
    return null;
  end if;

  -- Seconde passe : la plus proche parmi les traces principales.
  for i in 1..coalesce(array_length(a_nom, 1), 0) loop
    if a_len[i] >= 0.25 * len_max then
      nb := nb + 1;
      if best_d is null or a_d[i] < best_d then
        best_d := a_d[i];
        best_km := a_km[i];
        best_nom := a_nom[i];
      end if;
    end if;
  end loop;

  if best_d is null then
    return null;
  end if;

  select code, nom, pk_km into av from lieux
  where evenement_id = p_evenement and deleted_at is null and actif
    and pk_km is not null and pk_km <= best_km
  order by pk_km desc limit 1;
  select code, nom, pk_km into ap from lieux
  where evenement_id = p_evenement and deleted_at is null and actif
    and pk_km is not null and pk_km > best_km
  order by pk_km asc limit 1;

  return jsonb_build_object(
    'trace', best_nom,
    'plusieurs', nb > 1,
    'km', round(best_km::numeric, 2),
    'ecart_m', round(best_d),
    'avant', case when av.nom is not null
                  then jsonb_build_object('code', av.code, 'nom', av.nom, 'pk_km', av.pk_km) end,
    'apres', case when ap.nom is not null
                  then jsonb_build_object('code', ap.code, 'nom', ap.nom, 'pk_km', ap.pk_km) end);
end;
$$;
revoke execute on function public.projeter_sur_trace(uuid, double precision, double precision) from public, anon;
grant execute on function public.projeter_sur_trace(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- 4. suivi_signalement_interne() et suivi_signalement()
-- ---------------------------------------------------------------------
-- Le cycle d'un signalement — ou de son original s'il est un doublon :
-- le participant dont le SOS a été absorbé voit avancer l'intervention
-- qui le couvre, pas un « reçu » figé. Interne (aucun droit) : les
-- deux points d'entrée par jeton l'appellent.
create or replace function public.suivi_signalement_interne(p_id uuid)
returns table (
  reference text, statut text, recu_le timestamptz, pris_en_charge_le timestamptz,
  en_route_le timestamptz, arrive_le timestamptz, clos_le timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.reference, coalesce(o.statut, s.statut)::text, s.recu_le,
         coalesce(o.pris_en_charge_le, s.pris_en_charge_le),
         coalesce(o.en_route_le, s.en_route_le),
         coalesce(o.arrive_le, s.arrive_le),
         coalesce(o.clos_le, s.clos_le)
  from signalements s
  left join signalements o on o.id = s.doublon_de and o.deleted_at is null
  where s.id = p_id and s.deleted_at is null;
$$;
revoke execute on function public.suivi_signalement_interne(uuid) from public, anon, authenticated;

create or replace function public.suivi_signalement(
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
  select i.*
  from signalements s
  join evenements e on e.id = s.evenement_id
  cross join lateral suivi_signalement_interne(s.id) i
  where e.jeton_public = p_jeton
    and s.cle_client = p_cle_client
    and s.deleted_at is null;
$$;
revoke execute on function public.suivi_signalement(uuid, uuid) from public;
grant execute on function public.suivi_signalement(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4 bis. creer_signalement() — redéfinie en entier (base : 012), avec déduplication
-- ---------------------------------------------------------------------
create or replace function public.creer_signalement(
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
  v_doublon   uuid;
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
    return query select i.reference, i.statut, i.recu_le
                 from suivi_signalement_interne(v_existant.id) i;
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

  -- (123) Déduplication sanitaire, reprise de BFMF 2026 : trois
  -- personnes qui scannent le QR du même bloc pour la même chose ne
  -- font pas trois interventions. Un signalement ouvert de même nature
  -- au même lieu depuis moins de deux heures absorbe le nouveau, qui
  -- reste enregistré (le participant suit le sien) mais compté comme
  -- doublon. Sans lieu (GPS libre), rien n'est rapproché : deux
  -- malaises à 200 m l'un de l'autre sont deux malaises.
  if v_lieu is not null then
    select s.id into v_doublon
    from signalements s
    where s.evenement_id = v_evenement and s.lieu_id = v_lieu
      and s.type = p_type::type_signalement
      and s.deleted_at is null and s.doublon_de is null
      and s.statut in ('recu','pris_en_charge','en_cours')
      and s.emis_le > clock_timestamp() - interval '2 hours'
    order by s.emis_le desc
    limit 1;
  end if;

  v_ref := generer_reference_sos(v_evenement);

  insert into signalements (
    evenement_id, reference, cle_client, type, description, contact,
    latitude, longitude, precision_m, emis_le, lieu_id, doublon_de
  ) values (
    v_evenement, v_ref, p_cle_client, p_type::type_signalement,
    nullif(trim(coalesce(p_description,'')), ''),
    nullif(trim(coalesce(p_contact,'')), ''),
    v_lat, v_lon, p_precision_m,
    coalesce(p_emis_le, clock_timestamp()), v_lieu, v_doublon
  );

  -- Le statut rendu est celui de l'original si c'est un doublon.
  return query select i.reference, i.statut, i.recu_le
               from signalements s
               cross join lateral suivi_signalement_interne(s.id) i
               where s.evenement_id = v_evenement and s.cle_client = p_cle_client;
end;
$$;
revoke all on function public.creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) from public;
grant execute on function public.creer_signalement(
  uuid, uuid, text, text, text, double precision, double precision,
  double precision, timestamptz, text
) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. situation() — redéfinie en entier (base : 122)
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
        -- (123) Un doublon (même lieu, même nature, moins de deux heures)
        -- n'est pas un SOS de plus à traiter : il est compté sur l'original.
        'ouverts', count(*) filter (where statut in ('recu','pris_en_charge','en_cours') and doublon_de is null),
        'non_pris_en_charge', count(*) filter (where statut = 'recu' and doublon_de is null),
        'total', count(*),
        'derniers', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'reference', s.reference, 'type', s.type, 'statut', s.statut,
            'description', s.description, 'recu_le', s.recu_le,
            'latitude', s.latitude, 'longitude', s.longitude,
            'doublons', (select count(*) from signalements d where d.doublon_de = s.id and d.deleted_at is null))
            order by s.recu_le desc), '[]'::jsonb)
          from (select * from signalements
                where evenement_id = p_evenement and deleted_at is null
                  and statut in ('recu','pris_en_charge','en_cours') and doublon_de is null
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
-- 6. situation_autorite() — redéfinie en entier (base : 122)
-- ---------------------------------------------------------------------
create or replace function public.situation_autorite(p_jeton uuid)
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
          and statut in ('recu','pris_en_charge','en_cours') and doublon_de is null),
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
          -- (123) « km 3,2 · entre E2 et E3 · 40 m de la trace » : ce que
          -- BFMF disait, et qu'une paire de coordonnées ne dit pas.
          'sur_trace', projeter_sur_trace(a.evenement_id,
                         coalesce(s.latitude, l.latitude), coalesce(s.longitude, l.longitude)),
          -- (123) Les signalements groupés sur celui-ci (même lieu, même
          -- nature) : trois QR scannés au même bloc = une intervention.
          'doublons', (select count(*) from signalements d
                       where d.doublon_de = s.id and d.deleted_at is null),
          'description', case when op then s.description end
        ) as x
        from signalements s
        left join lieux l on l.id = s.lieu_id
        where s.evenement_id = a.evenement_id and s.deleted_at is null
          and s.statut in ('recu','pris_en_charge','en_cours')
          and s.doublon_de is null
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
          'sur_trace', projeter_sur_trace(a.evenement_id,
                         coalesce(m.latitude, l.latitude), coalesce(m.longitude, l.longitude)),
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
        'sur_trace', projeter_sur_trace(a.evenement_id, l.latitude, l.longitude),
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


    -- (123) La trace, pour la carte de la page autorité : un dessin
    -- vectoriel léger, sans fond de carte ni tuiles, qui marche hors
    -- ligne. Ramenée à 400 points au plus par trace — à l'échelle d'un
    -- écran, un GPX de 3 000 points n'en dessine pas plus.
    'traces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', t.nom, 'couleur', t.couleur, 'distance_km', t.distance_km,
        'points', (
          select coalesce(jsonb_agg(jsonb_build_array(p.value->0, p.value->1) order by p.ord), '[]'::jsonb)
          from jsonb_array_elements(t.points) with ordinality p(value, ord)
          where (p.ord - 1) % greatest(1, ceil(jsonb_array_length(t.points) / 400.0)::int) = 0
             or p.ord = jsonb_array_length(t.points)))
        order by t.code), '[]'::jsonb)
      from traces t
      where t.evenement_id = a.evenement_id and t.deleted_at is null and t.actif
        and jsonb_array_length(t.points) > 1),

    -- (109) Les lieux qui servent à se repérer et à dire où.
    'reperes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', l.code, 'nom', l.nom, 'type', l.type, 'pk_km', l.pk_km,
        'position', case when l.latitude is not null
                         then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
        -- (123) La capacité d'accueil d'une étape, en face de sa charge.
        'capacite', l.capacite,
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
revoke all on function public.situation_autorite(uuid) from public;
grant execute on function public.situation_autorite(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. contenu_public() — redéfinie en entier (base : 099)
-- ---------------------------------------------------------------------
create or replace function public.contenu_public(p_jeton uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb; v_evenement uuid;
begin
  select e.id into v_evenement
  from evenements e where e.jeton_public = p_jeton and e.deleted_at is null;

  if v_evenement is null then
    raise exception 'Événement inconnu' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'evenement', (
      select jsonb_build_object('nom', e.nom, 'logo_url', e.logo_url,
                                'phase', e.phase, 'mode_parcours', e.mode_parcours,
                                'date_debut', e.date_debut, 'date_fin', e.date_fin)
      from evenements e where e.id = v_evenement
    ),
    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', a.niveau, 'titre', a.titre, 'consigne', a.consigne,
        'emise_le', a.emise_le) order by a.emise_le desc), '[]'::jsonb)
      from alertes a
      where a.evenement_id = v_evenement and a.active and a.public and a.deleted_at is null
    ),
    'lieux', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', l.code, 'nom', l.nom, 'type', l.type,
        'latitude', l.latitude, 'longitude', l.longitude,
        'pk_km', l.pk_km) order by l.pk_km nulls last, l.nom), '[]'::jsonb)
      from lieux l
      where l.evenement_id = v_evenement and l.public and l.deleted_at is null
    ),
    -- (123) La trace, pour que le participant lise où il est sur le
    -- parcours (« km 3,2, entre E2 et E3 ») au lieu de coordonnées.
    -- Ramenée à 400 points au plus par trace — à l'échelle d'un
    -- écran, un GPX de 3 000 points n'en dessine pas plus.
    'traces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', t.nom, 'couleur', t.couleur, 'distance_km', t.distance_km,
        'points', (
          select coalesce(jsonb_agg(jsonb_build_array(p.value->0, p.value->1) order by p.ord), '[]'::jsonb)
          from jsonb_array_elements(t.points) with ordinality p(value, ord)
          where (p.ord - 1) % greatest(1, ceil(jsonb_array_length(t.points) / 400.0)::int) = 0
             or p.ord = jsonb_array_length(t.points)))
        order by t.code), '[]'::jsonb)
      from traces t
      where t.evenement_id = v_evenement and t.deleted_at is null and t.actif
        and jsonb_array_length(t.points) > 1),

    'programme', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'titre', p.titre, 'categorie', p.categorie, 'debut', p.debut,
        'duree_min', p.duree_min, 'intervenant', p.intervenant,
        'lieu', coalesce(l.nom, p.lieu_libre)) order by p.debut), '[]'::jsonb)
      from programme p
      left join lieux l on l.id = p.lieu_id
      where p.evenement_id = v_evenement and p.public and p.deleted_at is null
    ),
    'jalons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'libelle', j.libelle_public,
        'echeance', j.echeance,
        'fait', j.statut = 'fait') order by j.echeance nulls last), '[]'::jsonb)
      from jalons j
      where j.evenement_id = v_evenement
        and j.visibilite = 'public'
        and j.libelle_public is not null
        and j.statut <> 'annule'
        and j.deleted_at is null
    ),
    'communications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'titre', c.titre, 'corps', c.corps,
        'lien_url', c.lien_url, 'lien_libelle', c.lien_libelle,
        'publie_le', c.publie_le) order by c.publie_le desc), '[]'::jsonb)
      from communications c
      where c.evenement_id = v_evenement and c.deleted_at is null
        and c.publie_le is not null and c.publie_le <= now()
        and (c.visible_jusqu_au is null or c.visible_jusqu_au > now())
    )
  ) into v;
  return v;
end;
$function$;
revoke all on function public.contenu_public(uuid) from public;
grant execute on function public.contenu_public(uuid) to anon, authenticated;


commit;

-- =====================================================================
-- VÉRIFICATION
--
--   select projeter_sur_trace('<evenement>', 50.38, 5.61);
--   -- {"km": 3.2, "ecart_m": 40, "avant": {...}, "apres": {...}, ...}
--
--   select jsonb_array_length(situation_autorite('<jeton>')->'traces');
--   select (situation_autorite('<jeton>')->'interventions'->0->'sur_trace');
--
-- Puis dans l'application : un SOS participant scanné deux fois au
-- même bloc (QR) → le second porte doublon_de, PC-OPS montre « ×1 »
-- sur le premier et le participant du second suit le cycle du premier.
-- =====================================================================
