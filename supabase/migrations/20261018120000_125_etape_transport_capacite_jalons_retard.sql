-- =====================================================================
-- 125 — RESTES DU LOT 2 : ÉTAPE D'UNE COURSE, CAPACITÉ DES ÉTAPES, UN
-- SEUL COMPTE DES JALONS EN RETARD
--
-- Ce que le lot 2 du comparatif BFMF 2026 avait laissé (18/10) :
--
--   1. transports.etape — où en est la course (en route, chargé,
--      retour, déposé), posé par le chauffeur depuis Mon terrain ;
--      pastille dans Transports et dans le moniteur Logistique.
--   2. situation() : `parcours.etapes` (chaque étape avec sa capacité
--      et sa charge, pour des barres sur la Situation) ;
--      `logistique.transports[].etape / attendu_le` ;
--      `jalons_en_retard` — un seul compte là où trois écrans en
--      faisaient trois différents (point interne du rapport, vérifié :
--      Situation et Mur sur 5 jalons, BandeauEtat sur tous hors
--      « en cours »).
--
-- Idempotente (if not exists, create or replace), sans aucun DROP.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. transports.etape
-- ---------------------------------------------------------------------
alter table public.transports
  add column if not exists etape text;
comment on column public.transports.etape is
  'Où en est la course, dit par le chauffeur depuis Mon terrain : en_route (vers le départ), charge (personnes ou matériel à bord), retour, depose. Nul : pas encore partie. Indépendant du statut (planification).';
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'transports_etape_check') then
    alter table public.transports add constraint transports_etape_check
      check (etape is null or etape in ('en_route','charge','retour','depose'));
  end if;
end $c$;

-- ---------------------------------------------------------------------
-- 2. situation() — redéfinie en entier (base : 123)
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
            and g.statut in ('parti','en_cours')),
        -- (125) Les étapes, avec leur capacité (123) en face de leur
        -- charge : les personnes dont c'est le dernier pointage. BFMF
        -- en faisait des barres ; le moniteur Parcours les montre.
        'etapes', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'code', l.code, 'nom', l.nom, 'pk_km', l.pk_km,
            'capacite', l.capacite,
            'charge', (select coalesce(sum(coalesce(g.effectif_reel, g.effectif_prevu)), 0)
                       from groupes g where g.dernier_lieu_id = l.id and g.deleted_at is null
                         and g.statut in ('parti','en_cours')))
            order by l.pk_km nulls last, l.code), '[]'::jsonb)
          from lieux l
          where l.evenement_id = p_evenement and l.deleted_at is null and l.actif
            and l.type = 'etape'))
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
          'chauffeur', c.nom_affiche, 'vehicule', t.vehicule,
          -- (125) Où en est la course, dit par le chauffeur depuis Terrain.
          'etape', t.etape, 'attendu_le', t.attendu_le)
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

    -- (125) UN seul compte des jalons en retard. Avant : la Situation et
    -- le Mur comptaient sur les cinq prochains jalons seulement, le
    -- bandeau d'état sur tous mais hors « en cours » — trois chiffres
    -- différents pour la même question. Ici : tout jalon non fait dont
    -- l'échéance est passée, qu'il soit à venir ou en cours.
    'jalons_en_retard', (
      select count(*) from jalons
      where evenement_id = p_evenement and deleted_at is null
        and statut in ('a_venir','en_cours') and echeance < now()),

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


commit;

-- =====================================================================
-- VÉRIFICATION (avec les claims d'un membre)
--   select situation('<evenement>')->'jalons_en_retard';
--   select situation('<evenement>')->'parcours'->'etapes';
--   select situation('<evenement>')->'logistique'->'transports'->0->'etape';
-- =====================================================================
