-- =====================================================================
-- 116 — DEMANDES SIMILAIRES (module livré par Ren le 15/10, fichier
-- d'origine `20261015_demandes_similaires.sql`, repris tel quel sauf :
--   a. les `drop … if exists`, sans objet sur une première installation,
--      sont retirés (l'outil de Claude refuse tout DROP) ;
--   b. la policy « gestion » FOR ALL est scindée en insert / update /
--      delete : avec la policy de lecture, elle faisait une policy double
--      sur SELECT — exactement ce que la 113 vient de nettoyer.
-- Remplace la détection côté client de `doublons.js` (audit, point 9 du
-- REX), calibrée sur les 68 demandes réelles de BFMF 2026.
-- =====================================================================

begin;

-- =====================================================================
-- DEMANDES SIMILAIRES — module Eventware
-- Avant d'enregistrer une demande, le formulaire demande à la base :
-- « existe-t-il déjà quelque chose qui ressemble à ça ? »
--
--   doublon     une demande OUVERTE, même lieu, même besoin, quel que soit
--               l'émetteur → proposer de suivre/commenter l'existante
--   complément  le MÊME émetteur, même lieu, il y a moins de 20 min, demande
--               encore ouverte, ET le texte s'annonce comme un ajout
--               (« Il me faut aussi… », « Et 2 jus de pomme ») ou recouvre
--               nettement la précédente → proposer d'ajouter en commentaire
--   récurrence  même besoin, même lieu, résolu dans les 4 dernières heures
--               → information (« 3e demande de jetons au bar »)
--
-- Origine : REX BFMF 2026 — doublons purs sur le circuit des jetons,
-- compléments envoyés comme nouvelles demandes. Calibré sur les 68 demandes
-- réelles du festival (tests/evaluation_bfmf2026.sql).
--
-- Dépend du socle Eventware : missions, a_permission(). Rejouable.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Vocabulaire : synonymes et mots vides (CRUD dans l'app)
--    evenement_id NULL = vocabulaire commun à tous les événements.
-- ---------------------------------------------------------------------
create table if not exists public.demande_vocabulaire (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid references public.evenements(id) on delete cascade,
  terme         text not null check (length(trim(terme)) > 0),  -- tel qu'écrit sur le terrain
  canon         text not null default '',                       -- '' = mot ignoré
  created_at    timestamptz not null default now(),
  unique nulls not distinct (evenement_id, terme)
);

insert into public.demande_vocabulaire (evenement_id, terme, canon) values
  -- orthographe et pluriels fréquents
  (null,'sceau','seau'), (null,'sceaux','seau'), (null,'seaux','seau'),
  (null,'jetons','jeton'), (null,'bacs','bac'), (null,'casiers','casier'),
  (null,'personnes','personne'), (null,'pers','personne'), (null,'cartons','carton'),
  -- mêmes besoins, mots différents
  (null,'papier toilette','pq'), (null,'papier wc','pq'), (null,'rouleaux','pq'),
  (null,'wc','toilette'), (null,'toilettes','toilette'), (null,'sanitaires','toilette'),
  (null,'mazout','carburant'), (null,'fuel','carburant'), (null,'gasoil','carburant'),
  (null,'diesel','carburant'), (null,'essence','carburant'),
  (null,'food truck','foodtruck'), (null,'food trucks','foodtruck'), (null,'foodtrucks','foodtruck'), (null,'food','foodtruck'),
  (null,'lupulus placebo','placebo'), (null,'lupulus','biere'), (null,'bieres','biere'), (null,'futs','fut'),
  (null,'pick up','navette'), (null,'pickup','navette'), (null,'drop','navette'), (null,'dropper','navette'),
  (null,'deposer','navette'), (null,'depose','navette'), (null,'transport','navette'), (null,'transporter','navette'),
  (null,'aller rechercher','recuperer'), (null,'aller chercher','recuperer'), (null,'rechercher','recuperer'),
  (null,'chercher','recuperer'), (null,'ramener','recuperer'), (null,'rapatrier','recuperer'),
  (null,'rapatriement','recuperer'), (null,'recupere','recuperer'), (null,'recuperes','recuperer'),
  (null,'reappro','reapprovisionner'), (null,'reapprovisionnement','reapprovisionner'), (null,'livrer','reapprovisionner'),
  (null,'groupe electrogene','groupe'), (null,'generateur','groupe'),
  (null,'caisses','caisse'), (null,'monnaie','caisse'),
  -- mots vides (canon vide)
  (null,'le',''),(null,'la',''),(null,'les',''),(null,'l',''),(null,'de',''),(null,'des',''),(null,'du',''),
  (null,'d',''),(null,'un',''),(null,'une',''),(null,'et',''),(null,'a',''),(null,'au',''),(null,'aux',''),
  (null,'en',''),(null,'pour',''),(null,'sur',''),(null,'dans',''),(null,'avec',''),(null,'ou',''),
  (null,'svp',''),(null,'merci',''),(null,'il',''),(null,'nous',''),(null,'on',''),(null,'faut',''),
  (null,'besoin',''),(null,'est',''),(null,'ce',''),(null,'que',''),(null,'qui',''),(null,'vers',''),
  (null,'depuis',''),(null,'me',''),(null,'aussi',''),(null,'plus',''),(null,'bien',''),(null,'s',''),
  (null,'y',''),(null,'urgent',''),(null,'urgence',''),(null,'stp',''),(null,'encore',''),(null,'veut',''),
  (null,'possible',''),(null,'serait',''),(null,'reste',''),(null,'avoir',''),(null,'si',''),(null,'pas',''),
  (null,'site',''),(null,'principal',''),(null,'zone','')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Normalisation : minuscules, sans accents, synonymes, sans mots vides
--    « Aller rechercher sceau jetons Foodtruck étape 2 »
--      → « etape2 foodtruck jeton recuperer seau »
-- ---------------------------------------------------------------------
create or replace function public.normaliser_demande(p_evenement uuid, p_texte text)
returns text
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare
  t text;
  v record;
  mots text[];
begin
  t := ' ' || lower(unaccent(coalesce(p_texte, ''))) || ' ';
  t := regexp_replace(t, '[^a-z0-9]+', ' ', 'g');
  -- "etape 2", "scene 3", "e2" → un seul mot, pour qu'étape 2 ≠ étape 3
  t := regexp_replace(t, '\m(etape|scene)\s*([0-9])\M', '\1\2', 'g');
  t := regexp_replace(t, '\me([0-9])\M', 'etape\1', 'g');
  -- expressions puis mots : l'événement surcharge le commun, les plus longues d'abord
  for v in
    select * from (
      select distinct on (lower(unaccent(terme))) lower(unaccent(terme)) as terme, canon
        from demande_vocabulaire
       where evenement_id is null or evenement_id = p_evenement
       order by lower(unaccent(terme)), (evenement_id is null)
    ) voc
    order by length(voc.terme) desc
  loop
    if position(' ' || v.terme || ' ' in t) > 0 then
      t := replace(t, ' ' || v.terme || ' ', ' ' || v.canon || ' ');
      t := replace(t, ' ' || v.terme || ' ', ' ' || v.canon || ' ');  -- occurrences adjacentes
    end if;
  end loop;
  select array_agg(distinct m order by m) into mots
    from unnest(string_to_array(trim(regexp_replace(t, '\s+', ' ', 'g')), ' ')) m
   where length(m) >= 2 or m ~ '^[0-9]$';
  return coalesce(array_to_string(mots, ' '), '');
end $$;

-- Score 0..1 entre deux textes normalisés : le meilleur de
--   * la similarité de trigrammes (fautes de frappe, variantes),
--   * la part de mots communs rapportée à la demande la plus courte.
create or replace function public.score_similarite(a text, b text)
returns numeric
language sql immutable
set search_path = public, extensions, pg_temp
as $$
  select case when coalesce(a,'') = '' or coalesce(b,'') = '' then 0 else
    round(greatest(
      similarity(a, b),
      (select count(*) from (select unnest(string_to_array(a,' ')) intersect
                             select unnest(string_to_array(b,' '))) c)::numeric
        / least(cardinality(string_to_array(a,' ')), cardinality(string_to_array(b,' ')))
        * 0.9
    )::numeric, 2) end;
$$;

-- ---------------------------------------------------------------------
-- 3. La question posée par le formulaire
-- ---------------------------------------------------------------------
create or replace function public.missions_similaires(
  p_evenement   uuid,
  p_titre       text,
  p_description text default null,
  p_lieu_id     uuid default null,
  p_exclure     uuid default null,     -- en édition : la mission elle-même
  p_seuil       numeric default 0.5,
  p_auteur      uuid default auth.uid(),
  p_a           timestamptz default now()   -- autre valeur : rejeu (REX, exercice)
)
returns table (mission_id uuid, reference text, titre text, statut public.statut_mission,
               lieu_id uuid, created_at timestamptz, relation text, score numeric, raison text)
language sql stable security invoker
set search_path = public, extensions, pg_temp
as $$
  with nouvelle as (
    select normaliser_demande(p_evenement, concat_ws(' ', p_titre, p_description)) as n,
           -- « Et 2 jus… », « … aussi … », « + 1 casier », « j'oubliais … »
           (lower(extensions.unaccent(coalesce(p_titre,''))) ~
              '^\s*(et|\+|aussi|encore|en plus|egalement|ps|ajout)\M|\m(aussi|egalement|en plus|par la meme occasion|j.?oubli\w*)\M') as ajout
  ),
  candidates as (
    select m.*,
           score_similarite(nv.n, normaliser_demande(p_evenement, concat_ws(' ', m.titre, m.description))) as s,
           case when p_a >= now() - interval '1 minute'
                then m.statut in ('a_traiter','attribuee','en_cours')
                else m.resolue_le is null or m.resolue_le > p_a     -- état à la date du rejeu
           end as ouverte,
           (m.created_by = p_auteur) as meme_auteur,
           nv.ajout,
           (m.lieu_id is not distinct from p_lieu_id) as meme_lieu,
           round(extract(epoch from (p_a - m.created_at)) / 60)::int as age_min
      from missions m, nouvelle nv
     where m.evenement_id = p_evenement
       and m.deleted_at is null
       and m.id is distinct from p_exclure
       and m.created_at <  p_a
       and m.created_at >  p_a - interval '6 hours'
       and m.statut <> 'annulee'
  ),
  classees as (
    select c.*,
      case
        when c.ouverte and c.meme_auteur and c.meme_lieu and c.age_min <= 20
             and (c.ajout or c.s >= 0.35)                                          then 'complement'
        when c.ouverte and c.meme_lieu and c.s >= p_seuil                         then 'doublon'
        when c.ouverte and p_lieu_id is null and c.s >= p_seuil + 0.15            then 'doublon'
        when not c.ouverte and c.meme_lieu and c.s >= p_seuil
             and c.resolue_le > p_a - interval '4 hours'                        then 'recurrence'
      end as rel
    from candidates c
  )
  select id, reference, titre, statut, lieu_id, created_at, rel,
         s,
         case rel
           when 'complement' then 'Votre demande ' || reference || ' (il y a ' || age_min || ' min) est encore ouverte : l''ajouter en commentaire ?'
           when 'doublon'    then reference || ' demande déjà la même chose ici (' || to_char(created_at at time zone 'Europe/Brussels','HH24:MI') || ', '
                                  || case when p_a < now() - interval '1 minute' then 'ouverte'
                                          when statut = 'a_traiter' then 'à traiter'
                                          when statut = 'attribuee' then 'attribuée'
                                          else 'en cours' end
                                  || ') : la suivre plutôt que créer un doublon ?'
           when 'recurrence' then 'Même besoin résolu à ' || to_char(resolue_le at time zone 'Europe/Brussels','HH24:MI') || ' (' || reference || ') : le problème revient.'
         end
    from classees
   where rel is not null
   order by case rel when 'complement' then 1 when 'doublon' then 2 else 3 end, s desc
   limit 5;
$$;

-- ---------------------------------------------------------------------
-- 4. Sécurité
-- ---------------------------------------------------------------------
alter table public.demande_vocabulaire enable row level security;

create policy demande_vocabulaire_lecture on public.demande_vocabulaire for select to authenticated
  using (evenement_id is null or a_permission(evenement_id, 'missions', 'lire'));
create policy demande_vocabulaire_creation on public.demande_vocabulaire for insert to authenticated
  with check (evenement_id is not null and a_permission(evenement_id, 'referentiels', 'modifier'));
create policy demande_vocabulaire_modification on public.demande_vocabulaire for update to authenticated
  using (evenement_id is not null and a_permission(evenement_id, 'referentiels', 'modifier'))
  with check (evenement_id is not null and a_permission(evenement_id, 'referentiels', 'modifier'));
create policy demande_vocabulaire_suppression on public.demande_vocabulaire for delete to authenticated
  using (evenement_id is not null and a_permission(evenement_id, 'referentiels', 'modifier'));
-- Le vocabulaire commun (evenement_id NULL) ne se modifie que par migration.

grant select, insert, update, delete on public.demande_vocabulaire to authenticated;
grant execute on function public.normaliser_demande(uuid, text),
                          public.score_similarite(text, text),
                          public.missions_similaires(uuid, text, text, uuid, uuid, numeric, uuid, timestamptz) to authenticated;

commit;
