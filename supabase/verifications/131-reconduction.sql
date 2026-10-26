-- =====================================================================
-- 131 — RÉPÉTITION DE LA RECONDUCTION (éditeur SQL, transaction annulée)
--
-- À coller tel quel dans l'éditeur SQL de Supabase, une fois les 130 et
-- 131 appliquées. Le bloc redéfinit `dupliquer_evenement` à l'identique
-- de la migration, crée sur Rando VTT un fournisseur, une demande DP
-- décidée (3 lignes, 2 consultations dont une retenue, 1 commande),
-- reconduit l'événement au 10/11/2027 et se termine par
-- `raise exception 'DRY RUN 131 B OK …'` : rien n'est écrit, le
-- message d'erreur porte le résultat.
--
-- Attendu : 1 demande DP-01 en brouillon, 3 lignes, 2 consultations
--           « à envoyer », aucun montant, date limite décalée d'un an
--           (+364 j : 2026-11-11 → 2027-11-10), jalon absent.
--
-- Pourquoi ici et pas via l'outil Supabase de Claude : le corps de
-- `dupliquer_evenement` (hérité de la 047) contient un `delete from
-- role_capacites`, que l'outil tient pour destructif et soumet à une
-- confirmation d'une minute.
-- =====================================================================
do $m$
declare
  org uuid := 'a6d4d8c5-0ea3-4786-abba-4e1b59fcb32d';
  rando uuid := '7e2c829c-e5c7-4302-8db3-6a7afd96c5b6';
  f1 uuid; f2 uuid; dp uuid; l1 uuid; c1 uuid; c2 uuid; nouveau uuid;
  resultat text; n_lignes int; n_cons text; montants text; jalon_absent boolean;
begin
  begin
create or replace function public.dupliquer_evenement(p_source uuid, p_nom text, p_slug text, p_date_debut date, p_date_fin date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cible    uuid;
  v_org      uuid;
  v_quota    integer;
  v_utilises integer;
  v_decalage interval;
  v_datee    boolean;
  v_dp       uuid;      -- (131) demande de prix recréée
  dp         record;
begin
  if not (est_exploitant() or a_permission(p_source, 'referentiels', 'creer')) then
    raise exception 'Reconduction refusée : vous ne pilotez pas cet événement.'
      using errcode = '42501';
  end if;

  select organisation_id,
         coalesce((p_date_debut - date_debut) * interval '1 day', interval '0 day'),
         date_debut is not null
    into v_org, v_decalage, v_datee
  from evenements where id = p_source;

  if v_org is null then
    raise exception 'Événement source introuvable.' using errcode = 'P0002';
  end if;

  select quota_evenements into v_quota from organisations where id = v_org;
  select count(*) into v_utilises from evenements
   where organisation_id = v_org and deleted_at is null;
  if v_quota is not null and v_utilises >= v_quota then
    raise exception 'Quota de licence atteint (% événements sur %).', v_utilises, v_quota
      using errcode = '23514';
  end if;

  insert into evenements (
    nom, slug, date_debut, date_fin, phase, archive,
    organisation_id, geometrie, mode_parcours, modules, commune,
    point_0_lat, point_0_lon,
    frequentation_min, frequentation_max
  )
  select p_nom, p_slug, p_date_debut, p_date_fin, 'preparation', false,
         organisation_id, geometrie, mode_parcours, modules, commune,
         point_0_lat, point_0_lon,
         frequentation_min, frequentation_max
  from evenements where id = p_source
  returning id into v_cible;

  insert into roles (evenement_id, code, libelle, description, systeme, tout_pouvoir, ordre, origine)
  select v_cible, code, libelle, description, systeme, tout_pouvoir, ordre, 'import'
  from roles where evenement_id = p_source and deleted_at is null
  on conflict (evenement_id, code) do update set
    libelle = excluded.libelle,
    description = excluded.description,
    tout_pouvoir = excluded.tout_pouvoir,
    ordre = excluded.ordre;

  create temp table map_roles on commit drop as
  select ancien.id as ancien, nouveau.id as nouveau
  from roles ancien
  join roles nouveau on nouveau.code = ancien.code and nouveau.evenement_id = v_cible
  where ancien.evenement_id = p_source and ancien.deleted_at is null;

  delete from role_capacites
   where role_id in (select id from roles where evenement_id = v_cible);

  insert into role_capacites (role_id, ressource, action, phase)
  select m.nouveau, c.ressource, c.action, c.phase
  from role_capacites c join map_roles m on m.ancien = c.role_id
  on conflict do nothing;

  perform copier_table_evenement('lieux', p_source, v_cible);
  perform copier_table_evenement('fiches_reflexe', p_source, v_cible);
  perform copier_table_evenement('fiches_poste', p_source, v_cible);
  perform copier_table_evenement('groupes_travail', p_source, v_cible);
  -- (101) Le groupe est recâblé avant l'insertion : la 094 n'admet
  -- qu'une équipe par groupe, et la source tient encore la sienne.
  perform copier_table_evenement('equipes', p_source, v_cible,
                                 '{"groupe_travail_id": "groupes_travail"}'::jsonb);
  perform copier_table_evenement('contacts', p_source, v_cible);
  perform copier_table_evenement('types_mission', p_source, v_cible);
  perform copier_table_evenement('materiel', p_source, v_cible);
  perform copier_table_evenement('canaux_radio', p_source, v_cible);
  perform copier_table_evenement('creneaux', p_source, v_cible);
  perform copier_table_evenement('segments_parcours', p_source, v_cible);
  perform copier_table_evenement('elements_plan', p_source, v_cible);
  perform copier_table_evenement('jalons', p_source, v_cible);

  insert into conformite_reponses (evenement_id, reponses)
  select v_cible, reponses from conformite_reponses where evenement_id = p_source;

  update groupes_travail set pilote_membre_id = null where evenement_id = v_cible;
  update equipes set responsable_id = null where evenement_id = v_cible;

  update contacts c set lieu_id = m.nouveau
  from map_lieux m where c.evenement_id = v_cible and c.lieu_id = m.ancien;

  update materiel x set lieu_id = m.nouveau
  from map_lieux m where x.evenement_id = v_cible and x.lieu_id = m.ancien;
  update materiel x set equipe_id = m.nouveau
  from map_equipes m where x.evenement_id = v_cible and x.equipe_id = m.ancien;
  update materiel set quantite = 0 where evenement_id = v_cible;

  update canaux_radio c set equipe_id = m.nouveau
  from map_equipes m where c.evenement_id = v_cible and c.equipe_id = m.ancien;

  update creneaux c set equipe_id = m.nouveau
  from map_equipes m where c.evenement_id = v_cible and c.equipe_id = m.ancien;
  update creneaux c set lieu_id = m.nouveau
  from map_lieux m where c.evenement_id = v_cible and c.lieu_id = m.ancien;
  update creneaux c set fiche_id = m.nouveau
  from map_fiches_poste m where c.evenement_id = v_cible and c.fiche_id = m.ancien;
  update creneaux set
    debut = debut + v_decalage,
    fin = fin + v_decalage,
    rappel_par = null
  where evenement_id = v_cible;

  update segments_parcours s set depart_lieu_id = m.nouveau
  from map_lieux m where s.evenement_id = v_cible and s.depart_lieu_id = m.ancien;
  update segments_parcours s set arrivee_lieu_id = m.nouveau
  from map_lieux m where s.evenement_id = v_cible and s.arrivee_lieu_id = m.ancien;

  update elements_plan e set fiche_reflexe_id = m.nouveau
  from map_fiches_reflexe m where e.evenement_id = v_cible and e.fiche_reflexe_id = m.ancien;
  update elements_plan set confirme = false, confirme_par = null, confirme_le = null
  where evenement_id = v_cible;

  update jalons j set groupe_travail_id = m.nouveau
  from map_groupes_travail m where j.evenement_id = v_cible and j.groupe_travail_id = m.ancien;
  update jalons j set lieu_id = m.nouveau
  from map_lieux m where j.evenement_id = v_cible and j.lieu_id = m.ancien;
  -- (101) `a_venir`, pas `a_faire`. La visibilité (099) est reprise
  -- telle quelle : un jalon public l'an dernier le sera cette année.
  -- (129) Le début suit l'échéance, l'avancement repart de zéro.
  update jalons set
    statut = 'a_venir',
    responsable_membre_id = null,
    echeance = echeance + v_decalage,
    debut = debut + v_decalage,
    avancement = 0,
    fait_le = null
  where evenement_id = v_cible;

  -- (129) Les offsets viennent de la source, pas du recalcul sur des
  -- dates intermédiaires ; les dépendances suivent avec les nouveaux
  -- ids ; puis les dates sont recalées sur les nouvelles dates de
  -- l'événement, ancre par ancre (fin, montage, démontage comprises).
  update jalons n set offset_debut_j = s.offset_debut_j, offset_fin_j = s.offset_fin_j
  from map_jalons m join jalons s on s.id = m.ancien
  where n.id = m.nouveau;
  insert into jalon_dependances (evenement_id, jalon_id, precede_id, decalage_j, created_by)
  select v_cible, mj.nouveau, mp.nouveau, d.decalage_j, auth.uid()
  from jalon_dependances d
  join map_jalons mj on mj.ancien = d.jalon_id
  join map_jalons mp on mp.ancien = d.precede_id
  where d.evenement_id = p_source;
  -- (131) Demandes de prix décidées ou closes : brouillons, lignes,
  -- consultations à envoyer vers les mêmes fournisseurs, sans montants.
  -- Référence vide : le déclencheur renumérote DP-01, DP-02… dans
  -- l'ordre des références d'origine.
  for dp in select * from demandes_prix
            where evenement_id = p_source and deleted_at is null and statut in ('decidee', 'close')
            order by reference loop
    insert into demandes_prix (evenement_id, reference, objet, categorie, description, date_limite, livraison_de, livraison_a,
                               lieu_id, groupe_travail_id, origine)
    values (v_cible, '', dp.objet, dp.categorie, dp.description,
            dp.date_limite + v_decalage, dp.livraison_de + v_decalage, dp.livraison_a + v_decalage,
            (select m.nouveau from map_lieux m where m.ancien = dp.lieu_id),
            (select m.nouveau from map_groupes_travail m where m.ancien = dp.groupe_travail_id),
            'import')
    returning id into v_dp;
    insert into demande_prix_lignes (demande_id, ordre, designation, quantite, unite, precision, materiel_id)
    select v_dp, l.ordre, l.designation, l.quantite, l.unite, l.precision,
           (select m.nouveau from map_materiel m where m.ancien = l.materiel_id)
    from demande_prix_lignes l where l.demande_id = dp.id and l.deleted_at is null;
    insert into consultations (demande_id, evenement_id, fournisseur_id, contact_id, statut)
    select v_dp, v_cible, c.fournisseur_id, c.contact_id, 'a_envoyer'
    from consultations c join fournisseurs f on f.id = c.fournisseur_id and f.deleted_at is null
    where c.demande_id = dp.id and c.deleted_at is null;
  end loop;

  if p_date_debut is not null then
    perform _recaler_jalons(v_cible, false);
  end if;

  update veille_meteo cible set
    active = src.active,
    rafale_vigilance_kmh = src.rafale_vigilance_kmh,
    rafale_critique_kmh = src.rafale_critique_kmh,
    pluie_vigilance_mm = src.pluie_vigilance_mm,
    pluie_critique_mm = src.pluie_critique_mm,
    temp_max_vigilance = src.temp_max_vigilance,
    temp_min_vigilance = src.temp_min_vigilance,
    alerte_orage = src.alerte_orage,
    consigne_vigilance = src.consigne_vigilance,
    consigne_critique = src.consigne_critique,
    consignes = src.consignes
  from veille_meteo src
  where src.evenement_id = p_source and cible.evenement_id = v_cible;

  update membres_evenement cible set
    nom_affiche = coalesce(cible.nom_affiche, src.nom_affiche),
    telephone = coalesce(cible.telephone, src.telephone)
  from membres_evenement src
  where cible.evenement_id = v_cible
    and cible.user_id = auth.uid()
    and src.evenement_id = p_source
    and src.user_id = auth.uid();

  -- (101) `notable`, pas `important`.
  perform journaliser(
    v_cible, 'noyau', 'reconduction',
    format(
      'Événement reconduit depuis « %s »%s',
      (select nom from evenements where id = p_source),
      case when v_datee then ''
           else ' — édition précédente non datée : horaires des créneaux et échéances des jalons repris sans décalage, à revoir'
      end
    ),
    'notable'
  );

  return v_cible;
end;
$$;
  exception when others then raise exception 'tranche 1 : % (%)', sqlerrm, sqlstate; end;

  perform set_config('request.jwt.claims', '{"sub":"126d7065-44ba-418b-a061-eea88f2d5c7e","role":"authenticated"}', true);
  insert into fournisseurs (organisation_id, nom, categories) values (org, 'Essai 131 Lemaire', '{barrierage}') returning id into f1;
  insert into fournisseurs (organisation_id, nom, categories) values (org, 'Essai 131 Dupont', '{barrierage}') returning id into f2;
  insert into demandes_prix (evenement_id, objet, categorie, date_limite) values (rando, 'Barriérage (essai 131)', 'barrierage', '2026-11-01 12:00+01') returning id into dp;
  insert into demande_prix_lignes (demande_id, ordre, designation, quantite, unite) values (dp, 1, 'Heras 3,5 m', 10, 'pièce') returning id into l1;
  insert into demande_prix_lignes (demande_id, ordre, designation, quantite, unite) values (dp, 2, 'Pied béton', 5, 'pièce'), (dp, 3, 'Transport', 1, 'forfait');
  insert into consultations (demande_id, evenement_id, fournisseur_id) values (dp, rando, f1) returning id into c1;
  insert into consultations (demande_id, evenement_id, fournisseur_id) values (dp, rando, f2) returning id into c2;
  perform marquer_envoyee(c1, 'mailto'); perform marquer_envoyee(c2, 'mailto');
  insert into offre_lignes (consultation_id, ligne_id, prix_unitaire_ht) values (c1, l1, 2);
  update consultations set statut = 'offre_recue' where id in (c1, c2);
  update consultations set montant_ht = 500 where id = c2;
  perform retenir_offre(c1, 'essai');
  nouveau := dupliquer_evenement(rando, 'Rando VTT 2027 (essai 131)', 'rando-vtt-2027-essai-131', '2027-11-10', '2027-11-12');
  select string_agg(d.reference || ' ' || d.statut || ' ' || coalesce(to_char(d.date_limite at time zone 'Europe/Brussels', 'DD/MM/YY'), '-'), ' | ') into resultat
    from demandes_prix d where d.evenement_id = nouveau;
  select count(*) into n_lignes from demande_prix_lignes l join demandes_prix d on d.id = l.demande_id where d.evenement_id = nouveau;
  select string_agg(c.statut::text, ',') into n_cons from consultations c where c.evenement_id = nouveau;
  select coalesce(string_agg(coalesce(c.montant_ht::text, 'null'), ','), '-') into montants from consultations c where c.evenement_id = nouveau;
  select bool_and(d.jalon_id is null) into jalon_absent from demandes_prix d where d.evenement_id = nouveau;
  raise exception E'DRY RUN 131 B OK\ndemandes reconduites : % (attendu DP-01 brouillon 31/10/27)\nlignes : % (attendu 3)\nconsultations : % (attendu a_envoyer,a_envoyer)\nmontants : % (attendu null,null)\njalon absent : % (attendu t)', resultat, n_lignes, n_cons, montants, jalon_absent;
end $m$;
