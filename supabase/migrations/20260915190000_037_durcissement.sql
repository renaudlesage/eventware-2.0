-- =====================================================================
-- 037 — DURCISSEMENT SÉCURITÉ (lot 0)
--
-- Quatre corrections relevées par le linter Supabase du 15/09/2026 :
--
--   1. `journaliser` était SECURITY DEFINER, sans contrôle d'appartenance,
--      et exécutable par le rôle `anon`. N'importe qui disposant de la clé
--      publiable — qui est dans le bundle, c'est son rôle — et de l'UUID
--      d'un événement pouvait écrire la ligne de son choix dans SON
--      journal. Or le journal est la pièce qu'on produit devant une
--      commune ou un parquet après un incident : une trace qu'un tiers
--      peut écrire n'est plus une trace.
--
--   2. La vue `v_missions_ouvertes` était SECURITY DEFINER — elle
--      contournait donc RLS — et n'est utilisée nulle part.
--
--   3. Onze fonctions avaient un `search_path` mutable, dont des triggers
--      qui touchent au stock et aux droits.
--
--   4. Les fonctions de trigger étaient exposées à `anon` sur /rpc/.
--
-- Migration idempotente : rejouable sans effet de bord.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. journaliser — contrôle d'appartenance sur les appels directs
--
-- Le contrôle ne peut pas être inconditionnel : une vingtaine de triggers
-- appellent cette fonction, et certains se déclenchent sur des écritures
-- publiques parfaitement légitimes — un participant qui crée un
-- signalement par QR, un pointage de passage. Ces appels-là arrivent sans
-- auth.uid() et un `est_membre` sec les ferait échouer, donc échouer la
-- création du signalement avec eux.
--
-- La distinction se fait sur le rôle courant. Dans un trigger SECURITY
-- DEFINER, le rôle courant est le propriétaire de la fonction. Sur un
-- appel REST, c'est `anon` ou `authenticated` : c'est exactement le
-- chemin qu'on veut fermer, et lui seul.
-- ---------------------------------------------------------------------
create or replace function journaliser(
  p_evenement uuid, p_module text, p_categorie text, p_texte text,
  p_importance importance_journal default 'routine',
  p_objet_type text default null, p_objet_id uuid default null,
  p_objet_ref text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated')
     and not est_membre(p_evenement) then
    raise exception
      'journaliser : appel refusé — vous n''êtes pas membre de cet événement'
      using errcode = '42501';
  end if;

  insert into journal (evenement_id, source, module, categorie, texte,
                       importance, objet_type, objet_id, objet_ref, phase, auteur)
  values (p_evenement, 'systeme', p_module, p_categorie, p_texte,
          p_importance, p_objet_type, p_objet_id, p_objet_ref,
          (select phase from evenements where id = p_evenement),
          auth.uid());
end;
$$;

-- Et on retire la fonction de la surface d'API de `anon` : un participant
-- n'a aucune raison de journaliser directement, les triggers s'en
-- chargent pour lui. `authenticated` la garde — Meteo.jsx l'appelle — mais
-- passe désormais par le contrôle ci-dessus.
revoke all on function journaliser(uuid, text, text, text,
                                   importance_journal, text, uuid, text)
  from public, anon;
grant execute on function journaliser(uuid, text, text, text,
                                      importance_journal, text, uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 2. Vue de pilotage inutilisée
--
-- Définie en 009_a_014, jamais interrogée par le front. Elle s'exécutait
-- avec les droits de son créateur, donc au-dessus de RLS. Si elle
-- redevient utile un jour, la recréer avec `security_invoker = true`.
-- ---------------------------------------------------------------------
drop view if exists public.v_missions_ouvertes;

-- ---------------------------------------------------------------------
-- 3. search_path figé sur toutes les fonctions qui n'en ont pas
--
-- Boucle plutôt que liste nominative : la liste du linter est celle
-- d'aujourd'hui, la boucle rattrape aussi celles qu'on écrira demain en
-- oubliant la clause. Une fonction SECURITY DEFINER dont le search_path
-- est laissé libre peut être détournée en plaçant un objet de même nom
-- dans un schéma consulté avant `public`.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (
        p.proconfig is null
        or not exists (
          select 1 from unnest(p.proconfig) c where c like 'search\_path=%'
        )
      )
      -- Jamais les fonctions apportées par une extension (pgcrypto,
      -- postgis…) : elles ne nous appartiennent pas, l'ALTER échouerait
      -- et ferait tomber toute la migration.
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp',
                   f.signature);
    raise notice 'search_path figé : %', f.signature;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Fonctions de trigger retirées de l'API REST
--
-- PostgREST expose toute fonction du schéma public, y compris celles qui
-- ne retournent qu'un `trigger` et n'ont aucun sens hors de leur table.
-- Postgres vérifie le droit d'exécution d'une fonction de trigger au
-- moment où le trigger est CRÉÉ, pas au moment où il se déclenche : les
-- retirer à `anon` et `authenticated` ne casse donc aucun déclenchement.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated',
                   f.signature);
  end loop;
end
$$;

commit;

-- =====================================================================
-- VÉRIFICATION — à lancer après la migration.
--
-- (a) Le journal refuse un appel direct sur un événement dont on n'est
--     pas membre. À exécuter depuis l'application, pas depuis le SQL
--     Editor : ici, le rôle courant est postgres, donc le garde-fou est
--     volontairement inactif.
--
-- (b) Plus aucune fonction publique sans search_path :
--     select p.oid::regprocedure
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.prokind = 'f'
--       and (p.proconfig is null
--            or not exists (select 1 from unnest(p.proconfig) c
--                           where c like 'search\_path=%'));
--     -- doit renvoyer 0 ligne
--
-- (c) La vue a disparu :
--     select count(*) from pg_views
--     where schemaname = 'public' and viewname = 'v_missions_ouvertes';
--     -- doit renvoyer 0
-- =====================================================================
