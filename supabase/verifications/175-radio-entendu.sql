-- =====================================================================
-- Vérification de la migration 175 — lecture seule.
--
-- À lancer dans le SQL Editor de Supabase après le « Go 175 ». Rien
-- n'est écrit. Chaque ligne doit rendre `ok = true`.
-- =====================================================================
select 'colonne source, « talkie » par défaut' as controle,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'messages_vocaux'
                  and column_name = 'source' and column_default = '''talkie''::text' and is_nullable = 'NO') as ok
union all
select 'contrainte : talkie ou radio',
       exists (select 1 from pg_constraint where conname = 'messages_vocaux_source_check'
                  and conrelid = 'public.messages_vocaux'::regclass)
union all
select 'politique restrictive sur l''insertion',
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages_vocaux'
                  and policyname = 'messages_vocaux_radio' and permissive = 'RESTRICTIVE' and cmd = 'INSERT')
union all
select 'politique d''insertion de la 162 toujours là',
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages_vocaux'
                  and policyname = 'messages_vocaux_creation')
union all
select 'talkie_repondre connaît la radio',
       (select prosrc like '%m.source = ''radio''%' from pg_proc where oid = 'public.talkie_repondre(uuid)'::regprocedure)
union all
select 'talkie_repondre fermée à anon, ouverte aux membres',
       not has_function_privilege('anon', 'public.talkie_repondre(uuid)', 'execute')
       and has_function_privilege('authenticated', 'public.talkie_repondre(uuid)', 'execute')
union all
select 'aucune fonction exposée par erreur',
       not exists (select 1 from audit_fonctions_exposees());

-- Pour information : combien de messages de chaque source (juste après
-- application, tout est « talkie »).
select source, count(*) from messages_vocaux group by source order by source;
