-- Jeu d'essai de la réplique : deux organisations, deux événements, quatre personnes.
-- Rejouable : tout est « on conflict do nothing ».
set client_min_messages = warning;

create schema if not exists tests;

-- Se faire passer pour quelqu'un : les policies lisent auth.uid() dans request.jwt.claims.
create or replace function tests.connecter(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
create or replace function tests.anonyme() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', false);
$$;
-- Un contrôle qui s'arrête net quand il échoue.
create or replace function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice '  ✓ %', p_msg;
  else raise exception '  ✗ %', p_msg; end if;
end $$;
-- Vrai si la requête lève l'erreur attendue (42501 : droits ; autre code au choix).
create or replace function tests.refuse(p_sql text, p_code text default null) returns boolean language plpgsql as $$
begin
  execute p_sql; return false;
exception when others then
  return p_code is null or sqlstate = p_code;
end $$;

grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'coord.a@test.local'),
  ('00000000-0000-0000-0000-00000000a002', 'benevole.a@test.local'),
  ('00000000-0000-0000-0000-00000000b001', 'coord.b@test.local'),
  ('00000000-0000-0000-0000-00000000e001', 'exploitant@test.local')
on conflict do nothing;

insert into public.organisations (id, nom, slug, contact_nom, contact_email, contact_tel) values
  ('00000000-0000-0000-0000-0000000000aa', 'Organisation A', 'org-a', 'Ren', 'ren@test.local', '0470 00 00 00'),
  ('00000000-0000-0000-0000-0000000000bb', 'Organisation B', 'org-b', null, null, null)
on conflict do nothing;

insert into public.evenements (id, nom, slug, organisation_id, phase, date_debut, date_fin, date_montage, date_demontage,
                               commune, province, frequentation_min, frequentation_max, point_0_lat, point_0_lon) values
  ('00000000-0000-0000-0000-00000000e0aa', 'BFMF 2027', 'bfmf-2027', '00000000-0000-0000-0000-0000000000aa', 'preparation',
   '2027-08-14', '2027-08-15', '2027-08-12', '2027-08-16', 'Ferrières', 'Liège', 750, 1200, 50.3832, 5.6143),
  ('00000000-0000-0000-0000-00000000e0bb', 'Fête B', 'fete-b', '00000000-0000-0000-0000-0000000000bb', 'preparation',
   '2027-05-01', '2027-05-01', null, null, 'Aywaille', 'Liège', null, null, null, null)
on conflict do nothing;

-- Les rôles standard sont installés par déclencheur à la création de l'événement.
insert into public.membres_evenement (evenement_id, user_id, role_id, actif, nom_affiche)
select e.id, u.id, r.id, true, u.nom
from (values ('00000000-0000-0000-0000-00000000e0aa'::uuid, '00000000-0000-0000-0000-00000000a001'::uuid, 'coordinateur', 'Coord A'),
             ('00000000-0000-0000-0000-00000000e0aa', '00000000-0000-0000-0000-00000000a002', 'benevole', 'Bénévole A'),
             ('00000000-0000-0000-0000-00000000e0bb', '00000000-0000-0000-0000-00000000b001', 'coordinateur', 'Coord B')) as u(evenement, id, code, nom)
join public.evenements e on e.id = u.evenement
join public.roles r on r.evenement_id = e.id and r.code = u.code
where not exists (select 1 from public.membres_evenement m where m.evenement_id = e.id and m.user_id = u.id);

insert into public.membres_plateforme (user_id, niveau, actif)
select '00000000-0000-0000-0000-00000000e001', 'exploitant', true
where not exists (select 1 from public.membres_plateforme where user_id = '00000000-0000-0000-0000-00000000e001');
