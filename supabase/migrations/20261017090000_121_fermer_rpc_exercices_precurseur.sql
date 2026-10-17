-- =====================================================================
-- 121 — REFERMER LES RPC OUVERTES PAR 114 ET 120
--
-- 114 (précurseur) et 120 (exercices) ont accordé EXECUTE à
-- `authenticated` sans d'abord le retirer à PUBLIC et à `anon`, comme
-- le veut 090. Résultat : sept fonctions joignables sans compte via
-- /rest/v1/rpc/. Aucune ne rend quoi que ce soit à un anonyme — les
-- definer vérifient `a_permission`, les invoker tombent sur la RLS —
-- mais une fonction s'ouvre par décision, pas par défaut.
--
--   avant_vol, generer_exercice, exercice_permet   definer  (120)
--   exercice_objectifs_catalogue, remplir_champs   invoker  (120)
--   prc_grappes, prc_synthese                      invoker  (114)
--
-- Toutes ne sont appelées que depuis des écrans connectés
-- (Exercices.jsx, Precurseur.jsx) : `authenticated` les garde.
--
-- Les deux fonctions de 120 sans `search_path` figé le reçoivent ici.
--
-- Migration idempotente : rejouable sans effet de bord.
-- =====================================================================

begin;

-- Retirer d'abord à PUBLIC : sans ça, `anon` hérite du droit quoi
-- qu'on lui révoque directement (cf. 090).
revoke execute on function
  public.avant_vol(uuid),
  public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer),
  public.exercice_permet(uuid, public.action_permission),
  public.exercice_objectifs_catalogue(),
  public.remplir_champs(text, jsonb),
  public.prc_grappes(uuid, integer),
  public.prc_synthese(uuid)
from public, anon;

grant execute on function
  public.avant_vol(uuid),
  public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer),
  public.exercice_permet(uuid, public.action_permission),
  public.exercice_objectifs_catalogue(),
  public.remplir_champs(text, jsonb),
  public.prc_grappes(uuid, integer),
  public.prc_synthese(uuid)
to authenticated;

alter function public.exercice_objectifs_catalogue() set search_path = public, pg_temp;
alter function public.remplir_champs(text, jsonb) set search_path = public, pg_temp;

commit;

-- =====================================================================
-- VÉRIFICATION — doit renvoyer exactement les six fonctions publiques
-- de 090 (contenu_public, creer_signalement, evenement_public,
-- pointer_passage, situation_autorite, suivre_signalement).
--
--   select p.proname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.prokind = 'f'
--     and p.prorettype <> 'pg_catalog.trigger'::regtype
--     and has_function_privilege('anon', p.oid, 'execute')
--   order by 1;
--
-- Puis, connecté : ouvrir Exercices (avant-vol, génération) et
-- Précurseur — aucun écran ne doit tomber en erreur.
-- =====================================================================
