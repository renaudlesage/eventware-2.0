-- Réplique minimale pour tester 153 en local. NE PAS exécuter sur Supabase.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create table evenements (id uuid primary key, point_0_lat float8, point_0_lon float8, date_debut date);
insert into evenements values ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6', 50.3832160143447, 5.61429135778638, '2026-11-11'),
                              ('c0ae8b79-e502-4907-8b41-f3a3324e3507', 50.3994830854345, 5.60376536227559, '2026-11-28'),
                              ('00000000-0000-0000-0000-000000000000', null, null, '2026-10-31');
-- generer_exercice réduit à son contexte, avec la table telle qu'en production (128)
create or replace function public.generer_exercice(p_evenement uuid, p_titre text, p_format text default 'table', p_duree_min integer default 90,
  p_objectifs text[] default array['ALERTE'], p_date timestamptz default null, p_max_pieges integer default 4)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare ev evenements%rowtype; ctx jsonb;
begin
  select * into ev from evenements where id = p_evenement;
  ctx := jsonb_build_object(
    'nb_public', 'x',
    'coucher_soleil', case extract(month from coalesce(ev.date_debut, current_date))::int
                        when 11 then '17h10' when 12 then '16h40' when 1 then '17h00' when 2 then '17h50' when 3 then '18h40'
                        when 10 then '18h50' when 9 then '19h50' when 4 then '20h30' when 8 then '20h50' else '21h40' end,
    'nb_participants', 'y');
  raise notice 'contexte %', ctx;
  return null;
end $$;
