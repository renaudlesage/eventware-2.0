-- =====================================================================
-- Migration 062 : le REX a besoin d'un cycle, pas seulement d'un
-- collecteur — point 8 du REX BFMF 2026.
-- ---------------------------------------------------------------------
-- Aucune des 100 entrées ne portait de statut d'instruction, de
-- porteur ou d'échéance. Le champ `retenu` (booléen) existait déjà
-- mais ne distingue pas « pas encore arbitré » de « rejeté » — les deux
-- se lisaient comme faux. Un statut à quatre états les sépare.
-- =====================================================================

create type statut_rex as enum ('a_arbitrer', 'retenu', 'rejete', 'realise');

alter table rex_entrees add column statut statut_rex not null default 'a_arbitrer';
alter table rex_entrees add column porteur text;
alter table rex_entrees add column echeance date;

comment on column rex_entrees.statut is
  'Cycle d''instruction — a_arbitrer par défaut. Remplace la lecture binaire de `retenu`, qui ne distinguait pas « pas encore vu » de « rejeté ».';

-- Migration des données existantes : un retenu=true devient réellement
-- "retenu", le reste (false ou null) reste à arbitrer plutôt que
-- d'être requalifié à tort en rejeté — on ne sait pas lequel des deux
-- c'était pour les entrées déjà traitées sans ce statut.
update rex_entrees set statut = 'retenu' where retenu = true;