-- Tout ce que voit un participant, en un appel. Chaque bloc filtre sur
-- `public` : la fonction ne peut structurellement pas divulguer un lieu
-- ou une alerte que l'organisateur n'a pas cochés.
create or replace function public.contenu_public(p_jeton uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb; v_evenement uuid; v_phase phase_evenement;
begin
  select e.id, e.phase into v_evenement, v_phase
  from evenements e where e.jeton_public = p_jeton and e.deleted_at is null;

  if v_evenement is null then
    raise exception 'Événement inconnu' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'evenement', (
      select jsonb_build_object('nom', e.nom, 'logo_url', e.logo_url,
                                'phase', e.phase,
                                'date_debut', e.date_debut, 'date_fin', e.date_fin)
      from evenements e where e.id = v_evenement
    ),

    -- Seules les alertes cochées « publique » ET actives.
    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', a.niveau, 'titre', a.titre, 'consigne', a.consigne,
        'emise_le', a.emise_le) order by a.emise_le desc), '[]'::jsonb)
      from alertes a
      where a.evenement_id = v_evenement and a.active and a.public
        and a.deleted_at is null
    ),

    'lieux', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', l.code, 'nom', l.nom, 'type', l.type,
        'latitude', l.latitude, 'longitude', l.longitude,
        'pk_km', l.pk_km) order by l.pk_km nulls last, l.nom), '[]'::jsonb)
      from lieux l
      where l.evenement_id = v_evenement and l.public and l.deleted_at is null
    ),

    'programme', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'titre', p.titre, 'categorie', p.categorie, 'debut', p.debut,
        'duree_min', p.duree_min, 'intervenant', p.intervenant,
        'lieu', coalesce(l.nom, p.lieu_libre)) order by p.debut), '[]'::jsonb)
      from programme p
      left join lieux l on l.id = p.lieu_id
      where p.evenement_id = v_evenement and p.public and p.deleted_at is null
    ),

    -- Publiées et non expirées. C'est le canal d'après-événement :
    -- remerciements, photos, édition suivante.
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

grant execute on function public.contenu_public(uuid) to anon, authenticated;