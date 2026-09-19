-- =====================================================================
-- Migration 021 : correction du total de signalements dans rex_synthese
-- ---------------------------------------------------------------------
-- Défaut trouvé au test : le count(*) portait sur la sous-requête
-- agrégée par type. Il comptait donc le NOMBRE DE TYPES (3) et non le
-- nombre de signalements (11).
--
-- Une métrique fausse dans un REX est pire qu'une métrique absente :
-- elle est utilisée sans être vérifiée.
-- =====================================================================

create or replace function rex_synthese(p_evenement uuid)
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

    'signalements', jsonb_build_object(
      'total', (select count(*) from signalements
                where evenement_id = p_evenement and deleted_at is null),
      'par_type', (
        select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb)
        from (select type::text as type, count(*) as n from signalements
              where evenement_id = p_evenement and deleted_at is null
              group by type) t
      ),
      'par_statut', (
        select coalesce(jsonb_object_agg(s.statut, s.n), '{}'::jsonb)
        from (select statut::text as statut, count(*) as n from signalements
              where evenement_id = p_evenement and deleted_at is null
              group by statut) s
      ),
      'delai_median_prise_en_charge_min', (
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (pris_en_charge_le - recu_le))/60))
        from signalements
        where evenement_id = p_evenement and pris_en_charge_le is not null
      ),
      'sans_position', (select count(*) from signalements
                        where evenement_id = p_evenement and latitude is null
                          and deleted_at is null),
      'minutes_file_attente_max', (
        select round(max(extract(epoch from (recu_le - emis_le))/60))
        from signalements where evenement_id = p_evenement and emis_le is not null)
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

    'logistique', jsonb_build_object(
      'mouvements', (select count(*) from mouvements_stock where evenement_id = p_evenement),
      'articles_sous_seuil', (select count(*) from materiel
        where evenement_id = p_evenement and deleted_at is null
          and seuil_alerte is not null and quantite <= seuil_alerte),
      'biens_non_rendus', (select count(*) from attributions
        where evenement_id = p_evenement and deleted_at is null and rendu_le is null),
      'transports', (select count(*) from transports
        where evenement_id = p_evenement and deleted_at is null),
      'jauge_max', (
        select coalesce(max(cumul), 0) from (
          select sum(case when sens='entree' then nombre else -nombre end)
                 over (order by horodatage) as cumul
          from comptages where evenement_id = p_evenement and deleted_at is null) c)
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
        'debut', min(horodatage), 'fin', max(horodatage)
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