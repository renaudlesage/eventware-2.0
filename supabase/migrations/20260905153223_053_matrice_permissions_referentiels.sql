insert into matrice_permissions (role, phase, ressource, action)
select r.role::role_evenement, p.phase::phase_evenement, 'referentiels', a.action::action_permission
from
  (values ('coordinateur'), ('chef_equipe')) as r(role),
  (values ('preparation'), ('montage'), ('exploitation'), ('demontage'), ('cloture')) as p(phase),
  (values ('lire'), ('creer'), ('modifier')) as a(action)
on conflict do nothing;