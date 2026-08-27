-- ============ 025_roles_personnalisables ============
-- =====================================================================
-- Migration 025 : rôles personnalisables
-- ---------------------------------------------------------------------
-- Séparation de deux choses qui étaient fusionnées à tort :
--
--   Les CAPACITÉS (ressource × action × phase) restent figées au niveau
--   produit. C'est le vocabulaire du système, il ne s'invente pas.
--
--   Les RÔLES deviennent des données : un intitulé libre choisi par le
--   client — « Chef d'étape », « Dir-PC-Ops », « Responsable bar » — et
--   un paquet de capacités.
--
-- Le client compose avec ses mots, sans pouvoir inventer une capacité
-- inexistante : c'est ce qui évite le sur-mesure infini.
--
-- matrice_permissions n'est pas supprimée : elle devient le GABARIT
-- produit à partir duquel les rôles standard sont semés.
-- =====================================================================

begin;

create table roles (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  code          text not null,
  libelle       text not null,
  description   text,

  -- Rôle issu du gabarit produit. Renommable, mais non supprimable :
  -- supprimer « admin » enfermerait tout le monde dehors.
  systeme       boolean not null default false,

  -- Court-circuite toute vérification. Un seul rôle devrait le porter.
  tout_pouvoir  boolean not null default false,

  ordre         integer not null default 100,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  origine       origine_donnee not null default 'humain',

  unique (evenement_id, code)
);

create index idx_roles_ev on roles (evenement_id, ordre) where deleted_at is null;

create table role_capacites (
  role_id   uuid not null references roles(id) on delete cascade,
  ressource text not null,
  action    action_permission not null,
  phase     phase_evenement not null,
  primary key (role_id, ressource, action, phase)
);

create index idx_capacites_role on role_capacites (role_id);

comment on table role_capacites is
  'Droits ouverts pour un rôle. Absence de ligne = droit refusé.';

alter table membres_evenement
  add column role_id uuid references roles(id) on delete restrict;

create index idx_membres_role on membres_evenement (role_id);

-- ---------------------------------------------------------------------
-- Semis des rôles standard à partir du gabarit produit
-- ---------------------------------------------------------------------
create or replace function installer_roles_standard(p_evenement uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_role role_evenement;
  v_id uuid;
  v_n integer := 0;
  v_libelles constant jsonb := '{
    "admin":        {"libelle":"Administrateur","ordre":10,
                     "description":"Configure l''événement, les modules et les rôles."},
    "coordinateur": {"libelle":"Coordinateur","ordre":20,
                     "description":"Vue opérationnelle complète, décisions, main courante."},
    "chef_equipe":  {"libelle":"Chef d''équipe","ordre":30,
                     "description":"Son périmètre : son équipe, ses missions, édition sur le terrain."},
    "benevole":     {"libelle":"Bénévole","ordre":40,
                     "description":"Exécution : ses missions, sa fiche, sa carte."},
    "observateur":  {"libelle":"Observateur","ordre":50,
                     "description":"Lecture seule — commune, zone de secours, prestataire."}
  }'::jsonb;
begin
  foreach v_role in array enum_range(null::role_evenement)
  loop
    insert into roles (evenement_id, code, libelle, description, systeme,
                       tout_pouvoir, ordre, origine)
    values (
      p_evenement, v_role::text,
      v_libelles -> v_role::text ->> 'libelle',
      v_libelles -> v_role::text ->> 'description',
      true,
      v_role = 'admin',
      (v_libelles -> v_role::text ->> 'ordre')::int,
      'seed'
    )
    on conflict (evenement_id, code) do nothing
    returning id into v_id;

    if v_id is not null then
      v_n := v_n + 1;
      insert into role_capacites (role_id, ressource, action, phase)
      select v_id, mp.ressource, mp.action, mp.phase
      from matrice_permissions mp
      where mp.role = v_role
      on conflict do nothing;
    end if;
    v_id := null;
  end loop;

  return v_n;
end;
$$;

grant execute on function installer_roles_standard(uuid) to authenticated;

-- Tout nouvel événement reçoit les rôles standard
create or replace function trg_roles_nouvel_evenement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  perform installer_roles_standard(new.id);
  return null;
end;
$$;

create trigger roles_nouvel_evenement after insert on evenements
  for each row execute function trg_roles_nouvel_evenement();

-- ---------------------------------------------------------------------
-- Reprise de l'existant
-- ---------------------------------------------------------------------
do $$
declare e record;
begin
  for e in select id from evenements loop
    perform installer_roles_standard(e.id);
  end loop;
end $$;

update membres_evenement m
set role_id = r.id
from roles r
where r.evenement_id = m.evenement_id
  and r.code = m.role::text
  and m.role_id is null;

commit;;

-- ============ 026_autorisation_par_role_id ============
-- =====================================================================
-- Migration 026 : l'autorisation s'appuie sur role_id
-- ---------------------------------------------------------------------
-- a_permission garde sa signature : toutes les policies existantes
-- continuent de fonctionner sans être réécrites. Seule sa mécanique
-- interne change — elle interroge role_capacites au lieu de la matrice
-- produit.
--
-- Les trois règles de sûreté restent codées en dur, pas paramétrables :
--   R1 — un rôle « tout pouvoir » n'est jamais bloqué
--   R2 — la lecture de sos, alertes et journal est toujours ouverte
--   R3 — la phase ne restreint jamais la lecture du critique
-- Un client qui compose ses rôles ne peut donc pas, par maladresse,
-- enfermer quelqu'un dehors au pire moment.
-- =====================================================================

begin;

create or replace function role_id_dans(p_evenement uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role_id from membres_evenement m
  where m.evenement_id = p_evenement and m.user_id = auth.uid()
    and m.actif = true and m.deleted_at is null
  limit 1;
$$;

create or replace function a_tout_pouvoir(p_evenement uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select r.tout_pouvoir from roles r
    where r.id = role_id_dans(p_evenement) and r.deleted_at is null
  ), false);
$$;

create or replace function a_permission(
  p_evenement uuid,
  p_ressource text,
  p_action    action_permission
)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_role  uuid;
  v_phase phase_evenement;
begin
  v_role := role_id_dans(p_evenement);
  if v_role is null then
    return false;
  end if;

  -- R1
  if (select tout_pouvoir from roles where id = v_role) then
    return true;
  end if;

  -- R2 / R3
  if p_action = 'lire' and p_ressource in ('sos', 'alertes', 'journal') then
    return true;
  end if;

  v_phase := phase_courante(p_evenement);

  return exists (
    select 1 from role_capacites c
    where c.role_id = v_role
      and c.ressource = p_ressource
      and c.action = p_action
      and c.phase = v_phase
  );
end;
$$;

-- Les deux policies qui comparaient l'énuméré directement
drop policy if exists evenements_modification on evenements;
create policy evenements_modification on evenements for update to authenticated
  using (a_tout_pouvoir(id))
  with check (a_tout_pouvoir(id));

-- Gestion des rôles : réservée au rôle qui a tout pouvoir.
alter table roles          enable row level security;
alter table role_capacites enable row level security;

create policy roles_lecture on roles for select to authenticated
  using (est_membre(evenement_id) and deleted_at is null);
create policy roles_creation on roles for insert to authenticated
  with check (a_tout_pouvoir(evenement_id));
create policy roles_modification on roles for update to authenticated
  using (a_tout_pouvoir(evenement_id))
  with check (a_tout_pouvoir(evenement_id));

create policy capacites_lecture on role_capacites for select to authenticated
  using (exists (select 1 from roles r
                 where r.id = role_capacites.role_id and est_membre(r.evenement_id)));
create policy capacites_creation on role_capacites for insert to authenticated
  with check (exists (select 1 from roles r
                      where r.id = role_capacites.role_id and a_tout_pouvoir(r.evenement_id)));
create policy capacites_suppression on role_capacites for delete to authenticated
  using (exists (select 1 from roles r
                 where r.id = role_capacites.role_id and a_tout_pouvoir(r.evenement_id)));

-- ---------------------------------------------------------------------
-- Ce que je peux faire, ici et maintenant.
-- Permet à l'interface de se composer d'après les capacités réelles
-- plutôt que d'après une liste de rôles codée en dur — sinon un rôle
-- créé par le client n'aurait aucun écran.
-- ---------------------------------------------------------------------
create or replace function mes_capacites(p_evenement uuid)
returns table (ressource text, action text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with r as (select role_id_dans(p_evenement) as id),
       p as (select phase_courante(p_evenement) as phase)
  select distinct c.ressource, c.action::text
  from role_capacites c, r, p
  where c.role_id = r.id and c.phase = p.phase
    and not (select a_tout_pouvoir(p_evenement))

  union all

  -- Tout pouvoir : on renvoie l'univers des capacités connues
  select distinct mp.ressource, mp.action::text
  from matrice_permissions mp
  where (select a_tout_pouvoir(p_evenement))

  union all

  -- Règle R2, toujours vraie
  select x, 'lire' from unnest(array['sos','alertes','journal']) x
  where est_membre(p_evenement);
$$;

grant execute on function mes_capacites(uuid) to authenticated;

commit;;

-- ============ 027_situation_generale ============
-- =====================================================================
-- Migration 027 : situation générale
-- ---------------------------------------------------------------------
-- La vue QG d'un coup d'œil : ce que la v18 faisait en 1470 lignes.
--
-- Une seule fonction, pour deux usages : le tableau de bord interne et,
-- demain, la page autorité consultée sur jeton. Dupliquer la logique
-- garantirait qu'elles divergent — et que le bourgmestre voie autre
-- chose que le PC-Ops.
-- =====================================================================

create or replace function situation(p_evenement uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not est_membre(p_evenement) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select jsonb_build_object(

    'evenement', (
      select jsonb_build_object(
        'nom', e.nom, 'phase', e.phase, 'geometrie', e.geometrie,
        'modules', e.modules, 'date_debut', e.date_debut, 'date_fin', e.date_fin)
      from evenements e where e.id = p_evenement
    ),

    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', a.niveau, 'titre', a.titre, 'consigne', a.consigne,
        'emise_le', a.emise_le) order by a.emise_le desc), '[]'::jsonb)
      from alertes a
      where a.evenement_id = p_evenement and a.active and a.deleted_at is null
    ),

    'signalements', (
      select jsonb_build_object(
        'ouverts', count(*) filter (where statut in ('recu','pris_en_charge','en_cours')),
        'non_pris_en_charge', count(*) filter (where statut = 'recu'),
        'total', count(*),
        'derniers', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'reference', s.reference, 'type', s.type, 'statut', s.statut,
            'description', s.description, 'recu_le', s.recu_le,
            'latitude', s.latitude, 'longitude', s.longitude)
            order by s.recu_le desc), '[]'::jsonb)
          from (select * from signalements
                where evenement_id = p_evenement and deleted_at is null
                  and statut in ('recu','pris_en_charge','en_cours')
                order by recu_le desc limit 8) s
        ))
      from signalements
      where evenement_id = p_evenement and deleted_at is null
    ),

    'missions', (
      select jsonb_build_object(
        'ouvertes', count(*) filter (where statut not in ('resolue','annulee')),
        'p1', count(*) filter (where priorite = 'P1' and statut not in ('resolue','annulee')),
        'non_attribuees', count(*) filter (where equipe_id is null and membre_id is null
                                             and statut not in ('resolue','annulee')),
        'resolues', count(*) filter (where statut = 'resolue'),
        'par_statut', (
          select coalesce(jsonb_object_agg(x.statut, x.n), '{}'::jsonb)
          from (select statut::text as statut, count(*) n from missions
                where evenement_id = p_evenement and deleted_at is null
                  and statut not in ('resolue','annulee')
                group by statut) x))
      from missions where evenement_id = p_evenement and deleted_at is null
    ),

    'parcours', (
      select jsonb_build_object(
        'en_route', count(*) filter (where statut in ('parti','en_cours')),
        'arrives', count(*) filter (where statut = 'arrive'),
        'abandons', count(*) filter (where statut = 'abandon'),
        'personnes_sur_parcours', coalesce(sum(coalesce(effectif_reel, effectif_prevu))
                                   filter (where statut in ('parti','en_cours')), 0),
        'sans_nouvelles', (select count(*) from groupes_sans_nouvelles(p_evenement, 45)))
      from groupes where evenement_id = p_evenement and deleted_at is null
    ),

    'logistique', jsonb_build_object(
      'jauge', jauge_courante(p_evenement),
      'sous_seuil', (select coalesce(jsonb_agg(jsonb_build_object(
          'nom', m.nom, 'quantite', m.quantite, 'unite', m.unite,
          'seuil', m.seuil_alerte) order by m.nom), '[]'::jsonb)
        from materiel m
        where m.evenement_id = p_evenement and m.deleted_at is null
          and m.seuil_alerte is not null and m.quantite <= m.seuil_alerte),
      'transports_ouverts', (select count(*) from transports
        where evenement_id = p_evenement and deleted_at is null
          and statut not in ('resolue','annulee')),
      'biens_non_rendus', (select count(*) from attributions
        where evenement_id = p_evenement and deleted_at is null and rendu_le is null)
    ),

    'rh', (
      select jsonb_build_object(
        'postes_a_couvrir', coalesce(sum(manque), 0),
        'creneaux_decouverts', count(*) filter (where manque > 0))
      from couverture_creneaux(p_evenement, now())
    ),

    'recherches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', r.reference, 'nom', r.nom, 'description', r.description,
        'dernier_lieu', r.dernier_lieu, 'depuis', r.created_at)
        order by r.created_at desc), '[]'::jsonb)
      from recherches r
      where r.evenement_id = p_evenement and r.statut = 'en_cours' and r.deleted_at is null
    ),

    'jalons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'libelle', j.libelle, 'echeance', j.echeance, 'statut', j.statut,
        'critique', j.critique, 'responsable', j.responsable)
        order by j.echeance), '[]'::jsonb)
      from (select * from jalons
            where evenement_id = p_evenement and deleted_at is null
              and statut in ('a_venir','en_cours')
            order by echeance limit 5) j
    ),

    'journal', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'horodatage', x.horodatage, 'texte', x.texte,
        'importance', x.importance, 'module', x.module, 'source', x.source)
        order by x.horodatage desc), '[]'::jsonb)
      from (select * from journal
            where evenement_id = p_evenement and deleted_at is null
            order by horodatage desc limit 12) x
    )

  ) into v;
  return v;
end;
$$;

grant execute on function situation(uuid) to authenticated;;

-- ============ 028_acces_autorite ============
-- =====================================================================
-- Migration 028 : page autorité, sur jeton, sans compte
-- ---------------------------------------------------------------------
-- Le bourgmestre, le Dir-PC-Ops ou la zone de secours reçoivent un lien
-- le matin de l'événement. Pas d'inscription, pas de mot de passe
-- oublié à 23 h, pas de compte à créer pour trois heures d'usage par an.
-- Le lien se révoque après l'événement.
--
-- ⚠️ La vue autorité est DÉLIBÉRÉMENT plus étroite que la vue interne.
-- Le REX 2026 a mis en évidence une donnée personnelle sensible encodée
-- dans un journal partagé : un lien qui circule hors de l'équipe ne peut
-- exposer ni la main courante, ni la description d'un malaise, ni les
-- vêtements d'un enfant recherché. L'autorité a besoin de la SITUATION,
-- pas des personnes.
-- =====================================================================

begin;

create table acces_autorite (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  jeton         uuid not null default gen_random_uuid() unique,

  libelle       text not null,          -- « Bourgmestre de Ferrières »
  organisation  text,
  contact       text,

  actif         boolean not null default true,
  expire_le     timestamptz,

  dernier_acces timestamptz,
  nb_acces      integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create index idx_acces_ev on acces_autorite (evenement_id) where deleted_at is null;

create trigger tracabilite_acces before insert or update on acces_autorite
  for each row execute function trg_tracabilite_simple();

-- Toute création ou révocation est tracée : qui a donné accès à quoi.
create or replace function trg_journal_acces()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform journaliser(new.evenement_id, 'noyau', 'acces',
      'Accès autorité ouvert : ' || new.libelle ||
      coalesce(' (' || new.organisation || ')', ''),
      'notable'::importance_journal, 'acces_autorite', new.id, null);
  elsif old.actif and not new.actif then
    perform journaliser(new.evenement_id, 'noyau', 'acces',
      'Accès autorité révoqué : ' || new.libelle,
      'notable'::importance_journal, 'acces_autorite', new.id, null);
  end if;
  return null;
end;
$$;

create trigger journal_acces after insert or update on acces_autorite
  for each row execute function trg_journal_acces();

alter table acces_autorite enable row level security;

create policy acces_lecture on acces_autorite for select to authenticated
  using (a_tout_pouvoir(evenement_id) and deleted_at is null);
create policy acces_creation on acces_autorite for insert to authenticated
  with check (a_tout_pouvoir(evenement_id));
create policy acces_modification on acces_autorite for update to authenticated
  using (a_tout_pouvoir(evenement_id))
  with check (a_tout_pouvoir(evenement_id));

-- ---------------------------------------------------------------------
-- Vue autorité : agrégats et consignes, jamais de personnes.
-- ---------------------------------------------------------------------
create or replace function situation_autorite(p_jeton uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a acces_autorite%rowtype;
  v jsonb;
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

  -- Trace de consultation : on saura qui a regardé et quand.
  update acces_autorite
  set nb_acces = nb_acces + 1, dernier_acces = clock_timestamp()
  where id = a.id;

  select jsonb_build_object(

    'destinataire', jsonb_build_object(
      'libelle', a.libelle, 'organisation', a.organisation),

    'evenement', (
      select jsonb_build_object('nom', e.nom, 'phase', e.phase,
                                'geometrie', e.geometrie)
      from evenements e where e.id = a.evenement_id),

    -- Les alertes SONT destinées à sortir : c'est même leur objet.
    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', al.niveau, 'titre', al.titre, 'message', al.message,
        'consigne', al.consigne, 'emise_le', al.emise_le)
        order by al.emise_le desc), '[]'::jsonb)
      from alertes al
      where al.evenement_id = a.evenement_id and al.active and al.deleted_at is null),

    -- Volumes uniquement. Ni description, ni position, ni référence.
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
          and statut = 'en_cours')),

    'public', jsonb_build_object(
      'jauge', jauge_courante(a.evenement_id),
      'sur_parcours', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut in ('parti','en_cours')),
      'groupes_sans_nouvelles', (
        select count(*) from groupes_sans_nouvelles(a.evenement_id, 45))),

    -- Ce qui intéresse les secours : où sont les risques et où couper.
    'installations_risque', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nom', ep.nom, 'categorie', ep.categorie,
        'latitude', case when jsonb_array_length(ep.geometrie) > 0
                    then (ep.geometrie->0->>0)::double precision end,
        'longitude', case when jsonb_array_length(ep.geometrie) > 0
                    then (ep.geometrie->0->>1)::double precision end,
        'organe_coupure', ep.organe_coupure,
        'moyens_proximite', ep.moyens_proximite,
        'confirme', ep.confirme) order by ep.code), '[]'::jsonb)
      from elements_plan ep
      where ep.evenement_id = a.evenement_id and ep.deleted_at is null
        and ep.est_risque),

    'consulte_le', clock_timestamp()

  ) into v;

  return v;
end;
$$;

revoke all on function situation_autorite(uuid) from public;
grant execute on function situation_autorite(uuid) to anon, authenticated;

commit;;

-- ============ 029_exploitant_et_organisations ============
-- =====================================================================
-- Migration 029 : séparation exploitant / coordinateur
-- ---------------------------------------------------------------------
-- « admin » confondait deux métiers :
--
--   L'EXPLOITANT de la plateforme (l'éditeur) crée les organisations
--   clientes, ouvre les événements, active ce qui est souscrit et gère
--   les accès. Il ne pilote aucun événement.
--
--   Le COORDINATEUR (le client) pilote son événement de bout en bout,
--   mais ne décide pas de ce qu'il a acheté et ne voit rien des autres
--   clients.
--
-- D'où un niveau au-dessus de l'événement : l'organisation.
-- =====================================================================

begin;

create type statut_organisation as enum ('essai', 'active', 'suspendue', 'close');

create table organisations (
  id            uuid primary key default gen_random_uuid(),
  nom           text not null,
  slug          text not null unique,
  contact_nom   text,
  contact_email text,
  contact_tel   text,

  statut        statut_organisation not null default 'essai',

  -- Plafond contractuel : un événement ne peut pas activer un module
  -- que l'organisation n'a pas souscrit.
  modules_autorises jsonb not null default '{
    "securite": true, "logistique": false, "rh": false, "parcours": false,
    "sos_participants": false, "plan_implantation": false, "analyse": false
  }'::jsonb,

  quota_evenements integer,
  souscrit_le   date,
  echeance      date,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);

create trigger tracabilite_organisations before insert or update on organisations
  for each row execute function trg_tracabilite_simple();

-- ---------------------------------------------------------------------
-- Membres de la plateforme — l'éditeur, hors de tout événement
-- ---------------------------------------------------------------------
create type niveau_plateforme as enum ('exploitant', 'support');

create table membres_plateforme (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  niveau     niveau_plateforme not null default 'support',
  nom        text,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table membres_plateforme is
  'Compte de l''éditeur. N''appartient à aucune organisation cliente et ne pilote aucun événement.';

create or replace function est_exploitant()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from membres_plateforme
    where user_id = auth.uid() and actif and niveau = 'exploitant'
  );
$$;

grant execute on function est_exploitant() to authenticated;

-- ---------------------------------------------------------------------
-- Rattachement des événements
-- ---------------------------------------------------------------------
alter table evenements
  add column organisation_id uuid references organisations(id) on delete restrict;

create index idx_evenements_org on evenements (organisation_id);

-- Reprise de l'existant : une organisation pour ce qui existe déjà
insert into organisations (nom, slug, statut, modules_autorises, notes)
values ('Bucolique Ferrières', 'bucolique-ferrieres', 'active',
        '{"securite":true,"logistique":true,"rh":true,"parcours":true,
          "sos_participants":true,"plan_implantation":true,"analyse":true}'::jsonb,
        'Organisation créée lors de la séparation exploitant/coordinateur.')
on conflict (slug) do nothing;

update evenements
set organisation_id = (select id from organisations where slug = 'bucolique-ferrieres')
where organisation_id is null;

-- ---------------------------------------------------------------------
-- Un module ne peut pas dépasser ce que l'organisation a souscrit.
-- Contrôle en base : l'interface peut mentir, pas la base.
-- ---------------------------------------------------------------------
create or replace function trg_modules_sous_licence()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  v_autorises jsonb;
  k text;
begin
  select o.modules_autorises into v_autorises
  from organisations o where o.id = new.organisation_id;

  if v_autorises is null then
    return new;
  end if;

  for k in select jsonb_object_keys(new.modules)
  loop
    if coalesce((new.modules ->> k)::boolean, false)
       and not coalesce((v_autorises ->> k)::boolean, false) then
      raise exception 'Module « % » non souscrit par l''organisation', k
        using errcode = 'P0007';
    end if;
  end loop;

  return new;
end;
$$;

create trigger modules_sous_licence before insert or update on evenements
  for each row execute function trg_modules_sous_licence();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table organisations      enable row level security;
alter table membres_plateforme enable row level security;

-- L'exploitant voit tout ; un membre voit l'organisation de ses événements.
create policy organisations_lecture on organisations for select to authenticated
  using (
    est_exploitant()
    or exists (select 1 from evenements e
               where e.organisation_id = organisations.id and est_membre(e.id))
  );

create policy organisations_creation on organisations for insert to authenticated
  with check (est_exploitant());
create policy organisations_modification on organisations for update to authenticated
  using (est_exploitant()) with check (est_exploitant());

create policy plateforme_lecture on membres_plateforme for select to authenticated
  using (est_exploitant() or user_id = auth.uid());
create policy plateforme_gestion on membres_plateforme for all to authenticated
  using (est_exploitant()) with check (est_exploitant());

-- L'exploitant voit tous les événements, sans en être membre.
create policy evenements_lecture_exploitant on evenements for select to authenticated
  using (est_exploitant() and deleted_at is null);

create policy evenements_modification_exploitant on evenements for update to authenticated
  using (est_exploitant()) with check (est_exploitant());

commit;;

-- ============ 030_coordinateur_pilote_evenement ============
-- =====================================================================
-- Migration 030 : le coordinateur pilote l'événement
-- ---------------------------------------------------------------------
-- Le tout-pouvoir OPÉRATIONNEL passe de « admin » à « coordinateur ».
-- Le rôle « admin » disparaît du vocabulaire événement : au niveau
-- d'un événement, il n'y a plus d'administrateur — il y a un
-- coordinateur qui pilote, et un exploitant qui, lui, n'est pas
-- membre de l'événement.
--
-- Ce qui reste hors de portée du coordinateur, et qui est contrôlé en
-- base et non dans l'interface :
--   - l'activation des modules (c'est la licence)
--   - le rattachement à une organisation
-- =====================================================================

begin;

-- Le coordinateur devient le rôle qui passe partout dans son événement
update roles set tout_pouvoir = true, ordre = 10,
  description = 'Pilote l''événement : dispositif, équipes, rôles, phases, référentiels.'
where code = 'coordinateur';

-- L'ancien admin devient un rôle de reprise, sans pouvoir opérationnel
-- particulier. Il n'est pas supprimé : des membres y sont rattachés.
update roles set tout_pouvoir = false,
  libelle = 'Administrateur (hérité)',
  description = 'Rôle de la version précédente. À remplacer par Coordinateur.',
  ordre = 90
where code = 'admin';

-- Les membres qui étaient admin deviennent coordinateurs de leur événement
update membres_evenement m
set role_id = c.id
from roles a, roles c
where m.role_id = a.id
  and a.code = 'admin'
  and c.evenement_id = a.evenement_id
  and c.code = 'coordinateur';

-- Le gabarit produit suit, pour les événements à venir
update matrice_permissions set role = 'coordinateur' where role = 'admin';

-- Le semis initial doit désormais donner le tout-pouvoir au coordinateur
create or replace function installer_roles_standard(p_evenement uuid)
returns integer
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_role role_evenement;
  v_id uuid;
  v_n integer := 0;
  v_libelles constant jsonb := '{
    "coordinateur": {"libelle":"Coordinateur","ordre":10,
                     "description":"Pilote l''événement : dispositif, équipes, rôles, phases, référentiels."},
    "chef_equipe":  {"libelle":"Chef d''équipe","ordre":20,
                     "description":"Son périmètre : son équipe, ses missions, édition sur le terrain."},
    "benevole":     {"libelle":"Bénévole","ordre":30,
                     "description":"Exécution : ses missions, sa fiche, sa carte."},
    "observateur":  {"libelle":"Observateur","ordre":40,
                     "description":"Lecture seule — commune, zone de secours, prestataire."}
  }'::jsonb;
begin
  foreach v_role in array enum_range(null::role_evenement)
  loop
    -- « admin » n'existe plus au niveau d'un événement
    continue when v_role = 'admin';

    insert into roles (evenement_id, code, libelle, description, systeme,
                       tout_pouvoir, ordre, origine)
    values (
      p_evenement, v_role::text,
      v_libelles -> v_role::text ->> 'libelle',
      v_libelles -> v_role::text ->> 'description',
      true,
      v_role = 'coordinateur',
      (v_libelles -> v_role::text ->> 'ordre')::int,
      'seed'
    )
    on conflict (evenement_id, code) do nothing
    returning id into v_id;

    if v_id is not null then
      v_n := v_n + 1;
      insert into role_capacites (role_id, ressource, action, phase)
      select v_id, mp.ressource, mp.action, mp.phase
      from matrice_permissions mp where mp.role = v_role
      on conflict do nothing;
    end if;
    v_id := null;
  end loop;

  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Le créateur d'un événement en devient COORDINATEUR
-- ---------------------------------------------------------------------
create or replace function trg_admin_createur()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_role uuid;
begin
  if auth.uid() is null then return new; end if;

  select id into v_role from roles
  where evenement_id = new.id and code = 'coordinateur';

  insert into membres_evenement (evenement_id, user_id, role, role_id, origine)
  values (new.id, auth.uid(), 'coordinateur', v_role, 'humain')
  on conflict (evenement_id, user_id) do nothing;

  return new;
end;
$$;

-- Ordre des triggers : les rôles doivent exister avant l'affectation.
drop trigger if exists admin_createur on evenements;
drop trigger if exists roles_nouvel_evenement on evenements;

create trigger a_roles_nouvel_evenement after insert on evenements
  for each row execute function trg_roles_nouvel_evenement();
create trigger b_coordinateur_createur after insert on evenements
  for each row execute function trg_admin_createur();

commit;;

-- ============ 031_reconciliation_licence ============
-- =====================================================================
-- Migration 031 : la licence se propage aux événements
-- ---------------------------------------------------------------------
-- Défaut trouvé au test : le contrôle empêchait d'ACTIVER un module non
-- souscrit, mais laissait actif ce qui l'était déjà. Retirer un module
-- d'une licence — résiliation, fin d'essai, changement d'offre —
-- n'avait donc aucun effet sur les événements en cours.
--
-- Les événements clos ne sont pas touchés : on ne réécrit pas
-- l'historique d'un événement passé pour une raison commerciale.
-- =====================================================================

begin;

create or replace function trg_licence_vers_evenements()
returns trigger language plpgsql
security definer set search_path = public, pg_temp as $$
declare
  e record;
  v_modules jsonb;
  k text;
  v_retires text[];
begin
  if new.modules_autorises is not distinct from old.modules_autorises then
    return null;
  end if;

  for e in
    select id, nom, modules from evenements
    where organisation_id = new.id and deleted_at is null and phase <> 'cloture'
  loop
    v_modules := e.modules;
    v_retires := '{}';

    for k in select jsonb_object_keys(e.modules)
    loop
      if coalesce((e.modules ->> k)::boolean, false)
         and not coalesce((new.modules_autorises ->> k)::boolean, false) then
        v_modules := jsonb_set(v_modules, array[k], 'false'::jsonb);
        v_retires := v_retires || k;
      end if;
    end loop;

    if array_length(v_retires, 1) > 0 then
      update evenements set modules = v_modules where id = e.id;
      perform journaliser(e.id, 'noyau', 'licence',
        'Module(s) désactivé(s) par changement de licence : ' ||
        array_to_string(v_retires, ', '),
        'majeur'::importance_journal, 'organisation', new.id, null);
    end if;
  end loop;

  return null;
end;
$$;

create trigger licence_vers_evenements after update on organisations
  for each row execute function trg_licence_vers_evenements();

-- Mise en cohérence de l'existant
do $$
declare o record;
begin
  for o in select id, modules_autorises from organisations loop
    update organisations set updated_at = now() where id = o.id;
  end loop;
end $$;

commit;;
