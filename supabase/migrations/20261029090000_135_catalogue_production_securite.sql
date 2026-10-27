-- =====================================================================
-- 135 — CATALOGUE INFRASTRUCTURES : LOGE, PRODUCTION, QG SÉCURITÉ
--       (retour de Ren, 27/10)
--
-- Trois locaux de plus dans le calque infrastructures du catalogue
-- standard (organisation_id nul, donc visibles de tous) :
--
--   LOGE       — la loge artistes existait déjà (container 2,4 × 6 m),
--                mais rangée dans le calque logistique : elle passe en
--                infrastructures, à côté des scènes. Même code, les
--                objets déjà posés ne bougent pas (ils portent leur
--                propre calque).
--   BUREAUPROD — bureau de production : le bungalow de l'organisation,
--                6 × 3 m, 2 kW.
--   QGSECU     — QG sécurité : le PC du coordinateur, 6 × 3 m, 3 kW
--                (écrans, radios, chargeurs), en retrait du public.
--
-- Insertion gardée par « n'existe pas encore ». Aucun DROP.
-- =====================================================================

begin;

update public.catalogue_equipements
   set calque = 'infrastructures', ordre = 26
 where organisation_id is null and code = 'LOGE';

insert into public.catalogue_equipements
  (code, libelle, calque, categorie, forme, largeur_m, longueur_m, hauteur_m, nature, puissance_kw, accueil_public, ordre, description)
select v.code, v.libelle, 'infrastructures', 'autre'::public.categorie_element, 'rect', v.largeur_m, v.longueur_m, 2.8, 'objet', v.puissance_kw, false, v.ordre, v.description
from (values
  ('BUREAUPROD', 'Bureau de production 6 × 3 m', 6.0, 3.0, 2.0, 27, 'Bungalow de l''organisation : accueil des prestataires, caisse, radios en charge. Électricité, réseau, à l''écart du public'),
  ('QGSECU',     'QG sécurité 6 × 3 m',          6.0, 3.0, 3.0, 28, 'PC du coordinateur sécurité : écrans, radios, plans affichés. En retrait du public, accès des engins, vue sur le site si possible')
) as v(code, libelle, largeur_m, longueur_m, puissance_kw, ordre, description)
where not exists (
  select 1 from public.catalogue_equipements c
  where c.organisation_id is null and c.code = v.code
);

commit;

-- =====================================================================
-- VÉRIFICATION
--   select code, libelle, calque, ordre from catalogue_equipements
--    where organisation_id is null and code in ('LOGE','BUREAUPROD','QGSECU') order by ordre;
--   -- 3 lignes, toutes en infrastructures, ordres 26, 27, 28
-- =====================================================================
