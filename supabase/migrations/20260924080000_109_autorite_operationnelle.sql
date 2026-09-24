-- =====================================================================
-- 109 — LA PAGE AUTORITÉ REDEVIENT UN OUTIL DE TRAVAIL
--
-- La 028 avait volontairement réduit le lien autorité à des compteurs,
-- par prudence après le REX 2026 (une demande personnelle sensible
-- passée par un canal partagé). Résultat, constaté par Ren le 24/09 :
-- le Dir-PC-Ops qui ouvre le lien sait QU'IL SE PASSE quelque chose,
-- pas OÙ, ni par où entrer, ni avec quoi. Le PC-Ops de BFMF 2026 donnait
-- tout cela ; c'est lui qui sert de modèle.
--
-- Le compromis retenu (Ren, 24/09) : le détail dépend du DESTINATAIRE.
--
--   niveau 'situation'    — bourgmestre, élus, cellule communale.
--      Les interventions une par une (heure, nature, gravité, statut,
--      lieu, km, position), mais AUCUN texte libre : ni description, ni
--      titre de mission. Une recherche : son existence, le dernier lieu
--      connu, l'heure, le point de regroupement.
--
--   niveau 'operationnel' — Dir-PC-Ops, zone de secours, police.
--      En plus : la description d'un signalement, le titre et la
--      description d'une mission, l'âge approximatif et le signalement
--      physique d'une personne recherchée — ce qu'il faut pour agir.
--
-- Dans les deux cas, JAMAIS : le nom ou le contact de celui qui appelle,
-- le nom de la personne recherchée ni celui de son accompagnant, le nom
-- d'un membre de l'équipe, la main courante. Un MAYDAY reste un compte
-- (106).
--
-- Et le reste de ce qu'un Dir-PC-Ops demande en arrivant, qui n'a rien
-- de personnel et que la base connaît déjà (c'est ce que lit le dossier
-- de sécurité) : accès secours, PRV, voies engins, aires d'atterrissage,
-- tronçons et distances de brancardage, bornes, DEA et points d'eau,
-- moyens de secours de l'organisateur, installations à risque, plan
-- radio, programme, fréquentation, commune et zones.
--
-- Deux choses ne sortent que si le coordinateur les a désignées :
--   — les CONTACTS (case `visible_autorite`, rien par défaut : sur
--     BFMF2026, l'annuaire contient 26 bénévoles) ;
--   — les DOCUMENTS (nouvelle table `documents_autorite` : dossier de
--     sécurité, PPUI, plan — des liens, que le coordinateur colle).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Le niveau, porté par chaque lien.
-- ---------------------------------------------------------------------
alter table acces_autorite
  add column if not exists niveau text not null default 'situation'
    check (niveau in ('situation', 'operationnel'));

comment on column acces_autorite.niveau is
  'situation : sans texte libre ; operationnel : descriptions en plus. Jamais de nom (109).';

-- Changer le niveau d'un lien déjà remis, c'est changer ce que voit
-- quelqu'un hors de l'équipe : tracé comme l'ouverture et la révocation.
create or replace function trg_journal_acces()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'noyau', 'acces',
      'Accès autorité ouvert : ' || new.libelle ||
      coalesce(' (' || new.organisation || ')', '') ||
      case when new.niveau = 'operationnel' then ' — niveau opérationnel' else '' end,
      'notable'::importance_journal, 'acces_autorite', new.id, null);
  elsif old.actif and not new.actif then
    perform journaliser(new.evenement_id, 'noyau', 'acces',
      'Accès autorité révoqué : ' || new.libelle,
      'notable'::importance_journal, 'acces_autorite', new.id, null);
  elsif new.niveau is distinct from old.niveau then
    perform journaliser(new.evenement_id, 'noyau', 'acces',
      'Accès autorité ' || new.libelle || ' : niveau ' ||
      case when new.niveau = 'operationnel' then 'opérationnel' else 'situation' end,
      'notable'::importance_journal, 'acces_autorite', new.id, null);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Les contacts qu'on accepte de voir partir sur le lien.
--    La table se modifie avec `referentiels:modifier` ; décider qu'un
--    numéro sort vers un lien sans compte, c'est le rôle de celui qui
--    ouvre ces liens (tout pouvoir, comme `acces_autorite`).
-- ---------------------------------------------------------------------
alter table contacts
  add column if not exists visible_autorite boolean not null default false;

create or replace function trg_contact_visible_autorite()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.visible_autorite
     and (tg_op = 'INSERT' or not old.visible_autorite)
     and auth.uid() is not null
     and not a_tout_pouvoir(new.evenement_id) then
    raise exception 'Seul un coordinateur peut rendre un contact visible sur le lien autorité'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists contact_visible_autorite on contacts;
create trigger contact_visible_autorite before insert or update of visible_autorite on contacts
  for each row execute function trg_contact_visible_autorite();

-- ---------------------------------------------------------------------
-- 3. Les documents de référence (des liens : Drive, SharePoint…).
-- ---------------------------------------------------------------------
create table if not exists documents_autorite (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  titre         text not null check (length(trim(titre)) > 0),
  description   text,
  url           text not null check (url ~* '^https?://'),
  ordre         integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

-- Pas de `deleted_at` : un lien de document retiré n'a rien à garder
-- (la suppression logique, sous RLS, exige en plus de passer par
-- `supprimer_logiquement` — 091/100 — pour une ligne sans enjeu).
create index if not exists idx_documents_autorite_ev
  on documents_autorite (evenement_id);

drop trigger if exists tracabilite_documents_autorite on documents_autorite;
create trigger tracabilite_documents_autorite before insert or update on documents_autorite
  for each row execute function trg_tracabilite_simple();

alter table documents_autorite enable row level security;

drop policy if exists documents_autorite_lecture on documents_autorite;
drop policy if exists documents_autorite_creation on documents_autorite;
drop policy if exists documents_autorite_modification on documents_autorite;
drop policy if exists documents_autorite_suppression on documents_autorite;

create policy documents_autorite_lecture on documents_autorite for select to authenticated
  using (a_tout_pouvoir(evenement_id));
create policy documents_autorite_creation on documents_autorite for insert to authenticated
  with check (a_tout_pouvoir(evenement_id));
create policy documents_autorite_modification on documents_autorite for update to authenticated
  using (a_tout_pouvoir(evenement_id))
  with check (a_tout_pouvoir(evenement_id));
create policy documents_autorite_suppression on documents_autorite for delete to authenticated
  using (a_tout_pouvoir(evenement_id));

-- ---------------------------------------------------------------------
-- 4. Un point d'un élément de plan (premier sommet, comme la 040).
-- ---------------------------------------------------------------------
create or replace function _point_element(g jsonb)
returns jsonb language sql immutable as $$
  select case when jsonb_typeof(g) = 'array' and jsonb_array_length(g) > 0
              then jsonb_build_object('lat', (g->0->>0)::double precision,
                                      'lon', (g->0->>1)::double precision)
         end;
$$;
revoke all on function _point_element(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. La page autorité.
-- ---------------------------------------------------------------------
create or replace function situation_autorite(p_jeton uuid)
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

  update acces_autorite
  set nb_acces = nb_acces + 1, dernier_acces = clock_timestamp()
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
        'consigne', al.consigne, 'emise_le', al.emise_le)
        order by al.emise_le desc), '[]'::jsonb)
      from alertes al
      where al.evenement_id = a.evenement_id and al.active and al.deleted_at is null
        and not exists (select 1 from maydays md where md.alerte_id = al.id)),

    'activite', jsonb_build_object(
      'signalements_ouverts', (select count(*) from signalements
        where evenement_id = a.evenement_id and deleted_at is null
          and statut in ('recu','pris_en_charge','en_cours')),
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
          'lieu', l.nom, 'pk_km', l.pk_km,
          'position', case when s.latitude is not null
                           then jsonb_build_object('lat', s.latitude, 'lon', s.longitude)
                           when l.latitude is not null
                           then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
          'description', case when op then s.description end
        ) as x
        from signalements s
        left join lieux l on l.id = s.lieu_id
        where s.evenement_id = a.evenement_id and s.deleted_at is null
          and s.statut in ('recu','pris_en_charge','en_cours')
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
        'confirme', ep.confirme)
        order by array_position(array['point_rencontre_secours','prv','voie_engins','pma',
          'poste_secours','aire_helico','point_transfert','noria','point_rassemblement',
          'sortie_secours','itineraire_evacuation']::text[], ep.categorie::text), ep.code), '[]'::jsonb)
      from elements_plan ep
      where ep.evenement_id = a.evenement_id and ep.deleted_at is null
        and ep.categorie::text in ('point_rencontre_secours','prv','voie_engins','pma',
          'poste_secours','aire_helico','point_transfert','noria','point_rassemblement',
          'sortie_secours','itineraire_evacuation')),

    -- (109) Les lieux qui servent à se repérer et à dire où.
    'reperes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', l.code, 'nom', l.nom, 'type', l.type, 'pk_km', l.pk_km,
        'position', case when l.latitude is not null
                         then jsonb_build_object('lat', l.latitude, 'lon', l.longitude) end,
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

    'consulte_le', clock_timestamp()

  ) into v;

  return v;
end;
$$;

revoke all on function situation_autorite(uuid) from public;
grant execute on function situation_autorite(uuid) to anon, authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION — droits.sql, bloc U :
--   un signalement avec description et contact, une recherche avec nom
--   et accompagnant, un MAYDAY ; deux liens, l'un 'situation', l'autre
--   'operationnel'. Le premier ne contient aucun texte libre, le second
--   les descriptions ; AUCUN des deux ne contient le contact, le nom de
--   la personne recherchée, celui de l'accompagnant ni celui du MAYDAY.
--   Un contact non coché n'apparaît pas ; coché, il apparaît.
-- =====================================================================
