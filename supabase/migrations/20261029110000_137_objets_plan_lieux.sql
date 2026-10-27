-- =====================================================================
-- 137 — LES OBJETS DU PLAN SONT DES LIEUX (retour de Ren, 27/10)
--
-- Deux mondes cohabitaient : les lieux du référentiel (étapes, PC,
-- PRV), auxquels les demandes se rattachent et sur lesquels la charge
-- des lieux et ses dépendances (prc_*) se calculent ; et les objets de
-- la carte de conception (elements_plan) avec leurs liens (liens_plan),
-- sans passerelle. Un chapiteau lié à un groupe électrogène sur la
-- carte n'apparaissait donc nulle part dans Dépendances.
--
-- Désormais chaque objet du plan (nature `objet` : chapiteaux, scènes,
-- groupes, coffrets… pas les tracés ni les pictogrammes) a son reflet
-- dans `lieux`, tenu à jour par déclencheur : même code, même nom,
-- position du centre, type déduit de la catégorie. Supprimé du plan,
-- le lieu s'éteint (deleted_at). Et chaque lien de la carte devient une
-- dépendance de charge entre les deux lieux reflets : « alimente » à
-- 0,6 (l'alimenté dépend de l'alimentant), « lié à » à 0,5 dans les
-- deux sens. Retiré de la carte, le lien emporte ses dépendances
-- (clé en cascade). Une dépendance saisie à la main entre les mêmes
-- lieux garde la priorité.
--
-- Les déclencheurs sont `security definer` : celui qui dessine le plan
-- n'a pas forcément le droit d'écrire les référentiels ni le
-- précurseur, et le reflet n'est pas un choix de sa part.
--
-- Rattrapage : tous les objets et liens existants sont reflétés.
-- Aucun DROP.
-- =====================================================================

begin;

alter table public.lieux
  add column if not exists element_plan_id uuid references public.elements_plan(id) on delete set null;
comment on column public.lieux.element_plan_id is
  '(137) L''objet du plan dont ce lieu est le reflet : nom, code et position suivent l''objet.';
create unique index if not exists lieux_miroir_plan
  on public.lieux (element_plan_id) where element_plan_id is not null and deleted_at is null;

alter table public.prc_dependances
  add column if not exists lien_plan_id uuid references public.liens_plan(id) on delete cascade;
comment on column public.prc_dependances.lien_plan_id is
  '(137) Le lien de la carte de conception dont cette dépendance est le reflet ; partie avec lui.';
create index if not exists prc_dependances_lien_plan on public.prc_dependances (lien_plan_id) where lien_plan_id is not null;

-- Le type de lieu d'un objet du plan, d'après sa catégorie (et le QG
-- sécurité du catalogue, qui est un PC).
create or replace function public.type_lieu_du_plan(p_categorie public.categorie_element, p_code_catalogue text)
returns public.type_lieu
language sql immutable
as $f$
  select case
    when p_code_catalogue = 'QGSECU' then 'pc_ops'
    when p_categorie = 'scene' then 'scene'
    when p_categorie in ('bar', 'bar_installation', 'foodtruck') then 'bar'
    when p_categorie = 'camping' then 'camping'
    when p_categorie = 'parking' then 'parking'
    when p_categorie in ('poste_secours', 'pma') then 'poste_secours'
    when p_categorie in ('prv', 'point_rassemblement', 'aire_helico', 'perimetre', 'zone_interdite', 'point_rencontre_secours', 'point_transfert') then 'zone'
    when p_categorie in ('sortie_secours', 'cheminement') then 'entree'
    else 'autre'
  end::public.type_lieu
$f$;

-- Le reflet d'un objet : créé, mis à jour, ou éteint.
create or replace function public.miroir_lieu_element(p public.elements_plan)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_lieu uuid;
  v_code text;
  v_type public.type_lieu;
begin
  select id into v_lieu from lieux where element_plan_id = p.id and deleted_at is null;
  if p.nature is distinct from 'objet' or p.deleted_at is not null or p.centre_lat is null or p.centre_lon is null then
    if v_lieu is not null then
      update lieux set deleted_at = now() where id = v_lieu;
    end if;
    return;
  end if;
  -- Le code de l'objet ; suffixé si un autre lieu vivant le porte déjà.
  v_code := coalesce(nullif(trim(p.code), ''), 'OBJ');
  if exists (select 1 from lieux l where l.evenement_id = p.evenement_id and l.code = v_code and l.deleted_at is null and l.id is distinct from v_lieu) then
    v_code := v_code || '-P';
  end if;
  select type_lieu_du_plan(p.categorie, c.code) into v_type
    from (select 1) x left join catalogue_equipements c on c.id = p.catalogue_id;
  if v_lieu is null then
    insert into lieux (evenement_id, code, nom, type, latitude, longitude, description, actif, origine, element_plan_id)
    values (p.evenement_id, v_code, coalesce(nullif(trim(p.nom), ''), v_code), v_type, p.centre_lat, p.centre_lon,
            'Objet du plan d''implantation', true, 'humain', p.id);
  else
    update lieux
       set code = v_code, nom = coalesce(nullif(trim(p.nom), ''), v_code), type = v_type,
           latitude = p.centre_lat, longitude = p.centre_lon
     where id = v_lieu;
  end if;
end $f$;

create or replace function public.trg_miroir_lieu_element()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $f$
begin
  perform miroir_lieu_element(new);
  return new;
end $f$;

drop trigger if exists miroir_lieu_element on public.elements_plan;
create trigger miroir_lieu_element
  after insert or update on public.elements_plan
  for each row execute function public.trg_miroir_lieu_element();

-- Le reflet d'un lien : ses dépendances, refaites à chaque changement.
create or replace function public.miroir_dependance_lien(l public.liens_plan)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_de uuid; v_vers uuid; v_code_de text; v_code_vers text; v_poids numeric; v_note text;
begin
  delete from prc_dependances where lien_plan_id = l.id;
  select li.id, li.code into v_de, v_code_de from lieux li where li.element_plan_id = l.de_id and li.deleted_at is null;
  select li.id, li.code into v_vers, v_code_vers from lieux li where li.element_plan_id = l.vers_id and li.deleted_at is null;
  if v_de is null or v_vers is null or v_de = v_vers then
    return;
  end if;
  v_poids := case when l.nature = 'alimente' then 0.6 else 0.5 end;
  v_note := 'Lien de la carte : ' || v_code_de || ' ' || case l.nature when 'alimente' then 'alimente' else 'lié à' end || ' ' || v_code_vers
            || coalesce(' — ' || nullif(trim(l.note), ''), '');
  -- L'alimenté dépend de l'alimentant ; un simple lien joue dans les deux sens.
  insert into prc_dependances (evenement_id, amont_lieu_id, aval_lieu_id, poids, note, origine, lien_plan_id)
  values (l.evenement_id, v_de, v_vers, v_poids, v_note, 'humain', l.id)
  on conflict (amont_lieu_id, aval_lieu_id) do nothing;
  if l.nature is distinct from 'alimente' then
    insert into prc_dependances (evenement_id, amont_lieu_id, aval_lieu_id, poids, note, origine, lien_plan_id)
    values (l.evenement_id, v_vers, v_de, v_poids, v_note, 'humain', l.id)
    on conflict (amont_lieu_id, aval_lieu_id) do nothing;
  end if;
end $f$;

create or replace function public.trg_miroir_dependance_lien()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $f$
begin
  perform miroir_dependance_lien(new);
  return new;
end $f$;

drop trigger if exists miroir_dependance_lien on public.liens_plan;
create trigger miroir_dependance_lien
  after insert or update on public.liens_plan
  for each row execute function public.trg_miroir_dependance_lien();

-- Rattrapage de l'existant : les objets, puis les liens.
do $r$
declare p public.elements_plan; l public.liens_plan;
begin
  for p in select * from public.elements_plan where deleted_at is null and nature = 'objet' loop
    perform public.miroir_lieu_element(p);
  end loop;
  for l in select * from public.liens_plan loop
    perform public.miroir_dependance_lien(l);
  end loop;
end $r$;

commit;

-- =====================================================================
-- VÉRIFICATION
--   select count(*) from lieux where element_plan_id is not null and deleted_at is null;   -- = objets vivants
--   select count(*) from prc_dependances where lien_plan_id is not null;                  -- liens entre objets, ×2 pour « lié à »
-- =====================================================================
