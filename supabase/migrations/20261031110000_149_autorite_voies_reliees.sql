-- =====================================================================
-- 149 — LA PAGE AUTORITÉ : D'OÙ PART UNE VOIE D'ACCÈS SECOURS, OÙ ELLE
--       MÈNE (retour de Ren, 29/10)
--
-- Une voie d'accès secours se trace désormais comme un câble, d'un
-- objet à un autre (le PRV, puis l'accès secours) : ses bouts sont
-- `de_id` / `vers_id`. `acces_secours` rend pour chaque élément les
-- noms de ces deux bouts (`depuis`, `vers`), pour que la page dise
-- « PRV nord → Accès secours 12 ». Rien d'autre ne change (base : 147).
-- Idempotente (create or replace), sans aucun DROP.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- situation_autorite() — redéfinie en entier (base : 147) : `depuis` / `vers` des accès
-- ---------------------------------------------------------------------
create or replace function public.situation_autorite(p_jeton uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a    acces_autorite%rowtype;
  e    evenements%rowtype;
  op   boolean;
  v    jsonb;
begin
  select * into a from acces_autorite
  where jeton = p_jeton and deleted_at is null;

  if not found then
    raise exception 'Lien inconnu' using errcode = 'P0002';
  end if;
  if not a.actif then
    raise exception 'Cet accès a été révoqué' using errcode = 'P0005';
  end if;
  if a.expire_le is not null and a.expire_le < now() then
    raise exception 'Cet accès a expiré' using errcode = 'P0006';
  end if;

  -- (122) Une consultation = une visite, pas un rafraîchissement de
  -- 20 s : le compteur ne monte que si le dernier accès date de plus
  -- de dix minutes. L'heure du dernier accès, elle, suit toujours.
  update acces_autorite
  set nb_acces = nb_acces + case when a.dernier_acces is null
                                   or a.dernier_acces < clock_timestamp() - interval '10 minutes'
                                 then 1 else 0 end,
      dernier_acces = clock_timestamp()
  where id = a.id;

  select * into e from evenements where id = a.evenement_id;
  op := a.niveau = 'operationnel';

  select jsonb_build_object(

    'destinataire', jsonb_build_object(
      'libelle', a.libelle, 'organisation', a.organisation, 'niveau', a.niveau),

    'evenement', jsonb_build_object(
      'nom', e.nom, 'phase', e.phase, 'geometrie', e.geometrie,
      'mode_parcours', e.mode_parcours, 'logo_url', e.logo_url,
      'date_debut', e.date_debut, 'date_fin', e.date_fin,
      'commune', e.commune, 'province', e.province,
      'zone_police', (select c.zone_police from communes c where c.nom = e.commune),
      'zone_secours', (select c.zone_secours from communes c where c.nom = e.commune),
      'frequentation_min', e.frequentation_min, 'frequentation_max', e.frequentation_max,
      'point_0', case when e.point_0_lat is not null
                      then jsonb_build_object('lat', e.point_0_lat, 'lon', e.point_0_lon) end),

    -- Les alertes sont faites pour sortir ; celles d'un MAYDAY nomment
    -- une personne et restent au PC (106).
    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', al.niveau, 'titre', al.titre, 'message', al.message,
        'consigne', al.consigne, 'emise_le', al.emise_le,
        -- (122) Combien de postes ont lu, jamais lesquels ; et si le PC
        -- a pris la main.
        'accuses', (select count(*) from alertes_accuses ac where ac.alerte_id = al.id),
        'membres_actifs', (select count(*) from membres_evenement m
                           where m.evenement_id = a.evenement_id and m.actif and m.deleted_at is null),
        'acquittee_le', al.acquittee_le)
        order by al.emise_le desc), '[]'::jsonb)
      from alertes al
      where al.evenement_id = a.evenement_id and al.active and al.deleted_at is null
        and not exists (select 1 from maydays md where md.alerte_id = al.id)),

    'activite', jsonb_build_object(
      'signalements_ouverts', (select count(*) from signalements
        where evenement_id = a.evenement_id and deleted_at is null
          and statut in ('recu','pris_en_charge','en_cours') and doublon_de is null),
      'signalements_total', (select count(*) from signalements
        where evenement_id = a.evenement_id and deleted_at is null),
      'missions_ouvertes', (select count(*) from missions
        where evenement_id = a.evenement_id and deleted_at is null
          and statut not in ('resolue','annulee')),
      'missions_p1', (select count(*) from missions
        where evenement_id = a.evenement_id and deleted_at is null
          and priorite = 'P1' and statut not in ('resolue','annulee')),
      'recherches_en_cours', (select count(*) from recherches
        where evenement_id = a.evenement_id and deleted_at is null
          and statut = 'en_cours'),
      'maydays_en_cours', (select count(*) from maydays
        where evenement_id = a.evenement_id
          and statut in ('emis','accuse','en_cours'))),

    -- (109) Les interventions une par une. Un signalement ouvert, et une
    -- mission ouverte qui compte pour les secours (P1 ou P2, ou
    -- bloquante) sans être déjà la suite d'un signalement listé.
    -- Jamais `contact`, `traite_par`, `membre_id`, `cle_client`.
    'interventions', (
      select coalesce(jsonb_agg(x order by (x->>'rang')::int desc, x->>'heure' desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'source', 'signalement',
          'reference', s.reference,
          'heure', s.emis_le,
          'nature', s.type,
          'gravite', s.gravite,
          'rang', case s.gravite when 'critique' then 4 when 'grave' then 3
                                 when 'modere' then 2 else 1 end,
          'statut', s.statut,
          'depuis', coalesce(s.pris_en_charge_le, s.recu_le, s.emis_le),
          -- (122) Les temps du cycle, pour que « moyen engagé » et
          -- « sur place » soient des faits horodatés, pas un choix de
          -- liste.
          'pris_en_charge_le', s.pris_en_charge_le,
          'en_route_le', s.en_route_le,
          'arrive_le', s.arrive_le,
          'lieu', l.nom, 'pk_km', l.pk_km,
          'position', case when s.latitude is not null
                           then jsonb_build_object('lat', s.latitude, 'lon', s.longitude)
                           when l.latitude is not null
                           then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
          -- (123) « km 3,2 · entre E2 et E3 · 40 m de la trace » : ce que
          -- BFMF disait, et qu'une paire de coordonnées ne dit pas.
          'sur_trace', projeter_sur_trace(a.evenement_id,
                         coalesce(s.latitude, l.latitude), coalesce(s.longitude, l.longitude)),
          -- (123) Les signalements groupés sur celui-ci (même lieu, même
          -- nature) : trois QR scannés au même bloc = une intervention.
          'doublons', (select count(*) from signalements d
                       where d.doublon_de = s.id and d.deleted_at is null),
          'description', case when op then s.description end
        ) as x
        from signalements s
        left join lieux l on l.id = s.lieu_id
        where s.evenement_id = a.evenement_id and s.deleted_at is null
          and s.statut in ('recu','pris_en_charge','en_cours')
          and s.doublon_de is null
        union all
        select jsonb_build_object(
          'source', 'mission',
          'reference', m.reference,
          'heure', m.created_at,
          'nature', m.module,
          'priorite', m.priorite,
          'bloquant', m.bloquant,
          'rang', case m.priorite when 'P1' then 4 when 'P2' then 3 else 2 end,
          'statut', m.statut,
          'depuis', coalesce(m.demarree_le, m.attribuee_le, m.created_at),
          'lieu', l.nom, 'pk_km', l.pk_km,
          'position', case when m.latitude is not null
                           then jsonb_build_object('lat', m.latitude, 'lon', m.longitude)
                           when l.latitude is not null
                           then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
          'sur_trace', projeter_sur_trace(a.evenement_id,
                         coalesce(m.latitude, l.latitude), coalesce(m.longitude, l.longitude)),
          'titre', case when op then m.titre end,
          'description', case when op then m.description end
        )
        from missions m
        left join lieux l on l.id = m.lieu_id
        where m.evenement_id = a.evenement_id and m.deleted_at is null
          and m.statut not in ('resolue','annulee')
          and (m.priorite in ('P1','P2') or coalesce(m.bloquant, false))
          and not exists (select 1 from signalements s
                          where s.id = m.signalement_id
                            and s.deleted_at is null
                            and s.statut in ('recu','pris_en_charge','en_cours'))
      ) t),

    -- (109) Une recherche : où et quand, jamais qui.
    'recherches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', r.reference,
        'depuis', r.created_at,
        'vu_a', r.vu_a,
        'dernier_lieu', coalesce(l.nom, r.dernier_lieu),
        'pk_km', l.pk_km,
        'position', case when l.latitude is not null
                         then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
        'sur_trace', projeter_sur_trace(a.evenement_id, l.latitude, l.longitude),
        'point_regroupement', r.point_regroupement,
        'age_approx', case when op then r.age_approx end,
        'signalement', case when op then r.description end)
        order by r.created_at), '[]'::jsonb)
      from recherches r
      left join lieux l on l.id = r.dernier_lieu_id
      where r.evenement_id = a.evenement_id and r.deleted_at is null
        and r.statut = 'en_cours'),

    'public', jsonb_build_object(
      'jauge', jauge_courante_interne(a.evenement_id),
      'sur_parcours', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut in ('parti','en_cours')),
      'groupes_sans_nouvelles', (
        select count(*) from groupes_sans_nouvelles_interne(a.evenement_id, 45)),
      -- (109) Chaque groupe dehors : où il a été vu, quand. Pas
      -- l'accompagnateur ni son téléphone — le PC les a.
      'groupes', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', g.code, 'nom', g.nom,
          'effectif', coalesce(g.effectif_reel, g.effectif_prevu),
          'statut', g.statut,
          'dernier_lieu', l.nom, 'pk_km', l.pk_km,
          'dernier_passage', g.dernier_passage,
          'sans_nouvelles', exists (select 1 from groupes_sans_nouvelles_interne(a.evenement_id, 45) n
                                    where n.groupe_id = g.id))
          order by l.pk_km nulls first, g.code), '[]'::jsonb)
        from groupes g
        left join lieux l on l.id = g.dernier_lieu_id
        where g.evenement_id = a.evenement_id and g.deleted_at is null
          and g.statut in ('parti','en_cours')),
      'attente', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut = 'inscrit'),
      'arrives', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut = 'arrive')),

    -- (109) La veille météo telle que le PC la voit (critères et seuils).
    -- L'avertissement IRM et les observations se lisent côté page.
    'meteo', jsonb_build_object(
      'criteres', (select coalesce(jsonb_agg(jsonb_build_object(
          'critere', c.critere, 'niveau', c.niveau, 'depuis', c.depuis)
          order by c.critere), '[]'::jsonb)
        from veille_etat_criteres c where c.evenement_id = a.evenement_id),
      'seuils', (select jsonb_build_object(
          'rafale_vigilance_kmh', vm.rafale_vigilance_kmh,
          'rafale_critique_kmh', vm.rafale_critique_kmh)
        from veille_meteo vm where vm.evenement_id = a.evenement_id)),

    -- (109) Accès et commandement : les éléments du plan faits pour ça.
    'acces_secours', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', ep.code, 'nom', ep.nom, 'categorie', ep.categorie,
        'description', ep.description, 'position', _point_element(ep.geometrie),
        'adresse', ep.adresse,
        -- (149) Les deux bouts d'une voie reliée, par leur nom.
        'depuis', (select d.nom from elements_plan d where d.id = ep.de_id),
        'vers', (select v.nom from elements_plan v where v.id = ep.vers_id),
        'confirme', ep.confirme)
        order by array_position(array['point_rencontre_secours','prv','voie_engins','pma',
          'poste_secours','aire_helico','point_transfert','noria','point_rassemblement',
          'sortie_secours','itineraire_evacuation']::text[], ep.categorie::text), ep.code), '[]'::jsonb)
      from elements_plan ep
      where ep.evenement_id = a.evenement_id and ep.deleted_at is null
        and ep.categorie::text in ('point_rencontre_secours','prv','voie_engins','pma',
          'poste_secours','aire_helico','point_transfert','noria','point_rassemblement',
          'sortie_secours','itineraire_evacuation')),


    -- (123) La trace, pour la carte de la page autorité : un dessin
    -- vectoriel léger, sans fond de carte ni tuiles, qui marche hors
    -- ligne. Ramenée à 400 points au plus par trace — à l'échelle d'un
    -- écran, un GPX de 3 000 points n'en dessine pas plus.
    'traces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', t.nom, 'couleur', t.couleur, 'distance_km', t.distance_km,
        'points', (
          select coalesce(jsonb_agg(jsonb_build_array(p.value->0, p.value->1) order by p.ord), '[]'::jsonb)
          from jsonb_array_elements(t.points) with ordinality p(value, ord)
          where (p.ord - 1) % greatest(1, ceil(jsonb_array_length(t.points) / 400.0)::int) = 0
             or p.ord = jsonb_array_length(t.points)))
        order by t.code), '[]'::jsonb)
      from traces t
      where t.evenement_id = a.evenement_id and t.deleted_at is null and t.actif
        and jsonb_array_length(t.points) > 1),

    -- (109) Les lieux qui servent à se repérer et à dire où.
    'reperes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', l.code, 'nom', l.nom, 'type', l.type, 'pk_km', l.pk_km,
        'position', case when l.latitude is not null
                         then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
        -- (123) La capacité d'accueil d'une étape, en face de sa charge.
        'capacite', l.capacite,
        'charge', case when l.type = 'etape' then (
          select coalesce(sum(coalesce(g.effectif_reel, g.effectif_prevu)), 0)
          from groupes g where g.dernier_lieu_id = l.id and g.deleted_at is null
            and g.statut in ('parti','en_cours')) end)
        order by l.pk_km nulls last, l.type, l.code), '[]'::jsonb)
      from lieux l
      where l.evenement_id = a.evenement_id and l.deleted_at is null and l.actif
        and l.type in ('pc_ops','poste_secours','entree','etape','point_kilometrique','scene','parking')),

    -- (109) Tronçons : c'est la distance de portage qui dimensionne
    -- l'équipe de brancardage, pas la longueur totale.
    'segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'libelle', sp.libelle,
        'depart', d.nom, 'arrivee', ar.nom,
        'distance_m', sp.distance_totale_m,
        'brancardage_max_m', sp.brancardage_max_m,
        'composition', sp.composition)
        order by d.pk_km nulls last, sp.libelle), '[]'::jsonb)
      from segments_parcours sp
      left join lieux d on d.id = sp.depart_lieu_id
      left join lieux ar on ar.id = sp.arrivee_lieu_id
      where sp.evenement_id = a.evenement_id
        -- une ligne vide (créée puis jamais remplie) ne dit rien
        and (sp.libelle is not null or sp.depart_lieu_id is not null
             or sp.arrivee_lieu_id is not null)),

    'ressources', jsonb_build_object(
      'elements', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'code', ep.code, 'nom', ep.nom, 'categorie', ep.categorie,
          'description', ep.description, 'position', _point_element(ep.geometrie),
          'confirme', ep.confirme)
          order by ep.categorie, ep.code), '[]'::jsonb)
        from elements_plan ep
        where ep.evenement_id = a.evenement_id and ep.deleted_at is null
          and ep.categorie::text in ('dea','point_eau','coupure_gaz','coffret_electrique')),
      'extincteurs', (select count(*) from elements_plan ep
        where ep.evenement_id = a.evenement_id and ep.deleted_at is null
          and ep.categorie = 'extincteur'),
      'moyens', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'type', ms.type, 'quantite', ms.quantite, 'commentaire', ms.commentaire)
          order by ms.type), '[]'::jsonb)
        from moyens_premiers_secours ms where ms.evenement_id = a.evenement_id)),

    'installations_risque', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', ep.nom, 'categorie', ep.categorie,
        'latitude', (_point_element(ep.geometrie)->>'lat')::double precision,
        'longitude', (_point_element(ep.geometrie)->>'lon')::double precision,
        'description', ep.description,
        'mesures_maitrise', ep.mesures_maitrise,
        'organe_coupure', ep.organe_coupure,
        'moyens_proximite', ep.moyens_proximite,
        'confirme', ep.confirme) order by ep.code), '[]'::jsonb)
      from elements_plan ep
      where ep.evenement_id = a.evenement_id and ep.deleted_at is null
        and ep.est_risque),

    'programme', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'debut', p.debut, 'duree_min', p.duree_min, 'titre', p.titre,
        'categorie', p.categorie, 'lieu', coalesce(l.nom, p.lieu_libre))
        order by p.debut), '[]'::jsonb)
      from programme p
      left join lieux l on l.id = p.lieu_id
      where p.evenement_id = a.evenement_id and p.deleted_at is null),

    'radio', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'numero', cr.numero, 'libelle', cr.libelle, 'bande', cr.bande,
        'frequence_mhz', cr.frequence_mhz, 'sous_ton', cr.sous_ton,
        'usage', cr.usage_prevu, 'urgence', cr.canal_urgence)
        order by cr.ordre, cr.numero), '[]'::jsonb)
      from canaux_radio cr
      where cr.evenement_id = a.evenement_id and cr.deleted_at is null and cr.actif),

    -- (124) Qui appeler au PC : l'interlocuteur désigné et son suppléant,
    -- en tête de page — BFMF les affichait avec le point de rencontre.
    'interlocuteurs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', ct.role_autorite, 'nom', ct.nom, 'fonction', ct.fonction,
        'organisation', ct.organisation, 'telephone', ct.telephone)
        order by ct.role_autorite = 'interlocuteur' desc, ct.nom), '[]'::jsonb)
      from contacts ct
      where ct.evenement_id = a.evenement_id and ct.deleted_at is null
        and ct.role_autorite in ('interlocuteur','suppleant')),

    -- (109) Seulement ceux que le coordinateur a désignés.
    'contacts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', ct.nom, 'organisation', ct.organisation, 'fonction', ct.fonction,
        'telephone', ct.telephone, 'email', ct.email,
        'disponibilite', ct.disponibilite, 'categorie', ct.categorie)
        order by ct.categorie nulls last, ct.nom), '[]'::jsonb)
      from contacts ct
      where ct.evenement_id = a.evenement_id and ct.deleted_at is null
        and ct.visible_autorite),

    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'titre', d.titre, 'description', d.description, 'url', d.url)
        order by d.ordre, d.titre), '[]'::jsonb)
      from documents_autorite d
      where d.evenement_id = a.evenement_id),

    -- 127 : le plan d'implantation, pour la carte vectorielle. Tout ce
    -- qui a une géométrie : les objets (zones), les lignes (câbles,
    -- conduites, barrières), les pictogrammes. Les textes de fond
    -- (description, mesures) restent dans installations_risque.
    'plan', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', ep.code, 'nom', ep.nom,
        'nature', coalesce(ep.nature, case when ep.forme = 'ligne' then 'ligne' else 'objet' end),
        'forme', ep.forme, 'categorie', ep.categorie, 'picto', ep.picto, 'calque', ep.calque,
        'points', (
          select coalesce(jsonb_agg(jsonb_build_array(p.value->0, p.value->1) order by p.ord), '[]'::jsonb)
          from jsonb_array_elements(ep.geometrie) with ordinality p(value, ord)
          where jsonb_typeof(p.value) = 'array'),
        'centre', case when ep.centre_lat is not null
                       then jsonb_build_object('lat', ep.centre_lat, 'lon', ep.centre_lon) end,
        'rotation_deg', ep.rotation_deg,
        'est_risque', ep.est_risque, 'accueil_public', ep.accueil_public,
        'confirme', ep.confirme,
        'agent_extinction', ep.agent_extinction, 'capacite_extinction', ep.capacite_extinction,
        -- (147) L'emprise à l'échelle et les jonctions, comme couchesPlan.jsx les lit.
        'id', ep.id, 'largeur_m', ep.largeur_m, 'longueur_m', ep.longueur_m,
        'forme_echelle', ep.forme_echelle, 'quantite', ep.quantite,
        -- (147) Le réseau électrique et l'eau, pour le schéma unifilaire.
        'reseau', ep.reseau, 'de_id', ep.de_id, 'vers_id', ep.vers_id,
        'alimente_par', ep.alimente_par,
        'puissance_kw', ep.puissance_kw, 'production_kva', ep.production_kva,
        'tension_v', ep.tension_v, 'phases', ep.phases, 'calibre_a', ep.calibre_a,
        'differentiel_ma', ep.differentiel_ma, 'ip', ep.ip,
        'section_mm2', ep.section_mm2, 'type_cable', ep.type_cable, 'terre', ep.terre,
        'source_eau', ep.source_eau, 'raccord_eau', ep.raccord_eau,
        'besoin_eau', ep.besoin_eau, 'debit_l_min', ep.debit_l_min, 'diametre_mm', ep.diametre_mm,
        'organe_coupure', ep.organe_coupure)
        order by ep.calque, ep.code), '[]'::jsonb)
      from elements_plan ep
      where ep.evenement_id = a.evenement_id and ep.deleted_at is null
        and jsonb_typeof(ep.geometrie) = 'array'),

    'consulte_le', clock_timestamp()

  ) into v;

  return v;
end;
$$;
revoke all on function public.situation_autorite(uuid) from public;
grant execute on function public.situation_autorite(uuid) to anon, authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION
--   select e->>'code', e->>'depuis', e->>'vers'
--   from jsonb_array_elements(situation_autorite('<jeton>')->'acces_secours') e
--   where e->>'categorie' = 'voie_engins';
-- =====================================================================
