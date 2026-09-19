-- =====================================================================
-- Migration 031 : la licence se propage aux événements
-- ---------------------------------------------------------------------
-- Défaut trouvé au test : le contrôle empêchait d'ACTIVER un module non
-- souscrit, mais laissait actif ce qui l'était déjà. Retirer un module
-- d'une licence — résiliation, fin d'essai, changement d'offre —
-- n'avait donc aucun effet sur les événements en cours.
--
-- Les événements clos ne sont pas touchés : on ne réécrit pas
-- l'historique d'un événement passé pour une raison commerciale.
-- =====================================================================

begin;

create or replace function trg_licence_vers_evenements()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  e record;
  v_modules jsonb;
  k text;
  v_retires text[];
begin
  if new.modules_autorises is not distinct from old.modules_autorises then
    return null;
  end if;

  for e in
    select id, nom, modules from evenements
    where organisation_id = new.id and deleted_at is null and phase <> 'cloture'
  loop
    v_modules := e.modules;
    v_retires := '{}';

    for k in select jsonb_object_keys(e.modules)
    loop
      if coalesce((e.modules ->> k)::boolean, false)
         and not coalesce((new.modules_autorises ->> k)::boolean, false) then
        v_modules := jsonb_set(v_modules, array[k], 'false'::jsonb);
        v_retires := v_retires || k;
      end if;
    end loop;

    if array_length(v_retires, 1) > 0 then
      update evenements set modules = v_modules where id = e.id;
      perform journaliser(e.id, 'noyau', 'licence',
        'Module(s) désactivé(s) par changement de licence : ' ||
        array_to_string(v_retires, ', '),
        'majeur'::importance_journal, 'organisation', new.id, null);
    end if;
  end loop;

  return null;
end;
$$;

create trigger licence_vers_evenements after update on organisations
  for each row execute function trg_licence_vers_evenements();

-- Mise en cohérence de l'existant
do $$
declare o record;
begin
  for o in select id, modules_autorises from organisations loop
    update organisations set updated_at = now() where id = o.id;
  end loop;
end $$;

commit;