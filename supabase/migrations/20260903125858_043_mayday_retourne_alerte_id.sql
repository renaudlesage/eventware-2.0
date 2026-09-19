-- Ajoute alerte_id au retour de emettre_mayday, pour que le front
-- puisse déclencher la diffusion externe sans requête supplémentaire.
-- Signature changée : on retire l'ancienne fonction avant de recréer,
-- Postgres refusant de changer les colonnes de sortie d'une fonction
-- existante par simple CREATE OR REPLACE.
drop function if exists emettre_mayday(uuid, text, double precision, double precision, double precision);

create function emettre_mayday(
  p_evenement uuid,
  p_motif text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_precision_m double precision default null
)
returns table (reference text, emis_le timestamptz, alerte_id uuid)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m membres_evenement%rowtype;
  v_ref text;
  v_alerte uuid;
  v_indicatif text;
  v_canal text;
  v_id uuid;
begin
  select * into m from membres_evenement
  where evenement_id = p_evenement and user_id = auth.uid()
    and actif and deleted_at is null;

  if not found then
    raise exception 'Non membre de cet événement' using errcode = '42501';
  end if;

  select a.indicatif, 'CH ' || c.numero into v_indicatif, v_canal
  from attributions a
  left join canaux_radio c on c.id = a.canal_id
  where a.evenement_id = p_evenement and a.membre_id = m.id
    and a.nature = 'radio' and a.rendu_le is null and a.deleted_at is null
  limit 1;

  select 'MAYDAY-' || lpad((count(*) + 1)::text, 2, '0') into v_ref
  from maydays where evenement_id = p_evenement;

  insert into alertes (evenement_id, niveau, titre, message, consigne)
  values (p_evenement, 'urgence',
    'MAYDAY — ' || coalesce(m.nom_affiche, 'intervenant') ||
      coalesce(' (' || v_indicatif || ')', ''),
    coalesce(p_motif, 'Intervenant en difficulté, motif non précisé') ||
      coalesce(' — position ' || round(p_latitude::numeric, 5) || ' / ' ||
               round(p_longitude::numeric, 5), ' — position inconnue'),
    'Le PC prend la main. Ne pas saturer la radio' ||
      coalesce(' — rappel sur ' || v_canal, '') || '.')
  returning id into v_alerte;

  insert into maydays (evenement_id, reference, membre_id, emetteur_nom,
                       indicatif, canal, motif, latitude, longitude,
                       precision_m, alerte_id)
  values (p_evenement, v_ref, m.id, m.nom_affiche, v_indicatif, v_canal,
          p_motif, p_latitude, p_longitude, p_precision_m, v_alerte)
  returning id into v_id;

  perform journaliser(p_evenement, 'securite', 'mayday',
    v_ref || ' émis par ' || coalesce(m.nom_affiche, 'intervenant') ||
    coalesce(' (' || v_indicatif || ')', '') ||
    coalesce(' : ' || p_motif, ''),
    'majeur'::importance_journal, 'mayday', v_id, v_ref);

  return query
    select mm.reference, mm.emis_le, v_alerte from maydays mm where mm.id = v_id;
end;
$$;

grant execute on function emettre_mayday(
  uuid, text, double precision, double precision, double precision
) to authenticated;