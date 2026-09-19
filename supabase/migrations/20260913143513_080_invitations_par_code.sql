-- =====================================================================
-- Migration 080 : rejoindre un événement par code d'invitation
-- ---------------------------------------------------------------------
-- Aujourd'hui, rejoindre un événement demande à la personne de copier
-- son identifiant UUID depuis « Mon compte », de l'envoyer au
-- coordinateur, qui le recolle à la main. Pour cinquante membres d'une
-- ASBL, ce sont cinquante copier-coller d'UUID — et autant d'occasions
-- de se tromper d'un caractère sans jamais savoir lequel.
--
-- Un code court remplace l'échange : la personne crée son compte, tape
-- le code, elle est dedans avec le bon rôle.
--
-- Le code est volontairement AMBIGU-SAFE : ni 0/O, ni 1/I/L. Il sera lu
-- à voix haute au téléphone et recopié depuis un SMS.
-- =====================================================================

begin;

create or replace function code_invitation()
returns text
language sql volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
           (random() * 30)::int + 1, 1), '')
  from generate_series(1, 7);
$$;

create table invitations (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null unique default code_invitation(),
  libelle       text,
  role_id       uuid references roles(id) on delete set null,
  equipe_id     uuid references equipes(id) on delete set null,
  usages_max    integer,
  usages        integer not null default 0,
  expire_le     timestamptz,
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

comment on column invitations.usages_max is
  'Null = illimité. Un lien « bénévoles » sert cinquante fois ; un lien « coordinateur » devrait servir une seule.';
comment on column invitations.libelle is
  'À quoi sert ce lien — « Bénévoles bar », « Comité ». C''est ce qu''on relit six mois plus tard pour savoir qui a reçu quoi.';

alter table invitations enable row level security;

create policy invitations_lecture on invitations for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);
create policy invitations_ecriture on invitations for all to authenticated
  using (a_permission(evenement_id, 'membres', 'creer'))
  with check (a_permission(evenement_id, 'membres', 'creer'));

commit;