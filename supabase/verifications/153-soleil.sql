-- 153 — À lancer après la migration (local ou SQL Editor Supabase) : lecture seule.
select to_char(heure_soleil(50.3832, 5.6143, date '2026-11-11', 'coucher') at time zone 'Europe/Brussels', 'HH24:MI') as rando_vtt_coucher,              -- attendu 16:57
       to_char(heure_soleil(50.3832, 5.6143, date '2026-11-11', 'fin_crepuscule_civil') at time zone 'Europe/Brussels', 'HH24:MI') as rando_vtt_nuit, -- attendu 17:33
       to_char(heure_soleil(50.3995, 5.6038, date '2026-11-28', 'coucher') at time zone 'Europe/Brussels', 'HH24:MI') as concert_buco_coucher,         -- attendu 16:39
       to_char(heure_soleil(50.8503, 4.3517, date '2026-06-21', 'coucher') at time zone 'Europe/Brussels', 'HH24:MI') as bruxelles_solstice;           -- attendu 21:59 (publié : 22:00)
select position('heure_soleil(' in pg_get_functiondef('public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer)'::regprocedure)) > 0 as generer_exercice_branche,
       position('''21h40''' in pg_get_functiondef('public.generer_exercice(uuid, text, text, integer, text[], timestamptz, integer)'::regprocedure)) = 0 as table_retiree;
