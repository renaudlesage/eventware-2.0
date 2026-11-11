-- =====================================================================
-- 169 — LES FONCTIONS DE L'AUDIT ERGONOMIQUE DU 11/11
--
-- L'audit a montré, chiffres de production à l'appui, quatre manques
-- qui coûtent cher (le cinquième, les notifications poussées, est la
-- migration 170) :
--
--   1. LA DEMANDE DU BÉNÉVOLE. Le rôle bénévole n'a pas `missions :
--      créer` (et ne doit pas l'avoir : ce droit ouvre la Situation).
--      Résultat à BFMF 2026 : 85 demandes, toutes saisies par une seule
--      personne au QG. `demande_terrain()` laisse tout membre actif
--      poser une demande courte : une famille, une phrase, son lieu.
--      Débit limité, rejouable par sa clé, lieu repris du créneau en cours.
--
--   2. LA CLÔTURE GUIDÉE. BFMF 2026 est resté quatre mois en
--      exploitation : rien n'invitait à clôturer, alors que les seuils
--      appris (154) et le REX automatique (167) en dépendent.
--      `controle_cloture()` dit ce qui reste ouvert avant de fermer.
--
--   3. L'ARBITRAGE EN LOT. 100 constats « à arbitrer », 4 arbitrés : un
--      par un, ça ne tient pas. `rex_doublons()` rapproche les constats
--      qui disent la même chose ; `rex_reporter()` transforme les
--      constats retenus en jalons de l'édition suivante.
--
--   4. LA RECHERCHE GLOBALE. `rechercher()` trouve une demande par sa
--      référence, un contact par son nom, un lieu, un jalon, une ligne
--      de main courante — et dit où l'ouvrir. Elle s'exécute avec les
--      droits de l'appelant : on ne trouve que ce qu'on peut lire.
--
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. La demande du bénévole
-- ---------------------------------------------------------------------
create or replace function public.demande_terrain(
  p_evenement uuid,
  p_texte     text,
  p_famille   text    default null,
  p_lieu      uuid    default null,
  p_bloquant  boolean default false,
  p_cle       uuid    default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  ev evenements%rowtype;
  v_membre uuid; v_id uuid; v_texte text; v_fam familles_demande%rowtype;
  v_lieu uuid; v_module text; v_priorite priorite_mission; v_titre text; v_recentes int;
  m missions%rowtype;
begin
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then raise exception 'Événement inconnu.' using errcode = 'P0002'; end if;
  select mb.id into v_membre from membres_evenement mb
   where mb.evenement_id = p_evenement and mb.user_id = auth.uid() and mb.actif and mb.deleted_at is null limit 1;
  if v_membre is null then
    raise exception 'Il faut être membre actif de l''événement pour y poser une demande.' using errcode = '42501';
  end if;
  if not coalesce((ev.modules ->> 'logistique')::boolean, false) then
    raise exception 'Les demandes ne sont pas ouvertes sur cet événement.' using errcode = 'P0003';
  end if;
  if ev.phase = 'cloture' then
    raise exception 'L''événement est clôturé : plus de demande.' using errcode = 'P0006';
  end if;

  -- Rejouable : la même clé rend la demande déjà créée (envoi hors réseau rejoué).
  if p_cle is not null then
    select * into m from missions where id = p_cle;
    if m.id is not null then
      if m.evenement_id <> p_evenement or m.created_by is distinct from auth.uid() then
        raise exception 'Clé de demande déjà utilisée.' using errcode = '23505';
      end if;
      return jsonb_build_object('id', m.id, 'reference', m.reference, 'statut', m.statut, 'deja', true);
    end if;
  end if;

  v_texte := nullif(trim(regexp_replace(coalesce(p_texte, ''), '\s+', ' ', 'g')), '');
  if p_famille is not null then
    select * into v_fam from familles_demande where code = p_famille;
    if v_fam.code is null then raise exception 'Famille de demande inconnue.' using errcode = '22023'; end if;
  elsif v_texte is not null then
    -- Sans famille choisie, on la lit dans le texte (116, 167).
    select * into v_fam from familles_demande where code = famille_demande(p_evenement, v_texte);
  end if;
  if v_texte is null and v_fam.code is null then
    raise exception 'Dis en une phrase ce qu''il te faut, ou choisis une famille.' using errcode = '22023';
  end if;
  if length(coalesce(v_texte, '')) > 500 then
    raise exception 'Demande trop longue : 500 caractères au plus.' using errcode = '22001';
  end if;

  -- Débit : dix demandes par membre et par quart d'heure. Au-delà, c'est la radio ou le talkie.
  select count(*) into v_recentes from missions
   where evenement_id = p_evenement and created_by = auth.uid() and created_at > now() - interval '15 minutes';
  if v_recentes >= 10 then
    raise exception 'Dix demandes en un quart d''heure : passe par la radio ou « Parler au QG ».' using errcode = 'P0005';
  end if;

  -- Le lieu : celui qu'on donne s'il est de l'événement, sinon celui du créneau en cours.
  if p_lieu is not null then
    select l.id into v_lieu from lieux l where l.id = p_lieu and l.evenement_id = p_evenement and l.deleted_at is null;
  end if;
  if v_lieu is null then
    select c.lieu_id into v_lieu
      from affectations a join creneaux c on c.id = a.creneau_id
     where a.membre_id = v_membre and a.deleted_at is null and a.statut in ('propose', 'confirme', 'present')
       and c.deleted_at is null and c.lieu_id is not null and now() between c.debut - interval '30 minutes' and c.fin + interval '30 minutes'
     order by c.debut desc limit 1;
  end if;

  -- Soins et sécurité partent en sécurité, P1 : le QG doit les voir avant le reste.
  v_module := case when v_fam.code in ('soins', 'securite') then 'securite' else 'logistique' end;
  v_priorite := case when v_fam.code in ('soins', 'securite') then 'P1'
                     when coalesce(p_bloquant, false) then 'P2' else 'P3' end;
  v_titre := left(case when v_fam.code is not null and v_texte is not null then v_fam.libelle || ' : ' || v_texte
                       when v_fam.code is not null then v_fam.libelle
                       else v_texte end, 160);

  v_id := coalesce(p_cle, gen_random_uuid());
  insert into missions (id, evenement_id, module, phase, titre, description, priorite, statut, lieu_id, bloquant, qui_concerne)
  values (v_id, p_evenement, v_module, ev.phase, v_titre, v_texte, v_priorite, 'a_traiter', v_lieu, coalesce(p_bloquant, false),
          (select mb.nom_affiche from membres_evenement mb where mb.id = v_membre))
  returning * into m;
  return jsonb_build_object('id', m.id, 'reference', m.reference, 'statut', m.statut, 'priorite', m.priorite, 'module', m.module,
                            'lieu', (select l.nom from lieux l where l.id = m.lieu_id), 'deja', false);
end $$;
revoke all on function public.demande_terrain(uuid, text, text, uuid, boolean, uuid) from public, anon;
grant execute on function public.demande_terrain(uuid, text, text, uuid, boolean, uuid) to authenticated;

-- Ce qu'un membre voit de ses propres demandes, sans `missions : lire` (un rôle
-- sur mesure peut ne pas l'avoir) : la demande, où elle en est, qui la tient.
create or replace function public.mes_demandes(p_evenement uuid)
returns table (id uuid, reference text, titre text, statut text, priorite text, module text, lieu text, created_at timestamptz, attribuee_le timestamptz, resolue_le timestamptz, equipe text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.reference, m.titre, m.statut::text, m.priorite::text, m.module,
         (select l.nom from lieux l where l.id = m.lieu_id), m.created_at, m.attribuee_le, m.resolue_le,
         (select e.code from equipes e where e.id = m.equipe_id)
    from missions m
   where m.evenement_id = p_evenement and m.deleted_at is null and m.created_by = auth.uid()
     and exists (select 1 from membres_evenement mb where mb.evenement_id = p_evenement and mb.user_id = auth.uid() and mb.deleted_at is null)
   order by m.created_at desc
   limit 30;
$$;
revoke all on function public.mes_demandes(uuid) from public, anon;
grant execute on function public.mes_demandes(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. La clôture guidée
-- ---------------------------------------------------------------------
-- Ce qui reste ouvert avant de fermer. `bloquant` : à régler d'abord ;
-- `alerte` : à regarder ; `info` : ce que la clôture va faire.
create or replace function public.controle_cloture(p_evenement uuid)
returns table (code text, gravite text, titre text, detail text, n integer, ecran text, rubrique text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ev evenements%rowtype; v_n int; v_fin date;
begin
  select * into ev from evenements where id = p_evenement and deleted_at is null;
  if ev.id is null then raise exception 'Événement inconnu.' using errcode = 'P0002'; end if;
  if not (a_tout_pouvoir(p_evenement) or est_exploitant()) then
    raise exception 'Le contrôle de clôture est réservé à la coordination.' using errcode = '42501';
  end if;

  select count(*) into v_n from alertes a where a.evenement_id = p_evenement and a.active and a.deleted_at is null;
  if v_n > 0 then return query select 'CLO_ALERTES', 'bloquant', format('%s alerte(s) encore active(s)', v_n),
    'Lève-les : une alerte active reste affichée chez tous les membres après la clôture.', v_n, 'situation', null::text; end if;

  select count(*) into v_n from signalements s where s.evenement_id = p_evenement and s.deleted_at is null and s.doublon_de is null and s.statut in ('recu', 'pris_en_charge', 'en_cours');
  if v_n > 0 then return query select 'CLO_SOS', 'bloquant', format('%s signalement(s) non clos', v_n),
    'Clôture-les ou classe-les sans suite : rien ne dit sinon s''ils ont été traités.', v_n, 'securite', 'signalements'; end if;

  select count(*) into v_n from maydays y where y.evenement_id = p_evenement and y.statut in ('emis', 'accuse', 'en_cours');
  if v_n > 0 then return query select 'CLO_MAYDAY', 'bloquant', format('%s Mayday non clos', v_n),
    'Un appel de détresse ouvert ne se laisse pas derrière soi.', v_n, 'securite', 'mayday'; end if;

  select count(*) into v_n from recherches r where r.evenement_id = p_evenement and r.deleted_at is null and r.statut = 'en_cours';
  if v_n > 0 then return query select 'CLO_RECHERCHES', 'bloquant', format('%s recherche(s) de personne en cours', v_n),
    'Indique l''issue de chaque recherche.', v_n, 'securite', 'recherches'; end if;

  select count(*) into v_n from missions m where m.evenement_id = p_evenement and m.deleted_at is null and m.statut in ('a_traiter', 'attribuee', 'en_cours');
  if v_n > 0 then return query select 'CLO_DEMANDES', 'alerte', format('%s demande(s) encore ouverte(s)', v_n),
    'Résous-les ou annule-les : une demande laissée ouverte fausse les délais appris pour la prochaine édition.', v_n, 'logistique', 'interventions'; end if;

  select count(*) into v_n from transports t where t.evenement_id = p_evenement and t.deleted_at is null and t.statut in ('a_traiter', 'attribuee', 'en_cours');
  if v_n > 0 then return query select 'CLO_TRANSPORTS', 'alerte', format('%s transport(s) non terminé(s)', v_n),
    'Termine-les ou annule-les.', v_n, 'logistique', 'transports'; end if;

  select count(*) into v_n from attributions a where a.evenement_id = p_evenement and a.deleted_at is null and a.remis_le is not null and a.rendu_le is null;
  if v_n > 0 then return query select 'CLO_ATTRIBUTIONS', 'alerte', format('%s clé(s) ou radio(s) non rendue(s)', v_n),
    'Pointe les retours, ou note ce qui manque.', v_n, 'logistique', 'attributions'; end if;

  select count(*) into v_n from messages_vocaux v where v.evenement_id = p_evenement and v.deleted_at is null and v.statut = 'nouveau';
  if v_n > 0 then return query select 'CLO_VOCAUX', 'alerte', format('%s message(s) vocal(aux) jamais entendu(s)', v_n),
    'Écoute-les avant la clôture : l''audio sera effacé.', v_n, 'situation', null::text; end if;

  select count(*) into v_n from exercices x where x.evenement_id = p_evenement and x.deleted_at is null and x.debut_reel is not null and x.fin_reel is null;
  if v_n > 0 then return query select 'CLO_EXERCICE', 'alerte', format('%s exercice(s) démarré(s) et non terminé(s)', v_n),
    'Termine l''exercice pour figer sa synthèse.', v_n, 'exercices', 'exercices'; end if;

  select count(*) into v_n from jalons j where j.evenement_id = p_evenement and j.deleted_at is null and j.statut in ('a_venir', 'en_cours') and j.echeance < now();
  if v_n > 0 then return query select 'CLO_JALONS', 'alerte', format('%s jalon(s) dépassé(s) et non pointé(s)', v_n),
    'Marque-les faits, ratés ou annulés : le planning de la prochaine édition part de là.', v_n, 'planning', 'jalons'; end if;

  -- Ce que la clôture fera, pour qu'on le sache avant.
  select count(*) into v_n from messages_vocaux v where v.evenement_id = p_evenement and v.chemin_audio is not null;
  if v_n > 0 then return query select 'CLO_AUDIO', 'info', format('%s enregistrement(s) audio seront effacés', v_n),
    'Pour de bon. Les transcriptions restent.', v_n, null::text, null::text; end if;

  select count(*) into v_n from rex_entrees r where r.evenement_id = p_evenement and r.deleted_at is null and r.statut = 'a_arbitrer';
  return query select 'CLO_REX', 'info', format('%s constat(s) à arbitrer', v_n),
    'Eventware ajoutera les siens à la clôture. L''arbitrage peut se faire après, à tête reposée.', v_n, 'analyse', 'constats';

  v_fin := coalesce(ev.date_demontage, ev.date_fin, ev.date_debut);
  if v_fin is not null and v_fin < current_date and ev.phase <> 'cloture' then
    return query select 'CLO_DATE', 'info', format('L''événement est terminé depuis %s jour(s)', (current_date - v_fin)),
      'Les délais appris et le REX automatique attendent la clôture.', (current_date - v_fin)::int, null::text, null::text;
  end if;
end $$;
revoke all on function public.controle_cloture(uuid) from public, anon;
grant execute on function public.controle_cloture(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. L'arbitrage des constats en lot
-- ---------------------------------------------------------------------
-- Les paires de constats « à arbitrer » qui disent presque la même chose
-- (trigrammes, sans accent ni casse). L'écran en fait des groupes.
create or replace function public.rex_doublons(p_evenement uuid, p_seuil real default 0.5)
returns table (id_a uuid, id_b uuid, similarite real)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if not (a_tout_pouvoir(p_evenement) or a_permission(p_evenement, 'analyse', 'lire')) then
    raise exception 'Lecture des constats refusée.' using errcode = '42501';
  end if;
  return query
  with c as (
    select r.id, lower(unaccent(r.constat)) as t, r.created_at
      from rex_entrees r
     where r.evenement_id = p_evenement and r.deleted_at is null and r.statut = 'a_arbitrer' and length(r.constat) >= 12
  )
  select a.id, b.id, similarity(a.t, b.t)
    from c a join c b on (a.created_at, a.id) < (b.created_at, b.id)
   where similarity(a.t, b.t) >= greatest(0.3, least(0.95, coalesce(p_seuil, 0.5)))
   order by 3 desc
   limit 400;
end $$;
revoke all on function public.rex_doublons(uuid, real) from public, anon;
grant execute on function public.rex_doublons(uuid, real) to authenticated;

-- Reporte des constats retenus en jalons de l'édition suivante : un jalon
-- par constat, daté un mois avant l'événement, qui dit d'où il vient.
-- Rejouable : un constat déjà reporté n'est pas reporté deux fois.
create or replace function public.rex_reporter(p_evenement uuid, p_cible uuid, p_ids uuid[])
returns integer language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare src evenements%rowtype; cib evenements%rowtype; r rex_entrees%rowtype; v_n int := 0; v_jalon uuid; v_code text; v_rang int; v_echeance timestamptz;
begin
  select * into src from evenements where id = p_evenement and deleted_at is null;
  select * into cib from evenements where id = p_cible and deleted_at is null;
  if src.id is null or cib.id is null then raise exception 'Événement inconnu.' using errcode = 'P0002'; end if;
  if p_evenement = p_cible then raise exception 'L''édition suivante ne peut pas être la même.' using errcode = '22023'; end if;
  if src.organisation_id is distinct from cib.organisation_id then
    raise exception 'Les deux éditions doivent appartenir à la même organisation.' using errcode = '22023';
  end if;
  if not (a_tout_pouvoir(p_evenement) or a_permission(p_evenement, 'analyse', 'modifier')) then
    raise exception 'Reporter des constats demande « analyse : modifier » sur l''événement d''origine.' using errcode = '42501';
  end if;
  if not (a_tout_pouvoir(p_cible) or a_permission(p_cible, 'rh', 'creer')) then
    raise exception 'Il faut pouvoir créer des jalons dans l''édition suivante.' using errcode = '42501';
  end if;

  v_echeance := coalesce(cib.date_debut::timestamptz - interval '30 days', now() + interval '30 days');
  select coalesce(max(nullif(regexp_replace(j.code, '^REX-', ''), '')::int), 0) into v_rang
    from jalons j where j.evenement_id = p_cible and j.code ~ '^REX-[0-9]+$';

  for r in
    select * from rex_entrees x
     where x.evenement_id = p_evenement and x.deleted_at is null and x.id = any (p_ids)
       and x.statut in ('retenu', 'realise')
       and not (x.objet_type = 'jalons' and x.objet_id is not null and exists (select 1 from jalons j where j.id = x.objet_id and j.evenement_id = p_cible))
     order by x.created_at, x.id
  loop
    v_rang := v_rang + 1;
    v_code := 'REX-' || lpad(v_rang::text, 2, '0');
    insert into jalons (evenement_id, code, libelle, categorie, echeance, lieu_id, responsable, commentaire, statut, visibilite, phase_cible)
    values (p_cible, v_code, left(coalesce(nullif(trim(r.proposition), ''), r.constat), 140), 'rex', v_echeance,
            (select l.id from lieux l where l.evenement_id = p_cible and l.deleted_at is null and l.lieu_precedent_id = r.lieu_id limit 1),
            r.porteur,
            format(E'Constat de « %s » : %s%s', src.nom, r.constat, case when nullif(trim(r.proposition), '') is not null then E'\nProposition : ' || r.proposition else '' end),
            'a_venir', 'coordination', 'preparation')
    returning id into v_jalon;
    update rex_entrees set objet_type = 'jalons', objet_id = v_jalon, objet_ref = v_code,
           suite = trim(both from coalesce(suite || E'\n', '') || format('Reporté dans « %s » : jalon %s.', cib.nom, v_code))
     where id = r.id;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    perform journaliser(p_evenement, 'analyse', 'rex_report', format('%s constat(s) reporté(s) en jalons de « %s »', v_n, cib.nom), 'routine');
    perform journaliser(p_cible, 'analyse', 'rex_report', format('%s jalon(s) repris des constats de « %s »', v_n, src.nom), 'routine');
  end if;
  return v_n;
end $$;
revoke all on function public.rex_reporter(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.rex_reporter(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4. La recherche globale
-- ---------------------------------------------------------------------
-- Avec les droits de l'appelant (security invoker) : chaque table applique
-- ses propres règles de lecture, on ne trouve que ce qu'on peut ouvrir.
create or replace function public.rechercher(p_evenement uuid, p_q text, p_limite integer default 6)
returns table (genre text, id uuid, reference text, titre text, detail text, ecran text, rubrique text, objet text, quand timestamptz)
language plpgsql stable security invoker set search_path = public, extensions, pg_temp as $$
declare q text; v_motif text; lim int;
begin
  q := lower(unaccent(trim(coalesce(p_q, ''))));
  if length(q) < 2 then return; end if;
  v_motif := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  lim := greatest(1, least(20, coalesce(p_limite, 6)));

  return query
  (select 'demande', m.id, m.reference, m.titre,
          concat_ws(' · ', m.statut::text, m.priorite::text, (select l.nom from lieux l where l.id = m.lieu_id)),
          case when m.module = 'logistique' then 'logistique' else 'securite' end,
          case when m.module = 'logistique' then 'interventions' else 'missions' end,
          m.reference, m.created_at
     from missions m
    where m.evenement_id = p_evenement and m.deleted_at is null
      and (lower(m.reference) like v_motif or lower(unaccent(m.titre)) like v_motif or lower(unaccent(coalesce(m.description, ''))) like v_motif)
    order by (lower(m.reference) = q) desc, m.created_at desc limit lim)
  union all
  (select 'signalement', s.id, s.reference, coalesce(nullif(s.description, ''), s.type::text),
          concat_ws(' · ', s.statut::text, (select l.nom from lieux l where l.id = s.lieu_id)),
          'securite', 'signalements', s.reference, s.recu_le
     from signalements s
    where s.evenement_id = p_evenement and s.deleted_at is null
      and (lower(s.reference) like v_motif or lower(unaccent(coalesce(s.description, ''))) like v_motif)
    order by (lower(s.reference) = q) desc, s.recu_le desc nulls last limit lim)
  union all
  (select 'transport', t.id, t.reference, coalesce(nullif(t.motif, ''), 'Transport'),
          concat_ws(' → ', coalesce(t.depart_libre, t.adresse_depart), coalesce(t.arrivee_libre, t.adresse_arrivee)),
          'logistique', 'transports', t.reference, t.created_at
     from transports t
    where t.evenement_id = p_evenement and t.deleted_at is null
      and (lower(t.reference) like v_motif or lower(unaccent(coalesce(t.motif, ''))) like v_motif or lower(unaccent(coalesce(t.demandeur, ''))) like v_motif)
    order by t.created_at desc limit lim)
  union all
  (select 'contact', c.id, c.code, c.nom,
          concat_ws(' · ', c.fonction, c.organisation, c.telephone),
          'memento', 'contacts', c.nom, c.created_at
     from contacts c
    where c.evenement_id = p_evenement and c.deleted_at is null
      and (lower(unaccent(c.nom)) like v_motif or lower(unaccent(coalesce(c.organisation, ''))) like v_motif
           or lower(unaccent(coalesce(c.fonction, ''))) like v_motif or replace(coalesce(c.telephone, ''), ' ', '') like replace(v_motif, ' ', ''))
    order by c.nom limit lim)
  union all
  (select 'membre', mb.id, null::text, coalesce(mb.nom_affiche, 'membre sans nom'),
          concat_ws(' · ', mb.role, (select e.code from equipes e where e.id = mb.equipe_id), mb.telephone),
          'rh', 'membres', mb.nom_affiche, mb.created_at
     from membres_evenement mb
    where mb.evenement_id = p_evenement and mb.deleted_at is null and lower(unaccent(coalesce(mb.nom_affiche, ''))) like v_motif
    order by mb.nom_affiche limit lim)
  union all
  (select 'lieu', l.id, l.code, l.nom, l.type::text, 'plan', 'carte', l.code, l.created_at
     from lieux l
    where l.evenement_id = p_evenement and l.deleted_at is null
      and (lower(l.code) like v_motif or lower(unaccent(l.nom)) like v_motif)
    order by (lower(l.code) = q) desc, l.nom limit lim)
  union all
  (select 'jalon', j.id, j.code, j.libelle,
          concat_ws(' · ', j.statut::text, to_char(j.echeance at time zone 'Europe/Brussels', 'DD/MM/YYYY')),
          'planning', 'jalons', j.code, j.echeance
     from jalons j
    where j.evenement_id = p_evenement and j.deleted_at is null
      and (lower(j.code) like v_motif or lower(unaccent(j.libelle)) like v_motif)
    order by j.echeance limit lim)
  union all
  (select 'créneau', cr.id, cr.code, cr.poste,
          to_char(cr.debut at time zone 'Europe/Brussels', 'DD/MM HH24:MI') || ' → ' || to_char(cr.fin at time zone 'Europe/Brussels', 'HH24:MI'),
          'rh', 'couverture', cr.code, cr.debut
     from creneaux cr
    where cr.evenement_id = p_evenement and cr.deleted_at is null
      and (lower(cr.code) like v_motif or lower(unaccent(cr.poste)) like v_motif)
    order by cr.debut limit lim)
  union all
  (select 'fiche réflexe', f.id, f.code, f.titre, f.declencheur, 'memento', 'fiches', f.code, f.created_at
     from fiches_reflexe f
    where f.evenement_id = p_evenement and f.deleted_at is null
      and (lower(f.code) like v_motif or lower(unaccent(f.titre)) like v_motif or lower(unaccent(coalesce(f.declencheur, ''))) like v_motif)
    order by f.ordre nulls last limit lim)
  union all
  (select 'constat', x.id, null::text, left(x.constat, 140), concat_ws(' · ', x.statut::text, x.module),
          'analyse', 'constats', x.id::text, x.created_at
     from rex_entrees x
    where x.evenement_id = p_evenement and x.deleted_at is null and lower(unaccent(x.constat)) like v_motif
    order by x.created_at desc limit lim)
  union all
  (select 'main courante', jr.id, null::text, left(jr.texte, 140),
          to_char(jr.horodatage at time zone 'Europe/Brussels', 'DD/MM HH24:MI'),
          'securite', 'journal', null::text, jr.horodatage
     from journal jr
    where jr.evenement_id = p_evenement and jr.deleted_at is null and lower(unaccent(jr.texte)) like v_motif
    order by jr.horodatage desc limit lim);
end $$;
revoke all on function public.rechercher(uuid, text, integer) from public, anon;
grant execute on function public.rechercher(uuid, text, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
