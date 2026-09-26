-- =====================================================================
-- 112 — SUPPRIMER UN ÉVÉNEMENT DEPUIS LA CONSOLE PLATEFORME
--
-- Demande de Ren (26/09) : la console Plateforme créait et réattribuait
-- des événements, mais ne savait pas en retirer un. Les événements
-- d'essai (« BFMF 2028 test », les reconductions de la campagne) s'y
-- accumulaient et comptaient dans les quotas des organisations.
--
-- Deux temps, comme une corbeille :
--
--   1. SUPPRIMER (`supprimer_evenement`) : suppression logique
--      (`deleted_at`). L'événement disparaît pour tout le monde — liste
--      des membres, lien participant, lien autorité (qui lisent tous
--      des événements non supprimés) — et ne compte plus dans le quota.
--      Rien n'est perdu : il se RESTAURE (`restaurer_evenement`).
--   2. SUPPRIMER DÉFINITIVEMENT (`purger_evenement`) : seulement depuis
--      la corbeille, pour un événement déjà supprimé. Toutes ses
--      données partent avec lui (les 47 tables qui le référencent sont
--      en cascade). Les fichiers du stockage (logo, pièces jointes)
--      restent dans leurs buckets : la base ne peut pas les effacer.
--
-- Réservé à l'exploitant de la plateforme (`est_exploitant()`), avec le
-- nom de l'événement à retaper pour les deux suppressions. Refusé en
-- phase d'exploitation : on ne retire pas un événement qui se déroule.
--
-- Les trois écritures passent par des fonctions et non par un `update`
-- direct : la lecture des événements exige `deleted_at is null`, et
-- PostgreSQL refuse d'écrire une ligne que son auteur ne verrait plus
-- (même mécanisme qu'à la 091 pour `supprimer_logiquement`).
-- =====================================================================

begin;

create or replace function supprimer_evenement(p_evenement uuid, p_confirmation text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  e evenements%rowtype;
begin
  if not est_exploitant() then
    raise exception 'Réservé à l''exploitant de la plateforme' using errcode = '42501';
  end if;
  select * into e from evenements where id = p_evenement and deleted_at is null;
  if not found then
    raise exception 'Événement introuvable ou déjà supprimé' using errcode = 'P0002';
  end if;
  if e.phase = 'exploitation' then
    raise exception 'L''événement est en exploitation : changer de phase avant de le supprimer'
      using errcode = '42501';
  end if;
  if lower(trim(coalesce(p_confirmation, ''))) <> lower(trim(e.nom)) then
    raise exception 'Le nom retapé ne correspond pas à celui de l''événement' using errcode = '22023';
  end if;

  -- Tracé dans son propre journal avant de disparaître : si on le
  -- restaure, on saura qui l'avait retiré et quand.
  perform journaliser(p_evenement, 'noyau', 'suppression',
    'Événement supprimé depuis la console plateforme', 'majeur'::importance_journal,
    'evenement', p_evenement, null);

  update evenements set deleted_at = now(), updated_by = auth.uid() where id = p_evenement;
end;
$$;

create or replace function restaurer_evenement(p_evenement uuid)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  e evenements%rowtype;
  v_quota int;
  v_utilises int;
begin
  if not est_exploitant() then
    raise exception 'Réservé à l''exploitant de la plateforme' using errcode = '42501';
  end if;
  select * into e from evenements where id = p_evenement and deleted_at is not null;
  if not found then
    raise exception 'Événement introuvable dans la corbeille' using errcode = 'P0002';
  end if;
  -- Restaurer, c'est recompter dans le quota : même règle qu'à la
  -- création et à la reconduction (101).
  select quota_evenements into v_quota from organisations where id = e.organisation_id;
  select count(*) into v_utilises from evenements
   where organisation_id = e.organisation_id and deleted_at is null;
  if v_quota is not null and v_utilises >= v_quota then
    raise exception 'Quota de licence atteint (% événements sur %) : augmenter le quota ou réattribuer',
      v_utilises, v_quota using errcode = '23514';
  end if;

  update evenements set deleted_at = null, updated_by = auth.uid() where id = p_evenement;
  perform journaliser(p_evenement, 'noyau', 'suppression',
    'Événement restauré depuis la console plateforme', 'majeur'::importance_journal,
    'evenement', p_evenement, null);
end;
$$;

create or replace function purger_evenement(p_evenement uuid, p_confirmation text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  e evenements%rowtype;
begin
  if not est_exploitant() then
    raise exception 'Réservé à l''exploitant de la plateforme' using errcode = '42501';
  end if;
  select * into e from evenements where id = p_evenement and deleted_at is not null;
  if not found then
    raise exception 'Seul un événement déjà dans la corbeille se supprime définitivement'
      using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(p_confirmation, ''))) <> lower(trim(e.nom)) then
    raise exception 'Le nom retapé ne correspond pas à celui de l''événement' using errcode = '22023';
  end if;
  -- Les membres désignent leur rôle en RESTRICT : ils partent d'abord,
  -- le reste suit par cascade.
  delete from membres_evenement where evenement_id = p_evenement;
  delete from evenements where id = p_evenement;
end;
$$;

-- La corbeille : ce que la lecture ordinaire ne montre plus.
create or replace function evenements_supprimes()
returns table (id uuid, nom text, organisation text, phase text, supprime_le timestamptz, membres integer)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not est_exploitant() then
    raise exception 'Réservé à l''exploitant de la plateforme' using errcode = '42501';
  end if;
  return query
    select e.id, e.nom, o.nom, e.phase::text, e.deleted_at,
           (select count(*)::int from membres_evenement m where m.evenement_id = e.id and m.deleted_at is null)
    from evenements e
    left join organisations o on o.id = e.organisation_id
    where e.deleted_at is not null
    order by e.deleted_at desc;
end;
$$;

revoke all on function supprimer_evenement(uuid, text) from public, anon;
revoke all on function restaurer_evenement(uuid) from public, anon;
revoke all on function purger_evenement(uuid, text) from public, anon;
revoke all on function evenements_supprimes() from public, anon;
grant execute on function supprimer_evenement(uuid, text) to authenticated;
grant execute on function restaurer_evenement(uuid) to authenticated;
grant execute on function purger_evenement(uuid, text) to authenticated;
grant execute on function evenements_supprimes() to authenticated;

commit;
