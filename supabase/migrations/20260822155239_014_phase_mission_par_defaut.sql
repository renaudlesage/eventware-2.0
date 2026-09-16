-- ============ 014_phase_mission_par_defaut ============
-- Une mission naît dans la phase courante de l'événement.
-- Sans cela, les missions créées à la main sortent sans phase et le tri
-- montage / exploitation / démontage devient impossible au REX.
create or replace function trg_reference_mission()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  v_prefixe text;
  v_n int;
begin
  if new.phase is null then
    new.phase := (select phase from evenements where id = new.evenement_id);
  end if;

  if new.reference is not null and new.reference <> '' then
    return new;
  end if;

  v_prefixe := upper(substr(coalesce(new.module,'mis'), 1, 3));
  select coalesce(max(substring(reference from '[0-9]+$')::int), 0) + 1
    into v_n
  from missions
  where evenement_id = new.evenement_id
    and reference like v_prefixe || '-%';
  new.reference := v_prefixe || '-' || lpad(v_n::text, 3, '0');
  return new;
end;
$$;

update missions set phase = (select phase from evenements where id = missions.evenement_id)
where phase is null;;
