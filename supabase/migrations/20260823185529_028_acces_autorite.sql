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

commit;