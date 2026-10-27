-- =====================================================================
-- 136 — LES OBJETS DU PLAN D'IMPLANTATION PUBLIABLES (retour de Ren, 27/10)
--
-- « Ce que voit le public › Lieux » ne proposait que la table `lieux`
-- (le référentiel importé : étapes, PC, PRV…). Les chapiteaux, bars,
-- parkings posés sur la carte de conception sont dans `elements_plan`
-- et n'y apparaissaient pas : « Publiés 0 sur 0 ».
--
-- Même mécanique que pour les lieux : une colonne `public`, fausse par
-- défaut (rien n'est public sans un clic de l'organisateur), que
-- l'écran d'administration coche ; et `contenu_public()` (la vitrine
-- sans compte) ajoute à ses « lieux » les objets du plan cochés, à la
-- position de leur centre, sous la même forme (code, nom, type,
-- latitude, longitude). Les tracés (barrières, câbles) n'ont pas de
-- centre à montrer : exclus. La vitrine n'a rien à changer.
--
-- Aucun DROP : une colonne ajoutée, une fonction remplacée.
-- =====================================================================

begin;

alter table public.elements_plan
  add column if not exists public boolean not null default false;

comment on column public.elements_plan.public is
  '(136) Visible sur la vitrine sans compte (Ce que voit le public). Faux par défaut.';

create or replace function public.contenu_public(p_jeton uuid)
returns jsonb
language plpgsql
stable security definer
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
    -- (136) Les lieux du référentiel cochés publics, et les objets du plan
    -- d'implantation cochés publics, à la position de leur centre.
    'lieux', (
      select coalesce(jsonb_agg(s.x order by s.pk_km nulls last, s.nom), '[]'::jsonb)
      from (
        select l.pk_km, l.nom,
               jsonb_build_object(
                 'code', l.code, 'nom', l.nom, 'type', l.type,
                 'latitude', l.latitude, 'longitude', l.longitude,
                 'pk_km', l.pk_km) as x
        from lieux l
        where l.evenement_id = v_evenement and l.public and l.deleted_at is null
        union all
        select null::numeric, p.nom,
               jsonb_build_object(
                 'code', p.code, 'nom', p.nom, 'type', p.categorie::text,
                 'latitude', p.centre_lat, 'longitude', p.centre_lon,
                 'pk_km', null)
        from elements_plan p
        where p.evenement_id = v_evenement and p.public and p.deleted_at is null
          and p.nature <> 'ligne' and p.centre_lat is not null and p.centre_lon is not null
      ) s
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

commit;

-- =====================================================================
-- VÉRIFICATION
--   select column_name from information_schema.columns
--    where table_name = 'elements_plan' and column_name = 'public';        -- 1 ligne
--   select jsonb_array_length(contenu_public(jeton_public)->'lieux')
--     from evenements where id = '<un événement>';                        -- lieux publics + objets cochés
-- =====================================================================
