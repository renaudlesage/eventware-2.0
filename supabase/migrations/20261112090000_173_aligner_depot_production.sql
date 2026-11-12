-- =====================================================================
-- 173 — ALIGNER LE DÉPÔT SUR LA PRODUCTION : DIX FONCTIONS FERMÉES
--       HORS MIGRATION
--
-- Constat du 12/11, en comparant fonction par fonction les droits de la
-- production et ceux d'une base reconstruite depuis le dépôt (207
-- fonctions, empreinte des droits, du search_path et du mode
-- d'exécution) : 197 identiques, 10 différentes. Ces dix fonctions ont
-- été refermées directement en production, sans qu'aucune migration du
-- dépôt ne le fasse :
--
--   · `missions_similaires`, `normaliser_demande`, `score_similarite`
--     (116) : retirées à PUBLIC et aux anonymes, gardées aux connectés ;
--   · `_point_element` (109) : search_path figé ;
--   · six fonctions de déclencheur (109, 110, 114, 115) : retirées de l'API.
--
-- La production est donc saine, mais le dépôt ne la décrivait pas : une
-- base reconstruite depuis les migrations (« Reconstruire un projet
-- neuf ») aurait laissé `normaliser_demande`, en SECURITY DEFINER,
-- exécutable sans connexion. Et le contrôle de la 171, lancé sur la
-- réplique, ne pouvait pas être vide.
--
-- Cette migration écrit dans le dépôt ce qui est déjà vrai en
-- production. Elle n'y change RIEN (chaque ordre y est déjà satisfait) ;
-- elle n'a d'effet que sur une base reconstruite. Aucun DROP, rejouable.
-- =====================================================================

begin;

-- 116 — demandes similaires : connectés seulement (règle de 090).
revoke execute on function
  public.missions_similaires(uuid, text, text, uuid, uuid, numeric, uuid, timestamptz),
  public.normaliser_demande(uuid, text),
  public.score_similarite(text, text)
from public, anon;
grant execute on function
  public.missions_similaires(uuid, text, text, uuid, uuid, numeric, uuid, timestamptz),
  public.normaliser_demande(uuid, text),
  public.score_similarite(text, text)
to authenticated;

-- 109 — aide interne de situation_autorite : search_path figé. Ses droits
-- (aucun appel direct) sont déjà ceux de la production.
alter function public._point_element(jsonb) set search_path = public, pg_temp;

-- 109, 110, 114, 115 — fonctions de déclencheur : hors de l'API. La 171
-- les referme déjà par sa boucle ; elles sont nommées ici pour que
-- l'écart avec la production soit écrit quelque part.
revoke execute on function
  public.prc_trg_recalcul(),
  public.prc_trg_recalcul_mission(),
  public.trg_code_element_plan(),
  public.trg_code_fiche_reflexe(),
  public.trg_contact_visible_autorite(),
  public.trg_reference_recherche()
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
