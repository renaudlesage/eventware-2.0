-- =====================================================================
-- 131 — DEMANDES DE PRIX (briefing du 26/10, migration 2 sur 2)
--
-- Une demande de prix appartient à un événement et consulte plusieurs
-- fournisseurs de l'annuaire (130) de son organisation. Lignes, offres
-- reçues, comparaison, décision tracée, commande ; le suivi passe par
-- un jalon (Préparation, Gantt, retards du tableau de bord), jamais par
-- un écran à part.
--
--   demandes_prix        — DP-01, objet, période, date limite, statut DÉRIVÉ.
--   demande_prix_lignes  — ce qu'on demande (désignation, quantité, unité).
--   consultations        — un fournisseur consulté ; l'offre reçue y vit.
--   offre_lignes         — le prix par ligne, pour la grille de comparaison.
--   commandes            — ce qui suit la décision : livrée, facturée, payée.
--
-- Le statut de la demande se déduit des consultations (déclencheur) :
-- aucune envoyée → brouillon ; ≥ 1 envoyée → envoyee ; ≥ 1 offre →
-- comparaison ; 1 retenue → decidee ; commande livrée ou fermeture à la
-- main → close. On ne le saisit pas, sauf `close`.
--
-- Montants : HT + taux de TVA, TTC calculé à l'affichage. Si des
-- `offre_lignes` existent, `montant_ht` est recalculé ; sinon il est
-- saisi tel quel (« 1 850 € forfait »).
--
-- Pas d'e-mail sortant : l'application ouvre un `mailto:` et appelle
-- `marquer_envoyee`. Rien ne sort vers l'autorité ni la vitrine.
--
-- Idempotente : chaque objet est créé « s'il n'existe pas », chaque
-- fonction est `create or replace`. Aucun DROP ; les lignes d'offre et
-- de demande se suppriment par DELETE (pas de deleted_at sur
-- offre_lignes), le reste par suppression logique.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
do $e$
begin
  if not exists (select 1 from pg_type where typname = 'statut_demande_prix') then
    create type public.statut_demande_prix as enum ('brouillon', 'envoyee', 'comparaison', 'decidee', 'close');
  end if;
  if not exists (select 1 from pg_type where typname = 'statut_consultation') then
    create type public.statut_consultation as enum ('a_envoyer', 'envoyee', 'relancee', 'offre_recue', 'retenue', 'ecartee', 'sans_reponse');
  end if;
  if not exists (select 1 from pg_type where typname = 'statut_commande') then
    create type public.statut_commande as enum ('commandee', 'livree', 'facturee', 'payee');
  end if;
end $e$;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.demandes_prix (
  id                    uuid primary key default gen_random_uuid(),
  evenement_id          uuid not null references public.evenements(id) on delete cascade,
  reference             text not null default '',          -- DP-01, posé par déclencheur
  objet                 text not null,
  categorie             text,                              -- code de CATEGORIES_FOURNISSEUR
  description           text,
  date_limite           timestamptz,                       -- réponse attendue
  livraison_de          timestamptz,
  livraison_a           timestamptz,
  lieu_id               uuid references public.lieux(id) on delete set null,
  groupe_travail_id     uuid references public.groupes_travail(id) on delete set null,
  responsable_membre_id uuid references public.membres_evenement(id) on delete set null,
  statut                public.statut_demande_prix not null default 'brouillon',
  jalon_id              uuid references public.jalons(id) on delete set null,
  decision_motif        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  updated_by            uuid references auth.users(id),
  deleted_at            timestamptz,
  origine               public.origine_donnee not null default 'humain',
  unique (evenement_id, reference)
);
create index if not exists idx_demandes_prix_evenement on public.demandes_prix (evenement_id) where deleted_at is null;
comment on table public.demandes_prix is
  'Demande de prix d''un événement (131) : objet, lignes, consultations ; statut dérivé des consultations ; suivie par un jalon.';

create table if not exists public.demande_prix_lignes (
  id            uuid primary key default gen_random_uuid(),
  demande_id    uuid not null references public.demandes_prix(id) on delete cascade,
  ordre         integer not null default 0,
  designation   text not null,
  quantite      numeric not null default 1,
  unite         text not null default 'pièce',
  precision     text,
  materiel_id   uuid references public.materiel(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  deleted_at    timestamptz
);
create index if not exists idx_demande_prix_lignes_demande on public.demande_prix_lignes (demande_id) where deleted_at is null;

create table if not exists public.consultations (
  id               uuid primary key default gen_random_uuid(),
  demande_id       uuid not null references public.demandes_prix(id) on delete cascade,
  evenement_id     uuid not null references public.evenements(id) on delete cascade,   -- dénormalisé pour la RLS
  fournisseur_id   uuid not null references public.fournisseurs(id) on delete restrict,
  contact_id       uuid references public.fournisseur_contacts(id) on delete set null,
  statut           public.statut_consultation not null default 'a_envoyer',
  envoyee_le       timestamptz,
  relances         jsonb not null default '[]',             -- [{le, par, moyen, note}]
  offre_recue_le   timestamptz,
  offre_validite   date,
  offre_delai      text,
  offre_conditions text,
  montant_ht       numeric(12,2),
  taux_tva         numeric(5,2) not null default 21,
  commentaire      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_by       uuid references auth.users(id),
  deleted_at       timestamptz,
  unique (demande_id, fournisseur_id)
);
create index if not exists idx_consultations_evenement on public.consultations (evenement_id) where deleted_at is null;
create index if not exists idx_consultations_fournisseur on public.consultations (fournisseur_id) where deleted_at is null;

create table if not exists public.offre_lignes (
  id               uuid primary key default gen_random_uuid(),
  consultation_id  uuid not null references public.consultations(id) on delete cascade,
  ligne_id         uuid not null references public.demande_prix_lignes(id) on delete cascade,
  prix_unitaire_ht numeric(12,2),
  quantite_offerte numeric,
  remarque         text,
  unique (consultation_id, ligne_id)
);

create table if not exists public.commandes (
  id                    uuid primary key default gen_random_uuid(),
  evenement_id          uuid not null references public.evenements(id) on delete cascade,
  consultation_id       uuid not null references public.consultations(id) on delete restrict,
  reference_fournisseur text,
  statut                public.statut_commande not null default 'commandee',
  commandee_le          timestamptz not null default now(),
  livree_le             timestamptz,
  facturee_le           timestamptz,
  montant_facture_ht    numeric(12,2),
  commentaire           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  updated_by            uuid references auth.users(id),
  deleted_at            timestamptz
);
create index if not exists idx_commandes_evenement on public.commandes (evenement_id) where deleted_at is null;

-- Traçabilité
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_demandes_prix' and tgrelid = 'public.demandes_prix'::regclass) then
    create trigger tracabilite_demandes_prix before insert or update on public.demandes_prix
      for each row execute function public.trg_tracabilite();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_demande_prix_lignes' and tgrelid = 'public.demande_prix_lignes'::regclass) then
    create trigger tracabilite_demande_prix_lignes before insert or update on public.demande_prix_lignes
      for each row execute function public.trg_tracabilite_simple();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_consultations' and tgrelid = 'public.consultations'::regclass) then
    create trigger tracabilite_consultations before insert or update on public.consultations
      for each row execute function public.trg_tracabilite_simple();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_commandes' and tgrelid = 'public.commandes'::regclass) then
    create trigger tracabilite_commandes before insert or update on public.commandes
      for each row execute function public.trg_tracabilite_simple();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 3. Référence DP-01 (copié de trg_reference_recherche, REC-)
-- ---------------------------------------------------------------------
create or replace function public.trg_reference_demande_prix()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if new.reference is not null and new.reference <> '' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('demande_prix:' || new.evenement_id::text));
  select coalesce(max(substring(reference from '^DP-([0-9]+)$')::int), 0) + 1
    into v_n from demandes_prix where evenement_id = new.evenement_id;
  new.reference := 'DP-' || lpad(v_n::text, 2, '0');
  return new;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'reference_demande_prix' and tgrelid = 'public.demandes_prix'::regclass) then
    create trigger reference_demande_prix before insert on public.demandes_prix
      for each row execute function public.trg_reference_demande_prix();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 4. Cohérence d'une consultation : l'événement est celui de la demande,
--    le fournisseur appartient à l'organisation de l'événement.
-- ---------------------------------------------------------------------
create or replace function public.trg_consultation_coherente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ev uuid; v_org uuid;
begin
  select evenement_id into v_ev from demandes_prix where id = new.demande_id;
  if v_ev is null then
    raise exception 'Demande de prix inconnue' using errcode = 'P0002';
  end if;
  new.evenement_id := v_ev;
  select organisation_id into v_org from evenements where id = v_ev;
  if not exists (select 1 from fournisseurs f where f.id = new.fournisseur_id and f.organisation_id = v_org and f.deleted_at is null) then
    raise exception 'Le fournisseur n''appartient pas à l''organisation de l''événement' using errcode = '23514';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from fournisseur_contacts c where c.id = new.contact_id and c.fournisseur_id = new.fournisseur_id) then
    new.contact_id := null;
  end if;
  if new.statut = 'offre_recue' and new.offre_recue_le is null then new.offre_recue_le := now(); end if;
  return new;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'consultation_coherente' and tgrelid = 'public.consultations'::regclass) then
    create trigger consultation_coherente before insert or update on public.consultations
      for each row execute function public.trg_consultation_coherente();
  end if;
end $t$;

-- Une commande porte l'événement de sa consultation.
create or replace function public.trg_commande_coherente()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ev uuid;
begin
  select evenement_id into v_ev from consultations where id = new.consultation_id;
  if v_ev is null then raise exception 'Consultation inconnue' using errcode = 'P0002'; end if;
  new.evenement_id := v_ev;
  if new.statut in ('livree', 'facturee', 'payee') and new.livree_le is null then new.livree_le := now(); end if;
  if new.statut in ('facturee', 'payee') and new.facturee_le is null then new.facturee_le := now(); end if;
  return new;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'commande_coherente' and tgrelid = 'public.commandes'::regclass) then
    create trigger commande_coherente before insert or update on public.commandes
      for each row execute function public.trg_commande_coherente();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 5. Montant d'une offre : recalculé depuis ses lignes dès qu'il y en a
-- ---------------------------------------------------------------------
create or replace function public.trg_offre_ligne_montant()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cons uuid; v_total numeric;
begin
  v_cons := coalesce(new.consultation_id, old.consultation_id);
  if exists (select 1 from offre_lignes o where o.consultation_id = v_cons) then
    select sum(o.prix_unitaire_ht * coalesce(o.quantite_offerte, l.quantite)) into v_total
    from offre_lignes o join demande_prix_lignes l on l.id = o.ligne_id
    where o.consultation_id = v_cons and o.prix_unitaire_ht is not null;
    update consultations set montant_ht = v_total where id = v_cons and montant_ht is distinct from v_total;
  end if;
  return null;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'offre_ligne_montant' and tgrelid = 'public.offre_lignes'::regclass) then
    create trigger offre_ligne_montant after insert or update or delete on public.offre_lignes
      for each row execute function public.trg_offre_ligne_montant();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 6. Statut dérivé de la demande, et jalon de suivi
-- ---------------------------------------------------------------------
create or replace function public.statut_demande_derive(p_demande uuid)
returns public.statut_demande_prix language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from consultations c where c.demande_id = p_demande and c.deleted_at is null and c.statut = 'retenue') then 'decidee'
    when exists (select 1 from consultations c where c.demande_id = p_demande and c.deleted_at is null and c.statut = 'offre_recue') then 'comparaison'
    when exists (select 1 from consultations c where c.demande_id = p_demande and c.deleted_at is null and c.statut <> 'a_envoyer') then 'envoyee'
    else 'brouillon'
  end::public.statut_demande_prix;
$$;

-- Une saisie directe du statut est ramenée au statut dérivé, sauf `close`
-- (fermeture à la main). Les mises à jour venant des déclencheurs
-- (profondeur > 1) passent.
create or replace function public.trg_demande_prix_statut()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut
     and pg_trigger_depth() <= 1 and new.statut <> 'close' then
    new.statut := statut_demande_derive(new.id);
  end if;
  if tg_op = 'INSERT' and new.statut <> 'brouillon' then
    new.statut := 'brouillon';
  end if;
  return new;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'demande_prix_statut' and tgrelid = 'public.demandes_prix'::regclass) then
    create trigger demande_prix_statut before insert or update on public.demandes_prix
      for each row execute function public.trg_demande_prix_statut();
  end if;
end $t$;

-- Après chaque écriture d'une consultation : statut de la demande, jalon.
--   · première consultation envoyée + date limite ⇒ jalon « Offres
--     attendues — <objet> » à l'échéance, dans le groupe et pour le
--     responsable de la demande ;
--   · plus rien d'envoyé en attente, ou décision ⇒ jalon fait ;
--   · une consultation repasse en attente ⇒ jalon à venir.
create or replace function public.trg_consultation_suivi()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d demandes_prix%rowtype; v_statut statut_demande_prix; v_jalon uuid; v_code text;
  v_attente boolean; v_recue boolean;
begin
  select * into d from demandes_prix where id = new.demande_id;
  if d.id is null then return null; end if;

  if d.statut <> 'close' then
    v_statut := statut_demande_derive(d.id);
    if v_statut <> d.statut then
      update demandes_prix set statut = v_statut where id = d.id;
      d.statut := v_statut;
    end if;
  end if;

  if new.statut in ('envoyee', 'relancee') and d.jalon_id is null and d.date_limite is not null and d.deleted_at is null then
    v_code := d.reference || '-OFFRES';
    if exists (select 1 from jalons j where j.evenement_id = d.evenement_id and j.code = v_code) then
      v_code := v_code || '-' || substr(gen_random_uuid()::text, 1, 4);
    end if;
    insert into jalons (evenement_id, code, libelle, categorie, echeance, groupe_travail_id, responsable_membre_id, statut, origine)
    values (d.evenement_id, v_code, 'Offres attendues — ' || d.objet, 'fournisseur', d.date_limite,
            d.groupe_travail_id, d.responsable_membre_id, 'a_venir', 'humain')
    returning id into v_jalon;
    update demandes_prix set jalon_id = v_jalon where id = d.id;
    d.jalon_id := v_jalon;
  end if;

  if d.jalon_id is not null then
    v_attente := exists (select 1 from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut in ('envoyee', 'relancee'));
    v_recue := exists (select 1 from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut in ('offre_recue', 'retenue', 'ecartee', 'sans_reponse'));
    if (not v_attente and v_recue) or d.statut in ('decidee', 'close') then
      update jalons set statut = 'fait' where id = d.jalon_id and statut in ('a_venir', 'en_cours');
    elsif v_attente then
      update jalons set statut = 'a_venir' where id = d.jalon_id and statut = 'fait';
    end if;
  end if;
  return null;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'consultation_suivi' and tgrelid = 'public.consultations'::regclass) then
    create trigger consultation_suivi after insert or update on public.consultations
      for each row execute function public.trg_consultation_suivi();
  end if;
end $t$;

-- La demande change : le jalon suit (échéance, libellé, groupe,
-- responsable) ; supprimée ⇒ jalon annulé ; close ⇒ jalon fait.
create or replace function public.trg_demande_prix_jalon()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.jalon_id is null then return null; end if;
  if new.deleted_at is not null and old.deleted_at is null then
    update jalons set statut = 'annule' where id = new.jalon_id and statut in ('a_venir', 'en_cours');
    return null;
  end if;
  if new.date_limite is distinct from old.date_limite and new.date_limite is not null then
    update jalons set echeance = new.date_limite where id = new.jalon_id;
  end if;
  if new.objet is distinct from old.objet then
    update jalons set libelle = 'Offres attendues — ' || new.objet where id = new.jalon_id;
  end if;
  if new.groupe_travail_id is distinct from old.groupe_travail_id or new.responsable_membre_id is distinct from old.responsable_membre_id then
    update jalons set groupe_travail_id = new.groupe_travail_id, responsable_membre_id = new.responsable_membre_id where id = new.jalon_id;
  end if;
  if new.statut in ('decidee', 'close') and old.statut not in ('decidee', 'close') then
    update jalons set statut = 'fait' where id = new.jalon_id and statut in ('a_venir', 'en_cours');
  end if;
  return null;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'demande_prix_jalon' and tgrelid = 'public.demandes_prix'::regclass) then
    create trigger demande_prix_jalon after update on public.demandes_prix
      for each row execute function public.trg_demande_prix_jalon();
  end if;
end $t$;

-- Commande livrée (ou plus loin) ⇒ demande close.
create or replace function public.trg_commande_close()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_demande uuid;
begin
  if new.statut in ('livree', 'facturee', 'payee') and (tg_op = 'INSERT' or new.statut is distinct from old.statut) then
    select demande_id into v_demande from consultations where id = new.consultation_id;
    update demandes_prix set statut = 'close' where id = v_demande and statut <> 'close';
  end if;
  return null;
end $$;
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'commande_close' and tgrelid = 'public.commandes'::regclass) then
    create trigger commande_close after insert or update on public.commandes
      for each row execute function public.trg_commande_close();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 7. RLS : tout porte `evenement_id`, ressource `logistique`
-- ---------------------------------------------------------------------
alter table public.demandes_prix enable row level security;
alter table public.demande_prix_lignes enable row level security;
alter table public.consultations enable row level security;
alter table public.offre_lignes enable row level security;
alter table public.commandes enable row level security;

do $p$
declare t text;
begin
  foreach t in array array['demandes_prix', 'consultations', 'commandes'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_lecture') then
      execute format('create policy %I on public.%I for select to authenticated using (deleted_at is null and (a_permission(evenement_id, ''logistique'', ''lire'') or a_tout_pouvoir(evenement_id)))', t || '_lecture', t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_creation') then
      execute format('create policy %I on public.%I for insert to authenticated with check (a_permission(evenement_id, ''logistique'', ''creer'') or a_tout_pouvoir(evenement_id))', t || '_creation', t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_modification') then
      execute format('create policy %I on public.%I for update to authenticated using (a_permission(evenement_id, ''logistique'', ''modifier'') or a_tout_pouvoir(evenement_id)) with check (a_permission(evenement_id, ''logistique'', ''modifier'') or a_tout_pouvoir(evenement_id))', t || '_modification', t);
    end if;
  end loop;

  -- Lignes de demande : par la demande.
  if not exists (select 1 from pg_policies where tablename = 'demande_prix_lignes' and policyname = 'demande_prix_lignes_lecture') then
    create policy demande_prix_lignes_lecture on public.demande_prix_lignes for select to authenticated
      using (deleted_at is null and exists (select 1 from demandes_prix d where d.id = demande_id and (a_permission(d.evenement_id, 'logistique', 'lire') or a_tout_pouvoir(d.evenement_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'demande_prix_lignes' and policyname = 'demande_prix_lignes_creation') then
    create policy demande_prix_lignes_creation on public.demande_prix_lignes for insert to authenticated
      with check (exists (select 1 from demandes_prix d where d.id = demande_id and (a_permission(d.evenement_id, 'logistique', 'creer') or a_permission(d.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(d.evenement_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'demande_prix_lignes' and policyname = 'demande_prix_lignes_modification') then
    create policy demande_prix_lignes_modification on public.demande_prix_lignes for update to authenticated
      using (exists (select 1 from demandes_prix d where d.id = demande_id and (a_permission(d.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(d.evenement_id))))
      with check (exists (select 1 from demandes_prix d where d.id = demande_id and (a_permission(d.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(d.evenement_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'demande_prix_lignes' and policyname = 'demande_prix_lignes_suppression') then
    create policy demande_prix_lignes_suppression on public.demande_prix_lignes for delete to authenticated
      using (exists (select 1 from demandes_prix d where d.id = demande_id and (a_permission(d.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(d.evenement_id))));
  end if;

  -- Lignes d'offre : par la consultation.
  if not exists (select 1 from pg_policies where tablename = 'offre_lignes' and policyname = 'offre_lignes_lecture') then
    create policy offre_lignes_lecture on public.offre_lignes for select to authenticated
      using (exists (select 1 from consultations c where c.id = consultation_id and (a_permission(c.evenement_id, 'logistique', 'lire') or a_tout_pouvoir(c.evenement_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'offre_lignes' and policyname = 'offre_lignes_creation') then
    create policy offre_lignes_creation on public.offre_lignes for insert to authenticated
      with check (exists (select 1 from consultations c where c.id = consultation_id and (a_permission(c.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(c.evenement_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'offre_lignes' and policyname = 'offre_lignes_modification') then
    create policy offre_lignes_modification on public.offre_lignes for update to authenticated
      using (exists (select 1 from consultations c where c.id = consultation_id and (a_permission(c.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(c.evenement_id))))
      with check (exists (select 1 from consultations c where c.id = consultation_id and (a_permission(c.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(c.evenement_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'offre_lignes' and policyname = 'offre_lignes_suppression') then
    create policy offre_lignes_suppression on public.offre_lignes for delete to authenticated
      using (exists (select 1 from consultations c where c.id = consultation_id and (a_permission(c.evenement_id, 'logistique', 'modifier') or a_tout_pouvoir(c.evenement_id))));
  end if;
end $p$;

-- ---------------------------------------------------------------------
-- 8. Les gestes : envoyer, relancer, retenir
-- ---------------------------------------------------------------------
create or replace function public.marquer_envoyee(p_consultation uuid, p_moyen text default 'mailto')
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare c consultations%rowtype; d demandes_prix%rowtype; v_nom text;
begin
  select * into c from consultations where id = p_consultation and deleted_at is null;
  if c.id is null then raise exception 'Consultation inconnue' using errcode = 'P0002'; end if;
  if not a_permission(c.evenement_id, 'logistique', 'modifier') and not a_tout_pouvoir(c.evenement_id) then
    raise exception 'Envoi refusé : droits insuffisants sur la logistique' using errcode = '42501';
  end if;
  if c.statut <> 'a_envoyer' then return false; end if;
  update consultations set statut = 'envoyee', envoyee_le = now() where id = c.id;
  select * into d from demandes_prix where id = c.demande_id;
  select nom into v_nom from fournisseurs where id = c.fournisseur_id;
  perform journaliser(c.evenement_id, 'logistique', 'demande_prix',
    format('%s — demande envoyée à %s (%s)', d.reference, v_nom, coalesce(p_moyen, 'mailto')),
    'routine', 'demande_prix', d.id, d.reference);
  return true;
end $$;

create or replace function public.relancer(p_consultation uuid, p_note text default null, p_moyen text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare c consultations%rowtype; d demandes_prix%rowtype; v_nom text;
begin
  select * into c from consultations where id = p_consultation and deleted_at is null;
  if c.id is null then raise exception 'Consultation inconnue' using errcode = 'P0002'; end if;
  if not a_permission(c.evenement_id, 'logistique', 'modifier') and not a_tout_pouvoir(c.evenement_id) then
    raise exception 'Relance refusée : droits insuffisants sur la logistique' using errcode = '42501';
  end if;
  if c.statut not in ('envoyee', 'relancee') then return false; end if;
  update consultations
     set statut = 'relancee',
         relances = relances || jsonb_build_array(jsonb_build_object('le', now(), 'par', auth.uid(), 'moyen', p_moyen, 'note', p_note))
   where id = c.id;
  select * into d from demandes_prix where id = c.demande_id;
  select nom into v_nom from fournisseurs where id = c.fournisseur_id;
  perform journaliser(c.evenement_id, 'logistique', 'demande_prix',
    format('%s — %s relancé%s', d.reference, v_nom, case when p_note is null then '' else ' : ' || p_note end),
    'routine', 'demande_prix', d.id, d.reference);
  return true;
end $$;

-- La décision : une retenue, les autres écartées (sauf sans réponse),
-- le motif gardé, la main courante écrite, la commande ouverte.
create or replace function public.retenir_offre(p_consultation uuid, p_motif text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c consultations%rowtype; d demandes_prix%rowtype; v_nom text; v_commande uuid;
begin
  select * into c from consultations where id = p_consultation and deleted_at is null;
  if c.id is null then raise exception 'Consultation inconnue' using errcode = 'P0002'; end if;
  if not a_permission(c.evenement_id, 'logistique', 'modifier') and not a_tout_pouvoir(c.evenement_id) then
    raise exception 'Décision refusée : droits insuffisants sur la logistique' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'Le motif de la décision est obligatoire' using errcode = '23514';
  end if;
  if c.statut not in ('offre_recue', 'retenue') then
    raise exception 'Seule une offre reçue peut être retenue' using errcode = '23514';
  end if;
  select * into d from demandes_prix where id = c.demande_id;
  if d.statut = 'close' then
    raise exception 'La demande est close' using errcode = '23514';
  end if;
  update consultations set statut = 'ecartee'
   where demande_id = c.demande_id and id <> c.id and deleted_at is null and statut <> 'sans_reponse';
  update consultations set statut = 'retenue' where id = c.id;
  update demandes_prix set decision_motif = p_motif where id = d.id;
  select nom into v_nom from fournisseurs where id = c.fournisseur_id;
  select id into v_commande from commandes where consultation_id = c.id and deleted_at is null limit 1;
  if v_commande is null then
    insert into commandes (evenement_id, consultation_id, statut) values (c.evenement_id, c.id, 'commandee')
    returning id into v_commande;
  end if;
  perform journaliser(c.evenement_id, 'logistique', 'demande_prix',
    format('%s — offre retenue : %s, %s € HT — %s', d.reference, v_nom,
           coalesce(to_char(c.montant_ht, 'FM999G999G990D00'), '?'), p_motif),
    'notable', 'demande_prix', d.id, d.reference);
  return v_commande;
end $$;

-- ---------------------------------------------------------------------
-- 9. Lecture : la liste, la grille, le suivi, le budget
-- ---------------------------------------------------------------------
create or replace function public.demandes_prix_vue(p_evenement uuid)
returns table (
  id uuid, reference text, objet text, categorie text, description text, statut text,
  date_limite timestamptz, livraison_de timestamptz, livraison_a timestamptz,
  lieu_id uuid, lieu_nom text, groupe_travail_id uuid, groupe_nom text,
  responsable_membre_id uuid, responsable text, jalon_id uuid, jalon_statut text, decision_motif text,
  nb_lignes integer, nb_consultations integer, nb_a_envoyer integer, nb_envoyees integer, nb_offres integer, nb_sans_reponse integer,
  meilleure_offre_ht numeric, retenu_fournisseur text, retenu_montant_ht numeric, retenu_taux_tva numeric,
  commande_id uuid, commande_statut text, en_retard boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not a_permission(p_evenement, 'logistique', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture des demandes de prix non autorisée' using errcode = '42501';
  end if;
  return query
  select d.id, d.reference, d.objet, d.categorie, d.description, d.statut::text,
    d.date_limite, d.livraison_de, d.livraison_a,
    d.lieu_id, l.nom, d.groupe_travail_id, g.nom,
    d.responsable_membre_id, m.nom_affiche, d.jalon_id, j.statut::text, d.decision_motif,
    (select count(*)::int from demande_prix_lignes x where x.demande_id = d.id and x.deleted_at is null),
    (select count(*)::int from consultations c where c.demande_id = d.id and c.deleted_at is null),
    (select count(*)::int from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut = 'a_envoyer'),
    (select count(*)::int from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut in ('envoyee', 'relancee')),
    (select count(*)::int from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut in ('offre_recue', 'retenue', 'ecartee') and c.montant_ht is not null),
    (select count(*)::int from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut = 'sans_reponse'),
    (select min(c.montant_ht) from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut in ('offre_recue', 'retenue', 'ecartee')),
    r.nom, rc.montant_ht, rc.taux_tva,
    k.id, k.statut::text,
    (d.date_limite is not null and d.date_limite < now() and d.statut in ('envoyee')),
    d.updated_at
  from demandes_prix d
  left join lieux l on l.id = d.lieu_id
  left join groupes_travail g on g.id = d.groupe_travail_id
  left join membres_evenement m on m.id = d.responsable_membre_id
  left join jalons j on j.id = d.jalon_id
  left join lateral (select c.* from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut = 'retenue' limit 1) rc on true
  left join fournisseurs r on r.id = rc.fournisseur_id
  left join lateral (select x.* from commandes x where x.consultation_id = rc.id and x.deleted_at is null order by x.created_at desc limit 1) k on true
  where d.evenement_id = p_evenement and d.deleted_at is null
  order by d.reference;
end $$;

-- La grille : une ligne par consultation, les prix par ligne en JSON ;
-- l'application croise avec `demande_prix_lignes`.
create or replace function public.comparaison(p_demande uuid)
returns table (
  consultation_id uuid, fournisseur_id uuid, fournisseur_nom text, contact_id uuid, contact_nom text, contact_email text, contact_telephone text,
  statut text, envoyee_le timestamptz, relances jsonb, offre_recue_le timestamptz, offre_validite date, offre_delai text, offre_conditions text,
  montant_ht numeric, taux_tva numeric, montant_ttc numeric, commentaire text,
  note_moyenne numeric, dernier_verdict text, lignes jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ev uuid;
begin
  select evenement_id into v_ev from demandes_prix where id = p_demande;
  if v_ev is null then raise exception 'Demande de prix inconnue' using errcode = 'P0002'; end if;
  if not a_permission(v_ev, 'logistique', 'lire') and not a_tout_pouvoir(v_ev) then
    raise exception 'Lecture des demandes de prix non autorisée' using errcode = '42501';
  end if;
  return query
  select c.id, c.fournisseur_id, f.nom, c.contact_id, k.nom, coalesce(k.email, f.email), coalesce(k.telephone, f.telephone),
    c.statut::text, c.envoyee_le, c.relances, c.offre_recue_le, c.offre_validite, c.offre_delai, c.offre_conditions,
    c.montant_ht, c.taux_tva, round(c.montant_ht * (1 + c.taux_tva / 100), 2), c.commentaire,
    (select round(avg(v.note), 1) from fournisseur_evaluations v where v.fournisseur_id = f.id and v.deleted_at is null),
    (select v.verdict from fournisseur_evaluations v where v.fournisseur_id = f.id and v.deleted_at is null order by v.created_at desc limit 1),
    coalesce((select jsonb_agg(jsonb_build_object(
        'ligne_id', o.ligne_id, 'prix_unitaire_ht', o.prix_unitaire_ht, 'quantite_offerte', o.quantite_offerte,
        'total_ht', o.prix_unitaire_ht * coalesce(o.quantite_offerte, l.quantite), 'remarque', o.remarque))
      from offre_lignes o join demande_prix_lignes l on l.id = o.ligne_id where o.consultation_id = c.id), '[]'::jsonb)
  from consultations c
  join fournisseurs f on f.id = c.fournisseur_id
  left join fournisseur_contacts k on k.id = c.contact_id
  where c.demande_id = p_demande and c.deleted_at is null
  order by (c.statut = 'retenue') desc, c.montant_ht nulls last, f.nom;
end $$;

-- Pour le pavé Mon poste : ce qui attend quelqu'un.
--   offres_attendues — envoyées, date limite à venir
--   a_relancer       — envoyées, date limite passée, pas d'offre
--   a_comparer       — au moins deux offres, pas de décision
--   livraison        — commandée, non livrée, livraison (ou J) sous 7 jours
create or replace function public.suivi_demandes(p_evenement uuid)
returns table (categorie text, demande_id uuid, reference text, objet text, date_limite timestamptz, consultation_id uuid, fournisseur text, detail text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_j date;
begin
  if not a_permission(p_evenement, 'logistique', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture des demandes de prix non autorisée' using errcode = '42501';
  end if;
  select date_debut into v_j from evenements where id = p_evenement;
  return query
  select case when d.date_limite is null or d.date_limite >= now() then 'offres_attendues' else 'a_relancer' end,
         d.id, d.reference, d.objet, d.date_limite, c.id, f.nom,
         case when c.statut = 'relancee' then 'relancé ' || jsonb_array_length(c.relances) || ' fois' else 'envoyée le ' || to_char(c.envoyee_le at time zone 'Europe/Brussels', 'DD/MM') end
  from demandes_prix d
  join consultations c on c.demande_id = d.id and c.deleted_at is null and c.statut in ('envoyee', 'relancee')
  join fournisseurs f on f.id = c.fournisseur_id
  where d.evenement_id = p_evenement and d.deleted_at is null and d.statut not in ('decidee', 'close')
  union all
  select 'a_comparer', d.id, d.reference, d.objet, d.date_limite, null, null,
         (select count(*) from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut = 'offre_recue') || ' offres reçues'
  from demandes_prix d
  where d.evenement_id = p_evenement and d.deleted_at is null and d.statut = 'comparaison'
    and (select count(*) from consultations c where c.demande_id = d.id and c.deleted_at is null and c.statut = 'offre_recue') >= 2
  union all
  select 'livraison', d.id, d.reference, d.objet, d.livraison_de, c.id, f.nom,
         case when d.livraison_de is null then 'livraison non datée' else 'livraison le ' || to_char(d.livraison_de at time zone 'Europe/Brussels', 'DD/MM') end
  from commandes k
  join consultations c on c.id = k.consultation_id
  join demandes_prix d on d.id = c.demande_id
  join fournisseurs f on f.id = c.fournisseur_id
  where k.evenement_id = p_evenement and k.deleted_at is null and k.statut = 'commandee' and d.deleted_at is null
    and coalesce((d.livraison_de at time zone 'Europe/Brussels')::date, v_j) <= current_date + 7
  order by 1, 5 nulls last;
end $$;

-- Par catégorie : ce qui est retenu (HT), ce qui est facturé.
-- Pas de `reconduit_de` sur `evenements` (047) : pas de colonne « édition
-- précédente », on ne l'invente pas.
create or replace function public.budget_fournisseurs(p_evenement uuid)
returns table (categorie text, nb_demandes integer, nb_retenues integer, retenu_ht numeric, retenu_ttc numeric, facture_ht numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not a_permission(p_evenement, 'logistique', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture des demandes de prix non autorisée' using errcode = '42501';
  end if;
  return query
  select coalesce(d.categorie, 'autre'),
    count(distinct d.id)::int,
    count(c.id)::int,
    coalesce(sum(c.montant_ht), 0),
    coalesce(sum(round(c.montant_ht * (1 + c.taux_tva / 100), 2)), 0),
    coalesce(sum(k.montant_facture_ht), 0)
  from demandes_prix d
  left join consultations c on c.demande_id = d.id and c.deleted_at is null and c.statut = 'retenue'
  left join commandes k on k.consultation_id = c.id and k.deleted_at is null
  where d.evenement_id = p_evenement and d.deleted_at is null
  group by coalesce(d.categorie, 'autre')
  order by 1;
end $$;

-- L'historique d'un fournisseur, tous événements de l'organisation.
create or replace function public.historique_fournisseur(p_fournisseur uuid)
returns table (consultation_id uuid, evenement_id uuid, evenement text, reference text, objet text, statut text, montant_ht numeric, taux_tva numeric, envoyee_le timestamptz, retenue boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select organisation_id into v_org from fournisseurs where id = p_fournisseur;
  if v_org is null or not appartient_organisation(v_org) then
    raise exception 'Lecture de l''annuaire non autorisée' using errcode = '42501';
  end if;
  return query
  select c.id, e.id, e.nom, d.reference, d.objet, c.statut::text, c.montant_ht, c.taux_tva, c.envoyee_le, c.statut = 'retenue'
  from consultations c
  join demandes_prix d on d.id = c.demande_id
  join evenements e on e.id = c.evenement_id
  where c.fournisseur_id = p_fournisseur and c.deleted_at is null and d.deleted_at is null
  order by c.envoyee_le desc nulls last, e.nom;
end $$;

-- ---------------------------------------------------------------------
-- 10. L'annuaire (130) redéfini en entier : les compteurs de
--     consultations sont maintenant réels.
-- ---------------------------------------------------------------------
create or replace function public.annuaire(p_organisation uuid, p_categorie text default null)
returns table (
  id uuid, nom text, tva text, adresse text, site text, telephone text, email text,
  categories text[], zone text, notes text, actif boolean,
  contact_id uuid, contact_nom text, contact_fonction text, contact_telephone text, contact_email text,
  nb_contacts integer, nb_consultations integer, nb_retenues integer,
  note_moyenne numeric, nb_evaluations integer, dernier_verdict text, derniere_evaluation timestamptz, dernier_evenement text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not appartient_organisation(p_organisation) then
    raise exception 'Lecture de l''annuaire non autorisée' using errcode = '42501';
  end if;
  return query
  select f.id, f.nom, f.tva, f.adresse, f.site, f.telephone, f.email, f.categories, f.zone, f.notes, f.actif,
    c.id, c.nom, c.fonction, c.telephone, c.email,
    (select count(*)::int from fournisseur_contacts x where x.fournisseur_id = f.id and x.deleted_at is null),
    (select count(*)::int from consultations k where k.fournisseur_id = f.id and k.deleted_at is null and k.statut <> 'a_envoyer'),
    (select count(*)::int from consultations k where k.fournisseur_id = f.id and k.deleted_at is null and k.statut = 'retenue'),
    (select round(avg(v.note), 1) from fournisseur_evaluations v where v.fournisseur_id = f.id and v.deleted_at is null),
    (select count(*)::int from fournisseur_evaluations v where v.fournisseur_id = f.id and v.deleted_at is null),
    d.verdict, d.created_at, d.evenement
  from fournisseurs f
  left join lateral (
    select x.* from fournisseur_contacts x
    where x.fournisseur_id = f.id and x.deleted_at is null
    order by x.principal desc, x.created_at limit 1
  ) c on true
  left join lateral (
    select v.verdict, v.created_at, e.nom as evenement
    from fournisseur_evaluations v join evenements e on e.id = v.evenement_id
    where v.fournisseur_id = f.id and v.deleted_at is null
    order by v.created_at desc limit 1
  ) d on true
  where f.organisation_id = p_organisation and f.deleted_at is null
    and (p_categorie is null or p_categorie = any (f.categories))
  order by f.nom;
end $$;

-- ---------------------------------------------------------------------
-- 11. Suppression logique (130) redéfinie en entier avec les tables de
--     demandes de prix. `demande_prix_lignes` n'a pas d'evenement_id :
--     on passe par la demande.
-- ---------------------------------------------------------------------
create or replace function public.supprimer_logiquement(p_table text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ressource text;
  v_evenement uuid;
  v_org       uuid;
  v_touchees  integer;
begin
  -- (130) Niveau organisation : fournisseurs et leurs contacts.
  if p_table = 'fournisseurs' then
    select organisation_id into v_org from fournisseurs where id = p_id and deleted_at is null;
  elsif p_table = 'fournisseur_contacts' then
    select f.organisation_id into v_org from fournisseur_contacts c join fournisseurs f on f.id = c.fournisseur_id
     where c.id = p_id and c.deleted_at is null;
  end if;
  if p_table in ('fournisseurs', 'fournisseur_contacts') then
    if v_org is null then return false; end if;
    if not peut_gerer_annuaire(v_org) then
      raise exception 'Suppression refusée : vous ne gérez pas l''annuaire de cette organisation.'
        using errcode = '42501';
    end if;
    execute format('update %I set deleted_at = now(), updated_by = auth.uid() where id = $1 and deleted_at is null', p_table)
      using p_id;
    get diagnostics v_touchees = row_count;
    return v_touchees > 0;
  end if;

  v_ressource := case p_table
    when 'jalons'                  then 'rh'
    when 'groupes_travail'         then 'rh'
    when 'creneaux'                then 'rh'
    when 'equipes'                 then 'equipes'
    when 'lieux'                   then 'referentiels'
    when 'contacts'                then 'referentiels'
    when 'types_mission'           then 'referentiels'
    when 'materiel'                then 'logistique'
    when 'programme'               then 'referentiels'
    when 'fiches_reflexe'          then 'referentiels'
    when 'membres_evenement'       then 'membres'
    when 'elements_plan'           then 'plan_implantation'
    when 'fournisseur_evaluations' then 'analyse'
    when 'demandes_prix'           then 'logistique'
    when 'demande_prix_lignes'     then 'logistique'
    when 'consultations'           then 'logistique'
    when 'commandes'               then 'logistique'
    else null
  end;
  if v_ressource is null then
    raise exception 'Suppression logique non prévue pour « % ».', p_table
      using errcode = '42501';
  end if;
  if p_table = 'demande_prix_lignes' then
    select d.evenement_id into v_evenement from demande_prix_lignes l join demandes_prix d on d.id = l.demande_id
     where l.id = p_id and l.deleted_at is null;
  else
    execute format('select evenement_id from %I where id = $1 and deleted_at is null', p_table)
      into v_evenement using p_id;
  end if;
  if v_evenement is null then
    return false;
  end if;
  if not a_permission(v_evenement, v_ressource, 'modifier') then
    raise exception 'Suppression refusée : droits insuffisants sur « % » dans cette phase.', v_ressource
      using errcode = '42501';
  end if;
  execute format(
    'update %I set deleted_at = now(), updated_by = auth.uid() where id = $1 and deleted_at is null',
    p_table
  ) using p_id;
  get diagnostics v_touchees = row_count;
  return v_touchees > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Reconduction : redéfinie en entier (base : 129 ; seul le bloc
--     « demandes de prix » s'ajoute). Les demandes décidées ou closes
--     reviennent en brouillon, avec leurs lignes et leurs consultations
--     « à envoyer » vers les mêmes fournisseurs (retenu et écartés : on
--     reconsulte), sans montants ; la date limite suit le décalage.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 13. Droits : retirer d'abord à PUBLIC et anon (090), puis accorder
-- ---------------------------------------------------------------------
revoke execute on function
  public.statut_demande_derive(uuid),
  public.marquer_envoyee(uuid, text),
  public.relancer(uuid, text, text),
  public.retenir_offre(uuid, text),
  public.demandes_prix_vue(uuid),
  public.comparaison(uuid),
  public.suivi_demandes(uuid),
  public.budget_fournisseurs(uuid),
  public.historique_fournisseur(uuid),
  public.annuaire(uuid, text),
  public.supprimer_logiquement(text, uuid),
  public.dupliquer_evenement(uuid, text, text, date, date)
from public, anon;
-- Interne (déclencheurs) : pas d'appel direct depuis l'application.
revoke execute on function public.statut_demande_derive(uuid) from authenticated;

grant execute on function
  public.marquer_envoyee(uuid, text),
  public.relancer(uuid, text, text),
  public.retenir_offre(uuid, text),
  public.demandes_prix_vue(uuid),
  public.comparaison(uuid),
  public.suivi_demandes(uuid),
  public.budget_fournisseurs(uuid),
  public.historique_fournisseur(uuid),
  public.annuaire(uuid, text),
  public.supprimer_logiquement(text, uuid),
  public.dupliquer_evenement(uuid, text, text, date, date)
to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (éditeur SQL, en simulant un coordinateur ; le bloc du
-- README de la 131 rejoue le scénario du briefing en transaction annulée)
--   select * from demandes_prix_vue('<evenement>');
--   select * from comparaison('<demande>');
--   select * from suivi_demandes('<evenement>');
-- =====================================================================
