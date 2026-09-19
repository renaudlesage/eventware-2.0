-- Rejoindre par code. SECURITY DEFINER parce qu'un nouvel arrivant n'a
-- par définition aucun droit sur l'événement : il ne peut pas s'insérer
-- lui-même dans membres_evenement, et c'est très bien ainsi. La fonction
-- est la seule porte, et elle ne s'ouvre que sur un code valide.
create or replace function public.rejoindre_evenement(p_code text)
returns table(evenement_id uuid, evenement_nom text, role_code text, deja_membre boolean)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inv    invitations%rowtype;
  v_role   roles%rowtype;
  v_nom    text;
  v_existe boolean;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select * into v_inv from invitations
  where upper(trim(code)) = upper(trim(p_code))
    and deleted_at is null;

  if not found then
    raise exception 'Code inconnu' using errcode = 'P0002';
  end if;
  if not v_inv.actif then
    raise exception 'Ce code a été désactivé' using errcode = 'P0004';
  end if;
  if v_inv.expire_le is not null and v_inv.expire_le < now() then
    raise exception 'Ce code a expiré' using errcode = 'P0004';
  end if;
  if v_inv.usages_max is not null and v_inv.usages >= v_inv.usages_max then
    raise exception 'Ce code a déjà servi le nombre de fois prévu' using errcode = 'P0004';
  end if;

  select nom into v_nom from evenements where id = v_inv.evenement_id;

  -- Déjà membre : on ne crée pas de doublon et on ne consomme pas un
  -- usage. Quelqu'un qui reclique sur le lien doit simplement arriver.
  select exists(
    select 1 from membres_evenement
    where evenement_id = v_inv.evenement_id and user_id = auth.uid()
      and deleted_at is null
  ) into v_existe;

  if v_existe then
    return query select v_inv.evenement_id, v_nom, null::text, true;
    return;
  end if;

  select * into v_role from roles where id = v_inv.role_id;

  insert into membres_evenement (
    evenement_id, user_id, role_id, role, equipe_id, invite_le
  ) values (
    v_inv.evenement_id, auth.uid(), v_inv.role_id,
    coalesce(
      (case when v_role.code in ('admin','coordinateur','chef_equipe','benevole','observateur')
            then v_role.code end),
      'benevole'
    )::role_evenement,
    v_inv.equipe_id, now()
  );

  update invitations set usages = usages + 1 where id = v_inv.id;

  return query select v_inv.evenement_id, v_nom, coalesce(v_role.code, 'benevole'), false;
end;
$function$;

grant execute on function public.rejoindre_evenement(text) to authenticated;