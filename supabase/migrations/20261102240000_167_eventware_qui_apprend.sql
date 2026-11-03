-- =====================================================================
-- 167 — EVENTWARE QUI APPREND (1) : LE REX QUI S'ÉCRIT TOUT SEUL,
--       LES FAMILLES DE DEMANDES, LA MÉMOIRE DES LIEUX
--
-- Après BFMF 2026, la base savait des choses que personne n'avait
-- écrites : 85 demandes dont 26 closes sans trace, des réassorts qui
-- revenaient toutes les demi-heures aux mêmes bars, des seuils météo
-- franchis, 100 constats de REX tapés à la main. Cette migration fait
-- parler ces chiffres à trois endroits :
--
--   1. le REX distingue ce qu'un humain consigne (source 'humain') de
--      ce qu'Eventware propose (source 'eventware', clé stable cle_auto) ;
--      rex_proposer(p_evenement) relit l'événement et dépose ses constats
--      « à arbitrer » — jamais un prénom, que des chiffres et des lieux.
--      Rejouable : un constat déjà arbitré n'est pas touché, un constat
--      supprimé par le QG ne revient pas, un constat à arbitrer se met
--      à jour ;
--   2. les familles de demandes (jetons, boissons, sanitaires, transport
--      de personnes…) : un petit référentiel de mots, lus sur le texte
--      normalisé par normaliser_demande (116) ; familles_evenement() les
--      compte avec l'intervalle médian et les lieux — de quoi proposer
--      une ronde plutôt que d'attendre la demande ;
--   3. la mémoire des lieux : lieux.lieu_precedent_id et
--      evenements.edition_precedente_id relient une édition à la
--      précédente ; rapprocher_lieux() les apparie par code puis par nom,
--      rattacher_demandes_lieux() donne un lieu aux demandes qui le
--      nomment dans leur texte, memoire_lieux() raconte à chaque lieu ce
--      qui s'y est passé aux éditions d'avant.
--
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Le REX : d'où vient le constat
-- ---------------------------------------------------------------------
alter table public.rex_entrees add column if not exists source text not null default 'humain';
alter table public.rex_entrees add column if not exists cle_auto text;
alter table public.rex_entrees drop constraint if exists rex_entrees_source_check;
alter table public.rex_entrees add constraint rex_entrees_source_check check (source in ('humain', 'eventware'));
create unique index if not exists rex_entrees_cle_auto_unique on public.rex_entrees (evenement_id, cle_auto) where cle_auto is not null;
comment on column public.rex_entrees.source is 'humain : consigné par quelqu''un ; eventware : proposé par rex_proposer (167), à arbitrer comme les autres.';
comment on column public.rex_entrees.cle_auto is 'Clé stable du constat automatique (167) : rex_proposer met à jour le constat tant qu''il est à arbitrer, et ne le recrée pas s''il a été supprimé.';

-- ---------------------------------------------------------------------
-- 2. Les familles de demandes
-- ---------------------------------------------------------------------
-- Un référentiel commun et court. Chaque motif est un ou plusieurs mots
-- du texte normalisé (minuscules, sans accent, synonymes ramenés au
-- canon de demande_vocabulaire) ; un motif suffit ; la première famille
-- dans l'ordre l'emporte. `ronde` dit que la famille se prévient par un
-- passage régulier plutôt qu'à la demande.
create table if not exists public.familles_demande (
  code    text primary key,
  libelle text not null,
  motifs  text[] not null,
  ronde   boolean not null default false,
  module  text not null default 'logistique',
  ordre   integer not null default 100
);
comment on table public.familles_demande is 'Familles de demandes (167) : mots du texte normalisé → famille. Commun à toutes les organisations ; le vocabulaire propre passe par demande_vocabulaire.';

alter table public.familles_demande enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'familles_demande' and policyname = 'familles_demande_lecture') then
    create policy familles_demande_lecture on public.familles_demande for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'familles_demande' and policyname = 'familles_demande_gestion') then
    create policy familles_demande_gestion on public.familles_demande for all to authenticated using (est_exploitant()) with check (est_exploitant());
  end if;
end $$;
grant select, insert, update, delete on public.familles_demande to authenticated;

insert into public.familles_demande (code, libelle, motifs, ronde, module, ordre) values
  ('soins',               'Soins et blessés',          array['blesse','blessee','blesses','malaise','secours','ambulance','infirmier','infirmiere','medecin','soins','pansement','chute','dea','defibrillateur','inconscient','saigne'], false, 'sanitaire', 10),
  ('securite',            'Sécurité et ordre',         array['bagarre','agression','vol','ivre','ivresse','steward','stewards','police','intrusion','alcool','mineur','mineurs','menace','drogue'], false, 'securite', 20),
  ('jetons',              'Jetons et caisses',         array['jeton','jetons','caisse','caisses','monnaie','ticket','tickets','bancontact','terminal','fond de caisse','change'], true, 'logistique', 30),
  ('boissons',            'Réassort boissons',         array['biere','bieres','fut','futs','eau','jus','soda','sodas','soft','softs','placebo','boisson','boissons','casier','casiers','bac','bacs','cola','vin','champagne','cafe','the'], true, 'logistique', 40),
  ('nourriture',          'Réassort nourriture',       array['pain','pains','sandwich','sandwichs','frites','foodtruck','nourriture','repas','glace','glaces','glacons','glacon','chips','viande','saucisse','saucisses','ravitaillement','ravito'], true, 'logistique', 50),
  ('sanitaires',          'Sanitaires',                array['toilette','toilettes','wc','pq','urinoir','urinoirs','sanitaire','sanitaires','douche','douches'], true, 'logistique', 60),
  ('proprete',            'Propreté et déchets',       array['poubelle','poubelles','dechet','dechets','sac','sacs','nettoyer','nettoyage','balai','seau','seaux','vidanger','container','conteneur','containers','verre','gobelet','gobelets'], true, 'logistique', 70),
  ('energie',             'Énergie et carburant',      array['carburant','essence','diesel','mazout','groupe','generatrice','electricite','courant','disjoncteur','rallonge','cable','cables','gaz','bonbonne','bonbonnes','prise','prises'], true, 'logistique', 80),
  ('transport_personnes', 'Transport de personnes',    array['navette','navettes','recuperer','chercher','deposer','ramener','conduire','chauffeur','pick up','drop','passager','passagers','gare'], false, 'logistique', 90),
  ('transport_materiel',  'Transport de matériel',     array['carton','cartons','palette','palettes','livraison','livrer','camionnette','remorque','charger','decharger','transpalette','diable'], false, 'logistique', 100),
  ('technique',           'Son, lumière, technique',   array['son','lumiere','lumieres','micro','micros','enceinte','enceintes','sono','projecteur','projecteurs','ecran','regie','talkie','talkies','radio','radios','batterie','batteries','chargeur','chargeurs','eclairage'], false, 'logistique', 110),
  ('benevoles',           'Bénévoles et relèves',      array['releve','releves','renfort','renforts','benevole','benevoles','pause','absent','absente','manque','personne','personnes','equipier','equipiers'], false, 'rh', 120),
  ('acces',               'Signalétique et accès',     array['panneau','panneaux','fleche','fleches','flechage','signalisation','parking','parkings','acces','entree','sortie','barriere','barrieres','rubalise','bloque','bouchon'], false, 'parcours', 130)
on conflict (code) do update set libelle = excluded.libelle, motifs = excluded.motifs, ronde = excluded.ronde, module = excluded.module, ordre = excluded.ordre;

-- La famille d'un texte : les mots normalisés contiennent tous les mots d'un motif.
create or replace function public.famille_demande(p_evenement uuid, p_texte text)
returns text language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare mots text[]; f record;
begin
  mots := string_to_array(nullif(normaliser_demande(p_evenement, p_texte), ''), ' ');
  if mots is null then return null; end if;
  for f in select code, motifs from familles_demande order by ordre, code loop
    if exists (select 1 from unnest(f.motifs) m where mots @> string_to_array(m, ' ')) then return f.code; end if;
  end loop;
  return null;
end $$;
grant execute on function public.famille_demande(uuid, text) to authenticated;

-- Les familles d'un événement : combien, tous les combien, où.
create or replace function public.familles_evenement(p_evenement uuid)
returns table (famille text, libelle text, ronde boolean, module text, n integer, intervalle_median_min integer, lieux text, lieu_id uuid)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not (est_membre(p_evenement) or est_exploitant()) then
    raise exception 'Lecture réservée aux membres de l''événement.' using errcode = '42501';
  end if;
  return query
  with d as (
    select m.id, m.created_at, m.lieu_id,
           famille_demande(p_evenement, coalesce(m.titre, '') || ' ' || coalesce(m.description, '')) as famille
      from missions m
     where m.evenement_id = p_evenement and m.deleted_at is null and m.statut <> 'annulee'
  ),
  e as (
    select d.*, extract(epoch from d.created_at - lag(d.created_at) over (partition by d.famille order by d.created_at)) / 60 as ecart
      from d where d.famille is not null
  ),
  lx as (select e.famille as fam, e.lieu_id as lid, count(*) as nb from e where e.lieu_id is not null group by 1, 2),
  top as (select distinct on (lx.fam) lx.fam, lx.lid from lx order by lx.fam, lx.nb desc)
  select e.famille, f.libelle, f.ronde, f.module, count(*)::int,
         (percentile_cont(0.5) within group (order by e.ecart))::int,
         (select string_agg(x.t, ', ')
            from (select l.nom || ' ×' || lx.nb as t from lx join lieux l on l.id = lx.lid where lx.fam = e.famille order by lx.nb desc, l.nom limit 3) x),
         top.lid
    from e
    join familles_demande f on f.code = e.famille
    left join top on top.fam = e.famille
   group by e.famille, f.libelle, f.ronde, f.module, f.ordre, top.lid
   order by count(*) desc, f.ordre;
end $$;
grant execute on function public.familles_evenement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Le REX qui s'écrit tout seul
-- ---------------------------------------------------------------------
-- Dépose ou rafraîchit un constat automatique. Rend vrai s'il a été créé
-- ou mis à jour ; faux s'il existe déjà arbitré (retenu, rejeté, réalisé)
-- ou si le QG l'a supprimé — on ne revient pas sur une décision humaine.
create or replace function public.rex_proposer_un(
  p_evenement uuid, p_cle text, p_nature nature_rex, p_module text, p_impact impact_rex,
  p_constat text, p_proposition text, p_lieu uuid default null,
  p_objet_type text default null, p_objet_id uuid default null, p_objet_ref text default null
) returns boolean language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r record;
begin
  select id, statut, deleted_at into r from rex_entrees where evenement_id = p_evenement and cle_auto = p_cle;
  if r.id is null then
    insert into rex_entrees (evenement_id, nature, module, constat, impact, proposition, phase, lieu_id, objet_type, objet_id, objet_ref, source, cle_auto)
    values (p_evenement, p_nature, p_module, p_constat, p_impact, p_proposition, phase_courante(p_evenement), p_lieu, p_objet_type, p_objet_id, p_objet_ref, 'eventware', p_cle);
    return true;
  end if;
  if r.deleted_at is not null or r.statut <> 'a_arbitrer' then return false; end if;
  update rex_entrees
     set nature = p_nature, module = p_module, constat = p_constat, impact = p_impact, proposition = p_proposition,
         lieu_id = p_lieu, objet_type = p_objet_type, objet_id = p_objet_id, objet_ref = p_objet_ref
   where id = r.id
     and (nature, module, constat, impact, proposition) is distinct from (p_nature, p_module, p_constat, p_impact, p_proposition);
  return found;
end $$;
revoke all on function public.rex_proposer_un(uuid, text, nature_rex, text, impact_rex, text, text, uuid, text, uuid, text) from public, authenticated, anon;

-- Relit l'événement et propose ses constats. Rend le nombre de constats
-- créés ou mis à jour. Les chiffres viennent des demandes, des SOS, des
-- vocaux, du journal météo et des créneaux ; jamais d'un bénévole nommé.
create or replace function public.rex_proposer(p_evenement uuid)
returns integer language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  ev evenements%rowtype;
  v_n int := 0;
  s record; r record;
  v_total int; v_sans int; v_mes int; v_p90 numeric; v_med numeric;
  v_pic_h timestamptz; v_pic_n int; v_moy numeric;
  v_sos int; v_sos_mes int; v_sos_p90 numeric; v_sos_sans int;
  v_voc int; v_voc_tard int;
  v_postes int; v_postes_avec int;
  v_impact impact_rex; v_prop text; v_periode int;
begin
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then raise exception 'Événement inconnu.' using errcode = 'P0002'; end if;
  -- « analyse : modifier » (arbitrer), pas « créer » : le REX rapide est ouvert à tous les bénévoles,
  -- la relecture de l'événement est un geste du QG.
  if not (a_tout_pouvoir(p_evenement) or a_permission(p_evenement, 'analyse', 'modifier')) then
    raise exception 'Proposer des constats demande « analyse : modifier ».' using errcode = '42501';
  end if;

  -- a. Les demandes closes sans passer par « attribuée » ni « en cours » : le délai n'est pas mesurable.
  select count(*) filter (where statut = 'resolue'),
         count(*) filter (where statut = 'resolue' and attribuee_le is null and demarree_le is null)
    into v_total, v_sans
    from missions where evenement_id = p_evenement and deleted_at is null;
  if v_total >= 5 and v_sans * 5 >= v_total then
    if rex_proposer_un(p_evenement, 'demandes_sans_trace', 'dysfonctionnement', 'logistique', 'gene',
      format('%s demandes sur %s ont été closes sans passer par « attribuée » ni « en cours » : leur délai de prise en charge n''est pas mesurable, et les seuils de la prochaine édition restent ceux par défaut.', v_sans, v_total),
      'Prendre en charge depuis le téléphone (Attribuer ou Démarrer) avant de résoudre, même après coup ; une demande résolue d''un coup ne dit rien du temps d''attente.')
    then v_n := v_n + 1; end if;
  end if;

  -- b. Les délais de prise en charge, par priorité, face aux seuils appris de l'organisation (154).
  for s in select * from seuils_prise_en_charge(ev.organisation_id) loop
    select count(*), percentile_cont(0.9) within group (order by x.d), percentile_cont(0.5) within group (order by x.d)
      into v_mes, v_p90, v_med
      from (select extract(epoch from least(m.attribuee_le, m.demarree_le) - m.created_at) / 60 as d
              from missions m
             where m.evenement_id = p_evenement and m.deleted_at is null and m.priorite::text = s.priorite
               and coalesce(m.attribuee_le, m.demarree_le) is not null
               and least(m.attribuee_le, m.demarree_le) >= m.created_at) x;
    if v_mes >= 5 and v_p90 > s.seuil_min then
      if rex_proposer_un(p_evenement, 'delai_' || s.priorite, 'dysfonctionnement', 'logistique',
        case when s.priorite = 'P1' then 'bloquant'::impact_rex else 'gene' end,
        format('%s : 9 demandes sur 10 ont attendu jusqu''à %s min avant d''être prises en charge (médiane %s min, seuil %s min, %s demandes mesurées).', s.priorite, round(v_p90), round(v_med), s.seuil_min, v_mes),
        case when s.priorite = 'P1' then 'Un binôme au QG aux heures de pointe, et la prise en charge depuis le téléphone pour ne pas repasser par le QG.'
             else 'Vérifier qui reçoit ces demandes aux heures de pointe ; un relais par équipe allège le QG.' end)
      then v_n := v_n + 1; end if;
    elsif v_mes >= 5 and v_p90 <= s.seuil_min / 2.0 then
      if rex_proposer_un(p_evenement, 'delai_' || s.priorite, 'reussite', 'logistique', 'mineur',
        format('%s : 9 demandes sur 10 prises en charge en moins de %s min, deux fois sous le seuil de %s min (%s demandes mesurées).', s.priorite, greatest(1, round(v_p90)), s.seuil_min, v_mes),
        'À garder : noter ce qui a permis cette réactivité (effectif du QG, relais par équipe, horaires) pour le reproduire.')
      then v_n := v_n + 1; end if;
    end if;
  end loop;

  -- c. Le pic de charge : l'heure qui a reçu le plus de demandes, face à la moyenne des heures actives.
  select date_trunc('hour', created_at), count(*)::int into v_pic_h, v_pic_n
    from missions where evenement_id = p_evenement and deleted_at is null
   group by 1 order by 2 desc, 1 limit 1;
  select count(*)::numeric / greatest(1, count(distinct date_trunc('hour', created_at))) into v_moy
    from missions where evenement_id = p_evenement and deleted_at is null;
  if v_pic_n >= 6 and v_pic_n >= 2.5 * v_moy then
    if rex_proposer_un(p_evenement, 'pic_charge', 'risque', 'logistique', 'gene',
      format('Pic de %s demandes entre %s h et %s h (%s), pour une moyenne de %s par heure active.',
             v_pic_n, to_char(v_pic_h at time zone 'Europe/Brussels', 'HH24'), to_char((v_pic_h + interval '1 hour') at time zone 'Europe/Brussels', 'HH24'),
             to_char(v_pic_h at time zone 'Europe/Brussels', 'DD/MM'), round(v_moy, 1)),
      'Anticiper cette tranche : renfort au QG, tournée de réassort juste avant, jetons et caisses préparés.')
    then v_n := v_n + 1; end if;
  end if;

  -- d. Les familles qui reviennent : une ronde vaut mieux que dix demandes.
  for r in select * from familles_evenement(p_evenement) where n >= 3 order by n desc, famille limit 8 loop
    v_impact := case when r.n >= 10 then 'gene'::impact_rex else 'mineur' end;
    if r.ronde and r.intervalle_median_min is not null then
      v_periode := greatest(15, (r.intervalle_median_min / 15) * 15);
      v_prop := format('Prévoir une ronde « %s » toutes les %s min sur ces lieux plutôt qu''attendre les demandes.', lower(r.libelle), v_periode);
    else
      v_prop := case r.famille
        when 'transport_personnes' then 'Désigner un chauffeur de permanence avec un véhicule dédié et un point de rendez-vous connu de tous.'
        when 'transport_materiel'  then 'Grouper les transports de matériel sur des créneaux fixes, avec le véhicule et le bénévole prévus au planning.'
        when 'benevoles'           then 'Prévoir une réserve de bénévoles volants sur les créneaux chargés, et un relais par équipe pour les relèves.'
        when 'technique'           then 'Un référent technique joignable par radio, avec le matériel de rechange (batteries, câbles, micros) au QG.'
        when 'soins'               then 'Revoir la couverture du poste de secours sur ces lieux et ces heures avec le prestataire de soins.'
        when 'securite'            then 'Revoir le dispositif de gardiennage sur ces lieux et ces heures ; un signalement structuré plutôt qu''une demande.'
        else 'Prévoir la ressource en amont dans le planning plutôt que la demander au QG.' end;
    end if;
    if rex_proposer_un(p_evenement, 'famille_' || r.famille, 'suggestion', r.module, v_impact,
      format('%s demandes « %s » au fil de l''événement%s%s.', r.n, r.libelle,
             case when r.intervalle_median_min is not null then format(', une toutes les %s min en médiane', r.intervalle_median_min) else '' end,
             case when r.lieux is not null then ' — surtout à ' || r.lieux else '' end),
      v_prop, r.lieu_id)
    then v_n := v_n + 1; end if;
  end loop;

  -- e. Ce qui reste ouvert quand l'événement se range.
  if ev.phase in ('demontage', 'cloture') then
    select count(*) into v_total from missions
     where evenement_id = p_evenement and deleted_at is null and statut in ('a_traiter', 'attribuee', 'en_cours');
    if v_total > 0 then
      if rex_proposer_un(p_evenement, 'demandes_ouvertes', 'dysfonctionnement', 'logistique', 'mineur',
        format('%s demande(s) encore ouverte(s) au moment de ranger : rien ne dit si elles ont été faites.', v_total),
        'Clore ou annuler chaque demande avant la clôture ; une demande laissée ouverte fausse les délais appris.')
      then v_n := v_n + 1; end if;
    end if;
  end if;

  -- f. Les seuils météo franchis (journal du module meteo : « Seuil orange franchi — Froid : 2 °C »).
  for r in
    select lower(substring(j.texte from '^Seuil (\w+) franchi')) as niveau,
           trim(substring(j.texte from 'franchi — ([^:]+)')) as critere, count(*)::int as n
      from journal j
     where j.evenement_id = p_evenement and j.deleted_at is null and j.module = 'meteo' and j.texte ~ '^Seuil \w+ franchi — '
     group by 1, 2
  loop
    if rex_proposer_un(p_evenement, 'meteo_' || regexp_replace(lower(unaccent(r.critere)), '[^a-z0-9]+', '_', 'g') || '_' || r.niveau,
      'risque', 'securite', case when r.niveau = 'rouge' then 'bloquant'::impact_rex else 'gene' end,
      format('Seuil %s « %s » franchi %s fois pendant l''événement.', r.niveau, r.critere, r.n),
      'Prévoir la parade dans le dispositif (abri, eau, boissons chaudes, report) et vérifier que le seuil correspond au terrain.')
    then v_n := v_n + 1; end if;
  end loop;

  -- g. Les SOS : le temps avant prise en charge, et ceux classés sans suite.
  select count(*), count(*) filter (where statut = 'sans_suite'),
         count(*) filter (where pris_en_charge_le is not null and recu_le is not null),
         percentile_cont(0.9) within group (order by extract(epoch from pris_en_charge_le - recu_le) / 60) filter (where pris_en_charge_le is not null and recu_le is not null)
    into v_sos, v_sos_sans, v_sos_mes, v_sos_p90
    from signalements where evenement_id = p_evenement and deleted_at is null and doublon_de is null;
  if v_sos_mes >= 3 and v_sos_p90 > 5 then
    if rex_proposer_un(p_evenement, 'sos_delai', 'dysfonctionnement', 'sos', 'dangereux',
      format('SOS : 9 sur 10 ont attendu jusqu''à %s min avant d''être pris en charge (%s SOS mesurés).', round(v_sos_p90), v_sos_mes),
      'Un écran PC-OPS toujours ouvert avec l''alarme sonore, et un relais désigné quand le QG s''absente.')
    then v_n := v_n + 1; end if;
  elsif v_sos_mes >= 3 then
    if rex_proposer_un(p_evenement, 'sos_delai', 'reussite', 'sos', 'mineur',
      format('SOS : 9 sur 10 pris en charge en moins de %s min (%s SOS mesurés).', greatest(1, round(v_sos_p90)), v_sos_mes),
      'À garder : la veille du PC-OPS a tenu ; noter qui tenait l''écran et comment.')
    then v_n := v_n + 1; end if;
  end if;
  if v_sos >= 5 and v_sos_sans * 10 >= v_sos * 3 then
    if rex_proposer_un(p_evenement, 'sos_sans_suite', 'suggestion', 'sos', 'mineur',
      format('%s SOS sur %s classés sans suite : le bouton est peut-être trop facile à déclencher, ou mal compris.', v_sos_sans, v_sos),
      'Revoir le message de la page du participant et la confirmation avant l''envoi d''un SOS.')
    then v_n := v_n + 1; end if;
  end if;

  -- h. Les messages vocaux que le QG n'a pas entendus à temps.
  select count(*), count(*) filter (where statut = 'nouveau' or (entendu_le is not null and entendu_le - parle_le > interval '10 minutes'))
    into v_voc, v_voc_tard
    from messages_vocaux where evenement_id = p_evenement and deleted_at is null;
  if v_voc >= 5 and v_voc_tard * 4 >= v_voc then
    if rex_proposer_un(p_evenement, 'vocaux_non_entendus', 'dysfonctionnement', 'securite', 'gene',
      format('%s messages vocaux sur %s n''ont pas été entendus par le QG dans les 10 min.', v_voc_tard, v_voc),
      'Désigner qui écoute le fil « Entendu » à chaque créneau, et activer la transcription par le serveur pour lire sans écouter.')
    then v_n := v_n + 1; end if;
  end if;

  -- i. Les postes sans fiche : les bénévoles y arrivent sans consignes écrites (et sans QR du poste).
  select count(distinct poste), count(distinct poste) filter (where fiche_id is not null)
    into v_postes, v_postes_avec
    from creneaux where evenement_id = p_evenement and deleted_at is null and nullif(trim(poste), '') is not null;
  if v_postes >= 3 and v_postes_avec < v_postes then
    if rex_proposer_un(p_evenement, 'postes_sans_fiche', 'suggestion', 'rh', 'mineur',
      format('%s postes sur %s n''ont pas de fiche de poste : les bénévoles y arrivent sans consignes écrites.', v_postes - v_postes_avec, v_postes),
      'Écrire une fiche par poste (mission, tâches, matériel, à signaler) : elle sera le QR du poste de la prochaine édition.')
    then v_n := v_n + 1; end if;
  end if;

  if v_n > 0 then
    perform journaliser(p_evenement, 'analyse', 'rex_auto', format('Eventware propose %s constat(s) au REX, à arbitrer', v_n), 'routine');
  end if;
  return v_n;
end $$;
grant execute on function public.rex_proposer(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. La mémoire des lieux
-- ---------------------------------------------------------------------
alter table public.lieux add column if not exists lieu_precedent_id uuid references public.lieux (id) on delete set null;
alter table public.evenements add column if not exists edition_precedente_id uuid references public.evenements (id) on delete set null;
create index if not exists lieux_precedent_idx on public.lieux (lieu_precedent_id);
comment on column public.lieux.lieu_precedent_id is 'Le même lieu à l''édition précédente (167) : la mémoire des lieux remonte cette chaîne.';
comment on column public.evenements.edition_precedente_id is 'L''édition précédente de cet événement (167), posée par rapprocher_lieux.';

-- Apparie les lieux d'une édition à ceux de la précédente : par code, sinon par nom (sans accent ni casse).
-- Ne touche pas un lieu déjà rapproché. Rend le nombre de lieux rapprochés.
create or replace function public.rapprocher_lieux(p_cible uuid, p_source uuid)
returns integer language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare v_n int; v_nom text;
begin
  if p_cible = p_source then raise exception 'Un événement n''est pas sa propre édition précédente.' using errcode = '22023'; end if;
  if not (a_tout_pouvoir(p_cible) or a_permission(p_cible, 'referentiels', 'modifier')) then
    raise exception 'Rapprocher les lieux demande « référentiels : modifier ».' using errcode = '42501';
  end if;
  if not (est_membre(p_source) or est_exploitant()) then
    raise exception 'Il faut être membre de l''édition précédente.' using errcode = '42501';
  end if;
  if (select organisation_id from evenements where id = p_cible) is distinct from (select organisation_id from evenements where id = p_source) then
    raise exception 'Les deux éditions doivent appartenir à la même organisation.' using errcode = '22023';
  end if;
  select nom into v_nom from evenements where id = p_source;
  update evenements set edition_precedente_id = p_source where id = p_cible and edition_precedente_id is distinct from p_source;

  with cand as (
    select c.id as cible, s.id as source,
           row_number() over (partition by c.id order by (lower(c.code) = lower(s.code)) desc, s.created_at) as rn
      from lieux c
      join lieux s on s.evenement_id = p_source and s.deleted_at is null
       and (lower(c.code) = lower(s.code) or lower(unaccent(c.nom)) = lower(unaccent(s.nom)))
     where c.evenement_id = p_cible and c.deleted_at is null and c.lieu_precedent_id is null
  )
  update lieux l set lieu_precedent_id = cand.source from cand where cand.cible = l.id and cand.rn = 1;
  get diagnostics v_n = row_count;
  perform journaliser(p_cible, 'analyse', 'memoire', format('Mémoire des lieux : %s lieu(x) rapproché(s) de « %s »', v_n, v_nom), 'routine');
  return v_n;
end $$;
grant execute on function public.rapprocher_lieux(uuid, uuid) to authenticated;

-- Donne un lieu aux demandes qui n'en ont pas mais le nomment dans leur texte
-- (code ou nom du lieu, dans le texte normalisé). Le nom le plus long gagne :
-- « étape 2 » avant « étape ». Rend le nombre de demandes rattachées.
create or replace function public.rattacher_demandes_lieux(p_evenement uuid)
returns integer language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare m record; mots text[]; v_lieu uuid; v_n int := 0;
begin
  if not (a_tout_pouvoir(p_evenement) or a_permission(p_evenement, 'missions', 'modifier')) then
    raise exception 'Rattacher les demandes demande « missions : modifier ».' using errcode = '42501';
  end if;
  for m in select id, titre, description from missions where evenement_id = p_evenement and deleted_at is null and lieu_id is null loop
    mots := string_to_array(nullif(normaliser_demande(p_evenement, coalesce(m.titre, '') || ' ' || coalesce(m.description, '')), ''), ' ');
    if mots is null then continue; end if;
    select l.id into v_lieu
      from lieux l
     where l.evenement_id = p_evenement and l.deleted_at is null
       and (lower(l.code) = any (mots)
            or mots @> string_to_array(nullif(normaliser_demande(p_evenement, l.nom), ''), ' '))
     order by length(l.nom) desc, l.code limit 1;
    if v_lieu is not null then
      update missions set lieu_id = v_lieu where id = m.id;
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    perform journaliser(p_evenement, 'missions', 'rattachement', format('%s demande(s) rattachée(s) à un lieu d''après leur texte', v_n), 'routine');
  end if;
  return v_n;
end $$;
grant execute on function public.rattacher_demandes_lieux(uuid) to authenticated;

-- Ce que chaque lieu de l'événement a vécu aux éditions précédentes (en
-- remontant la chaîne lieu_precedent_id) : demandes par famille,
-- signalements, constats de REX retenus ou réalisés.
create or replace function public.memoire_lieux(p_evenement uuid)
returns table (lieu_id uuid, nom text, editions integer, demandes integer, familles jsonb, signalements integer, rex integer, constats text[])
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not (est_membre(p_evenement) or est_exploitant()) then
    raise exception 'Lecture réservée aux membres de l''événement.' using errcode = '42501';
  end if;
  return query
  with recursive chaine as (
    select l.id as lid, l.nom as lnom, l.lieu_precedent_id as anc, 1 as prof
      from lieux l where l.evenement_id = p_evenement and l.deleted_at is null and l.lieu_precedent_id is not null
    union all
    select c.lid, c.lnom, a.lieu_precedent_id, c.prof + 1
      from chaine c join lieux a on a.id = c.anc where c.prof < 12 and a.lieu_precedent_id is not null
  ),
  anc as (select c.lid, c.lnom, c.anc as aid from chaine c),
  dem as (
    select a.lid, famille_demande(m.evenement_id, coalesce(m.titre, '') || ' ' || coalesce(m.description, '')) as fam
      from anc a join missions m on m.lieu_id = a.aid and m.deleted_at is null and m.statut <> 'annulee'
  ),
  fam as (
    select x.lid, jsonb_agg(jsonb_build_object('code', x.fam, 'libelle', coalesce(f.libelle, 'Autres'), 'n', x.nb) order by x.nb desc) as familles
      from (select d.lid, coalesce(d.fam, 'autre') as fam, count(*) as nb from dem d group by 1, 2) x
      left join familles_demande f on f.code = x.fam
     group by x.lid
  ),
  sig as (
    select a.lid, count(*)::int as nb from anc a join signalements s on s.lieu_id = a.aid and s.deleted_at is null and s.doublon_de is null group by 1
  ),
  rx as (
    select a.lid, count(*)::int as nb,
           (array_agg(r.constat order by (r.statut = 'retenu') desc, r.created_at desc))[1:3] as constats
      from anc a join rex_entrees r on r.lieu_id = a.aid and r.deleted_at is null and r.statut in ('retenu', 'realise')
     group by 1
  )
  select a.lid, a.lnom, count(*)::int,
         coalesce((select count(*) from dem d where d.lid = a.lid), 0)::int,
         fam.familles, coalesce(sig.nb, 0), coalesce(rx.nb, 0), rx.constats
    from anc a
    left join fam on fam.lid = a.lid
    left join sig on sig.lid = a.lid
    left join rx on rx.lid = a.lid
   group by a.lid, a.lnom, fam.familles, sig.nb, rx.nb, rx.constats
   order by 4 desc, a.lnom;
end $$;
grant execute on function public.memoire_lieux(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
