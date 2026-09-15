-- =====================================================================
-- 039 — RÉDUIRE LA SURFACE D'API ANONYME
--
-- Postgres accorde EXECUTE à PUBLIC sur toute fonction créée, et
-- PostgREST publie tout le schéma `public` : les 31 fonctions
-- `security definer` du projet étaient donc joignables sans compte, via
-- /rest/v1/rpc/. La plupart vérifient leurs droits en interne et ne
-- rendraient rien d'utile à un appelant anonyme — mais c'est une
-- défense de second rideau. Le bon réflexe est de ne pas les publier.
--
-- Six d'entre elles doivent rester ouvertes : elles portent le parcours
-- participant et l'accès autorité, tous deux par jeton, sans compte.
-- Chacune a été retrouvée dans le front avant d'être inscrite ici :
--
--   evenement_public     Participant.jsx  — ouverture du lien QR
--   creer_signalement    Participant.jsx  — dépôt d'un signalement
--   suivre_signalement   Participant.jsx  — suivi de son signalement
--   pointer_passage      Pointage.jsx     — pointage d'un passage
--   contenu_public       Vitrine.jsx      — vitrine publique
--   situation_autorite   Autorite.jsx     — accès autorité par jeton
--
-- Toute nouvelle RPC destinée au public devra être ajoutée à cette
-- liste, sans quoi elle naîtra fermée. C'est le sens voulu : une
-- fonction s'ouvre par décision, pas par défaut.
--
-- Migration idempotente : rejouable sans effet de bord.
-- =====================================================================

begin;

do $$
declare
  f record;
  publiques text[] := array[
    'evenement_public',
    'creer_signalement',
    'suivre_signalement',
    'pointer_passage',
    'contenu_public',
    'situation_autorite'
  ];
begin
  for f in
    select p.oid::regprocedure as signature, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Les fonctions de trigger ont été retirées à tout le monde en
      -- 037 : les réinclure ici les rouvrirait à `authenticated`.
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      -- Jamais les fonctions apportées par une extension.
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    -- On retire d'abord à PUBLIC : sans ça, `anon` hérite du droit
    -- quoi qu'on lui révoque directement.
    execute format('revoke execute on function %s from public, anon',
                   f.signature);

    -- `authenticated` garde tout : c'est la surface d'API légitime de
    -- l'application. Le revoke sur PUBLIC ci-dessus le priverait de
    -- l'héritage, on le lui redonne donc explicitement.
    execute format('grant execute on function %s to authenticated',
                   f.signature);

    if f.proname = any (publiques) then
      execute format('grant execute on function %s to anon', f.signature);
    end if;
  end loop;
end
$$;

commit;

-- =====================================================================
-- VÉRIFICATION — doit renvoyer exactement les six fonctions publiques.
--
--   select routine_name
--   from information_schema.role_routine_grants
--   where routine_schema = 'public'
--     and grantee = 'anon'
--     and privilege_type = 'EXECUTE'
--   order by routine_name;
--
-- Puis, dans l'application : ouvrir le lien QR participant dans un
-- onglet privé, déposer un signalement, le suivre. Et se connecter
-- normalement pour vérifier qu'aucun écran ne tombe en erreur — c'est
-- `authenticated` qui vient d'être régrané, un oubli s'y verrait tout
-- de suite.
-- =====================================================================
