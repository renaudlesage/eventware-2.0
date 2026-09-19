-- =====================================================================
-- Migration 068 : fil de commentaires sur une demande
-- ---------------------------------------------------------------------
-- `commentaire_qg` était à sens unique : le QG écrivait, le demandeur
-- lisait. Or c'est souvent le demandeur qui détient la réponse — « non,
-- c'est le frigo du bar 2, pas du bar 1 ».
--
-- Un fil, mais attaché à une demande qui a un statut, un porteur et une
-- échéance — pas un canal libre. C'est la différence avec un tchat
-- d'équipe : ici la conversation ne peut pas remplacer l'objet, elle
-- le documente.
--
-- Le champ unique disparaît : deux endroits pour la même chose finissent
-- toujours par se contredire.
-- =====================================================================

begin;

create table mission_commentaires (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  mission_id    uuid not null references missions(id) on delete cascade,
  auteur_id     uuid references auth.users(id),
  texte         text not null check (length(trim(texte)) > 0),
  created_at    timestamptz not null default now()
);

create index on mission_commentaires (mission_id, created_at);

comment on table mission_commentaires is
  'Échange entre le QG et le demandeur, attaché à une demande précise.';

-- Reprise de l'existant : un commentaire déjà écrit devient le premier
-- message du fil, plutôt que d'être perdu au passage.
insert into mission_commentaires (evenement_id, mission_id, texte, created_at)
select evenement_id, id, commentaire_qg, coalesce(updated_at, created_at)
from missions
where commentaire_qg is not null and trim(commentaire_qg) <> '';

alter table missions drop column commentaire_qg;

alter table mission_commentaires enable row level security;

-- Lecture : quiconque peut lire la demande peut lire son fil.
create policy mission_commentaires_lecture on mission_commentaires for select to authenticated
  using (a_permission(evenement_id, 'missions', 'lire'));

-- Écriture : le QG (capacité de modifier) ET le demandeur lui-même.
-- Le demandeur écrit quelle que soit la phase : c'est sa demande, et
-- lui interdire de répondre viderait le fil de son intérêt.
create policy mission_commentaires_ecriture on mission_commentaires for insert to authenticated
  with check (
    auteur_id = auth.uid()
    and (
      a_permission(evenement_id, 'missions', 'modifier')
      or exists (
        select 1 from missions m
        where m.id = mission_id and m.created_by = auth.uid()
      )
    )
  );

commit;