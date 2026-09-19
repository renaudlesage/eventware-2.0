-- =====================================================================
-- Migration 085 : un membre ne peut pas s'attribuer un rôle
-- ---------------------------------------------------------------------
-- La politique d'écriture autorisait « user_id = auth.uid() » pour que
-- chacun règle son nom, son téléphone et ses pavés. Mais elle ne
-- limitait aucune colonne : un bénévole pouvait donc se nommer
-- coordinateur. Vérifié en base — l'élévation passait.
--
-- On garde la liberté sur ce qui est personnel, on bloque ce qui est
-- une attribution : rôle, équipe, périmètre, activation. Ces quatre-là
-- ne se décident pas soi-même.
--
-- Le déclencheur ne s'applique qu'à un utilisateur authentifié : une
-- migration ou une tâche d'administration (auth.uid() nul) garde la
-- main, sinon plus personne ne pourrait réparer une donnée.
-- =====================================================================

create or replace function trg_protege_attribution_membre()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.role      is distinct from old.role
   or new.role_id   is distinct from old.role_id
   or new.equipe_id is distinct from old.equipe_id
   or new.perimetre is distinct from old.perimetre
   or new.actif     is distinct from old.actif)
     and not a_permission(new.evenement_id, 'membres', 'modifier') then
    raise exception
      'Un rôle, une équipe ou un périmètre sont attribués par l''encadrement, pas choisis'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists protege_attribution_membre on membres_evenement;
create trigger protege_attribution_membre
  before update on membres_evenement
  for each row execute function trg_protege_attribution_membre();