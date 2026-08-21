-- =====================================================================
-- Migration 004 : le créateur d'un événement en devient admin
-- ---------------------------------------------------------------------
-- Sans ce trigger, la policy evenements_creation accepte l'insertion
-- mais rien n'inscrit l'auteur comme membre : il crée un événement
-- qu'il ne voit pas. Défaut mis en évidence par le test de phase 1.
--
-- SECURITY DEFINER obligatoire : au moment de l'insertion l'auteur
-- n'est pas encore membre, donc membres_creation le refuserait.
--
-- auth.uid() nul = insertion par service_role (seed, import,
-- back-office) : on ne crée rien, l'appelant gère l'affectation.
-- =====================================================================

begin;

create or replace function trg_admin_createur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  insert into membres_evenement (evenement_id, user_id, role, origine)
  values (new.id, auth.uid(), 'admin', 'humain')
  on conflict (evenement_id, user_id) do nothing;

  return new;
end;
$$;

create trigger admin_createur
  after insert on evenements
  for each row execute function trg_admin_createur();

commit;
