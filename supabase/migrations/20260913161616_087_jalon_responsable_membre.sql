-- =====================================================================
-- Migration 087 : une action de préparation s'attribue à quelqu'un
-- ---------------------------------------------------------------------
-- `responsable` était un texte libre : utile pour désigner un
-- prestataire extérieur (« Chapiteaux Dubois »), mais incapable de
-- faire apparaître l'action dans la liste de tâches de la personne.
--
-- On ajoute donc un vrai rattachement, sans retirer le texte : les deux
-- cas existent et ne se remplacent pas.
-- =====================================================================

alter table jalons add column responsable_membre_id uuid
  references membres_evenement(id) on delete set null;

comment on column jalons.responsable_membre_id is
  'Membre chargé de l''action — la fait apparaître dans « Mes missions ». Distinct de `responsable`, texte libre pour un intervenant extérieur.';

-- Les actions attribuées rejoignent la liste de tâches personnelle.
create or replace function public.mon_terrain(p_evenement uuid)
returns table(genre text, id uuid, reference text, titre text, detail text,
              priorite text, statut text, latitude double precision,
              longitude double precision, pour_moi boolean,
              horodatage timestamp with time zone)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with moi as (
    select m.id, m.equipe_id
    from membres_evenement m
    where m.evenement_id = p_evenement and m.user_id = auth.uid()
      and m.actif and m.deleted_at is null
    limit 1
  ),
  tout as (
    select 'mission'::text as genre, m.id, m.reference, m.titre, m.description as detail,
           m.priorite::text as priorite, m.statut::text as statut,
           m.latitude, m.longitude,
           coalesce(m.membre_id = (select id from moi), false) as pour_moi,
           m.created_at as horodatage
    from missions m
    where m.evenement_id = p_evenement and m.deleted_at is null
      and m.statut not in ('resolue','annulee')
      and (
        m.membre_id = (select id from moi)
        or (m.equipe_id is not null and m.equipe_id = (select equipe_id from moi))
        or (m.membre_id is null and m.equipe_id is null)
      )

    union all

    select 'transport', t.id, t.reference,
           coalesce(t.depart_libre,'?') || ' → ' || coalesce(t.arrivee_libre,'?'),
           t.nb_personnes || ' pers. ' || coalesce(t.motif,''),
           t.priorite::text, t.statut::text, null, null,
           coalesce(t.chauffeur_id = (select id from moi), false),
           t.created_at
    from transports t
    where t.evenement_id = p_evenement and t.deleted_at is null
      and t.statut not in ('resolue','annulee')
      and (t.chauffeur_id = (select id from moi) or t.chauffeur_id is null)

    union all

    -- Contrairement aux missions, une action SANS responsable n'apparaît
    -- chez personne. Une demande sans titulaire est un appel au
    -- volontariat ; une action de préparation sans titulaire est un
    -- oubli, et l'afficher dans la liste de chacun n'y changerait rien.
    select 'jalon', j.id, j.code, j.libelle,
           coalesce(j.commentaire, j.categorie),
           case when j.critique then 'P1' else 'P3' end,
           j.statut::text, null, null,
           true,
           coalesce(j.echeance, j.created_at)
    from jalons j
    where j.evenement_id = p_evenement and j.deleted_at is null
      and j.statut in ('a_venir','en_cours')
      and j.responsable_membre_id = (select id from moi)
  )
  select * from tout
  order by pour_moi desc, priorite, horodatage;
$function$;