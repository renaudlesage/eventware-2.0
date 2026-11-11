-- =====================================================================
-- 170 — NOTIFICATIONS POUSSÉES
--
-- L'audit du 11/11 : rien n'arrive quand l'application est fermée. Une
-- alerte, une demande attribuée, une réponse du QG ou un rappel de
-- créneau n'atteignent que la personne qui a l'application ouverte, et
-- « Rappel envoyé ✓ » n'envoyait rien.
--
-- Chaque appareil qui accepte les notifications dépose ici son
-- abonnement (norme Web Push : une adresse et deux clés). La fonction
-- serveur `notifier` lit ces abonnements avec la clé de service et
-- envoie ; elle seule connaît la clé privée du serveur (VAPID). Un
-- utilisateur ne voit et ne gère que ses propres abonnements.
--
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

create table if not exists public.abonnements_push (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  appareil      text,
  -- Ce que la personne veut recevoir sur cet appareil. Absent = oui.
  preferences   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  dernier_envoi timestamptz,
  echecs        integer not null default 0
);
comment on table public.abonnements_push is 'Abonnements Web Push par appareil (170). Lus par la fonction serveur « notifier » ; chacun ne gère que les siens.';
create index if not exists abonnements_push_user_idx on public.abonnements_push (user_id);

alter table public.abonnements_push enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'abonnements_push' and policyname = 'abonnements_push_les_miens') then
    create policy abonnements_push_les_miens on public.abonnements_push for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
grant select, insert, update, delete on public.abonnements_push to authenticated;
revoke all on public.abonnements_push from anon;

-- Un appareil qui change de compte : son abonnement suit la personne connectée.
-- (L'adresse est unique ; l'upsert d'un autre utilisateur serait refusé par la police.)
create or replace function public.abonner_push(p_endpoint text, p_p256dh text, p_auth text, p_appareil text default null)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Abonnement invalide.' using errcode = '22023';
  end if;
  insert into abonnements_push (user_id, endpoint, p256dh, auth, appareil)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_appareil, 200))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    appareil = excluded.appareil, echecs = 0
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.abonner_push(text, text, text, text) from public, anon;
grant execute on function public.abonner_push(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
