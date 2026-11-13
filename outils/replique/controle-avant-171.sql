-- Le contrôle des fonctions exposées, hors fonction : la requête de audit_fonctions_exposees() (migration 171),
-- pour une réplique arrêtée AVANT 171 (JUSQUA=170 rejouer.sh), où la fonction n'existe pas encore.
-- Sert à montrer ce que le contrôle aurait vu ; à partir de 171, rejouer.sh appelle la fonction elle-même.
-- La liste `voulues` est celle de la 171 : si elle change là-bas, ce fichier ne sert plus qu'à l'histoire.
with c(voulues) as (select array[
       'contenu_public', 'evenement_public', 'creer_signalement', 'suivi_signalement', 'suivre_signalement',
       'pointer_passage', 'situation_autorite',
       'dossier_par_jeton', 'deposer_avis', 'accuser_reception_dossier',
       'poste_par_jeton']),
f as (
  select p.oid, p.proname, p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig, p.proacl
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
r as (
  select f.sig, 'exécutable sans connexion' || case when f.prosecdef then ' (SECURITY DEFINER)' else '' end as probleme
    from f, c
   where has_function_privilege('anon', f.oid, 'execute') and not (f.proname = any (c.voulues))
  union all
  select f.sig, 'ouverte à PUBLIC'
    from f
   where f.proacl is null
      or exists (select 1 from aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all
  select f.sig, 'search_path non figé'
    from f
   where not exists (select 1 from unnest(coalesce(f.proconfig, '{}')) x where x like 'search_path=%')
)
select sig || ' — ' || probleme from r order by probleme, sig;
