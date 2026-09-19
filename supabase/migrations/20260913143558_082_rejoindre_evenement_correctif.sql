-- Correctif : le paramètre de sortie « evenement_id » masquait la
-- colonne du même nom dans membres_evenement. On qualifie les colonnes
-- et on renomme les sorties pour que l'ambiguïté ne puisse pas revenir.
drop function if exists public.rejoindre_evenement(text);

create function public.rejoindre_evenement(p_code text)
returns table(id_evenement uuid, nom_evenement text, code_role text, deja_membre boolean)
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

  select * into v_inv from invitations i
  where upper(trim(i.code)) = upper(trim(p_code)) and i.deleted_at is null;

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

  select e.nom into v_nom from evenements e where e.id = v_inv.evenement_id;

  select exists(
    select 1 from membres_evenement m
    where m.evenement_id = v_inv.evenement_id
      and m.user_id = auth.uid()
      and m.deleted_at is null
  ) into v_existe;

  -- Déjà membre : ni doublon, ni usage consommé. Quelqu'un qui reclique
  -- sur le lien doit simplement arriver à destination.
  if v_existe then
    return query select v_inv.evenement_id, v_nom, null::text, true;
    return;
  end if;

  select * into v_role from roles r where r.id = v_inv.role_id;

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

  update invitations i set usages = i.usages + 1 where i.id = v_inv.id;

  return query select v_inv.evenement_id, v_nom, coalesce(v_role.code, 'benevole'), false;
end;
$function$;

grant execute on function public.rejoindre_evenement(text) to authenticated;