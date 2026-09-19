-- =====================================================================
-- Migration 027 : situation générale
-- ---------------------------------------------------------------------
-- La vue QG d'un coup d'œil : ce que la v18 faisait en 1470 lignes.
--
-- Une seule fonction, pour deux usages : le tableau de bord interne et,
-- demain, la page autorité consultée sur jeton. Dupliquer la logique
-- garantirait qu'elles divergent — et que le bourgmestre voie autre
-- chose que le PC-Ops.
-- =====================================================================

create or replace function situation(p_evenement uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
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

    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', a.niveau, 'titre', a.titre, 'consigne', a.consigne,
        'emise_le', a.emise_le) order by a.emise_le desc), '[]'::jsonb)
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
                group by statut) x))
      from missions where evenement_id = p_evenement and deleted_at is null
    ),

    'parcours', (
      select jsonb_build_object(
        'en_route', count(*) filter (where statut in ('parti','en_cours')),
        'arrives', count(*) filter (where statut = 'arrive'),
        'abandons', count(*) filter (where statut = 'abandon'),
        'personnes_sur_parcours', coalesce(sum(coalesce(effectif_reel, effectif_prevu))
                                   filter (where statut in ('parti','en_cours')), 0),
        'sans_nouvelles', (select count(*) from groupes_sans_nouvelles(p_evenement, 45)))
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
$$;

grant execute on function situation(uuid) to authenticated;