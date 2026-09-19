-- Le cumul par borne, et surtout l'écart entre bornes consécutives :
-- c'est lui qui dit combien de personnes sont encore sur un tronçon,
-- donc où envoyer une voiture-balai en fin de journée.
create or replace function public.flux_parcours(p_evenement uuid)
returns table(
  lieu_id uuid, code text, nom text, pk_km numeric,
  passages integer, dernier timestamp with time zone,
  encore_apres integer
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with bornes as (
    select l.id, l.code, l.nom, l.pk_km,
           coalesce(sum(c.nombre), 0)::int as passages,
           max(c.horodatage) as dernier
    from lieux l
    left join comptages_parcours c
      on c.lieu_id = l.id and c.evenement_id = p_evenement
    where l.evenement_id = p_evenement
      and l.deleted_at is null
      and l.pk_km is not null
    group by l.id, l.code, l.nom, l.pk_km
  )
  select id, code, nom, pk_km, passages, dernier,
         -- Combien n'ont pas encore atteint la borne suivante : ceux
         -- qui sont passés ici moins ceux passés là-bas. Jamais
         -- négatif — un comptage en retard ne doit pas afficher un
         -- nombre absurde.
         greatest(
           passages - coalesce(lead(passages) over (order by pk_km), passages),
           0
         )::int as encore_apres
  from bornes
  order by pk_km;
$function$;

grant execute on function public.flux_parcours(uuid) to authenticated;