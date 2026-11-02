-- =====================================================================
-- 166 — TALKIE : LE SORT DE LA RECONNAISSANCE, LA SUPPRESSION PAR LE QG
--
-- Sur les premiers messages réels (2/11), aucune transcription n'est
-- arrivée : la reconnaissance vocale du téléphone ne dit rien quand elle
-- échoue, et le QG ne sait pas si c'est le téléphone, le réseau ou le
-- micro. Le message porte désormais `reconnaissance` : 'ok', 'absente'
-- (le navigateur n'en a pas), 'vide' (rien reconnu), 'erreur:<motif>'
-- (le téléphone a refusé le micro à la reconnaissance, pas de réseau…).
-- Le QG peut supprimer un message reçu (effacement logique, audio retiré
-- du compartiment) : la police de suppression du compartiment s'ouvre à
-- « missions : modifier », comme la lecture. Aucun DROP, rejouable.
-- =====================================================================

begin;

alter table public.messages_vocaux add column if not exists reconnaissance text;
comment on column public.messages_vocaux.reconnaissance is
  'Sort de la reconnaissance vocale sur le téléphone (166) : ok, absente, vide, erreur:<motif>. Explique l''absence de transcription au QG.';

-- Le déclencheur de la 162 n'appelait la réponse automatique que sur `transcription` : quand le QG
-- tape lui-même le texte d'un message sans transcription, les mots-clés n'étaient pas reconnus.
create or replace function public.trg_talkie_transcription() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform talkie_lieu(new.id);
  if coalesce(new.transcription_corrigee, new.transcription, '') <> '' then perform talkie_repondre(new.id); end if;
  return null;
end $$;

-- La suppression par le QG : effacement logique, journal, et le chemin de l'audio rendu pour que
-- l'application retire le fichier du compartiment (un `update` direct de deleted_at serait refusé
-- par la police de lecture, comme pour les autres tables : cf. supprimer_logiquement, 091).
create or replace function public.supprimer_message_vocal(p_message uuid)
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare m messages_vocaux%rowtype; v_nom text;
begin
  select * into m from messages_vocaux where id = p_message and deleted_at is null;
  if m.id is null then return null; end if;
  if not a_permission(m.evenement_id, 'missions', 'modifier') and not a_tout_pouvoir(m.evenement_id) then
    raise exception 'Suppression refusée : réservée au QG (missions : modifier).' using errcode = '42501';
  end if;
  update messages_vocaux set deleted_at = now(), updated_by = auth.uid() where id = p_message;
  select nom_affiche into v_nom from membres_evenement where id = m.membre_id;
  perform journaliser(m.evenement_id, 'talkie', 'suppression',
    format('Message vocal de %s (%s) supprimé par le QG', coalesce(v_nom, 'membre inconnu'), to_char(m.parle_le at time zone 'Europe/Brussels', 'HH24"h"MI')),
    'routine', 'messages_vocaux', m.id, null);
  return coalesce(m.chemin_audio, '');
end $$;
comment on function public.supprimer_message_vocal(uuid) is 'Effacement logique d''un message vocal par le QG (166) ; rend le chemin de l''audio à retirer du compartiment.';
revoke execute on function public.supprimer_message_vocal(uuid) from public, anon;
grant  execute on function public.supprimer_message_vocal(uuid) to authenticated;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vocaux_suppression_qg') then
    create policy vocaux_suppression_qg on storage.objects for delete to authenticated
      using (bucket_id = 'vocaux' and a_permission(((storage.foldername(name))[1])::uuid, 'missions', 'modifier'));
  end if;
end $p$;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/166.sql)
--   select reconnaissance from messages_vocaux limit 1;
-- =====================================================================
