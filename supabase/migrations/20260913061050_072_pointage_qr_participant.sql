-- =====================================================================
-- Migration 072 : pointage par QR, scanné par le participant lui-même
-- ---------------------------------------------------------------------
-- Constat de terrain : personne n'a les moyens de tenir un bénévole à
-- chaque borne pendant huit heures. Le participant scanne donc le QR
-- posé sur la borne et se pointe lui-même.
--
-- MAIS un comptage par bénévole et un auto-pointage ne valent pas la
-- même chose, et les confondre serait dangereux :
--   - le bénévole voit passer TOUT LE MONDE ;
--   - le scan n'enregistre que ceux qui ont bien voulu scanner.
--
-- « 52 encore dehors » et « 52 n'ont pas scanné » demandent deux
-- décisions opposées — lancer une battue, ou ne rien faire. La colonne
-- `source` existe pour que l'écran ne puisse jamais présenter l'un
-- pour l'autre.
-- =====================================================================

begin;

alter table comptages_parcours add column source text not null default 'benevole';
alter table comptages_parcours add constraint chk_source_comptage
  check (source in ('benevole', 'scan'));

alter table comptages_parcours add column cle_client uuid;
alter table comptages_parcours add column latitude double precision;
alter table comptages_parcours add column longitude double precision;
alter table comptages_parcours add column precision_m double precision;

-- Idempotence : la file hors-ligne rejoue les envois ratés. Sans cette
-- clé, un réseau capricieux compterait la même personne trois fois.
create unique index on comptages_parcours (evenement_id, cle_client)
  where cle_client is not null;

comment on column comptages_parcours.source is
  'benevole = compté par un posté qui voit tout passer. scan = auto-déclaré, donc partiel par nature.';

commit;