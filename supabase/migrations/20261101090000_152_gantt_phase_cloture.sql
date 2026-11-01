-- =====================================================================
-- 152 — LA PHASE D'UN JALON : LA CLÔTURE AUSSI (retour de Ren, 1/11)
--
-- gantt() déduit la phase d'un jalon de son échéance et des dates de
-- l'événement, sauf phase forcée (`phase_cible`, 129). Il s'arrêtait au
-- démontage : tout ce qui tombait après était « démontage ». Un jalon
-- daté après la fin du démontage est en clôture (bilan, REX, factures).
-- Redéfinie en entier (base : 129), aucun DROP, idempotente.
-- =====================================================================

begin;

create or replace function public.gantt(p_evenement uuid)
returns table (
  id uuid, code text, libelle text, debut timestamptz, fin timestamptz, phase text,
  groupe_travail_id uuid, groupe_nom text, groupe_ordre integer, groupe_pilote text,
  responsable text, responsable_membre_id uuid, statut text, avancement integer, critique boolean,
  en_retard boolean, sur_chemin_critique boolean, marge_j integer,
  predecesseurs uuid[], successeurs uuid[],
  offset_debut_j integer, offset_fin_j integer, ancre text, phase_cible text, visibilite text, commentaire text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev evenements%rowtype; v_tout boolean;
begin
  if not a_permission(p_evenement, 'rh', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du planning non autorisée' using errcode = '42501';
  end if;
  -- `e.id`, pas `id` : la colonne de sortie du même nom rend le mot ambigu.
  select * into ev from evenements e where e.id = p_evenement;
  v_tout := a_tout_pouvoir(p_evenement);
  return query
  select x.* from (
    select j.id, j.code, j.libelle, j.debut, j.echeance as fin,
      coalesce(j.phase_cible::text,
        case when j.echeance is null or ev.date_debut is null then 'preparation'
             when (j.echeance at time zone 'Europe/Brussels')::date < coalesce(ev.date_montage, ev.date_debut) then 'preparation'
             when (j.echeance at time zone 'Europe/Brussels')::date < ev.date_debut then 'montage'
             when (j.echeance at time zone 'Europe/Brussels')::date <= coalesce(ev.date_fin, ev.date_debut) then 'exploitation'
             -- (152) Après la fin du démontage : la clôture.
             when (j.echeance at time zone 'Europe/Brussels')::date <= coalesce(ev.date_demontage, ev.date_fin, ev.date_debut) then 'demontage'
             else 'cloture' end) as phase,
      j.groupe_travail_id, g.nom as groupe_nom, g.ordre as groupe_ordre, pil.nom_affiche as groupe_pilote,
      coalesce(m.nom_affiche, j.responsable) as responsable, j.responsable_membre_id,
      j.statut::text, j.avancement::int, j.critique,
      (j.echeance is not null and j.echeance < now() and j.statut in ('a_venir','en_cours')) as en_retard,
      (cc.marge_j is not null and cc.marge_j <= 0 and j.statut in ('a_venir','en_cours')) as sur_chemin_critique,
      cc.marge_j,
      (select coalesce(array_agg(d.precede_id), '{}'::uuid[]) from jalon_dependances d where d.jalon_id = j.id) as predecesseurs,
      (select coalesce(array_agg(d.jalon_id), '{}'::uuid[]) from jalon_dependances d where d.precede_id = j.id) as successeurs,
      j.offset_debut_j, j.offset_fin_j, j.ancre, j.phase_cible::text, j.visibilite::text, j.commentaire
    from jalons j
    left join groupes_travail g on g.id = j.groupe_travail_id and g.deleted_at is null
    left join membres_evenement pil on pil.id = g.pilote_membre_id
    left join membres_evenement m on m.id = j.responsable_membre_id
    left join chemin_critique(p_evenement) cc on cc.jalon_id = j.id
    where j.evenement_id = p_evenement and j.deleted_at is null and j.statut <> 'annule'
      and (v_tout or j.visibilite <> 'coordination')
  ) x
  order by x.groupe_ordre nulls last, x.groupe_nom nulls last,
           array_position(array['preparation','montage','exploitation','demontage','cloture'], x.phase),
           coalesce(x.debut, x.fin) nulls last, x.fin;
end $$;

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle, phase from gantt('<evenement>') order by phase, fin;
-- =====================================================================
