-- Le total reste, mais les deux sources sont exposées séparément :
-- l'écran doit pouvoir dire « 288, dont 42 comptés et 246 scannés »,
-- parce qu'un parcours suivi uniquement par scans ne permet PAS de
-- conclure que ceux qui manquent sont encore dehors.
drop function if exists public.flux_parcours(uuid);

create function public.flux_parcours(p_evenement uuid)
returns table(
  lieu_id uuid, code text, nom text, pk_km numeric,
  passages integer, comptes integer, scannes integer,
  dernier timestamp with time zone, encore_apres integer
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with bornes as (
    select l.id, l.code, l.nom, l.pk_km,
           coalesce(sum(c.nombre), 0)::int as passages,
           coalesce(sum(c.nombre) filter (where c.source = 'benevole'), 0)::int as comptes,
           coalesce(sum(c.nombre) filter (where c.source = 'scan'), 0)::int as scannes,
           max(c.horodatage) as dernier
    from lieux l
    left join comptages_parcours c
      on c.lieu_id = l.id and c.evenement_id = p_evenement
    where l.evenement_id = p_evenement
      and l.deleted_at is null
      and l.pk_km is not null
    group by l.id, l.code, l.nom, l.pk_km
  )
  select id, code, nom, pk_km, passages, comptes, scannes, dernier,
         greatest(
           passages - coalesce(lead(passages) over (order by pk_km), passages),
           0
         )::int as encore_apres
  from bornes
  order by pk_km;
$function$;

grant execute on function public.flux_parcours(uuid) to authenticated;