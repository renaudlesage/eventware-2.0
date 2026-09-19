-- La politique exigeait 'evenement'/'modifier', une capacité qui
-- n'existe dans aucune ligne de la matrice : seuls coordinateur et
-- admin y accédaient, par leur contournement « tout pouvoir ». Ça
-- marchait par accident, pas par conception — même défaut que pour les
-- transports et les référentiels.
--
-- On aligne sur 'referentiels'/'modifier', qui gouverne déjà la
-- publication des lieux et du programme. Une seule capacité pour les
-- trois actes de publication : pouvoir publier le plan sans pouvoir
-- écrire un mot n'aurait pas de sens.
drop policy if exists communications_ecriture on communications;

create policy communications_ecriture on communications for all to authenticated
  using (a_permission(evenement_id, 'referentiels', 'modifier'))
  with check (a_permission(evenement_id, 'referentiels', 'modifier'));