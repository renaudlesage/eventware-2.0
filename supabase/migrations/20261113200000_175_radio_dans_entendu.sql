-- =====================================================================
-- 175 — LA RADIO DANS LE FIL « ENTENDU »
--
-- Le pont radio (PR 76) parle sur le canal d'urgence. Il écoute aussi :
-- la sortie haut-parleur de la radio branchée sur l'entrée audio du poste
-- du QG, chaque transmission entendue est enregistrée et rangée avec les
-- messages vocaux du talkie, dans le fil « Entendu », transcrite par
-- l'appareil ou par le serveur comme un message de bénévole.
--
-- Ce qui change :
--
--   1. `messages_vocaux.source` : 'talkie' (un bénévole a parlé dans son
--      téléphone, c'est lui le `membre_id`) ou 'radio' (le pont a capté
--      le canal ; `membre_id` est alors le membre qui tient le pont, pas
--      celui qui a parlé — on ne sait pas qui c'est) ;
--   2. une politique RESTRICTIVE sur l'insertion : seul un membre qui
--      traite les signalements ou les demandes (ou qui a tout pouvoir)
--      peut ranger un message comme venu de la radio. Un bénévole ne
--      peut pas faire passer sa voix pour une transmission du canal.
--      La politique d'insertion de la 162 reste en place : les deux
--      s'ajoutent (pas de DROP) ;
--   3. `talkie_repondre` : pour une transmission radio, le classement
--      (urgence, DEA…) est gardé — il fait remonter le message en tête
--      du fil — mais aucune réponse automatique n'est écrite : elle
--      arriverait dans « Mes messages » du membre qui tient le pont.
--      Le reste de la fonction est celui de la 162, inchangé (la
--      production a le même code, sans les commentaires : vérifié le
--      13/11 par lecture).
--
-- L'audio de la radio suit le sort de celui du talkie : même
-- compartiment (`vocaux`), effacé à la clôture par `purger_vocaux`.
--
-- Idempotente, sans DROP.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. La source d'un message vocal
-- ---------------------------------------------------------------------
alter table public.messages_vocaux
  add column if not exists source text not null default 'talkie';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_vocaux_source_check'
                    and conrelid = 'public.messages_vocaux'::regclass) then
    alter table public.messages_vocaux
      add constraint messages_vocaux_source_check check (source in ('talkie', 'radio'));
  end if;
end $$;

comment on column public.messages_vocaux.source is
  'D''où vient le message (175) : talkie (le membre a parlé dans son téléphone) ou radio (capté sur le canal par le pont radio ; membre_id est alors celui qui tient le pont).';

-- ---------------------------------------------------------------------
-- 2. Seul le QG range un message comme venu de la radio
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages_vocaux'
                    and policyname = 'messages_vocaux_radio') then
    create policy messages_vocaux_radio on public.messages_vocaux
      as restrictive for insert to authenticated
      with check (
        source = 'talkie'
        or a_permission(evenement_id, 'sos', 'modifier')
        or a_permission(evenement_id, 'missions', 'modifier')
        or a_tout_pouvoir(evenement_id)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Classer une transmission radio sans y répondre
-- ---------------------------------------------------------------------
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

  -- (175) Une transmission captée sur la radio par le pont : personne ne lirait
  -- une réponse dans l'application (le message est rangé sous le membre qui
  -- tient le pont, pas sous celui qui a parlé). On garde le classement, qui
  -- fait remonter une urgence en tête du fil « Entendu », et rien d'autre.
  if m.source = 'radio' then
    update messages_vocaux
       set intention = coalesce(v_code, 'AUCUNE'),
           urgence = urgence or coalesce(v_code in ('URGENCE', 'DEA'), false)
     where id = p_message;
    if v_code in ('URGENCE', 'URGENCE_DOUTEUSE', 'DEA') then
      perform journaliser(m.evenement_id, 'talkie', 'radio_classee',
        format('Transmission radio classée %s', v_code), 'notable', 'messages_vocaux', m.id, null);
    end if;
    return null;
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



revoke execute on function public.talkie_repondre(uuid) from public, anon;
grant  execute on function public.talkie_repondre(uuid) to authenticated;

comment on function public.talkie_repondre(uuid) is
  'Réponse automatique à un message vocal (162). SECURITY DEFINER parce qu''elle lit canaux_radio, elements_plan et missions pour un membre qui n''y a pas accès ; n''accepte que les messages de l''appelant (ou du QG) et ne renvoie que le texte. Ne change jamais statut. Une transmission radio (175) est classée (intention, urgence) mais jamais répondue.';

commit;
