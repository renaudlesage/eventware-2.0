-- =====================================================================
-- Migration 003 : correction de l'horodatage des bascules de phase
-- ---------------------------------------------------------------------
-- Défaut trouvé au test : now() renvoie l'heure de DÉBUT de transaction.
-- Trois bascules enchaînées dans la même transaction portaient donc un
-- horodatage identique, rendant leur ordre indéterminable dans le
-- journal. clock_timestamp() donne l'heure réelle de l'instruction.
--
-- Conséquence si non corrigé : une chronologie post-événement fausse,
-- invisible jusqu'au jour où on l'analyse.
-- =====================================================================

alter table bascule_phase alter column bascule_le set default clock_timestamp();
