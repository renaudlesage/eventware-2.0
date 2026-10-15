-- =====================================================================
-- 117 — BARRIÉRAGE DE PÉRIMÈTRE ET PICTOGRAMMES DE SÉCURITÉ (15/10 soir)
--
-- Deux natures d'objet rejoignent le plan à l'échelle (115) :
--   ligne  — une barrière se pose en tirant une ligne sur la carte ; la
--            base garde le tracé (`geometrie`), la longueur d'un module
--            (`largeur_m`), la longueur totale (`longueur_m`) et le nombre
--            de barrières (`quantite`) ;
--   picto  — un pictogramme de sécurité (sortie, extincteur, DEA…) est un
--            point, dessiné à taille fixe quel que soit le zoom.
-- Les contraintes `forme in ('rect','cercle')` de la 115 sont laissées
-- telles quelles (les retoucher demanderait un DROP CONSTRAINT) : la
-- nature est une colonne à part, et `forme` ne vaut que pour les objets
-- à emprise.
-- =====================================================================

begin;

alter table public.catalogue_equipements
  add column if not exists nature text not null default 'objet'
    check (nature in ('objet', 'ligne', 'picto')),
  add column if not exists picto  text;

alter table public.elements_plan
  add column if not exists nature   text check (nature is null or nature in ('objet', 'ligne', 'picto')),
  add column if not exists picto    text,
  add column if not exists quantite integer check (quantite is null or quantite >= 0);

comment on column public.elements_plan.nature   is 'objet (emprise rect/cercle), ligne (barriérage : geometrie = tracé, largeur_m = module, longueur_m = total, quantite = nombre), picto (point à taille fixe)';
comment on column public.elements_plan.quantite is 'Nombre de modules d''une ligne de barrières';

-- Les barrières du catalogue standard se posent désormais en ligne.
update public.catalogue_equipements
   set nature = 'ligne'
 where organisation_id is null and code in ('HERAS', 'NADAR', 'CRASH');

-- Pictogrammes de sécurité (signalisation de type ISO 7010, dessinée
-- par l'application). Emprise symbolique de 0,5 m pour rester dans les
-- contrôles de distance.
insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, nature, picto, ordre, description)
values
  ('SORTIE',   'Sortie',                       'securite', 'autre',               'cercle', 0.5, 0.5, 'picto', 'sortie',          85, 'Sortie normale du public'),
  ('SECOURS',  'Sortie de secours',            'securite', 'sortie_secours',      'cercle', 0.5, 0.5, 'picto', 'sortie_secours',  86, null),
  ('EVAC',     'Sens d''évacuation',           'securite', 'itineraire_evacuation','cercle', 0.5, 0.5, 'picto', 'evacuation',      87, 'Flèche : tourne-la avec la rotation'),
  ('RASSEMB',  'Point de rassemblement',       'securite', 'point_rassemblement', 'cercle', 0.5, 0.5, 'picto', 'rassemblement',   88, null),
  ('EXTPICTO', 'Extincteur (picto)',           'securite', 'extincteur',          'cercle', 0.5, 0.5, 'picto', 'extincteur',      89, null),
  ('RIA',      'Dévidoir / RIA',               'securite', 'extincteur',          'cercle', 0.5, 0.5, 'picto', 'ria',             90, 'Robinet d''incendie armé ou dévidoir'),
  ('HYDRANT',  'Bouche / borne d''incendie',   'securite', 'point_eau',           'cercle', 0.5, 0.5, 'picto', 'hydrant',         91, null),
  ('DEAPICTO', 'DEA (picto)',                  'securite', 'dea',                 'cercle', 0.5, 0.5, 'picto', 'dea',             92, null),
  ('SOINS',    'Premiers soins',               'securite', 'poste_secours',       'cercle', 0.5, 0.5, 'picto', 'premiers_soins',  93, null),
  ('TELURG',   'Téléphone d''urgence',         'securite', 'autre',               'cercle', 0.5, 0.5, 'picto', 'telephone',       94, null),
  ('COUPELEC', 'Coupure électrique',           'securite', 'coffret_electrique',  'cercle', 0.5, 0.5, 'picto', 'coupure_elec',    95, 'Organe de coupure générale'),
  ('COUPGAZ',  'Coupure gaz',                  'securite', 'coupure_gaz',         'cercle', 0.5, 0.5, 'picto', 'coupure_gaz',     96, null),
  ('EAUPOT',   'Eau potable',                  'securite', 'point_eau',           'cercle', 0.5, 0.5, 'picto', 'eau_potable',     97, null),
  ('INTERDIT', 'Accès interdit au public',     'securite', 'autre',               'cercle', 0.5, 0.5, 'picto', 'interdit',        98, null),
  ('DANGER',   'Danger',                       'securite', 'autre',               'cercle', 0.5, 0.5, 'picto', 'danger',          99, 'Triangle d''avertissement : précise le danger dans le nom'),
  ('PMR',      'Accès PMR',                    'securite', 'autre',               'cercle', 0.5, 0.5, 'picto', 'pmr',            100, null)
on conflict do nothing;

commit;
