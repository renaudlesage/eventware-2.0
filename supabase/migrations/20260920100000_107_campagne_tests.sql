-- =====================================================================
-- 107 — CE QUE LA CAMPAGNE DE TESTS DU 20/09 A MONTRÉ (côté base)
--
-- Huit corrections, toutes prouvées sur la base avant d'être écrites
-- ici (le détail des preuves est dans le diagnostic de la campagne).
--
-- 1. LOGO IRREMPLAÇABLE (2a-13). Le bucket `logos` n'avait aucune
--    policy SELECT : le premier envoi passait (chemin INSERT), le
--    remplacement échouait — `upsert` devient INSERT … ON CONFLICT DO
--    UPDATE, et PostgreSQL exige de VOIR la ligne existante pour la
--    mettre à jour. Le bucket étant public, personne n'avait remarqué
--    que les membres ne « voyaient » pas les objets. Une policy de
--    lecture pour les membres de l'événement, et le remplacement passe.
--
-- 2. RETIRÉ, DONC BANNI (« un admin plateforme jeté d'un événement ne
--    peut plus y revenir »). Le retrait est logique (`deleted_at`), mais
--    la contrainte d'unicité (evenement_id, user_id) ignore
--    `deleted_at`. Deux chemins de retour, deux défauts :
--      - l'exploitant (`rejoindre_evenement(uuid, text)`) : l'upsert
--        remettait `actif = true` sans effacer `deleted_at` → la ligne
--        restait invisible, l'événement absent de sa liste ;
--      - le code d'invitation (`rejoindre_evenement(text)`) : test
--        « déjà membre » sur les lignes vivantes, puis INSERT → 23505.
--    Les deux réactivent désormais la ligne retirée, avec le rôle
--    demandé. Le retrait reste tracé (journal) ; le retour aussi. Le
--    garde-fou « pas de rôle auto-attribué » (trigger) exempte une
--    ligne qui revit : c'est prouvé au bloc P de droits.sql.
--
-- 3. « COORDINATION » VOULAIT DIRE « RH:MODIFIER » (2b-04). Une action
--    passée en visibilité Coordination restait lisible par tout
--    détenteur de `rh:modifier` — le chef d'équipe, donc, et même le
--    bénévole de BFMF2027 dont la matrice porte ce droit. Le mot
--    désigne l'encadrement : ce sont les rôles à tout pouvoir, et eux
--    seuls. La lecture des autres visibilités ne change pas. Dans le
--    même mouvement, l'écriture d'un jalon s'ouvre à son RESPONSABLE,
--    comme une mission à son titulaire : le bénévole n'a plus besoin de
--    `rh:modifier` pour faire avancer ce dont il répond (voir 108).
--
-- 4. MISSION D'ÉQUIPE INFRANCHISSABLE (3e-02). La 105 exigeait, pour
--    écrire une mission, qu'elle soit attribuée à soi (`membre_id`).
--    Une mission attribuée à MON ÉQUIPE sans titulaire arrive bien dans
--    Mon terrain — mais « Je démarre » ne posait que le statut, la ligne
--    gardait `membre_id` null, et WITH CHECK refusait (quatre 42501 dans
--    les journaux à 08:07). Côté base, `mon_terrain` renvoie maintenant
--    le TITULAIRE de chaque ligne, pour que l'écran dise « pris par X »
--    au lieu d'offrir un bouton qui échoue. Côté application, avancer
--    une ligne sans titulaire, c'est la prendre : `membre_id` est posé
--    à chaque avancée (Terrain.jsx). La policy 105 reste telle quelle —
--    elle disait juste.
--
-- 5. TRANSPORTS : MÊME RÈGLE QUE LES MISSIONS (3e-03, et matrice 108).
--    Prendre un transport exigeait `logistique:modifier`, un droit
--    d'encadrement. Un chauffeur bénévole doit pouvoir prendre un
--    transport sans chauffeur, et le faire avancer, avec le même droit
--    que pour une mission (`missions:modifier`) — sans pour autant
--    réattribuer celui d'un autre.
--
-- 6. UNE TRACE GPX EST UN RÉFÉRENTIEL (3e-07). Son import demandait
--    `parcours:creer`, le droit du POINTAGE que tout bénévole détient
--    pour « pointer un autre groupe ». Les traces rejoignent les lieux :
--    `referentiels:creer` pour importer, `referentiels:modifier` pour
--    retoucher. Leur lecture reste `parcours:lire`.
--
-- 7. LA PAGE PARTICIPANT NE SAIT PAS SI LE SOS EST OUVERT (2b-07).
--    `evenement_public` ne renvoyait que le nom et le logo : la page
--    affichait le formulaire de signalement même sur un événement où
--    le module est éteint (BFMF2027), sous un titre « Signaler un
--    problème », et Réglages ne montrait aucun lien participant sans
--    ce module. La fonction dit maintenant si le SOS est actif ; la
--    vitrine (infos, horaire, plan) existe pour tout événement.
--
-- 8. BASCULE GROUPE → ÉQUIPE EXPLICITE. « Reprendre comme équipe »
--    créait l'équipe et rien d'autre : les membres du groupe restaient
--    à affecter un par un dans Bénévoles, ce qui rendait la bascule
--    inintelligible. La fonction `reprendre_groupe_comme_equipe` fait
--    tout d'un coup : l'équipe, son responsable (le pilote), l'affectation
--    des membres du groupe qui n'ont pas encore d'équipe, une ligne au
--    journal — et rend compte de ce qu'elle a fait.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Logos : lecture par les membres de l'événement
-- ---------------------------------------------------------------------
drop policy if exists logos_lecture on storage.objects;
create policy logos_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'logos' and est_membre(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- 2. Réadhésion après retrait
-- ---------------------------------------------------------------------
-- Le garde-fou « on ne se donne pas un rôle soi-même » (trigger
-- protege_attribution_membre) s'appliquait aussi au retour d'un membre
-- retiré : sa ligne n'ayant plus de rôle vivant, `a_permission` répond
-- non, et la réadhésion échouait sur ce message même pour l'exploitant.
-- Une ligne qui REVIT (deleted_at posé → effacé) est exemptée : seule
-- une fonction serveur peut produire ce passage, jamais un utilisateur
-- (sa ligne retirée lui est invisible), et ces fonctions ont fait leur
-- propre contrôle — exploitant, ou code d'invitation émis par
-- l'encadrement.
create or replace function trg_protege_attribution_membre()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    return new;
  end if;

  if (new.role      is distinct from old.role
   or new.role_id   is distinct from old.role_id
   or new.equipe_id is distinct from old.equipe_id
   or new.perimetre is distinct from old.perimetre
   or new.actif     is distinct from old.actif)
     and not a_permission(new.evenement_id, 'membres', 'modifier') then
    raise exception
      'Un rôle, une équipe ou un périmètre sont attribués par l''encadrement, pas choisis'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function rejoindre_evenement(p_evenement uuid, p_role_code text default 'coordinateur')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role uuid;
  v_id uuid;
  v_retour boolean;
begin
  if not est_exploitant() then
    raise exception 'Réservé à l''exploitant de la plateforme' using errcode = '42501';
  end if;

  select id into v_role from roles
  where evenement_id = p_evenement and code = p_role_code and deleted_at is null;

  if v_role is null then
    raise exception 'Rôle « % » inexistant sur cet événement', p_role_code
      using errcode = 'P0002';
  end if;

  select exists (
    select 1 from membres_evenement
    where evenement_id = p_evenement and user_id = auth.uid() and deleted_at is not null
  ) into v_retour;

  insert into membres_evenement (evenement_id, user_id, role, role_id, nom_affiche, origine)
  values (p_evenement, auth.uid(),
          case when p_role_code in ('coordinateur','chef_equipe','benevole','observateur')
               then p_role_code::role_evenement else 'coordinateur' end,
          v_role, 'Éditeur (support)', 'humain')
  on conflict (evenement_id, user_id)
    do update set role_id    = excluded.role_id,
                  role       = excluded.role,
                  actif      = true,
                  -- (107) une ligne retirée revit : c'est tout l'objet
                  -- de l'appel quand on a été retiré par erreur.
                  deleted_at = null,
                  updated_at = now()
  returning id into v_id;

  perform journaliser(p_evenement, 'noyau', 'acces',
    case when v_retour
      then 'Retour de l''éditeur dans le dispositif après retrait, rôle ' || p_role_code
      else 'Rattachement de l''éditeur au dispositif, rôle ' || p_role_code end,
    'notable'::importance_journal, 'membre', v_id, null);

  return v_id;
end;
$$;

create or replace function rejoindre_evenement(p_code text)
returns table (id_evenement uuid, nom_evenement text, code_role text, deja_membre boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv    invitations%rowtype;
  v_role   roles%rowtype;
  v_nom    text;
  v_existe boolean;
  v_retire uuid;
  v_nom_personne text;
  v_legacy role_evenement;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select * into v_inv from invitations i
  where upper(trim(i.code)) = upper(trim(p_code)) and i.deleted_at is null;

  if not found then
    raise exception 'Code inconnu' using errcode = 'P0002';
  end if;
  if not v_inv.actif then
    raise exception 'Ce code a été désactivé' using errcode = 'P0004';
  end if;
  if v_inv.expire_le is not null and v_inv.expire_le < now() then
    raise exception 'Ce code a expiré' using errcode = 'P0004';
  end if;
  if v_inv.usages_max is not null and v_inv.usages >= v_inv.usages_max then
    raise exception 'Ce code a déjà servi le nombre de fois prévu' using errcode = 'P0004';
  end if;

  select e.nom into v_nom from evenements e where e.id = v_inv.evenement_id;

  select exists(
    select 1 from membres_evenement m
    where m.evenement_id = v_inv.evenement_id
      and m.user_id = auth.uid() and m.deleted_at is null
  ) into v_existe;

  if v_existe then
    return query select v_inv.evenement_id, v_nom, null::text, true;
    return;
  end if;

  select * into v_role from roles r where r.id = v_inv.role_id;

  v_legacy := coalesce(
    (case when v_role.code in ('admin','coordinateur','chef_equipe','benevole','observateur')
          then v_role.code end),
    'benevole'
  )::role_evenement;

  -- Le nom donné à l'inscription pré-remplit l'adhésion.
  v_nom_personne := nullif(trim(coalesce(
    auth.jwt() -> 'user_metadata' ->> 'nom', '')), '');

  -- (107) Une ligne retirée bloque l'insertion (unicité) : on la fait
  -- revivre avec le rôle du code, comme une adhésion neuve.
  select m.id into v_retire from membres_evenement m
  where m.evenement_id = v_inv.evenement_id and m.user_id = auth.uid()
    and m.deleted_at is not null;

  if v_retire is not null then
    update membres_evenement m
    set role_id    = v_inv.role_id,
        role       = v_legacy,
        equipe_id  = v_inv.equipe_id,
        invite_le  = now(),
        nom_affiche = coalesce(m.nom_affiche, v_nom_personne),
        actif      = true,
        deleted_at = null,
        updated_at = now()
    where m.id = v_retire;
    perform journaliser(v_inv.evenement_id, 'noyau', 'acces',
      'Retour d''un membre retiré, par code d''invitation, rôle ' || coalesce(v_role.code, 'benevole'),
      'notable'::importance_journal, 'membre', v_retire, null);
  else
    insert into membres_evenement (
      evenement_id, user_id, role_id, role, equipe_id, invite_le, nom_affiche
    ) values (
      v_inv.evenement_id, auth.uid(), v_inv.role_id, v_legacy,
      v_inv.equipe_id, now(), v_nom_personne
    );
  end if;

  update invitations i set usages = i.usages + 1 where i.id = v_inv.id;

  return query select v_inv.evenement_id, v_nom, coalesce(v_role.code, 'benevole'), false;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Coordination = les rôles à tout pouvoir
-- ---------------------------------------------------------------------
drop policy if exists jalons_lecture on jalons;
create policy jalons_lecture on jalons
  for select to authenticated
  using (
    deleted_at is null
    and (
      a_tout_pouvoir(evenement_id)
      or (visibilite <> 'coordination' and a_permission(evenement_id, 'rh', 'lire'))
    )
  );

-- Et le pendant pour l'écriture : le RESPONSABLE d'une action ou d'un
-- jalon peut le faire avancer, comme le titulaire d'une mission (105).
-- Jusqu'ici c'était `rh:modifier` pour tout le monde, ce qui obligeait
-- à donner ce droit d'encadrement au bénévole standard pour qu'il
-- puisse passer « fait » ce dont il répond depuis Mon terrain — et lui
-- ouvrait du même coup tous les jalons de l'événement, visibilité
-- comprise. La 108 le lui retire ; ce chemin-ci le remplace.
drop policy if exists jalons_modification on jalons;
create policy jalons_modification on jalons
  for update to authenticated
  using (
    a_permission(evenement_id, 'rh', 'modifier')
    or responsable_membre_id in (
      select m.id from membres_evenement m
      where m.evenement_id = jalons.evenement_id
        and m.user_id = (select auth.uid()) and m.deleted_at is null
    )
  )
  with check (
    a_permission(evenement_id, 'rh', 'modifier')
    or responsable_membre_id in (
      select m.id from membres_evenement m
      where m.evenement_id = jalons.evenement_id
        and m.user_id = (select auth.uid()) and m.deleted_at is null
    )
  );

-- ---------------------------------------------------------------------
-- 4. mon_terrain : le titulaire de chaque ligne
-- ---------------------------------------------------------------------
-- Le type de retour change : `create or replace` ne le permet pas.
drop function if exists mon_terrain(uuid);

create function mon_terrain(p_evenement uuid)
returns table (
  genre text, id uuid, reference text, titre text, detail text,
  priorite text, statut text, latitude double precision, longitude double precision,
  pour_moi boolean, horodatage timestamptz, titulaire text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with moi as (
    select m.id, m.equipe_id
    from membres_evenement m
    where m.evenement_id = p_evenement and m.user_id = auth.uid()
      and m.actif and m.deleted_at is null
    limit 1
  ),
  tout as (
    select 'mission'::text as genre, m.id, m.reference, m.titre, m.description as detail,
           m.priorite::text as priorite, m.statut::text as statut,
           m.latitude, m.longitude,
           coalesce(m.membre_id = (select id from moi), false) as pour_moi,
           m.created_at as horodatage,
           -- (107) Qui tient la ligne. Null quand personne : c'est
           -- l'appel au volontariat, l'écran propose « Je prends ».
           (select t.nom_affiche from membres_evenement t where t.id = m.membre_id) as titulaire
    from missions m
    where m.evenement_id = p_evenement and m.deleted_at is null
      and m.statut not in ('resolue','annulee')
      and (
        m.membre_id = (select id from moi)
        or (m.equipe_id is not null and m.equipe_id = (select equipe_id from moi))
        or (m.membre_id is null and m.equipe_id is null)
      )

    union all

    select 'transport', t.id, t.reference,
           coalesce(t.depart_libre,'?') || ' → ' || coalesce(t.arrivee_libre,'?'),
           t.nb_personnes || ' pers. ' || coalesce(t.motif,''),
           t.priorite::text, t.statut::text, null, null,
           coalesce(t.chauffeur_id = (select id from moi), false),
           t.created_at,
           (select c.nom_affiche from membres_evenement c where c.id = t.chauffeur_id)
    from transports t
    where t.evenement_id = p_evenement and t.deleted_at is null
      and t.statut not in ('resolue','annulee')
      and (t.chauffeur_id = (select id from moi) or t.chauffeur_id is null)

    union all

    -- Contrairement aux missions, une action SANS responsable n'apparaît
    -- chez personne. Une demande sans titulaire est un appel au
    -- volontariat ; une action de préparation sans titulaire est un
    -- oubli, et l'afficher dans la liste de chacun n'y changerait rien.
    select 'jalon', j.id, j.code, j.libelle,
           coalesce(j.commentaire, j.categorie),
           case when j.critique then 'P1' else 'P3' end,
           j.statut::text, null, null,
           true,
           coalesce(j.echeance, j.created_at),
           null
    from jalons j
    where j.evenement_id = p_evenement and j.deleted_at is null
      and j.statut in ('a_venir','en_cours')
      and j.responsable_membre_id = (select id from moi)
  )
  select * from tout
  order by pour_moi desc, priorite, horodatage;
$$;

revoke all on function mon_terrain(uuid) from public, anon;
grant execute on function mon_terrain(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Transports : prise en main par un chauffeur, comme une mission
-- ---------------------------------------------------------------------
drop policy if exists transports_modification on transports;
create policy transports_modification on transports
  for update to authenticated
  using (
    a_permission(evenement_id, 'logistique', 'modifier')
    or (
      a_permission(evenement_id, 'missions', 'modifier')
      and (
        chauffeur_id is null
        or chauffeur_id in (
          select m.id from membres_evenement m
          where m.evenement_id = transports.evenement_id
            and m.user_id = (select auth.uid()) and m.deleted_at is null
        )
      )
    )
  )
  with check (
    a_permission(evenement_id, 'logistique', 'modifier')
    or (
      a_permission(evenement_id, 'missions', 'modifier')
      and chauffeur_id in (
        select m.id from membres_evenement m
        where m.evenement_id = transports.evenement_id
          and m.user_id = (select auth.uid()) and m.deleted_at is null
      )
    )
  );

-- ---------------------------------------------------------------------
-- 6. Traces : un référentiel
-- ---------------------------------------------------------------------
drop policy if exists traces_creation on traces;
drop policy if exists traces_modification on traces;
create policy traces_creation on traces
  for insert to authenticated
  with check (a_permission(evenement_id, 'referentiels', 'creer'));
create policy traces_modification on traces
  for update to authenticated
  using (a_permission(evenement_id, 'referentiels', 'modifier'))
  with check (a_permission(evenement_id, 'referentiels', 'modifier'));

-- ---------------------------------------------------------------------
-- 7. evenement_public : le SOS est-il ouvert ?
-- ---------------------------------------------------------------------
drop function if exists evenement_public(uuid);

create function evenement_public(p_jeton uuid)
returns table (nom text, logo_url text, sos_actif boolean, phase text, mode_parcours text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select e.nom, e.logo_url,
         coalesce((e.modules ->> 'sos_participants')::boolean, false),
         e.phase::text, e.mode_parcours::text
  from evenements e
  where e.jeton_public = p_jeton and e.deleted_at is null;
$$;

revoke all on function evenement_public(uuid) from public;
grant execute on function evenement_public(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Reprendre un groupe de travail comme équipe — en une fois
-- ---------------------------------------------------------------------
create or replace function reprendre_groupe_comme_equipe(p_groupe uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_g        groupes_travail%rowtype;
  v_existant equipes%rowtype;
  v_base     text;
  v_code     text;
  v_i        integer;
  v_equipe   uuid;
  v_affectes integer;
  v_deja     integer;
begin
  select * into v_g from groupes_travail where id = p_groupe and deleted_at is null;
  if not found then
    raise exception 'Groupe de travail introuvable' using errcode = 'P0002';
  end if;

  if not a_permission(v_g.evenement_id, 'equipes', 'creer') then
    raise exception 'Reprise refusée : il faut pouvoir créer des équipes sur cet événement'
      using errcode = '42501';
  end if;

  -- Un groupe n'a qu'une équipe (index unique de la 094) : la reprise
  -- est idempotente, on rend l'équipe existante sans rien refaire.
  select * into v_existant from equipes
  where groupe_travail_id = p_groupe and deleted_at is null;
  if found then
    return jsonb_build_object(
      'equipe_id', v_existant.id, 'code', v_existant.code,
      'membres_affectes', 0, 'deja_en_equipe', 0, 'existait', true);
  end if;

  -- Code : le nom en capitales sans accent ni ponctuation, six signes,
  -- puis un suffixe si le code est déjà pris — même règle que l'écran.
  v_base := upper(regexp_replace(
    translate(v_g.nom, 'àâäáãåéèêëíìîïóòôöõúùûüýÿçñÀÂÄÁÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÝÇÑ',
                       'aaaaaaeeeeiiiiooooouuuuyycnAAAAAAEEEEIIIIOOOOOUUUUYCN'),
    '[^A-Za-z0-9]', '', 'g'));
  v_base := coalesce(nullif(substr(v_base, 1, 6), ''), 'GRP');
  v_code := v_base;
  v_i := 2;
  while exists (select 1 from equipes where evenement_id = v_g.evenement_id and upper(code) = v_code) loop
    v_code := substr(v_base, 1, 5) || v_i;
    v_i := v_i + 1;
    if v_i > 99 then
      v_code := substr(v_base, 1, 3) || to_char(clock_timestamp(), 'SSMS');
      exit;
    end if;
  end loop;

  insert into equipes (evenement_id, code, nom, description, responsable_id, groupe_travail_id)
  values (v_g.evenement_id, v_code, v_g.nom, v_g.objet, v_g.pilote_membre_id, p_groupe)
  returning id into v_equipe;

  -- Les membres du groupe rejoignent l'équipe — sauf ceux qui en ont
  -- déjà une autre : une affectation existante n'est jamais écrasée
  -- en silence, elle est comptée et rendue.
  update membres_evenement m
  set equipe_id = v_equipe, updated_at = now()
  where m.evenement_id = v_g.evenement_id
    and m.deleted_at is null
    and m.equipe_id is null
    and m.id in (select mg.membre_id from membres_groupe_travail mg where mg.groupe_id = p_groupe);
  get diagnostics v_affectes = row_count;

  select count(*) into v_deja
  from membres_evenement m
  where m.evenement_id = v_g.evenement_id and m.deleted_at is null
    and m.equipe_id is not null and m.equipe_id <> v_equipe
    and m.id in (select mg.membre_id from membres_groupe_travail mg where mg.groupe_id = p_groupe);

  perform journaliser(v_g.evenement_id, 'rh', 'equipe',
    'Groupe de travail « ' || v_g.nom || ' » repris comme équipe ' || v_code
      || ' — ' || v_affectes || ' membre(s) affecté(s)'
      || case when v_deja > 0 then ', ' || v_deja || ' déjà dans une autre équipe' else '' end,
    'notable'::importance_journal, 'equipe', v_equipe, v_code);

  return jsonb_build_object(
    'equipe_id', v_equipe, 'code', v_code,
    'membres_affectes', v_affectes, 'deja_en_equipe', v_deja, 'existait', false);
end;
$$;

revoke all on function reprendre_groupe_comme_equipe(uuid) from public, anon;
grant execute on function reprendre_groupe_comme_equipe(uuid) to authenticated, service_role;

commit;

-- =====================================================================
-- VÉRIFICATION — droits.sql, blocs O à T :
--   O. un coordinateur remplace un logo existant (upsert) ;
--   P. un membre retiré revient par l'exploitant et par un code ;
--   Q. une action « coordination » est invisible d'un chef d'équipe ;
--   R. un bénévole prend un transport sans chauffeur, ne réattribue
--      pas celui d'un autre ; mon_terrain renvoie le titulaire ;
--   S. la reprise d'un groupe crée l'équipe et affecte ses membres ;
--   T. le responsable d'une action la fait avancer, pas une autre.
-- =====================================================================
