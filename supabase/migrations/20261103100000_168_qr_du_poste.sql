-- =====================================================================
-- 168 — EVENTWARE QUI APPREND (2) : LE QR DU POSTE
--
-- Un bénévole arrive à son poste, souvent sans avoir lu quoi que ce
-- soit. Un QR collé sur le bar, le stand jetons, la barrière lui ouvre,
-- sans compte ni installation, la page du poste : sa fiche (mission,
-- tâches, matériel, à signaler), le créneau en cours et le suivant, le
-- canal radio de l'équipe et le canal d'urgence, le DEA et la sortie de
-- secours les plus proches, les fiches réflexe, et le numéro du QG.
--
-- Garde-fou : la page est publique. Elle ne montre jamais un nom de
-- bénévole ni un numéro personnel : les numéros de téléphone trouvés
-- dans la fiche ou les fiches réflexe (hors 100, 101, 112) sont masqués,
-- seul le numéro du QG déclaré sur l'événement est affiché.
--
--   postes_qr                 un jeton par poste (distinct des créneaux)
--   generer_postes_qr         crée les postes manquants depuis les créneaux
--   poste_par_jeton           la page, pour anon (compteur d'accès)
--   evenements.telephone_qg   le seul numéro public
--
-- Aucun DROP, rejouable.
-- =====================================================================

begin;

alter table public.evenements add column if not exists telephone_qg text;
comment on column public.evenements.telephone_qg is 'Numéro du QG affiché sur la page publique du poste (168). Le seul numéro qui y figure.';

create table if not exists public.postes_qr (
  id            uuid primary key default gen_random_uuid(),
  evenement_id  uuid not null references public.evenements (id) on delete cascade,
  poste         text not null,
  jeton         uuid not null default gen_random_uuid() unique,
  fiche_id      uuid references public.fiches_poste (id) on delete set null,
  lieu_id       uuid references public.lieux (id) on delete set null,
  equipe_id     uuid references public.equipes (id) on delete set null,
  consigne      text,
  actif         boolean not null default true,
  nb_acces      integer not null default 0,
  dernier_acces timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);
comment on table public.postes_qr is 'Le QR du poste (168) : un jeton public par poste, qui ouvre la fiche, le créneau, le canal radio, les secours proches et les fiches réflexe — sans nom ni numéro personnel.';
create unique index if not exists postes_qr_poste_unique on public.postes_qr (evenement_id, lower(poste)) where deleted_at is null;
create index if not exists postes_qr_evenement_idx on public.postes_qr (evenement_id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tracabilite_postes_qr') then
    create trigger tracabilite_postes_qr before insert or update on public.postes_qr for each row execute function trg_tracabilite_simple();
  end if;
end $$;

alter table public.postes_qr enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'postes_qr' and policyname = 'postes_qr_lecture') then
    create policy postes_qr_lecture on public.postes_qr for select to authenticated using (est_membre(evenement_id) and deleted_at is null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'postes_qr' and policyname = 'postes_qr_creation') then
    create policy postes_qr_creation on public.postes_qr for insert to authenticated with check (a_permission(evenement_id, 'rh', 'modifier'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'postes_qr' and policyname = 'postes_qr_modification') then
    create policy postes_qr_modification on public.postes_qr for update to authenticated using (a_permission(evenement_id, 'rh', 'modifier')) with check (a_permission(evenement_id, 'rh', 'modifier'));
  end if;
end $$;
grant select, insert, update on public.postes_qr to authenticated;
revoke all on public.postes_qr from anon;

-- Un poste par libellé distinct de créneau. Fiche, lieu et équipe sont
-- pris sur les créneaux du poste (la valeur la plus fréquente) quand le
-- poste ne les a pas encore. Rend le nombre de postes créés.
create or replace function public.generer_postes_qr(p_evenement uuid)
returns integer language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not (a_tout_pouvoir(p_evenement) or a_permission(p_evenement, 'rh', 'modifier')) then
    raise exception 'Générer les QR des postes demande « bénévoles : modifier ».' using errcode = '42501';
  end if;
  insert into postes_qr (evenement_id, poste)
  select distinct p_evenement, trim(c.poste)
    from creneaux c
   where c.evenement_id = p_evenement and c.deleted_at is null and nullif(trim(c.poste), '') is not null
     and not exists (select 1 from postes_qr q where q.evenement_id = p_evenement and q.deleted_at is null and lower(q.poste) = lower(trim(c.poste)));
  get diagnostics v_n = row_count;

  -- Ce que les créneaux savent du poste.
  update postes_qr q
     set fiche_id  = coalesce(q.fiche_id,  (select c.fiche_id  from creneaux c where c.evenement_id = p_evenement and c.deleted_at is null and lower(trim(c.poste)) = lower(q.poste) and c.fiche_id  is not null group by c.fiche_id  order by count(*) desc limit 1)),
         lieu_id   = coalesce(q.lieu_id,   (select c.lieu_id   from creneaux c where c.evenement_id = p_evenement and c.deleted_at is null and lower(trim(c.poste)) = lower(q.poste) and c.lieu_id   is not null group by c.lieu_id   order by count(*) desc limit 1)),
         equipe_id = coalesce(q.equipe_id, (select c.equipe_id from creneaux c where c.evenement_id = p_evenement and c.deleted_at is null and lower(trim(c.poste)) = lower(q.poste) and c.equipe_id is not null group by c.equipe_id order by count(*) desc limit 1))
   where q.evenement_id = p_evenement and q.deleted_at is null
     and (q.fiche_id is null or q.lieu_id is null or q.equipe_id is null);

  if v_n > 0 then
    perform journaliser(p_evenement, 'rh', 'qr_poste', format('%s QR de poste généré(s)', v_n), 'routine');
  end if;
  return v_n;
end $$;
grant execute on function public.generer_postes_qr(uuid) to authenticated;

-- Masque les numéros de téléphone (8 chiffres et plus, avec espaces, points,
-- barres ou tirets) ; garde 100, 101, 112 et les numéros courts.
create or replace function public.masquer_numeros(p_texte text)
returns text language sql immutable as $$
  select case when p_texte is null then null
         else regexp_replace(p_texte, '\+?\(?\d[\d ()./-]{6,}\d', '[numéro : voir le QG]', 'g') end;
$$;

-- La page du poste, par jeton. Publique : rien de nominatif, aucun numéro
-- hors celui du QG. Compte les accès.
create or replace function public.poste_par_jeton(p_jeton uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare q postes_qr%rowtype; ev evenements%rowtype; v jsonb; v_lat float8; v_lon float8; v_equipe uuid;
begin
  select * into q from postes_qr where jeton = p_jeton and deleted_at is null;
  if q.id is null then raise exception 'Ce QR ne correspond à aucun poste.' using errcode = 'P0002'; end if;
  if not q.actif then raise exception 'Ce QR a été désactivé par l''organisateur.' using errcode = 'P0003'; end if;
  select * into ev from evenements where id = q.evenement_id and deleted_at is null;
  if ev.id is null then raise exception 'Ce QR ne correspond à aucun poste.' using errcode = 'P0002'; end if;

  update postes_qr set nb_acces = nb_acces + 1, dernier_acces = clock_timestamp() where id = q.id;

  select l.latitude, l.longitude into v_lat, v_lon from lieux l where l.id = q.lieu_id;
  -- L'équipe : celle du poste, sinon celle du créneau en cours ou à venir.
  v_equipe := coalesce(q.equipe_id, (
    select c.equipe_id from creneaux c
     where c.evenement_id = q.evenement_id and c.deleted_at is null and lower(trim(c.poste)) = lower(q.poste) and c.equipe_id is not null
     order by (now() between c.debut and c.fin) desc, (c.debut > now()) desc, abs(extract(epoch from c.debut - now())) limit 1));

  select jsonb_build_object(
    'evenement', jsonb_build_object('nom', ev.nom, 'logo_url', ev.logo_url, 'phase', ev.phase, 'date_debut', ev.date_debut, 'date_fin', ev.date_fin, 'telephone_qg', ev.telephone_qg),
    'poste', jsonb_build_object('poste', q.poste, 'consigne', masquer_numeros(q.consigne),
                                'lieu', (select l.nom from lieux l where l.id = q.lieu_id),
                                'equipe', (select e.code || ' · ' || e.nom from equipes e where e.id = v_equipe and e.deleted_at is null)),
    'fiche', (
      select jsonb_build_object('intitule', f.intitule, 'mission', f.mission, 'taches', coalesce(f.taches, '[]'::jsonb),
                                'materiel', f.materiel, 'a_signaler', f.a_signaler, 'contact', masquer_numeros(f.contact))
        from fiches_poste f where f.id = q.fiche_id and f.deleted_at is null
    ),
    'creneau_courant', (
      select jsonb_build_object('code', c.code, 'debut', c.debut, 'fin', c.fin, 'consignes', masquer_numeros(c.consignes), 'besoin', c.besoin,
                                'equipe', (select e.code from equipes e where e.id = c.equipe_id), 'lieu', (select l.nom from lieux l where l.id = c.lieu_id))
        from creneaux c
       where c.evenement_id = q.evenement_id and c.deleted_at is null and lower(trim(c.poste)) = lower(q.poste) and now() between c.debut and c.fin
       order by c.fin limit 1
    ),
    'creneau_suivant', (
      select jsonb_build_object('code', c.code, 'debut', c.debut, 'fin', c.fin, 'consignes', masquer_numeros(c.consignes), 'besoin', c.besoin,
                                'equipe', (select e.code from equipes e where e.id = c.equipe_id), 'lieu', (select l.nom from lieux l where l.id = c.lieu_id))
        from creneaux c
       where c.evenement_id = q.evenement_id and c.deleted_at is null and lower(trim(c.poste)) = lower(q.poste) and c.debut > now()
       order by c.debut limit 1
    ),
    'radio', jsonb_build_object(
      'equipe', (select jsonb_build_object('numero', r.numero, 'libelle', r.libelle) from canaux_radio r
                  where r.evenement_id = q.evenement_id and r.deleted_at is null and r.actif and r.equipe_id = v_equipe and not r.canal_urgence
                  order by r.ordre nulls last, r.numero limit 1),
      'urgence', (select jsonb_build_object('numero', r.numero, 'libelle', r.libelle) from canaux_radio r
                   where r.evenement_id = q.evenement_id and r.deleted_at is null and r.actif and r.canal_urgence
                   order by r.ordre nulls last, r.numero limit 1)
    ),
    -- Les secours autour du poste : le plus proche de chaque sorte (plan d'implantation, puis lieux de type poste de secours).
    'secours', (
      select coalesce(jsonb_agg(s.x order by s.rang, s.distance nulls last), '[]'::jsonb)
        from (
          select distinct on (t.categorie) t.categorie,
                 case t.categorie when 'dea' then 1 when 'poste_secours' then 2 when 'sortie_secours' then 3 when 'point_rencontre_secours' then 4 else 5 end as rang,
                 t.distance,
                 jsonb_build_object('categorie', t.categorie, 'nom', t.nom, 'distance_m', round(t.distance)::int) as x
            from (
              select p.categorie, coalesce(nullif(p.nom, ''), p.code) as nom,
                     case when v_lat is not null and p.centre_lat is not null then distance_m(v_lat, v_lon, p.centre_lat, p.centre_lon) end as distance
                from elements_plan p
               where p.evenement_id = q.evenement_id and p.deleted_at is null
                 and p.categorie in ('dea', 'poste_secours', 'sortie_secours', 'point_rencontre_secours', 'prv')
              union all
              select 'poste_secours', l.nom,
                     case when v_lat is not null and l.latitude is not null then distance_m(v_lat, v_lon, l.latitude, l.longitude) end
                from lieux l
               where l.evenement_id = q.evenement_id and l.deleted_at is null and l.type = 'poste_secours' and l.id is distinct from q.lieu_id
            ) t
           order by t.categorie, t.distance nulls last, t.nom
        ) s
    ),
    'reflexes', (
      select coalesce(jsonb_agg(jsonb_build_object('code', f.code, 'titre', f.titre, 'categorie', f.categorie, 'declencheur', f.declencheur,
                                                   'conduite', coalesce(f.conduite, '[]'::jsonb), 'a_ne_pas_faire', coalesce(f.a_ne_pas_faire, '[]'::jsonb),
                                                   'contacts', masquer_numeros(f.contacts)) order by f.ordre nulls last, f.code), '[]'::jsonb)
        from fiches_reflexe f where f.evenement_id = q.evenement_id and f.deleted_at is null
    )
  ) into v;
  return v;
end $$;
revoke all on function public.poste_par_jeton(uuid) from public;
grant execute on function public.poste_par_jeton(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
