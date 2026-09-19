-- =====================================================================
-- 106 — LE LIEN AUTORITÉ NE NOMME PERSONNE
--
-- Deux défauts trouvés à l'audit du 18/09, réglés ensemble parce
-- qu'ils touchent la même fonction.
--
-- 1. `situation_autorite` renvoyait TOUTES les alertes actives, dont
--    celle qu'un MAYDAY crée : son titre porte le nom de l'intervenant,
--    son message sa position GPS. Contraire au contrat de la page
--    (« jamais de personnes »), et à ce qu'on doit à quelqu'un en
--    difficulté : que son nom ne parte pas sur un lien sans compte. Ces
--    alertes sont retirées du flux ; l'autorité reçoit à la place un
--    compte `maydays_en_cours` — elle a besoin de savoir qu'un
--    intervenant est en difficulté, pas de savoir qui.
--
-- 2. `groupes_sans_nouvelles` et `jauge_courante` (voir 104) devaient
--    vérifier l'appartenance… mais la page autorité les appelle sans
--    compte. Elles sont donc dédoublées : une version `_interne`, sans
--    contrôle et sans droit d'exécution pour personne, réservée aux
--    fonctions serveur qui ont fait leur propre contrôle (ici, le
--    jeton) ; et la version publique, vérifiée, que l'application
--    appelle. Même nom, même signature : le front ne change pas.
--
-- Tout dans une seule transaction : à aucun moment le lien autorité
-- n'appelle une fonction qui lui refuserait l'accès.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Les internes : corps repris tels quels (jauge : 016 ; groupes sans
-- nouvelles : 018).
-- ---------------------------------------------------------------------
create or replace function groupes_sans_nouvelles_interne(p_evenement uuid, p_minutes integer default 45)
returns table (
  groupe_id uuid, code text, nom text, effectif integer, dernier_lieu text,
  dernier_passage timestamptz, minutes_ecoulees integer, jamais_pointe boolean,
  accompagnateur text, contact text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select g.id, g.code, g.nom, coalesce(g.effectif_reel, g.effectif_prevu),
         l.nom, g.dernier_passage,
         round(extract(epoch from (clock_timestamp() -
           coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at)))/60)::int,
         (g.dernier_passage is null),
         coalesce(m.nom_affiche, g.accompagnateur_libre), g.contact
  from groupes g
  left join lieux l on l.id = g.dernier_lieu_id
  left join membres_evenement m on m.id = g.accompagnateur_id
  where g.evenement_id = p_evenement
    and g.deleted_at is null
    and g.statut in ('parti','en_cours')
    and coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at)
        < clock_timestamp() - (p_minutes || ' minutes')::interval
  order by coalesce(g.dernier_passage, g.depart_reel, g.depart_prevu, g.created_at);
$$;

create or replace function jauge_courante_interne(p_evenement uuid)
returns integer
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when sens = 'entree' then nombre else -nombre end), 0)::int
  from comptages
  where evenement_id = p_evenement and deleted_at is null;
$$;

revoke all on function groupes_sans_nouvelles_interne(uuid, integer) from public, anon, authenticated;
revoke all on function jauge_courante_interne(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Les publiques : vérifiées, puis déléguées.
-- ---------------------------------------------------------------------
create or replace function groupes_sans_nouvelles(p_evenement uuid, p_minutes integer default 45)
returns table (
  groupe_id uuid, code text, nom text, effectif integer, dernier_lieu text,
  dernier_passage timestamptz, minutes_ecoulees integer, jamais_pointe boolean,
  accompagnateur text, contact text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exiger_membre(p_evenement);
  select * from groupes_sans_nouvelles_interne(p_evenement, p_minutes);
$$;

create or replace function jauge_courante(p_evenement uuid)
returns integer
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exiger_membre(p_evenement);
  select jauge_courante_interne(p_evenement);
$$;

-- ---------------------------------------------------------------------
-- La page autorité. Reprise de la 040 ; trois changements, marqués
-- « (106) ».
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

  update acces_autorite
  set nb_acces = nb_acces + 1, dernier_acces = clock_timestamp()
  where id = a.id;

  select jsonb_build_object(

    'destinataire', jsonb_build_object(
      'libelle', a.libelle, 'organisation', a.organisation),

    'evenement', (
      select jsonb_build_object('nom', e.nom, 'phase', e.phase,
                                'geometrie', e.geometrie, 'logo_url', e.logo_url)
      from evenements e where e.id = a.evenement_id),

    -- (106) Les alertes nées d'un MAYDAY ne sortent pas : elles nomment
    -- et localisent une personne.
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
      -- (106) Le fait, sans la personne.
      'maydays_en_cours', (select count(*) from maydays
        where evenement_id = a.evenement_id
          and statut in ('emis','accuse','en_cours'))),

    -- (106) Versions internes : le contrôle d'accès, c'est le jeton.
    'public', jsonb_build_object(
      'jauge', jauge_courante_interne(a.evenement_id),
      'sur_parcours', (select coalesce(sum(coalesce(effectif_reel, effectif_prevu)), 0)
        from groupes where evenement_id = a.evenement_id and deleted_at is null
          and statut in ('parti','en_cours')),
      'groupes_sans_nouvelles', (
        select count(*) from groupes_sans_nouvelles_interne(a.evenement_id, 45))),

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

-- Les droits sont conservés par `create or replace` ; réaffirmés pour
-- que la règle de la 090 reste lisible ici.
revoke all on function situation_autorite(uuid) from public;
grant execute on function situation_autorite(uuid) to anon, authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION
--
-- droits.sql, bloc N : un MAYDAY est émis par le coordinateur, la page
-- autorité est appelée, et son contenu ne contient ni le nom de
-- l'émetteur ni le mot MAYDAY, mais bien `maydays_en_cours = 1`.
-- =====================================================================
