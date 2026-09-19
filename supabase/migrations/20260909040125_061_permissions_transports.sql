-- =====================================================================
-- Migration 061 : droits sur les transports
-- ---------------------------------------------------------------------
-- REX BFMF 2026, point 3 : 12 transports sur 18 saisis en mission
-- logistique générique parce que l'opérateur QG n'avait pas le module
-- Transport. Vérification faite : zéro ligne pour 'transports' dans la
-- matrice. Ce n'était pas un rejet de l'outil, c'était son absence.
-- =====================================================================

insert into matrice_permissions (role, phase, ressource, action)
select r.role::role_evenement, p.phase::phase_evenement, 'transports', a.action::action_permission
from
  (values ('coordinateur'), ('chef_equipe')) as r(role),
  (values ('preparation'), ('montage'), ('exploitation'), ('demontage'), ('cloture')) as p(phase),
  (values ('lire'), ('creer'), ('modifier')) as a(action)
on conflict do nothing;