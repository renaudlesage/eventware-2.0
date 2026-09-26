-- =====================================================================
-- 110 — RÉFÉRENCES ATTRIBUÉES PAR LA BASE, CODES RÉUTILISABLES
--
-- Audit du 19/09, points 4.8 et 4.9.
--
-- 4.8 — Numérotation côté client. Sécurité numérotait les recherches
--   (« REC- » + nombre de lignes affichées + 1) et les fiches réflexe
--   (« FR- » + nombre de fiches + 1). Les lignes supprimées ne sont plus
--   affichées (RLS) mais gardent leur référence : après une suppression,
--   le numéro calculé existe déjà, et l'insertion échoue sur l'unicité
--   (23505). Même défaut si deux postes déclarent en même temps. La base
--   attribue désormais la référence, comme elle le fait déjà pour les
--   missions (LOG-012, 011) et les SOS (007) : le plus grand numéro de
--   l'événement, supprimées comprises, plus un, sous un verrou par
--   événement. Une référence fournie explicitement est gardée telle
--   quelle (pack standard, import).
--
-- 4.9 — Réimporter le code d'une entrée supprimée. L'unicité
--   (evenement_id, code) de lieux, équipes, types de mission, matériel et
--   contacts comptait les lignes supprimées, que l'import ne voit pas
--   (RLS) : il croyait le code libre, l'insertion échouait (23505,
--   message brut). L'unicité ne porte plus que sur les lignes vivantes :
--   un code redevient disponible quand sa ligne est supprimée, et la
--   ligne supprimée reste en base comme trace. Aucune fonction ne fait
--   `on conflict (evenement_id, code)` sur ces cinq tables (vérifié : les
--   deux seules le font sur `roles` et `fiches_reflexe`, non touchées).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 4.8 — Recherches : REC-01, REC-02…
-- ---------------------------------------------------------------------
create or replace function trg_reference_recherche()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  v_n int;
begin
  if new.reference is not null and new.reference <> '' then
    return new;
  end if;
  -- Deux déclarations simultanées sur le même événement prennent le
  -- verrou l'une après l'autre : pas de doublon.
  perform pg_advisory_xact_lock(hashtext('recherche:' || new.evenement_id::text));
  select coalesce(max(substring(reference from '^REC-([0-9]+)$')::int), 0) + 1
    into v_n
  from recherches
  where evenement_id = new.evenement_id;
  new.reference := 'REC-' || lpad(v_n::text, 2, '0');
  return new;
end;
$$;

drop trigger if exists reference_recherche on recherches;
create trigger reference_recherche before insert on recherches
  for each row execute function trg_reference_recherche();

-- ---------------------------------------------------------------------
-- 4.8 — Fiches réflexe : FR-01, FR-02…
-- Le pack standard fournit ses propres codes et n'est pas concerné.
-- ---------------------------------------------------------------------
create or replace function trg_code_fiche_reflexe()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  v_n int;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('fiche:' || new.evenement_id::text));
  select coalesce(max(substring(code from '^FR-([0-9]+)$')::int), 0) + 1
    into v_n
  from fiches_reflexe
  where evenement_id = new.evenement_id;
  new.code := 'FR-' || lpad(v_n::text, 2, '0');
  return new;
end;
$$;

drop trigger if exists code_fiche_reflexe on fiches_reflexe;
create trigger code_fiche_reflexe before insert on fiches_reflexe
  for each row execute function trg_code_fiche_reflexe();

-- ---------------------------------------------------------------------
-- 4.9 — Unicité des codes sur les seules lignes vivantes.
-- ---------------------------------------------------------------------
alter table lieux         drop constraint if exists lieux_evenement_id_code_key;
alter table equipes       drop constraint if exists equipes_evenement_id_code_key;
alter table types_mission drop constraint if exists types_mission_evenement_id_code_key;
alter table materiel      drop constraint if exists materiel_evenement_id_code_key;
alter table contacts      drop constraint if exists contacts_evenement_id_code_key;

create unique index if not exists lieux_code_vivant
  on lieux (evenement_id, code) where deleted_at is null;
create unique index if not exists equipes_code_vivant
  on equipes (evenement_id, code) where deleted_at is null;
create unique index if not exists types_mission_code_vivant
  on types_mission (evenement_id, code) where deleted_at is null;
create unique index if not exists materiel_code_vivant
  on materiel (evenement_id, code) where deleted_at is null;
create unique index if not exists contacts_code_vivant
  on contacts (evenement_id, code) where deleted_at is null;

commit;

-- =====================================================================
-- VÉRIFICATION — droits.sql, bloc V :
--   une recherche et une fiche insérées sans référence en reçoivent une ;
--   après suppression logique de la dernière, la suivante ne heurte pas
--   l'unicité ; un lieu supprimé libère son code, un lieu vivant non.
-- =====================================================================
