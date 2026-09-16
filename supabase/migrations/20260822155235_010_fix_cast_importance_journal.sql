-- ============ 010_fix_cast_importance_journal ============
-- Défaut trouvé au test : une expression CASE renvoie du text, pas
-- l'énuméré importance_journal. La résolution de surcharge échoue et
-- tout changement de statut d'un signalement plantait.
-- Un littéral simple ('notable') passait, lui, car « unknown » se
-- résout vers l'énuméré. D'où un bug invisible à l'insertion.
create or replace function trg_journal_signalement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' — ' || new.type ||
      coalesce(' : ' || new.description, ''),
      'notable'::importance_journal, 'signalement', new.id, new.reference);
  elsif new.statut is distinct from old.statut then
    perform journaliser(new.evenement_id, 'sos', 'signalement',
      'Signalement ' || new.reference || ' → ' || new.statut,
      (case when new.statut in ('clos','sans_suite') then 'routine' else 'notable' end)::importance_journal,
      'signalement', new.id, new.reference);
  end if;
  return null;
end;
$$;;
