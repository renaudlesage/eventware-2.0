-- Réplique minimale pour tester 154 en local. NE PAS exécuter sur Supabase.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create type priorite_mission as enum ('P1','P2','P3','P4');
create type statut_mission as enum ('a_traiter','attribuee','en_cours','resolue','annulee');
create table evenements (id uuid primary key, nom text, organisation_id uuid, phase text, archive boolean, deleted_at timestamptz);
create table missions (id uuid primary key default gen_random_uuid(), evenement_id uuid, reference text, titre text,
  priorite priorite_mission, statut statut_mission, created_at timestamptz, attribuee_le timestamptz,
  demarree_le timestamptz, resolue_le timestamptz, deleted_at timestamptz);
insert into evenements values
 ('74b89117-c0f4-4956-8965-d944757551ee','BFMF2026','a6d4d8c5-0ea3-4786-abba-4e1b59fcb32d','exploitation',true,null),
 ('7e2c829c-e5c7-4302-8db3-6a7afd96c5b6','Rando VTT','a6d4d8c5-0ea3-4786-abba-4e1b59fcb32d','exploitation',false,null),
 ('00000000-0000-0000-0000-0000000000c1','Autre client','00000000-0000-0000-0000-0000000000aa','exploitation',false,null);
