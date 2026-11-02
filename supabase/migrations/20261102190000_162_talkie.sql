-- =====================================================================
-- 162 — TALKIE-TÉLÉPHONE : MESSAGES VOCAUX ET RÉPONSE AUTOMATIQUE
--
-- Au BFMF 2026, 10 demandes sur 68 ont été closes sans trace de prise
-- en charge : tout ce qui passe par la voix échappe à Eventware. Un
-- bénévole sans radio maintient un bouton, dit sa demande, relâche ;
-- le message part au QG dès qu'il y a du réseau, avec l'heure où il a
-- parlé et sa position. Le QG l'entend, répond, crée une demande.
-- Pour quelques questions simples (canal, nuit, DEA, statut de ma
-- demande), Eventware répond lui-même — par mots-clés, sans modèle de
-- langage, jamais avec une information à une urgence hormis le 112.
--
--   · `messages_vocaux` : un membre insère les siens et ne lit que les
--     siens ; `missions : modifier` lit tout et met à jour ;
--   · compartiment privé `vocaux` (1 Mo), chemin
--     <evenement>/<membre>/<uuid>.<ext>, mêmes règles ;
--   · `talkie_intentions` : le référentiel des mots-clés, modifiable
--     par formulaire (exploitant) ;
--   · `talkie_repondre` (security definer, justifié ci-dessous) et le
--     déclencheur sur la transcription ; `talkie_lieu` propose un lieu ;
--   · `purger_vocaux` : la voix est une donnée personnelle, l'audio
--     s'efface à la clôture, les transcriptions restent.
-- Activation : `evenements.modules ->> 'talkie'`, et
-- `talkie_reponses_auto` pour la réponse automatique.
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Licence : `talkie_reponses_auto` est une option du module `talkie`,
--    pas un module. Le contrôle de souscription (modules_autorises)
--    accepte désormais une clé « <module>_<option> » dès que le module
--    est souscrit. Le reste du contrôle ne change pas.
-- ---------------------------------------------------------------------
create or replace function public.trg_modules_sous_licence()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_autorises jsonb;
  k text;
  v_module text;
begin
  select o.modules_autorises into v_autorises
  from organisations o where o.id = new.organisation_id;
  if v_autorises is null then
    return new;
  end if;
  for k in select jsonb_object_keys(new.modules)
  loop
    if not coalesce((new.modules ->> k)::boolean, false) then continue; end if;
    if coalesce((v_autorises ->> k)::boolean, false) then continue; end if;
    -- (162) une option « module_option » d'un module souscrit
    v_module := split_part(k, '_', 1);
    if v_module <> k and coalesce((v_autorises ->> v_module)::boolean, false) then continue; end if;
    raise exception 'Module « % » non souscrit par l''organisation', k
      using errcode = 'P0007';
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Les tables
-- ---------------------------------------------------------------------
create table if not exists public.messages_vocaux (
  id                     uuid primary key default gen_random_uuid(),   -- généré sur le téléphone : un renvoi ne crée pas de doublon
  evenement_id           uuid not null references public.evenements(id) on delete cascade,
  membre_id              uuid not null references public.membres_evenement(id) on delete cascade,
  parle_le               timestamptz not null,                          -- heure du téléphone au moment de parler
  recu_le                timestamptz not null default now(),            -- l'écart mesure le réseau
  duree_s                numeric,
  chemin_audio           text,
  transcription          text,
  transcription_corrigee text,
  latitude               double precision,
  longitude              double precision,
  precision_m            integer,
  lieu_id                uuid references public.lieux(id) on delete set null,
  urgence                boolean not null default false,
  statut                 text not null default 'nouveau' check (statut in ('nouveau', 'entendu', 'traite')),
  entendu_le             timestamptz,
  entendu_par            uuid references auth.users(id),
  mission_id             uuid references public.missions(id) on delete set null,
  reponse                text,
  reponse_le             timestamptz,
  reponse_source         text check (reponse_source in ('auto', 'qg')),
  intention              text,
  origine                origine_donnee not null default 'humain',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_by             uuid references auth.users(id),
  deleted_at             timestamptz
);
comment on table public.messages_vocaux is
  'Messages vocaux des bénévoles au QG (162). parle_le = heure du téléphone ; recu_le = arrivée en base. L''audio s''efface à la clôture (purger_vocaux), la transcription reste.';
create index if not exists messages_vocaux_evenement_idx on public.messages_vocaux (evenement_id, statut, parle_le desc);

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_messages_vocaux') then
    create trigger tracabilite_messages_vocaux before insert or update on public.messages_vocaux
      for each row execute function public.trg_tracabilite();
  end if;
end $t$;

create table if not exists public.talkie_intentions (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique,
  libelle  text not null,
  motifs   text[] not null default '{}',
  ordre    integer not null default 100,
  actif    boolean not null default true
);
comment on table public.talkie_intentions is
  'Référentiel des intentions reconnues dans un message vocal (162) : la première, dans l''ordre, dont un motif figure dans le texte normalisé l''emporte.';

insert into public.talkie_intentions (code, libelle, motifs, ordre)
select c.code, c.libelle, c.motifs, c.ordre from (values
  ('URGENCE',         'Urgence vitale',          array['malaise','bless','inconscient','respire','saign','feu','incendie','fumee','bagarre','arme','noy','convuls','112','mayday'], 10),
  ('DEA',             'Où est le DEA',           array['dea','defibrillateur'], 20),
  ('STATUT_DEMANDE',  'Où en est ma demande',    array['ma demande','ou en est','c est pour quand','quelqu un arrive','toujours rien'], 30),
  ('CANAL',           'Quel canal radio',        array['canal','frequence','quelle radio'], 40),
  ('NUIT',            'À quelle heure la nuit',  array['nuit','coucher','soleil','fait noir'], 50)
) as c(code, libelle, motifs, ordre)
where not exists (select 1 from public.talkie_intentions x where x.code = c.code);

-- ---------------------------------------------------------------------
-- 2. Qui est le membre connecté sur cet événement
-- ---------------------------------------------------------------------
create or replace function public.talkie_mon_membre(p_evenement uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.id from membres_evenement m
   where m.evenement_id = p_evenement and m.user_id = auth.uid() and m.actif and m.deleted_at is null
   limit 1;
$$;
revoke execute on function public.talkie_mon_membre(uuid) from public, anon;
grant  execute on function public.talkie_mon_membre(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Normaliser, reconnaître, répondre
-- ---------------------------------------------------------------------
create or replace function public.talkie_normaliser(p_texte text)
returns text language sql immutable set search_path = public, extensions, pg_temp as $$
  select trim(regexp_replace(regexp_replace(lower(unaccent(coalesce(p_texte, ''))), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;
revoke execute on function public.talkie_normaliser(text) from public, anon;
grant  execute on function public.talkie_normaliser(text) to authenticated;

-- Le lieu proposé : le nom d'un lieu (ou « étape 3 », « la 3 ») dans le
-- texte ; sans texte, le lieu le plus proche à moins de 150 m ; sinon
-- rien. On n'invente jamais un lieu.
create or replace function public.talkie_lieu(p_message uuid)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  m messages_vocaux%rowtype;
  t text;
  l record;
  v_lieu uuid;
  v_num text;
begin
  select * into m from messages_vocaux where id = p_message;
  if m.id is null then return null; end if;
  t := ' ' || talkie_normaliser(coalesce(m.transcription_corrigee, m.transcription)) || ' ';
  if length(t) > 2 then
    -- le nom complet d'un lieu actif, les plus longs d'abord
    for l in select id, nom, code, type from lieux where evenement_id = m.evenement_id and deleted_at is null order by length(nom) desc loop
      if position(' ' || talkie_normaliser(l.nom) || ' ' in t) > 0 or (l.code is not null and position(' ' || talkie_normaliser(l.code) || ' ' in t) > 0) then
        v_lieu := l.id; exit;
      end if;
    end loop;
    -- « étape 3 », « étape trois », « la 3 », « e3 »
    if v_lieu is null then
      v_num := coalesce((regexp_match(t, '\m(?:etape|la|e|point) ?(\d{1,2})\M'))[1],
                        case when t ~ '\metape (un|une)\M' then '1' when t ~ '\metape deux\M' then '2' when t ~ '\metape trois\M' then '3'
                             when t ~ '\metape quatre\M' then '4' when t ~ '\metape cinq\M' then '5' when t ~ '\metape six\M' then '6' end);
      if v_num is not null then
        select id into v_lieu from lieux
         where evenement_id = m.evenement_id and deleted_at is null and type = 'etape'
           and (talkie_normaliser(nom) ~ ('\m' || v_num || '\M') or talkie_normaliser(code) ~ ('\m' || 'e' || v_num || '\M') or talkie_normaliser(code) ~ ('\m' || v_num || '\M'))
         order by length(nom) limit 1;
      end if;
    end if;
  end if;
  if v_lieu is null and m.latitude is not null and m.longitude is not null then
    select id into v_lieu from lieux
     where evenement_id = m.evenement_id and deleted_at is null and latitude is not null and longitude is not null
       and distance_m(m.latitude, m.longitude, latitude, longitude) <= 150
     order by distance_m(m.latitude, m.longitude, latitude, longitude) limit 1;
  end if;
  if v_lieu is not null and m.lieu_id is null then
    update messages_vocaux set lieu_id = v_lieu where id = p_message;
  end if;
  return v_lieu;
end $$;

-- La réponse automatique.
-- SECURITY DEFINER, justifié : elle lit canaux_radio, elements_plan et
-- missions, que le bénévole n'a pas forcément le droit de lire. Elle
-- n'accepte qu'un message de l'appelant (ou l'appel du déclencheur,
-- auth.uid() = auteur du message) et ne renvoie que le texte de la
-- réponse. Elle ne change jamais `statut` : une réponse automatique
-- n'est pas un accusé du QG.
create or replace function public.talkie_repondre(p_message uuid)
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  m messages_vocaux%rowtype;
  ev evenements%rowtype;
  mb membres_evenement%rowtype;
  t text;
  i record;
  v_motif text;
  v_code text;
  v_reponse text;
  v_urgence boolean := false;
  v_lat double precision; v_lon double precision;
  r record;
  v_jour date;
begin
  select * into m from messages_vocaux where id = p_message and deleted_at is null;
  if m.id is null then return null; end if;
  select * into mb from membres_evenement where id = m.membre_id;
  if mb.user_id is distinct from auth.uid() and not a_permission(m.evenement_id, 'missions', 'modifier') and not a_tout_pouvoir(m.evenement_id) then
    raise exception 'Ce message n''est pas le vôtre' using errcode = '42501';
  end if;
  select * into ev from evenements where id = m.evenement_id;
  if not coalesce((ev.modules ->> 'talkie_reponses_auto')::boolean, false) then return null; end if;
  t := talkie_normaliser(coalesce(m.transcription_corrigee, m.transcription));
  if coalesce(t, '') = '' then return null; end if;
  t := ' ' || t || ' ';

  -- La première intention, dans l'ordre, dont un motif figure dans le texte.
  for i in select * from talkie_intentions where actif order by ordre, code loop
    foreach v_motif in array i.motifs loop
      if position(talkie_normaliser(v_motif) in t) > 0 then v_code := i.code; exit; end if;
    end loop;
    exit when v_code is not null;
  end loop;

  -- Négation directe juste avant le motif d'urgence (« pas de blessé »,
  -- « personne n'est blessé ») : on ne conclut pas à l'urgence, mais le
  -- message reste en tête du fil (URGENCE_DOUTEUSE). Un faux positif
  -- coûte peu, un faux négatif peut coûter cher.
  if v_code = 'URGENCE' then
    if t ~ ('(pas d|pas de|pas un|aucun|aucune|sans|personne n est|personne nest|personne n a|ni) (\w+ ){0,2}(' ||
            (select string_agg(talkie_normaliser(x), '|') from unnest((select motifs from talkie_intentions where code = 'URGENCE')) x where x !~ '^\d+$') || ')') then
      v_code := 'URGENCE_DOUTEUSE';
    end if;
  end if;

  v_lat := coalesce(m.latitude, ev.point_0_lat); v_lon := coalesce(m.longitude, ev.point_0_lon);
  case v_code
    when 'URGENCE' then
      v_urgence := true;
      v_reponse := 'Si quelqu''un est en danger, appelle le 112 maintenant. Le QG a reçu ton message.';
    when 'DEA' then
      v_urgence := true;
      select e.nom, round(distance_m(v_lat, v_lon, e.centre_lat, e.centre_lon)) as d into r
        from elements_plan e where e.evenement_id = m.evenement_id and e.deleted_at is null and e.categorie = 'dea'
         and e.centre_lat is not null and v_lat is not null
        order by distance_m(v_lat, v_lon, e.centre_lat, e.centre_lon) limit 1;
      v_reponse := 'Appelle le 112. ' || case when r.nom is not null then format('DEA le plus proche : %s, à %s m.', r.nom, r.d) else 'Aucun DEA n''est positionné sur le plan : le QG a reçu ton message.' end;
    when 'STATUT_DEMANDE' then
      select mi.reference, mi.titre, mi.statut::text as statut, mi.attribuee_le, eq.code as equipe into r
        from missions mi left join equipes eq on eq.id = mi.equipe_id
       where mi.evenement_id = m.evenement_id and mi.deleted_at is null and mi.created_by = mb.user_id
         and mi.statut::text not in ('resolue', 'annulee')
       order by mi.created_at desc limit 1;
      if r.reference is null then
        v_reponse := 'Je ne trouve pas de demande ouverte à ton nom. Le QG a reçu ton message.';
      else
        v_reponse := format('Ta demande %s (%s) est %s', r.reference, r.titre,
          case r.statut when 'a_traiter' then 'en attente au QG' when 'attribuee' then 'attribuée' when 'en_cours' then 'en cours' else r.statut end)
          || case when r.attribuee_le is not null then format(', attribuée à %s', to_char(r.attribuee_le at time zone 'Europe/Brussels', 'HH24"h"MI')) else '' end
          || case when r.equipe is not null then format(' à l''équipe %s', r.equipe) else '' end || '.';
      end if;
    when 'CANAL' then
      select string_agg(format('%s %s', c.numero, coalesce(c.libelle, '')), ', ' order by c.ordre, c.numero) as equipe,
             (select string_agg(format('%s %s', u.numero, coalesce(u.libelle, '')), ', ' order by u.ordre) from canaux_radio u
               where u.evenement_id = m.evenement_id and u.deleted_at is null and u.actif and u.canal_urgence) as urgence
        into r
        from canaux_radio c
       where c.evenement_id = m.evenement_id and c.deleted_at is null and c.actif and c.equipe_id = mb.equipe_id;
      v_reponse := case when r.equipe is not null then format('Ton canal : %s.', r.equipe) else 'Aucun canal n''est attribué à ton équipe.' end
                   || case when r.urgence is not null then format(' Urgence : canal %s.', r.urgence) else '' end;
    when 'NUIT' then
      v_jour := (now() at time zone 'Europe/Brussels')::date;
      if v_lat is null then
        v_reponse := 'Sans point 0, je ne sais pas calculer la nuit ici. Le QG a reçu ton message.';
      else
        v_reponse := format('Coucher du soleil à %s, nuit (fin du crépuscule civil) à %s.',
          to_char(heure_soleil(v_lat, v_lon, v_jour, 'coucher') at time zone 'Europe/Brussels', 'HH24"h"MI'),
          to_char(heure_soleil(v_lat, v_lon, v_jour, 'fin_crepuscule_civil') at time zone 'Europe/Brussels', 'HH24"h"MI'));
      end if;
    else
      v_reponse := 'Reçu, transmis au QG.';
  end case;

  update messages_vocaux
     set intention = coalesce(v_code, 'AUCUNE'), reponse = v_reponse, reponse_le = now(), reponse_source = 'auto',
         urgence = urgence or v_urgence
   where id = p_message;
  perform journaliser(m.evenement_id, 'talkie', 'reponse_auto',
    format('Réponse automatique (%s) à un message vocal : %s', coalesce(v_code, 'AUCUNE'), v_reponse), 'routine', 'messages_vocaux', m.id, null);
  return v_reponse;
end $$;

comment on function public.talkie_repondre(uuid) is
  'Réponse automatique à un message vocal (162). SECURITY DEFINER parce qu''elle lit canaux_radio, elements_plan et missions pour un membre qui n''y a pas accès ; n''accepte que les messages de l''appelant (ou du QG) et ne renvoie que le texte. Ne change jamais statut.';
comment on function public.talkie_lieu(uuid) is 'Propose un lieu à un message vocal (162) : nom dans le texte, sinon le plus proche à moins de 150 m, sinon rien.';

-- Le déclencheur : à l'arrivée d'une transcription (insertion ou mise à jour).
create or replace function public.trg_talkie_transcription() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform talkie_lieu(new.id);
  if coalesce(new.transcription, '') <> '' then perform talkie_repondre(new.id); end if;
  return null;
end $$;
revoke execute on function public.trg_talkie_transcription() from public, anon, authenticated;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'talkie_transcription') then
    create trigger talkie_transcription after insert or update of transcription, transcription_corrigee on public.messages_vocaux
      for each row execute function public.trg_talkie_transcription();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 4. Purger l'audio à la clôture
--    La voix est une donnée personnelle : les fichiers partent, les
--    transcriptions restent. Les fichiers eux-mêmes se suppriment par
--    l'API Storage (l'application le fait juste avant) ; ici on vide
--    `chemin_audio` et on rend la liste des chemins, pour contrôle.
-- ---------------------------------------------------------------------
create or replace function public.purger_vocaux(p_evenement uuid)
returns text[] language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_chemins text[]; v_n integer;
begin
  if not a_tout_pouvoir(p_evenement) then
    raise exception 'La purge des vocaux exige tout pouvoir' using errcode = '42501';
  end if;
  select array_agg(chemin_audio) into v_chemins from messages_vocaux where evenement_id = p_evenement and chemin_audio is not null;
  update messages_vocaux set chemin_audio = null where evenement_id = p_evenement and chemin_audio is not null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform journaliser(p_evenement, 'talkie', 'purge', format('%s enregistrement(s) vocal(aux) effacé(s), transcriptions conservées', v_n), 'notable');
  end if;
  return coalesce(v_chemins, '{}');
end $$;
comment on function public.purger_vocaux(uuid) is 'Efface les enregistrements vocaux d''un événement (162) : vide chemin_audio, garde les transcriptions, rend les chemins pour l''API Storage.';

revoke execute on function public.talkie_lieu(uuid), public.talkie_repondre(uuid), public.purger_vocaux(uuid) from public, anon;
grant  execute on function public.talkie_lieu(uuid), public.talkie_repondre(uuid), public.purger_vocaux(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.messages_vocaux enable row level security;
alter table public.talkie_intentions enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'messages_vocaux' and policyname = 'messages_vocaux_lecture') then
    create policy messages_vocaux_lecture on public.messages_vocaux for select to authenticated
      using (deleted_at is null and (membre_id = talkie_mon_membre(evenement_id)
                                     or a_permission(evenement_id, 'missions', 'modifier') or a_tout_pouvoir(evenement_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'messages_vocaux' and policyname = 'messages_vocaux_creation') then
    create policy messages_vocaux_creation on public.messages_vocaux for insert to authenticated
      with check (membre_id = talkie_mon_membre(evenement_id)
                  and exists (select 1 from evenements e where e.id = evenement_id and coalesce((e.modules ->> 'talkie')::boolean, false)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'messages_vocaux' and policyname = 'messages_vocaux_modification') then
    create policy messages_vocaux_modification on public.messages_vocaux for update to authenticated
      using (a_permission(evenement_id, 'missions', 'modifier') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'missions', 'modifier') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'talkie_intentions' and policyname = 'talkie_intentions_lecture') then
    create policy talkie_intentions_lecture on public.talkie_intentions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'talkie_intentions' and policyname = 'talkie_intentions_gestion') then
    create policy talkie_intentions_gestion on public.talkie_intentions for all to authenticated
      using (est_exploitant()) with check (est_exploitant());
  end if;
end $p$;

revoke all on public.messages_vocaux, public.talkie_intentions from public, anon;
grant select, insert, update on public.messages_vocaux to authenticated;
grant select, insert, update, delete on public.talkie_intentions to authenticated;

-- ---------------------------------------------------------------------
-- 6. Le compartiment « vocaux » : privé, 1 Mo, chemin <evenement>/<membre>/<uuid>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('vocaux', 'vocaux', false, 1048576)
on conflict (id) do update set public = false, file_size_limit = 1048576;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vocaux_ecriture') then
    create policy vocaux_ecriture on storage.objects for insert to authenticated
      with check (bucket_id = 'vocaux'
                  and ((storage.foldername(name))[2])::uuid = talkie_mon_membre(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vocaux_remplacement') then
    create policy vocaux_remplacement on storage.objects for update to authenticated
      using (bucket_id = 'vocaux' and ((storage.foldername(name))[2])::uuid = talkie_mon_membre(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vocaux_lecture') then
    create policy vocaux_lecture on storage.objects for select to authenticated
      using (bucket_id = 'vocaux'
             and (((storage.foldername(name))[2])::uuid = talkie_mon_membre(((storage.foldername(name))[1])::uuid)
                  or a_permission(((storage.foldername(name))[1])::uuid, 'missions', 'modifier')
                  or a_tout_pouvoir(((storage.foldername(name))[1])::uuid)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vocaux_suppression') then
    create policy vocaux_suppression on storage.objects for delete to authenticated
      using (bucket_id = 'vocaux' and a_tout_pouvoir(((storage.foldername(name))[1])::uuid));
  end if;
end $p$;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/162.sql)
--   select talkie_repondre('<message>');
--   select purger_vocaux('<evenement>');
-- =====================================================================
