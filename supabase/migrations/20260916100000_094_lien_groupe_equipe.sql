-- =====================================================================
-- 094 — LIEN VIVANT ENTRE GROUPE DE TRAVAIL ET ÉQUIPE
--
-- « Reprendre comme équipe » faisait une copie : le nom était recopié
-- une fois, puis les deux objets divergeaient. Renommer le groupe ne
-- renommait pas l'équipe, et le rapprochement se faisant par le nom, le
-- bouton « Reprendre » réapparaissait — prêt à créer un doublon.
--
-- La colonne de liaison règle les deux : on sait de quelle préparation
-- vient une équipe, et le nom suit.
--
-- Ce que ce choix coûte, et qu'il faut assumer : une équipe engagée sur
-- le terrain change de nom si quelqu'un retouche le groupe de travail
-- correspondant, même le jour J. C'est le prix du lien vivant.
--
-- `on delete set null` : supprimer un groupe ne supprime pas l'équipe,
-- qui a sa vie opérationnelle propre — elle perd seulement son origine.
-- =====================================================================

begin;

alter table equipes
  add column if not exists groupe_travail_id uuid
    references groupes_travail(id) on delete set null;

comment on column equipes.groupe_travail_id is
  'Groupe de travail dont cette équipe est issue (094). Le nom suit celui du groupe.';

-- Une équipe par groupe : sans cet index, deux clics sur « Reprendre »
-- recréeraient le doublon qu''on cherche justement à empêcher.
create unique index if not exists equipes_groupe_travail_unique
  on equipes (groupe_travail_id)
  where groupe_travail_id is not null and deleted_at is null;

-- Rattrapage des équipes déjà reprises, rapprochées par le nom — le
-- seul lien qui existait jusqu'ici.
update equipes e
set groupe_travail_id = g.id
from groupes_travail g
where g.evenement_id = e.evenement_id
  and lower(btrim(g.nom)) = lower(btrim(e.nom))
  and e.groupe_travail_id is null
  and e.deleted_at is null
  and g.deleted_at is null;

-- Propagation du nom. Sur le seul renommage : toucher au nom d'un
-- groupe est le cas qui nous occupe, pas ses autres colonnes.
create or replace function trg_nom_groupe_vers_equipe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.nom is distinct from old.nom then
    update equipes
    set nom = new.nom
    where groupe_travail_id = new.id
      and deleted_at is null;
  end if;
  return null;
end;
$$;

revoke all on function trg_nom_groupe_vers_equipe()
  from public, anon, authenticated;

drop trigger if exists nom_groupe_vers_equipe on groupes_travail;
create trigger nom_groupe_vers_equipe
  after update on groupes_travail
  for each row execute function trg_nom_groupe_vers_equipe();

commit;

-- =====================================================================
-- VÉRIFICATION
--
--   select g.nom as groupe, e.code, e.nom as equipe
--   from groupes_travail g
--   left join equipes e on e.groupe_travail_id = g.id
--   order by g.nom;
--
-- Puis, dans l'application : renommer un groupe déjà repris, et
-- vérifier que l'équipe suit dans le menu de rattachement de Bénévoles.
-- =====================================================================
