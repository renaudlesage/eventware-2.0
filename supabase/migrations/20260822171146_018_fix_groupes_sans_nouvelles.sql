-- ============ 018_fix_groupes_sans_nouvelles ============
-- =====================================================================
-- Migration 018 : correction de groupes_sans_nouvelles
-- ---------------------------------------------------------------------
-- Défaut trouvé au test, inversé par rapport au besoin :
-- un groupe parti SANS aucun pointage avait dernier_passage NULL et
-- depart_reel NULL. La comparaison renvoyait « inconnu » et le groupe
-- était EXCLU de la liste d'alerte — alors que c'est précisément celui
-- qu'il faut voir en premier.
--
-- On remonte la chaîne jusqu'à une date qui existe toujours, et on
-- ajoute un drapeau : « jamais pointé » n'est pas la même information
-- que « pas de nouvelles depuis 50 minutes ».
-- =====================================================================

begin;

drop function if exists groupes_sans_nouvelles(uuid, integer);

create function groupes_sans_nouvelles(
  p_evenement uuid,
  p_minutes integer default 45
)
returns table (
  groupe_id uuid, code text, nom text, effectif integer,
  dernier_lieu text, dernier_passage timestamptz, minutes_ecoulees integer,
  jamais_pointe boolean, accompagnateur text, contact text
)
language sql stable
security definer set search_path = public, pg_temp
as $$
  select g.id, g.code, g.nom, coalesce(g.effectif_reel, g.effectif_prevu),
         l.nom, g.dernier_passage,
         round(extract(epoch from (clock_timestamp() -
           coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at)))/60)::int,
         (g.dernier_passage is null),
         coalesce(m.nom_affiche, g.accompagnateur_libre), g.contact
  from groupes g
  left join lieux l on l.id = g.dernier_lieu_id
  left join membres_evenement m on m.id = g.accompagnateur_id
  where g.evenement_id = p_evenement
    and g.deleted_at is null
    and g.statut in ('parti','en_cours')
    and coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at)
        < clock_timestamp() - (p_minutes || ' minutes')::interval
  order by coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at);
$$;

grant execute on function groupes_sans_nouvelles(uuid, integer) to authenticated;

commit;;
