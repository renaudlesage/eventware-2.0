drop function public.couverture_creneaux(uuid, timestamp with time zone);

create function public.couverture_creneaux(
  p_evenement uuid,
  p_depuis timestamp with time zone default null
)
returns table(
  creneau_id uuid, code text, poste text,
  debut timestamp with time zone, fin timestamp with time zone,
  lieu text, besoin integer,
  confirmes integer, proposes integer, presents integer, manque integer,
  rappel text, rappel_envoye_le timestamp with time zone,
  fiche_id uuid, fiche_intitule text
)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin,
    count(*) filter (where a.statut in ('confirme','present'))::int,
    count(*) filter (where a.statut = 'propose')::int,
    count(*) filter (where a.statut = 'present')::int,
    greatest(c.besoin - count(*) filter (where a.statut in ('confirme','present')), 0)::int,
    c.rappel, c.rappel_envoye_le,
    c.fiche_id, f.intitule
  from creneaux c
  left join lieux l on l.id = c.lieu_id
  left join fiches_poste f on f.id = c.fiche_id and f.deleted_at is null
  left join affectations a
    on a.creneau_id = c.id and a.deleted_at is null and a.statut <> 'annule'
  where c.evenement_id = p_evenement
    and c.deleted_at is null
    and (p_depuis is null or c.fin >= p_depuis)
  group by c.id, c.code, c.poste, c.debut, c.fin, l.nom, c.besoin,
           c.rappel, c.rappel_envoye_le, c.fiche_id, f.intitule
  order by c.debut, c.poste;
$function$;

grant execute on function public.couverture_creneaux(uuid, timestamp with time zone) to authenticated;