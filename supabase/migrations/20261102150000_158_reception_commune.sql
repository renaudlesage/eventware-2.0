-- =====================================================================
-- 158 — RÉCEPTION DES MESSAGES DE LA COMMUNE (pont commune, partie A)
--
-- Eventware envoie déjà ses alertes à la commune (canaux_diffusion,
-- 042). Il n'avait aucun récepteur pour les messages que la commune lui
-- adresse (Crisiware : `envoyer_emission_evenement`). Cette migration
-- ajoute :
--   · `liaisons_commune` : par événement, la commune, le nom de
--     l'en-tête et le secret qu'elle devra présenter. Le secret n'est
--     stocké que haché : il s'affiche une seule fois, à la création ou
--     à la régénération, pour être transmis à la commune ;
--   · `messages_commune` : les messages reçus, en ajout seul, uniques
--     par référence (un envoi rejoué ne crée rien) ; qui a lu, et quand,
--     par `messages_commune_accuses` (modèle alertes_accuses, 122) ;
--   · `journal_receptions` : les rejets (secret absent ou faux,
--     événement inconnu, charge invalide, exercice refusé), sans jamais
--     le secret ;
--   · `recevoir_message_commune(jeton, en-têtes, charge)` : la réception
--     elle-même, appelée par l'Edge Function `reception-commune` avec la
--     clé de service. Un message reçu est aussi inscrit au journal
--     (entrée système).
-- Les invariants de l'exercice conjoint (partie B) sont déjà tenus ici :
--   I2. un événement réel n'accepte jamais un message marqué exercice ;
--   I3. un bac à sable n'accepte jamais un message non marqué exercice.
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Les tables
-- ---------------------------------------------------------------------
create table if not exists public.liaisons_commune (
  id                 uuid primary key default gen_random_uuid(),
  evenement_id       uuid not null references public.evenements(id) on delete cascade,
  commune            text not null,
  entete             text not null default 'X-Commune-Secret',
  secret_hash        text not null,                 -- sha256 du secret, jamais le secret
  actif              boolean not null default true,
  est_exercice       boolean not null default false,
  exercice_code      text,
  nb_messages        integer not null default 0,
  dernier_message_le timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  updated_by         uuid references auth.users(id),
  deleted_at         timestamptz,
  check (not est_exercice or exercice_code is not null)
);
comment on table public.liaisons_commune is
  'Liaison entrante depuis une commune (158) : en-tête et secret (haché) que la commune présente pour écrire dans messages_commune.';

create table if not exists public.messages_commune (
  id             uuid primary key default gen_random_uuid(),
  evenement_id   uuid not null references public.evenements(id) on delete cascade,
  liaison_id     uuid references public.liaisons_commune(id) on delete set null,
  reference      text not null,
  niveau         text not null check (niveau in ('information', 'vigilance', 'urgence', 'evacuation')),
  titre          text not null,
  message        text,
  consigne       text,
  incident_type  text,
  incident_phase text,
  emise_le       timestamptz,
  recu_le        timestamptz not null default now(),
  lu_par         uuid references auth.users(id),
  lu_le          timestamptz,
  est_exercice   boolean not null default false,
  exercice_code  text,
  unique (evenement_id, reference)
);
comment on table public.messages_commune is
  'Messages reçus de la commune (158). Ajout seul ; un envoi rejoué (même référence) ne crée rien.';

create table if not exists public.messages_commune_accuses (
  id           uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references public.evenements(id) on delete cascade,
  message_id   uuid not null references public.messages_commune(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id),
  nom          text,
  accuse_le    timestamptz not null default now(),
  unique (message_id, user_id)
);
comment on table public.messages_commune_accuses is 'Qui a lu un message de la commune, et quand (158).';

create table if not exists public.journal_receptions (
  id           uuid primary key default gen_random_uuid(),
  recu_le      timestamptz not null default now(),
  evenement_id uuid references public.evenements(id) on delete cascade,
  liaison_id   uuid references public.liaisons_commune(id) on delete set null,
  jeton_public uuid,
  motif        text not null check (motif in ('secret_absent', 'secret_faux', 'evenement_inconnu', 'charge_invalide', 'liaison_inactive', 'exercice_refuse')),
  detail       text
);
comment on table public.journal_receptions is 'Rejets de la réception des messages de la commune (158). Jamais le secret.';

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_liaisons_commune') then
    create trigger tracabilite_liaisons_commune before insert or update on public.liaisons_commune
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- Premier accusé : le message est « lu ». Le nom vient du membre.
create or replace function public.trg_accuse_message_commune() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.nom is null then
    select m.nom_affiche into new.nom from membres_evenement m
     where m.evenement_id = new.evenement_id and m.user_id = new.user_id and m.deleted_at is null limit 1;
  end if;
  update messages_commune set lu_par = new.user_id, lu_le = new.accuse_le where id = new.message_id and lu_le is null;
  return new;
end $$;
revoke execute on function public.trg_accuse_message_commune() from public, anon, authenticated;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'accuse_message_commune') then
    create trigger accuse_message_commune before insert on public.messages_commune_accuses
      for each row execute function public.trg_accuse_message_commune();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 2. Créer une liaison, régénérer son secret
-- ---------------------------------------------------------------------
create or replace function public.creer_liaison_commune(p_evenement uuid, p_commune text, p_entete text default 'X-Commune-Secret',
                                                        p_est_exercice boolean default false, p_exercice_code text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_secret text; v_id uuid;
begin
  if not a_permission(p_evenement, 'alertes', 'creer') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Création d''une liaison non autorisée' using errcode = '42501';
  end if;
  if coalesce(trim(p_commune), '') = '' then raise exception 'Commune requise' using errcode = '22023'; end if;
  if coalesce(trim(p_entete), '') = '' or p_entete !~ '^[A-Za-z][A-Za-z0-9-]*$' then
    raise exception 'Nom d''en-tête invalide' using errcode = '22023';
  end if;
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  insert into liaisons_commune (evenement_id, commune, entete, secret_hash, est_exercice, exercice_code)
  values (p_evenement, trim(p_commune), trim(p_entete), encode(extensions.digest(v_secret, 'sha256'), 'hex'),
          coalesce(p_est_exercice, false), nullif(trim(p_exercice_code), ''))
  returning id into v_id;
  perform journaliser(p_evenement, 'securite', 'commune', format('Liaison entrante créée pour la commune de %s', trim(p_commune)), 'notable', 'liaisons_commune', v_id, null);
  return jsonb_build_object('id', v_id, 'secret', v_secret);
end $$;

create or replace function public.regenerer_secret_liaison(p_liaison uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v liaisons_commune%rowtype; v_secret text;
begin
  select * into v from liaisons_commune where id = p_liaison and deleted_at is null;
  if v.id is null then raise exception 'Liaison inconnue' using errcode = 'P0002'; end if;
  if not a_permission(v.evenement_id, 'alertes', 'creer') and not a_tout_pouvoir(v.evenement_id) then
    raise exception 'Régénération non autorisée' using errcode = '42501';
  end if;
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  update liaisons_commune set secret_hash = encode(extensions.digest(v_secret, 'sha256'), 'hex') where id = v.id;
  perform journaliser(v.evenement_id, 'securite', 'commune', format('Secret de la liaison « %s » régénéré', v.commune), 'notable', 'liaisons_commune', v.id, null);
  return jsonb_build_object('id', v.id, 'secret', v_secret);
end $$;

-- ---------------------------------------------------------------------
-- 3. Recevoir : appelée par l'Edge Function avec la clé de service
--    p_entetes : les en-têtes « X-… » de la requête, en minuscules.
--    Rien n'est levé : chaque refus est journalisé et rendu dans le
--    résultat, pour que la fonction réponde le bon code HTTP.
-- ---------------------------------------------------------------------
create or replace function public.recevoir_message_commune(p_jeton_public uuid, p_entetes jsonb, p_charge jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  l liaisons_commune%rowtype;
  r liaisons_commune%rowtype;
  v_presente boolean := false;
  v_secret text;
  v_code text := p_charge -> 'exercice' ->> 'code';
  v_bac boolean;
  v_alerte jsonb := p_charge -> 'alerte';
  v_niveau text := v_alerte ->> 'niveau';
  v_ref text := v_alerte ->> 'reference';
  v_id uuid;
  v_importance importance_journal;
begin
  if p_jeton_public is null then
    insert into journal_receptions (motif, detail) values ('charge_invalide', 'evenement.jeton_public absent');
    return jsonb_build_object('statut', 'refuse', 'motif', 'charge_invalide', 'detail', 'evenement.jeton_public absent');
  end if;
  select * into ev from evenements where jeton_public = p_jeton_public and deleted_at is null;
  if ev.id is null then
    insert into journal_receptions (motif, jeton_public, detail) values ('evenement_inconnu', p_jeton_public, 'aucun événement pour ce jeton');
    return jsonb_build_object('statut', 'refuse', 'motif', 'evenement_inconnu');
  end if;

  -- La liaison : celle dont l'en-tête est présent et dont le secret correspond.
  -- (`l` ne reçoit une ligne QUE sur correspondance du secret.)
  l := null;
  for r in select * from liaisons_commune where evenement_id = ev.id and deleted_at is null and actif order by created_at loop
    v_secret := p_entetes ->> lower(r.entete);
    if v_secret is null then continue; end if;
    v_presente := true;
    if encode(extensions.digest(v_secret, 'sha256'), 'hex') = r.secret_hash then
      l := r;
      exit;
    end if;
  end loop;
  if l.id is null then
    insert into journal_receptions (evenement_id, jeton_public, motif, detail)
    values (ev.id, p_jeton_public, case when v_presente then 'secret_faux' else 'secret_absent' end,
            case when v_presente then 'un en-tête de liaison est présent mais son secret ne correspond à aucune liaison active'
                 else 'aucun en-tête de liaison active dans la requête' end);
    return jsonb_build_object('statut', 'refuse', 'motif', case when v_presente then 'secret_faux' else 'secret_absent' end);
  end if;

  -- Invariants de l'exercice conjoint : I2 (réel ⇏ exercice), I3 (bac à sable ⇏ réel).
  v_bac := exists (select 1 from exercices x where x.bac_a_sable_id = ev.id and x.deleted_at is null);
  if v_code is not null and not (l.est_exercice and l.exercice_code = v_code and v_bac) then
    insert into journal_receptions (evenement_id, liaison_id, jeton_public, motif, detail)
    values (ev.id, l.id, p_jeton_public, 'exercice_refuse',
            case when not v_bac then 'message marqué exercice adressé à un événement réel'
                 when not l.est_exercice then 'message marqué exercice sur une liaison réelle'
                 else 'code d''exercice différent de celui de la liaison' end);
    return jsonb_build_object('statut', 'refuse', 'motif', 'exercice_refuse');
  end if;
  if v_code is null and (v_bac or l.est_exercice) then
    insert into journal_receptions (evenement_id, liaison_id, jeton_public, motif, detail)
    values (ev.id, l.id, p_jeton_public, 'exercice_refuse',
            case when v_bac then 'message non marqué exercice adressé à un bac à sable' else 'message non marqué exercice sur une liaison d''exercice' end);
    return jsonb_build_object('statut', 'refuse', 'motif', 'exercice_refuse');
  end if;

  -- La charge
  if v_alerte is null or coalesce(v_ref, '') = '' or coalesce(v_alerte ->> 'titre', '') = ''
     or v_niveau not in ('information', 'vigilance', 'urgence', 'evacuation') then
    insert into journal_receptions (evenement_id, liaison_id, jeton_public, motif, detail)
    values (ev.id, l.id, p_jeton_public, 'charge_invalide', 'alerte.reference, alerte.titre et alerte.niveau (information|vigilance|urgence|evacuation) sont requis');
    return jsonb_build_object('statut', 'refuse', 'motif', 'charge_invalide');
  end if;

  insert into messages_commune (evenement_id, liaison_id, reference, niveau, titre, message, consigne, incident_type, incident_phase, emise_le, est_exercice, exercice_code)
  values (ev.id, l.id, v_ref, v_niveau, v_alerte ->> 'titre', v_alerte ->> 'message', v_alerte ->> 'consigne',
          p_charge -> 'incident' ->> 'type', p_charge -> 'incident' ->> 'phase',
          nullif(v_alerte ->> 'emise_le', '')::timestamptz, v_code is not null, v_code)
  on conflict (evenement_id, reference) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('statut', 'doublon', 'reference', v_ref);
  end if;

  v_importance := case v_niveau when 'urgence' then 'majeur' when 'evacuation' then 'majeur' when 'vigilance' then 'notable' else 'routine' end;
  insert into journal (evenement_id, source, module, categorie, texte, importance, objet_type, objet_id, objet_ref, auteur_nom, phase)
  values (ev.id, 'systeme', 'securite', 'commune',
          format('%sMessage de la commune de %s (%s) : %s%s', case when v_code is not null then '[EXERCICE] ' else '' end,
                 l.commune, v_niveau, v_alerte ->> 'titre',
                 case when coalesce(v_alerte ->> 'consigne', '') <> '' then ' — consigne : ' || (v_alerte ->> 'consigne') else '' end),
          v_importance, 'messages_commune', v_id, v_ref, 'Commune de ' || l.commune, ev.phase);
  update liaisons_commune set nb_messages = nb_messages + 1, dernier_message_le = now() where id = l.id;

  return jsonb_build_object('statut', 'recu', 'reference', v_ref, 'message_id', v_id, 'niveau', v_niveau);
end $$;

comment on function public.recevoir_message_commune(uuid, jsonb, jsonb) is
  'Réception d''un message de la commune (158), par l''Edge Function reception-commune (clé de service). Vérifie liaison et secret, tient I2/I3, idempotente par référence, journalise.';

revoke execute on function public.creer_liaison_commune(uuid, text, text, boolean, text), public.regenerer_secret_liaison(uuid) from public, anon;
grant  execute on function public.creer_liaison_commune(uuid, text, text, boolean, text), public.regenerer_secret_liaison(uuid) to authenticated;
revoke execute on function public.recevoir_message_commune(uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.recevoir_message_commune(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
alter table public.liaisons_commune enable row level security;
alter table public.messages_commune enable row level security;
alter table public.messages_commune_accuses enable row level security;
alter table public.journal_receptions enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'liaisons_commune' and policyname = 'liaisons_commune_lecture') then
    create policy liaisons_commune_lecture on public.liaisons_commune for select to authenticated
      using (deleted_at is null and (a_permission(evenement_id, 'alertes', 'creer') or a_tout_pouvoir(evenement_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'liaisons_commune' and policyname = 'liaisons_commune_modification') then
    create policy liaisons_commune_modification on public.liaisons_commune for update to authenticated
      using (a_permission(evenement_id, 'alertes', 'creer') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'alertes', 'creer') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'messages_commune' and policyname = 'messages_commune_lecture') then
    create policy messages_commune_lecture on public.messages_commune for select to authenticated
      using (est_membre(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'messages_commune_accuses' and policyname = 'messages_commune_accuses_lecture') then
    create policy messages_commune_accuses_lecture on public.messages_commune_accuses for select to authenticated
      using (est_membre(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'messages_commune_accuses' and policyname = 'messages_commune_accuses_creation') then
    create policy messages_commune_accuses_creation on public.messages_commune_accuses for insert to authenticated
      with check (user_id = auth.uid() and est_membre(evenement_id)
                  and exists (select 1 from messages_commune m where m.id = message_id and m.evenement_id = messages_commune_accuses.evenement_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'journal_receptions' and policyname = 'journal_receptions_lecture') then
    create policy journal_receptions_lecture on public.journal_receptions for select to authenticated
      using ((evenement_id is not null and a_tout_pouvoir(evenement_id)) or est_exploitant());
  end if;
end $p$;

revoke all on public.liaisons_commune, public.messages_commune, public.messages_commune_accuses, public.journal_receptions from public, anon;
-- Le secret haché ne se lit ni ne s'écrit depuis l'application : droits colonne par colonne.
revoke all on public.liaisons_commune from authenticated;
grant select (id, evenement_id, commune, entete, actif, est_exercice, exercice_code, nb_messages, dernier_message_le,
              created_at, updated_at, created_by, updated_by, deleted_at),
      update (commune, entete, actif, est_exercice, exercice_code, updated_at, updated_by)
   on public.liaisons_commune to authenticated;
grant select on public.messages_commune, public.journal_receptions to authenticated;
grant select, insert on public.messages_commune_accuses to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (réplique : outils/replique/tests/158.sql)
--   select creer_liaison_commune('<evenement>', 'Ferrières');   -- le secret, une seule fois
--   select recevoir_message_commune('<jeton_public>', '{"x-commune-secret":"<secret>"}',
--     '{"source":"crisiware","evenement":{"jeton_public":"…"},"alerte":{"reference":"r1","niveau":"urgence","titre":"Test"}}');
-- =====================================================================
