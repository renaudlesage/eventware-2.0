-- =====================================================================
-- 129 — PLANNING GANTT DE L'AVANT / APRÈS-ÉVÉNEMENT (briefing du 26/10)
--
-- Un seul objet : `jalons`. Le Gantt lit et écrit la même table que
-- Préparation, la frise du Planning et la Situation. On lui ajoute :
--
--   debut            — début prévu ; nul = jalon ponctuel (losange).
--   avancement       — 0..100 ; `statut = fait` force 100 (déclencheur),
--                      100 ne force pas `fait` (le geste reste humain).
--   offset_debut_j,  — position en jours par rapport à une date de
--   offset_fin_j       l'événement (l'ancre). La date absolue fait foi ;
--                      l'offset sert à recaler quand les dates changent
--                      et à la reconduction. Recalculé par déclencheur à
--                      chaque écriture de `debut` / `echeance` / `ancre`,
--                      pour que le Gantt, Préparation ou un import
--                      n'aient pas à y penser.
--   ancre            — debut (J = date_debut), fin, montage, demontage.
--   phase_cible      — ligne du Gantt ; nulle = déduite de la date.
--
-- `jalon_dependances` : un lien fin-à-début, avec un battement en jours.
-- Pas d'autre type de lien, pas de deleted_at (une dépendance se
-- supprime vraiment). Un déclencheur refuse les cycles.
--
-- Fonctions (definer, droits `rh`) :
--   chemin_critique(ev)  — CPM en jours : passe avant depuis les débuts
--                          planifiés (ES = max du début planifié et des
--                          fins des prédécesseurs + battement), passe
--                          arrière depuis J (un jalon sans successeur a
--                          pour échéance J, ou la fin du démontage s'il
--                          est après J) ; marge = LF − EF ; 0 = critique.
--   gantt(ev)            — une ligne par jalon vivant, avec groupe,
--                          phase, retard, marge, prédécesseurs.
--   recaler_jalons(ev, simuler) — réécrit les dates depuis les offsets.
--   deplacer_jalon(j, debut, fin, entrainer) — déplace, et pousse les
--                          successeurs qui ne tiendraient plus.
--   dupliquer_evenement  — redéfinie (base : 047/101) : recopie début,
--                          offsets, ancre, phase cible, dépendances, puis
--                          recale sur les nouvelles dates.
--
-- Idempotente, sans aucun DROP, sans `not null` sans défaut.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Colonnes de `jalons`
-- ---------------------------------------------------------------------
alter table public.jalons add column if not exists debut timestamptz;
alter table public.jalons add column if not exists avancement smallint not null default 0;
alter table public.jalons add column if not exists offset_debut_j integer;
alter table public.jalons add column if not exists offset_fin_j integer;
alter table public.jalons add column if not exists ancre text not null default 'debut';
alter table public.jalons add column if not exists phase_cible public.phase_evenement;

comment on column public.jalons.debut is 'Début prévu (129). Nul : jalon ponctuel. `echeance` reste la fin.';
comment on column public.jalons.avancement is '0..100 (129). fait ⇒ 100 par déclencheur ; 100 ne force pas fait.';
comment on column public.jalons.offset_debut_j is 'Jours entre l''ancre et le début (129), négatif avant. Recalculé à chaque écriture de debut/ancre.';
comment on column public.jalons.offset_fin_j is 'Jours entre l''ancre et la fin (129). Sert au recalage et à la reconduction.';
comment on column public.jalons.ancre is 'Date de l''événement à laquelle l''offset se rapporte (129) : debut, fin, montage, demontage.';
comment on column public.jalons.phase_cible is 'Ligne du Gantt (129). Nulle : déduite de la date de fin.';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'jalons_avancement_check') then
    alter table public.jalons add constraint jalons_avancement_check check (avancement between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jalons_ancre_check') then
    alter table public.jalons add constraint jalons_ancre_check check (ancre in ('debut','fin','montage','demontage'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jalons_debut_avant_fin_check') then
    alter table public.jalons add constraint jalons_debut_avant_fin_check check (debut is null or echeance is null or debut <= echeance);
  end if;
end $c$;

-- ---------------------------------------------------------------------
-- 2. L'ancre : la date de l'événement à laquelle un offset se rapporte
-- ---------------------------------------------------------------------
create or replace function public.jour_ancre(p_evenement uuid, p_ancre text)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select case p_ancre
           when 'fin' then coalesce(e.date_fin, e.date_debut)
           when 'montage' then coalesce(e.date_montage, e.date_debut)
           when 'demontage' then coalesce(e.date_demontage, e.date_fin, e.date_debut)
           else e.date_debut
         end
  from evenements e where e.id = p_evenement;
$$;

-- Les offsets suivent les dates ; fait ⇒ avancement 100.
create or replace function public.trg_jalon_offsets()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ancre date;
begin
  if new.statut = 'fait' then new.avancement := 100; end if;
  v_ancre := jour_ancre(new.evenement_id, new.ancre);
  -- Sans date d'événement, on ne sait pas calculer : on garde ce qu'on a
  -- (une reconduction les pose explicitement).
  if v_ancre is not null then
    new.offset_debut_j := case when new.debut is null then null
                               else (new.debut at time zone 'Europe/Brussels')::date - v_ancre end;
    new.offset_fin_j := case when new.echeance is null then null
                             else (new.echeance at time zone 'Europe/Brussels')::date - v_ancre end;
  end if;
  return new;
end $$;

do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'jalon_offsets' and tgrelid = 'public.jalons'::regclass) then
    create trigger jalon_offsets before insert or update of debut, echeance, ancre, statut, evenement_id
      on public.jalons for each row execute function public.trg_jalon_offsets();
  end if;
end $t$;

-- Les jalons déjà en base reçoivent leurs offsets (sans toucher au reste :
-- le déclencheur de traçabilité réécrit updated_at, c'est le prix).
update public.jalons j set ancre = ancre
 where j.deleted_at is null and j.echeance is not null and j.offset_fin_j is null
   and jour_ancre(j.evenement_id, j.ancre) is not null;

-- ---------------------------------------------------------------------
-- 3. Dépendances fin-à-début
-- ---------------------------------------------------------------------
create table if not exists public.jalon_dependances (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references public.evenements(id) on delete cascade,
  jalon_id      uuid not null references public.jalons(id) on delete cascade,   -- le successeur
  precede_id    uuid not null references public.jalons(id) on delete cascade,   -- le prédécesseur
  decalage_j    integer not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  unique (jalon_id, precede_id),
  check (jalon_id <> precede_id)
);
create index if not exists idx_jalon_dependances_evenement on public.jalon_dependances (evenement_id);
create index if not exists idx_jalon_dependances_precede on public.jalon_dependances (precede_id);
comment on table public.jalon_dependances is
  'Lien fin-à-début entre deux jalons (129) : jalon_id ne commence pas avant la fin de precede_id + decalage_j jours.';

alter table public.jalon_dependances enable row level security;
do $p$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jalon_dependances' and policyname = 'jalon_dependances_lecture') then
    create policy jalon_dependances_lecture on public.jalon_dependances for select to authenticated
      using (a_permission(evenement_id, 'rh', 'lire') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jalon_dependances' and policyname = 'jalon_dependances_creation') then
    create policy jalon_dependances_creation on public.jalon_dependances for insert to authenticated
      with check (a_permission(evenement_id, 'rh', 'modifier') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jalon_dependances' and policyname = 'jalon_dependances_modification') then
    create policy jalon_dependances_modification on public.jalon_dependances for update to authenticated
      using (a_permission(evenement_id, 'rh', 'modifier') or a_tout_pouvoir(evenement_id))
      with check (a_permission(evenement_id, 'rh', 'modifier') or a_tout_pouvoir(evenement_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jalon_dependances' and policyname = 'jalon_dependances_suppression') then
    create policy jalon_dependances_suppression on public.jalon_dependances for delete to authenticated
      using (a_permission(evenement_id, 'rh', 'modifier') or a_tout_pouvoir(evenement_id));
  end if;
end $p$;

-- Même événement des deux côtés, auteur, et jamais de cycle.
create or replace function public.trg_jalon_dependance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ev_j uuid; v_ev_p uuid;
begin
  select evenement_id into v_ev_j from jalons where id = new.jalon_id;
  select evenement_id into v_ev_p from jalons where id = new.precede_id;
  if v_ev_j is null or v_ev_p is null or v_ev_j <> new.evenement_id or v_ev_p <> new.evenement_id then
    raise exception 'Les deux jalons doivent appartenir à l''événement de la dépendance' using errcode = '23514';
  end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  -- precede_id déjà atteignable depuis jalon_id (en suivant les successeurs) : boucle.
  if exists (
    with recursive aval as (
      select d.jalon_id from jalon_dependances d where d.precede_id = new.jalon_id and d.evenement_id = new.evenement_id
      union
      select d.jalon_id from jalon_dependances d join aval a on d.precede_id = a.jalon_id
    )
    select 1 from aval where aval.jalon_id = new.precede_id
  ) then
    raise exception 'Dépendance circulaire' using errcode = '23514';
  end if;
  return new;
end $$;

do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'dependance_sans_cycle' and tgrelid = 'public.jalon_dependances'::regclass) then
    create trigger dependance_sans_cycle before insert or update on public.jalon_dependances
      for each row execute function public.trg_jalon_dependance();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 4. Le chemin critique
-- ---------------------------------------------------------------------
create or replace function public.chemin_critique(p_evenement uuid)
returns table (jalon_id uuid, es date, ef date, ls date, lf date, marge_j integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ev evenements%rowtype;
  v_j date; v_fin_ev date; n int; i int := 0; v_change int;
begin
  if not a_permission(p_evenement, 'rh', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du planning non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement;
  v_j := ev.date_debut;
  v_fin_ev := coalesce(ev.date_demontage, ev.date_fin, ev.date_debut);

  -- Une table temporaire par session, vidée à chaque appel (gantt()
  -- et chemin_critique() peuvent tourner dans la même transaction) :
  -- jamais de DROP, l'outil Supabase le refuse sans confirmation.
  if to_regclass('pg_temp.cpm_129') is null then
    create temp table cpm_129 (id uuid, d0 date, d1 date, duree int, es date, ef date, lf date) on commit drop;
  end if;
  delete from cpm_129 where id is not null;
  insert into cpm_129 (id, d0, d1, duree)
    select j.id,
           (coalesce(j.debut, j.echeance) at time zone 'Europe/Brussels')::date as d0,
           (j.echeance at time zone 'Europe/Brussels')::date as d1,
           case when j.statut = 'fait' then 0
                else greatest(0, (j.echeance at time zone 'Europe/Brussels')::date
                               - (coalesce(j.debut, j.echeance) at time zone 'Europe/Brussels')::date) end
    from jalons j
    where j.evenement_id = p_evenement and j.deleted_at is null and j.statut <> 'annule' and j.echeance is not null;
  select count(*) into n from cpm_129;

  -- Passe avant : au plus tôt. Un jalon sans prédécesseur part de son
  -- début planifié ; les autres du plus tard entre leur début planifié
  -- et la fin de leurs prédécesseurs + battement.
  update cpm_129 c set es = c.d0, ef = c.d0 + c.duree
   where not exists (select 1 from jalon_dependances d join cpm_129 p on p.id = d.precede_id where d.jalon_id = c.id);
  loop
    update cpm_129 c set es = x.es, ef = x.es + c.duree
      from (select d.jalon_id as id, greatest(min(c2.d0), max(p.ef + d.decalage_j)) as es
              from jalon_dependances d
              join cpm_129 p on p.id = d.precede_id
              join cpm_129 c2 on c2.id = d.jalon_id
             where d.evenement_id = p_evenement
             group by d.jalon_id
            having bool_and(p.ef is not null)) x
     where x.id = c.id and c.es is distinct from x.es;
    get diagnostics v_change = row_count;
    i := i + 1;
    exit when v_change = 0 or i > n + 1;
  end loop;

  -- Passe arrière : au plus tard, depuis J. Un jalon sans successeur
  -- doit être fini pour J ; après J (démontage), pour la fin du démontage.
  if v_j is not null then
    update cpm_129 c set lf = case when c.ef <= v_j then v_j else greatest(c.ef, v_fin_ev) end
     where not exists (select 1 from jalon_dependances d join cpm_129 s on s.id = d.jalon_id where d.precede_id = c.id);
    i := 0;
    loop
      update cpm_129 c set lf = x.lf
        from (select d.precede_id as id, min(s.lf - s.duree - d.decalage_j) as lf
                from jalon_dependances d join cpm_129 s on s.id = d.jalon_id
               where d.evenement_id = p_evenement
               group by d.precede_id
              having bool_and(s.lf is not null)) x
       where x.id = c.id and c.lf is distinct from x.lf;
      get diagnostics v_change = row_count;
      i := i + 1;
      exit when v_change = 0 or i > n + 1;
    end loop;
  end if;

  return query select c.id, c.es, c.ef, (c.lf - c.duree)::date, c.lf, (c.lf - c.ef)::int from cpm_129 c;
end $$;

-- ---------------------------------------------------------------------
-- 5. Le Gantt
-- ---------------------------------------------------------------------
create or replace function public.gantt(p_evenement uuid)
returns table (
  id uuid, code text, libelle text, debut timestamptz, fin timestamptz, phase text,
  groupe_travail_id uuid, groupe_nom text, groupe_ordre integer, groupe_pilote text,
  responsable text, responsable_membre_id uuid, statut text, avancement integer, critique boolean,
  en_retard boolean, sur_chemin_critique boolean, marge_j integer,
  predecesseurs uuid[], successeurs uuid[],
  offset_debut_j integer, offset_fin_j integer, ancre text, phase_cible text, visibilite text, commentaire text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev evenements%rowtype; v_tout boolean;
begin
  if not a_permission(p_evenement, 'rh', 'lire') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Lecture du planning non autorisée' using errcode = '42501';
  end if;
  select * into ev from evenements where id = p_evenement;
  v_tout := a_tout_pouvoir(p_evenement);
  return query
  select x.* from (
    select j.id, j.code, j.libelle, j.debut, j.echeance as fin,
      coalesce(j.phase_cible::text,
        case when j.echeance is null or ev.date_debut is null then 'preparation'
             when (j.echeance at time zone 'Europe/Brussels')::date < coalesce(ev.date_montage, ev.date_debut) then 'preparation'
             when (j.echeance at time zone 'Europe/Brussels')::date < ev.date_debut then 'montage'
             when (j.echeance at time zone 'Europe/Brussels')::date <= coalesce(ev.date_fin, ev.date_debut) then 'exploitation'
             else 'demontage' end) as phase,
      j.groupe_travail_id, g.nom as groupe_nom, g.ordre as groupe_ordre, pil.nom_affiche as groupe_pilote,
      coalesce(m.nom_affiche, j.responsable) as responsable, j.responsable_membre_id,
      j.statut::text, j.avancement::int, j.critique,
      (j.echeance is not null and j.echeance < now() and j.statut in ('a_venir','en_cours')) as en_retard,
      (cc.marge_j is not null and cc.marge_j <= 0 and j.statut in ('a_venir','en_cours')) as sur_chemin_critique,
      cc.marge_j,
      (select coalesce(array_agg(d.precede_id), '{}'::uuid[]) from jalon_dependances d where d.jalon_id = j.id) as predecesseurs,
      (select coalesce(array_agg(d.jalon_id), '{}'::uuid[]) from jalon_dependances d where d.precede_id = j.id) as successeurs,
      j.offset_debut_j, j.offset_fin_j, j.ancre, j.phase_cible::text, j.visibilite::text, j.commentaire
    from jalons j
    left join groupes_travail g on g.id = j.groupe_travail_id and g.deleted_at is null
    left join membres_evenement pil on pil.id = g.pilote_membre_id
    left join membres_evenement m on m.id = j.responsable_membre_id
    left join chemin_critique(p_evenement) cc on cc.jalon_id = j.id
    where j.evenement_id = p_evenement and j.deleted_at is null and j.statut <> 'annule'
      and (v_tout or j.visibilite <> 'coordination')
  ) x
  order by x.groupe_ordre nulls last, x.groupe_nom nulls last,
           array_position(array['preparation','montage','exploitation','demontage'], x.phase),
           coalesce(x.debut, x.fin) nulls last, x.fin;
end $$;

-- ---------------------------------------------------------------------
-- 6. Recaler les dates depuis les offsets
-- ---------------------------------------------------------------------
create or replace function public._recaler_jalons(p_evenement uuid, p_simuler boolean)
returns table (touches integer, exemples text[])
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if to_regclass('pg_temp.recal_129') is null then
    create temp table recal_129 (id uuid, libelle text, debut timestamptz, echeance timestamptz, n_debut timestamptz, n_fin timestamptz) on commit drop;
  end if;
  delete from recal_129 where id is not null;
  insert into recal_129 (id, libelle, debut, echeance, n_debut, n_fin)
    select j.id, j.libelle, j.debut, j.echeance,
      case when j.offset_debut_j is null or j.debut is null then j.debut
           else ((jour_ancre(p_evenement, j.ancre) + j.offset_debut_j)::timestamp
                 + (j.debut at time zone 'Europe/Brussels')::time) at time zone 'Europe/Brussels' end,
      case when j.offset_fin_j is null or j.echeance is null then j.echeance
           else ((jour_ancre(p_evenement, j.ancre) + j.offset_fin_j)::timestamp
                 + (j.echeance at time zone 'Europe/Brussels')::time) at time zone 'Europe/Brussels' end
    from jalons j
    where j.evenement_id = p_evenement and j.deleted_at is null
      and j.statut in ('a_venir','en_cours')
      and (j.offset_debut_j is not null or j.offset_fin_j is not null)
      and jour_ancre(p_evenement, j.ancre) is not null;
  delete from recal_129 r where r.n_debut is not distinct from r.debut and r.n_fin is not distinct from r.echeance;
  if not p_simuler then
    update jalons j set debut = r.n_debut, echeance = r.n_fin from recal_129 r where r.id = j.id;
  end if;
  return query select count(*)::int, (array_agg(r.libelle order by r.n_fin))[1:5] from recal_129 r;
end $$;

create or replace function public.recaler_jalons(p_evenement uuid, p_simuler boolean default true)
returns table (touches integer, exemples text[])
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not a_permission(p_evenement, 'rh', 'modifier') and not a_tout_pouvoir(p_evenement) then
    raise exception 'Recalage du planning non autorisé' using errcode = '42501';
  end if;
  return query select * from _recaler_jalons(p_evenement, p_simuler);
end $$;

-- ---------------------------------------------------------------------
-- 7. Déplacer un jalon, et entraîner ses successeurs
-- ---------------------------------------------------------------------
create or replace function public.deplacer_jalon(p_jalon uuid, p_debut timestamptz, p_fin timestamptz, p_entrainer boolean default true)
returns table (deplaces integer, apres_j integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j jalons%rowtype; ev evenements%rowtype; s jalons%rowtype; d record;
  v_cur uuid; v_besoin timestamptz; v_delta interval;
  v_deplaces int := 0; v_apres int := 0;
begin
  select * into j from jalons where id = p_jalon and deleted_at is null;
  if j.id is null then raise exception 'Jalon inconnu' using errcode = 'P0002'; end if;
  if not a_permission(j.evenement_id, 'rh', 'modifier') and not a_tout_pouvoir(j.evenement_id) then
    raise exception 'Déplacement non autorisé' using errcode = '42501';
  end if;
  if p_fin is null then raise exception 'La fin est obligatoire'; end if;
  if p_debut is not null and p_debut > p_fin then raise exception 'Le début est après la fin'; end if;
  select * into ev from evenements where id = j.evenement_id;

  update jalons set debut = p_debut, echeance = p_fin where id = p_jalon;
  if ev.date_debut is not null and (p_fin at time zone 'Europe/Brussels')::date > ev.date_debut then v_apres := 1; end if;

  if p_entrainer then
    if to_regclass('pg_temp.file_129') is null then
      create temp table file_129 (id uuid primary key, traite boolean not null default false) on commit drop;
    end if;
    delete from file_129 where id is not null;
    insert into file_129 (id) values (p_jalon);
    loop
      select f.id into v_cur from file_129 f where not f.traite limit 1;
      exit when v_cur is null;
      update file_129 set traite = true where id = v_cur;
      for d in select dp.jalon_id, dp.decalage_j, p.echeance as fin_pred
                 from jalon_dependances dp join jalons p on p.id = dp.precede_id
                where dp.precede_id = v_cur loop
        select * into s from jalons where id = d.jalon_id and deleted_at is null and statut in ('a_venir','en_cours');
        if s.id is null or s.echeance is null then continue; end if;
        v_besoin := d.fin_pred + make_interval(days => d.decalage_j);
        if coalesce(s.debut, s.echeance) < v_besoin then
          v_delta := v_besoin - coalesce(s.debut, s.echeance);
          update jalons set debut = debut + v_delta, echeance = echeance + v_delta where id = s.id;
          v_deplaces := v_deplaces + 1;
          if ev.date_debut is not null and ((s.echeance + v_delta) at time zone 'Europe/Brussels')::date > ev.date_debut then
            v_apres := v_apres + 1;
          end if;
          insert into file_129 (id) values (s.id) on conflict (id) do update set traite = false;
        end if;
      end loop;
    end loop;
  end if;
  return query select v_deplaces, v_apres;
end $$;

-- ---------------------------------------------------------------------
-- 8. Reconduction : les jalons gardent leur place relative à J
--    (redéfinie en entier, base : 047 / 101 ; seul le bloc jalons change)
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
-- 9. Droits : retirer d'abord à PUBLIC et anon (090), puis accorder
-- ---------------------------------------------------------------------
revoke execute on function
  public.gantt(uuid),
  public.chemin_critique(uuid),
  public.recaler_jalons(uuid, boolean),
  public._recaler_jalons(uuid, boolean),
  public.deplacer_jalon(uuid, timestamptz, timestamptz, boolean),
  public.jour_ancre(uuid, text),
  public.dupliquer_evenement(uuid, text, text, date, date)
from public, anon;
revoke execute on function public._recaler_jalons(uuid, boolean) from authenticated;

grant execute on function
  public.gantt(uuid),
  public.chemin_critique(uuid),
  public.recaler_jalons(uuid, boolean),
  public.deplacer_jalon(uuid, timestamptz, timestamptz, boolean),
  public.jour_ancre(uuid, text),
  public.dupliquer_evenement(uuid, text, text, date, date)
to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION (éditeur SQL, en simulant un coordinateur ; le bloc du
-- README de la 129 rejoue les sept points du briefing en transaction
-- annulée)
--   select * from gantt('<evenement>');
--   select * from chemin_critique('<evenement>');
--   select * from recaler_jalons('<evenement>', true);
-- =====================================================================
