-- =====================================================================
-- Migration 035 : Mayday intervenant
-- ---------------------------------------------------------------------
-- Objet distinct du signalement : ce n'est pas un incident constaté,
-- c'est l'émetteur lui-même qui est en difficulté. Conséquences :
--
--   TOUT membre peut en émettre un, quel que soit son rôle. On ne
--   subordonne pas un appel au secours à une capacité — c'est la seule
--   écriture du système qui ignore la matrice.
--
--   Il crée automatiquement une alerte d'urgence : l'information doit
--   s'imposer à tous les écrans, pas attendre qu'on la consulte.
--
--   Il porte le canal radio de l'émetteur : le PC doit savoir sur quelle
--   fréquence le rappeler, et c'est la première chose qu'on cherche.
-- =====================================================================

begin;

create type statut_mayday as enum ('emis', 'accuse', 'en_cours', 'clos', 'annule');

create table maydays (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references evenements(id) on delete cascade,
  reference     text not null,

  membre_id     uuid references membres_evenement(id) on delete set null,
  emetteur_nom  text,
  indicatif     text,
  canal         text,

  motif         text,
  latitude      double precision,
  longitude     double precision,
  precision_m   double precision,

  statut        statut_mayday not null default 'emis',
  emis_le       timestamptz not null default clock_timestamp(),
  accuse_le     timestamptz,
  accuse_par    uuid references auth.users(id),
  clos_le       timestamptz,
  resolution    text,

  alerte_id     uuid references alertes(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),

  unique (evenement_id, reference)
);

create index idx_maydays_ouverts on maydays (evenement_id, emis_le desc)
  where statut in ('emis','accuse','en_cours');

create trigger tracabilite_maydays before insert or update on maydays
  for each row execute function trg_tracabilite_simple();

-- ---------------------------------------------------------------------
-- Émission — accessible à tout membre, sans condition de rôle
-- ---------------------------------------------------------------------
create or replace function emettre_mayday(
  p_evenement uuid,
  p_motif text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_precision_m double precision default null
)
returns table (reference text, emis_le timestamptz)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m membres_evenement%rowtype;
  v_ref text;
  v_alerte uuid;
  v_indicatif text;
  v_canal text;
  v_id uuid;
begin
  select * into m from membres_evenement
  where evenement_id = p_evenement and user_id = auth.uid()
    and actif and deleted_at is null;

  if not found then
    raise exception 'Non membre de cet événement' using errcode = '42501';
  end if;

  -- Indicatif et canal, repris du poste radio attribué s'il y en a un
  select a.indicatif, 'CH ' || c.numero into v_indicatif, v_canal
  from attributions a
  left join canaux_radio c on c.id = a.canal_id
  where a.evenement_id = p_evenement and a.membre_id = m.id
    and a.nature = 'radio' and a.rendu_le is null and a.deleted_at is null
  limit 1;

  select 'MAYDAY-' || lpad((count(*) + 1)::text, 2, '0') into v_ref
  from maydays where evenement_id = p_evenement;

  insert into alertes (evenement_id, niveau, titre, message, consigne)
  values (p_evenement, 'urgence',
    'MAYDAY — ' || coalesce(m.nom_affiche, 'intervenant') ||
      coalesce(' (' || v_indicatif || ')', ''),
    coalesce(p_motif, 'Intervenant en difficulté, motif non précisé') ||
      coalesce(' — position ' || round(p_latitude::numeric, 5) || ' / ' ||
               round(p_longitude::numeric, 5), ' — position inconnue'),
    'Le PC prend la main. Ne pas saturer la radio' ||
      coalesce(' — rappel sur ' || v_canal, '') || '.')
  returning id into v_alerte;

  insert into maydays (evenement_id, reference, membre_id, emetteur_nom,
                       indicatif, canal, motif, latitude, longitude,
                       precision_m, alerte_id)
  values (p_evenement, v_ref, m.id, m.nom_affiche, v_indicatif, v_canal,
          p_motif, p_latitude, p_longitude, p_precision_m, v_alerte)
  returning id into v_id;

  perform journaliser(p_evenement, 'securite', 'mayday',
    v_ref || ' émis par ' || coalesce(m.nom_affiche, 'intervenant') ||
    coalesce(' (' || v_indicatif || ')', '') ||
    coalesce(' : ' || p_motif, ''),
    'majeur'::importance_journal, 'mayday', v_id, v_ref);

  return query
    select mm.reference, mm.emis_le from maydays mm where mm.id = v_id;
end;
$$;

grant execute on function emettre_mayday(
  uuid, text, double precision, double precision, double precision
) to authenticated;

-- ---------------------------------------------------------------------
-- RLS : lecture par tout membre, traitement par l'encadrement
-- ---------------------------------------------------------------------
alter table maydays enable row level security;

create policy maydays_lecture on maydays for select to authenticated
  using (est_membre(evenement_id));

create policy maydays_modification on maydays for update to authenticated
  using (a_permission(evenement_id,'sos','modifier'))
  with check (a_permission(evenement_id,'sos','modifier'));

-- Clôture : lève l'alerte associée dans le même mouvement, pour qu'un
-- bandeau d'urgence ne survive jamais à la situation qui l'a causé.
create or replace function trg_cycle_mayday()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'accuse' and new.accuse_le is null then
      new.accuse_le := clock_timestamp();
      new.accuse_par := auth.uid();
    end if;
    if new.statut in ('clos','annule') then
      new.clos_le := coalesce(new.clos_le, clock_timestamp());
      if new.alerte_id is not null then
        update alertes set active = false,
               motif_levee = coalesce(new.resolution, 'Mayday clôturé')
        where id = new.alerte_id and active;
      end if;
    end if;
    perform journaliser(new.evenement_id, 'securite', 'mayday',
      new.reference || ' → ' || new.statut ||
      coalesce(' : ' || new.resolution, ''),
      'majeur'::importance_journal, 'mayday', new.id, new.reference);
  end if;
  return new;
end;
$$;

create trigger cycle_mayday before update on maydays
  for each row execute function trg_cycle_mayday();

commit;