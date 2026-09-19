-- =====================================================================
-- Migration 060 : le mouvement de stock doit faire autorité
-- ---------------------------------------------------------------------
-- Défaut structurel trouvé en vérifiant le REX BFMF 2026 : chaque
-- mouvement s'écrivait bien dans mouvements_stock, mais rien — ni
-- trigger, ni mise à jour côté client — ne répercutait ça sur
-- materiel.quantite. Le mouvement existait, la quantité affichée
-- restait figée. Exactement la mécanique du « enregistré puis
-- disparu » que décrit le REX, reproductible ici indépendamment de
-- l'ancienne application.
--
-- materiel.quantite devient un total dérivé, jamais saisi à la main :
-- entrée s'ajoute, sortie se retranche, plus aucune divergence
-- possible entre le registre et le nombre affiché.
-- =====================================================================

create or replace function trg_maj_quantite_stock()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update materiel
  set quantite = quantite + (case when new.sens = 'entree' then new.quantite else -new.quantite end)
  where id = new.materiel_id;
  return new;
end;
$$;

create trigger maj_quantite_stock
after insert on mouvements_stock
for each row execute function trg_maj_quantite_stock();

-- Réconciliation : recalcule quantite pour tout matériel déjà existant
-- à partir de son registre de mouvements, pour repartir d'un état
-- cohérent plutôt que de ne corriger que les mouvements à venir.
update materiel m
set quantite = m.quantite + coalesce((
  select sum(case when ms.sens = 'entree' then ms.quantite else -ms.quantite end)
  from mouvements_stock ms
  where ms.materiel_id = m.id and ms.deleted_at is null
), 0);