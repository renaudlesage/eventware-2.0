-- =====================================================================
-- Migration 086 : pièces jointes
-- ---------------------------------------------------------------------
-- Une action de préparation s'accompagne souvent d'un document : devis,
-- bon de commande, attestation de montage, plan du fournisseur. Sans
-- endroit où le mettre, il finit dans un fil de courriels que personne
-- ne retrouve six mois plus tard.
--
-- Compartiment PRIVÉ, contrairement aux deux existants. `logos` et
-- `referentiels` sont publics à juste titre — un logo s'affiche, le
-- référentiel RezonWal est un document public. Un devis, non : une
-- adresse devinée ne doit pas suffire à le lire.
--
-- La table est volontairement générique (objet_type + objet_id) :
-- joindre un fichier vaudra aussi pour une demande ou un signalement,
-- et une seconde table ne dirait rien de plus.
-- =====================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('pieces', 'pieces', false, 20971520)
on conflict (id) do nothing;

create table pieces_jointes (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  objet_type    text not null check (objet_type in ('jalon','mission','signalement','creneau')),
  objet_id      uuid not null,
  nom           text not null,
  chemin        text not null unique,
  taille        bigint,
  type_mime     text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index on pieces_jointes (objet_type, objet_id);

comment on column pieces_jointes.chemin is
  'Chemin dans le compartiment « pieces ». Commence toujours par l''identifiant d''événement — c''est lui qui porte les droits.';

alter table pieces_jointes enable row level security;

create policy pj_lecture on pieces_jointes for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);
create policy pj_ecriture on pieces_jointes for all to authenticated
  using (a_permission(evenement_id, 'rh', 'creer'))
  with check (a_permission(evenement_id, 'rh', 'creer'));

-- Stockage : lecture réservée aux membres, écriture à l'encadrement.
create policy pieces_lecture on storage.objects for select to authenticated
  using (bucket_id = 'pieces'
         and est_membre(((storage.foldername(name))[1])::uuid));

create policy pieces_ecriture on storage.objects for insert to authenticated
  with check (bucket_id = 'pieces'
              and a_permission(((storage.foldername(name))[1])::uuid, 'rh', 'creer'));

create policy pieces_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'pieces'
         and a_permission(((storage.foldername(name))[1])::uuid, 'rh', 'creer'));

commit;