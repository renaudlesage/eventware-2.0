begin;

insert into organisations (nom, slug, statut, modules_autorises, notes)
values (
  'Essais (auto)', 'essais-auto', 'essai',
  '{"securite":true,"logistique":false,"rh":false,"parcours":false,
    "sos_participants":false,"plan_implantation":false,"analyse":false}'::jsonb,
  'Organisation par défaut pour tout événement créé hors du parcours client. À réattribuer à une vraie organisation dès qu''un client est identifié.'
)
on conflict (slug) do nothing;

set local session_replication_role = replica;

update evenements
set organisation_id = (select id from organisations where slug = 'essais-auto')
where organisation_id is null and deleted_at is null;

set local session_replication_role = default;

-- Postgres interdit une sous-requête directe dans DEFAULT : on
-- l'enveloppe dans une fonction, seule forme autorisée.
create or replace function organisation_essai_par_defaut()
returns uuid
language sql stable
as $$
  select id from organisations where slug = 'essais-auto';
$$;

alter table evenements
  alter column organisation_id
  set default organisation_essai_par_defaut();

commit;