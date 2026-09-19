-- =====================================================================
-- Migration 058 : libellés explicites dans la main courante
-- ---------------------------------------------------------------------
-- Défaut trouvé à l'usage : les déclencheurs qui consignent un
-- changement de statut concaténaient le code brut de l'énumération
-- ("resolue", "en_cours", "clos") directement dans le texte du
-- journal. Comme ce texte est écrit une fois pour toutes à l'insertion,
-- toute vue qui l'affiche ensuite — le moniteur de la Situation, le
-- rapport — hérite du même code brut. Ce n'est pas un défaut
-- d'affichage à corriger à un seul endroit : c'est le texte source
-- lui-même qu'il fallait rendre lisible.
--
-- Une seule fonction de traduction, partagée par les sept déclencheurs
-- qui consignent un changement de statut.
-- =====================================================================

create or replace function libelle_statut(code text)
returns text
language sql immutable
as $$
  select case code
    when 'a_traiter' then 'à traiter'
    when 'attribuee' then 'attribuée'
    when 'en_cours' then 'en cours'
    when 'resolue' then 'résolue'
    when 'annulee' then 'annulée'
    when 'emis' then 'émis'
    when 'accuse' then 'accusé'
    when 'clos' then 'clôturé'
    when 'annule' then 'annulé'
    when 'recu' then 'reçu'
    when 'pris_en_charge' then 'pris en charge'
    when 'sans_suite' then 'sans suite'
    when 'fait' then 'fait'
    when 'rate' then 'raté'
    when 'parti' then 'parti'
    when 'arrive' then 'arrivé'
    when 'abandon' then 'abandonné'
    else replace(code, '_', ' ')
  end
$$;

comment on function libelle_statut is
  'Traduit un code d''énumération brut (statut) en libellé lisible, pour que le texte écrit dans la main courante le soit une fois pour toutes, plutôt que d''être corrigé séparément à chaque endroit qui l''affiche ensuite.';

-- ---------------------------------------------------------------------

create or replace function trg_journal_mission()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, new.module, 'mission',
      'Mission ' || new.reference || ' [' || new.priorite || '] ' || new.titre,
      (case when new.priorite in ('P1','P2') then 'majeur' else 'routine' end)::importance_journal,
      'mission', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, new.module, 'mission',
      'Mission ' || new.reference || ' → ' || libelle_statut(new.statut::text) ||
      coalesce(' : ' || new.resolution, ''),
      (case when new.priorite in ('P1','P2') then 'notable' else 'routine' end)::importance_journal,
      'mission', new.id, new.reference);
  end if;
  return null;
end;
$$;

create or replace function trg_cycle_mayday()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'accuse' and new.accuse_le is null then
      new.accuse_le := clock_timestamp();
      new.accuse_par := auth.uid();
    end if;
    if new.statut in ('clos','annule') then
      new.clos_le := coalesce(new.clos_le, clock_timestamp());
      if new.alerte_id is not null then
        update alertes set active = false,
               motif_levee = coalesce(new.resolution, 'Mayday clôturé')
        where id = new.alerte_id and active;
      end if;
    end if;
    perform journaliser(new.evenement_id, 'securite', 'mayday',
      new.reference || ' → ' || libelle_statut(new.statut::text) ||
      coalesce(' : ' || new.resolution, ''),
      'majeur'::importance_journal, 'mayday', new.id, new.reference);
  end if;
  return new;
end;
$$;

create or replace function trg_journal_transport()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'logistique', 'transport',
      new.reference || ' — ' || new.nb_personnes || ' pers. ' ||
      coalesce(new.depart_libre,'?') || ' → ' || coalesce(new.arrivee_libre,'?'),
      'routine'::importance_journal, 'transport', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'logistique', 'transport',
      new.reference || ' → ' || libelle_statut(new.statut::text),
      'routine'::importance_journal, 'transport', new.id, new.reference);
  end if;
  return null;
end;
$$;

create or replace function trg_journal_recherche()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'securite', 'recherche',
      'RECHERCHE ' || new.reference || ' — ' || coalesce(new.nom,'personne non identifiée') ||
      ' : ' || new.description, 'majeur', 'recherche', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'securite', 'recherche',
      'Recherche ' || new.reference || ' → ' || libelle_statut(new.statut::text) ||
      coalesce(' (' || new.circonstances || ')', ''),
      'majeur', 'recherche', new.id, new.reference);
  end if;
  return null;
end;
$$;

create or replace function trg_journal_signalement()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' — ' || new.type ||
      coalesce(' : ' || new.description, ''),
      'notable'::importance_journal, 'signalement', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' → ' || libelle_statut(new.statut::text),
      (case when new.statut in ('clos','sans_suite') then 'routine' else 'notable' end)::importance_journal,
      'signalement', new.id, new.reference);
  end if;
  return null;
end;
$$;

create or replace function trg_journal_groupe()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut
     and new.statut in ('parti','arrive','abandon') then
    perform journaliser(new.evenement_id, 'parcours', 'groupe',
      'Groupe ' || new.nom || ' → ' || libelle_statut(new.statut::text) ||
      coalesce(' (' || new.effectif_reel || ' pers.)', ''),
      (case when new.statut = 'abandon' then 'notable' else 'routine' end)::importance_journal,
      'groupe', new.id, new.code);
  end if;
  return null;
end;
$$;

create or replace function trg_journal_jalon()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut
     and new.statut in ('fait','rate') then
    if new.statut = 'fait' and new.fait_le is null then
      update jalons set fait_le = clock_timestamp() where id = new.id;
    end if;
    perform journaliser(new.evenement_id, 'rh', 'jalon',
      'Jalon ' || new.libelle || ' → ' || libelle_statut(new.statut::text),
      (case when new.statut = 'rate' or new.critique then 'notable' else 'routine' end)::importance_journal,
      'jalon', new.id, new.code);
  end if;
  return null;
end;
$$;