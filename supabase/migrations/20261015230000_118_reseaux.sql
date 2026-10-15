-- =====================================================================
-- 118 — RÉSEAUX D'ÉLECTRICITÉ ET D'EAU SUR LE PLAN (15/10 nuit)
--
-- Un câble ou une conduite est une ligne (nature 'ligne', 117) tracée
-- d'un objet à un autre : `de_id` → `vers_id`. Tracer un câble raccorde
-- l'objet d'arrivée (`alimente_par`) ; une conduite, de même
-- (`raccord_eau`). Les coffrets de distribution (« chapelles ») sont
-- des objets du calque énergie avec tension, phases, calibre de la
-- protection, différentiel et degré IP : de quoi dessiner le schéma
-- unifilaire et vérifier les points du RGIE que le plan peut vérifier
-- (section ↔ calibre, chute de tension, 30 mA sur les prises, IP en
-- extérieur, mise à la terre des groupes).
-- =====================================================================

begin;

alter table public.catalogue_equipements
  add column if not exists reseau          text check (reseau is null or reseau in ('electricite', 'eau')),
  add column if not exists tension_v       integer check (tension_v is null or tension_v > 0),
  add column if not exists phases          smallint check (phases is null or phases in (1, 3)),
  add column if not exists calibre_a       numeric(6,1) check (calibre_a is null or calibre_a > 0),
  add column if not exists differentiel_ma integer check (differentiel_ma is null or differentiel_ma > 0),
  add column if not exists ip              text,
  add column if not exists section_mm2     numeric(6,2) check (section_mm2 is null or section_mm2 > 0),
  add column if not exists type_cable      text,
  add column if not exists diametre_mm     numeric(6,1) check (diametre_mm is null or diametre_mm > 0);

alter table public.elements_plan
  add column if not exists reseau          text check (reseau is null or reseau in ('electricite', 'eau')),
  add column if not exists de_id           uuid references public.elements_plan(id) on delete set null,
  add column if not exists vers_id         uuid references public.elements_plan(id) on delete set null,
  add column if not exists tension_v       integer check (tension_v is null or tension_v > 0),
  add column if not exists phases          smallint check (phases is null or phases in (1, 3)),
  add column if not exists calibre_a       numeric(6,1) check (calibre_a is null or calibre_a > 0),
  add column if not exists differentiel_ma integer check (differentiel_ma is null or differentiel_ma > 0),
  add column if not exists ip              text,
  add column if not exists section_mm2     numeric(6,2) check (section_mm2 is null or section_mm2 > 0),
  add column if not exists type_cable      text,
  add column if not exists diametre_mm     numeric(6,1) check (diametre_mm is null or diametre_mm > 0),
  add column if not exists terre           boolean not null default false;

comment on column public.elements_plan.reseau is 'Pour une ligne : câble (electricite) ou conduite (eau), de de_id vers vers_id';
comment on column public.elements_plan.calibre_a is 'Objet : calibre de sa protection amont (A). Câble : courant admissible (A)';
comment on column public.elements_plan.differentiel_ma is 'Sensibilité du différentiel qui protège les départs de cet objet (mA)';
comment on column public.elements_plan.terre is 'Mise à la terre réalisée (groupe, armoire) — piquet et liaison vérifiés';

create index if not exists idx_elements_de_id   on public.elements_plan (de_id);
create index if not exists idx_elements_vers_id on public.elements_plan (vers_id);

-- Les groupes et l'armoire existants reçoivent leurs caractéristiques.
update public.catalogue_equipements set tension_v = 400, phases = 3, differentiel_ma = 300, ip = 'IP44',
  calibre_a = case code when 'GE20' then 32 when 'GE60' then 100 when 'GE100' then 160 when 'GE200' then 320 when 'ARMOIRE' then 250 end
 where organisation_id is null and code in ('GE20', 'GE60', 'GE100', 'GE200', 'ARMOIRE');

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, hauteur_m, puissance_kw, production_kva, nature, reseau,
   tension_v, phases, calibre_a, differentiel_ma, ip, section_mm2, type_cable, diametre_mm, source_eau, ordre, description)
values
  -- Énergie : sources et coffrets
  ('RACC',    'Raccordement réseau 63 A (compteur forain)', 'energie', 'coffret_electrique', 'rect', 0.6, 0.4, 1.2, 0, 43, 'objet', null, 400, 3, 63, 300, 'IP44', null, null, null, false, 45, 'Cabine ou compteur de chantier du GRD : 63 A tri = 43 kVA'),
  ('RACC125', 'Raccordement réseau 125 A',                  'energie', 'coffret_electrique', 'rect', 0.6, 0.4, 1.2, 0, 86, 'objet', null, 400, 3, 125, 300, 'IP44', null, null, null, false, 46, '125 A tri = 86 kVA'),
  ('COF32',   'Coffret de distribution 32 A',               'energie', 'coffret_electrique', 'rect', 0.4, 0.3, 0.5, 0, 0, 'objet', null, 400, 3, 32, 30, 'IP44', null, null, null, false, 47, 'Chapelle : prises 16 A mono et 32 A tri, différentiel 30 mA'),
  ('COF63',   'Coffret de distribution 63 A',               'energie', 'coffret_electrique', 'rect', 0.5, 0.4, 0.8, 0, 0, 'objet', null, 400, 3, 63, 30, 'IP44', null, null, null, false, 48, 'Chapelle : départs 16 / 32 A sous 30 mA'),
  ('COF125',  'Coffret de distribution 125 A',              'energie', 'coffret_electrique', 'rect', 0.6, 0.5, 1.2, 0, 0, 'objet', null, 400, 3, 125, 300, 'IP44', null, null, null, false, 49, 'Tête de réseau : différentiel 300 mA sélectif, départs 63 A'),
  -- Énergie : câbles (ligne tracée d''un objet à l''autre)
  ('CAB3G15', 'Câble H07RN-F 3G1,5 (10 A mono)',  'energie', 'cable', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'electricite', 230, 1, 10, null, null, 1.5, 'H07RN-F', null, false, 55, 'Éclairage, petits appareils'),
  ('CAB3G25', 'Câble H07RN-F 3G2,5 (16 A mono)',  'energie', 'cable', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'electricite', 230, 1, 16, null, null, 2.5, 'H07RN-F', null, false, 56, null),
  ('CAB5G25', 'Câble H07RN-F 5G2,5 (16 A tri)',   'energie', 'cable', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'electricite', 400, 3, 16, null, null, 2.5, 'H07RN-F', null, false, 57, null),
  ('CAB5G6',  'Câble H07RN-F 5G6 (32 A tri)',     'energie', 'cable', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'electricite', 400, 3, 32, null, null, 6, 'H07RN-F', null, false, 58, null),
  ('CAB5G16', 'Câble H07RN-F 5G16 (63 A tri)',    'energie', 'cable', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'electricite', 400, 3, 63, null, null, 16, 'H07RN-F', null, false, 59, null),
  ('CAB5G35', 'Câble H07RN-F 5G35 (125 A tri)',   'energie', 'cable', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'electricite', 400, 3, 125, null, null, 35, 'H07RN-F', null, false, 60, null),
  -- Eau : sources, répartiteurs et conduites
  ('COMPTEAU','Raccordement eau (compteur)',      'eau', 'point_eau', 'rect', 0.4, 0.4, 0.5, 0, 0, 'objet', null, null, null, null, null, null, null, null, 25, true, 53, 'Compteur du distributeur ou borne-hydrant avec disconnecteur'),
  ('REPART',  'Répartiteur / nourrice',           'eau', 'point_eau', 'rect', 0.4, 0.3, 0.5, 0, 0, 'objet', null, null, null, null, null, null, null, null, 25, true, 54, 'Vannes de départ vers les postes'),
  ('TUY19',   'Tuyau 3/4" (19 mm)',               'eau', 'autre', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'eau', null, null, null, null, null, null, null, 19, false, 61, 'Tuyau d''arrosage renforcé, alimentaire si bar'),
  ('TUY25',   'Conduite PE 25 mm',                'eau', 'autre', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'eau', null, null, null, null, null, null, null, 25, false, 62, null),
  ('TUY32',   'Conduite PE 32 mm',                'eau', 'autre', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'eau', null, null, null, null, null, null, null, 32, false, 63, null),
  ('TUY50',   'Conduite PE 50 mm',                'eau', 'autre', 'rect', 0.1, 0.1, null, 0, 0, 'ligne', 'eau', null, null, null, null, null, null, null, 50, false, 64, 'Collecteur principal')
on conflict do nothing;

commit;
