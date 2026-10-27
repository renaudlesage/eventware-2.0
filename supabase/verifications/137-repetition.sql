-- =====================================================================
-- RÉPÉTITION À BLANC DE LA 137 — à coller dans l'éditeur SQL Supabase.
-- Tout est annulé par le `raise exception` final : rien n'est écrit.
-- Résultat attendu (en rouge, c'est normal) :
--   DRY RUN 137 OK : rattrapage 14 lieux (attendu 14), 4 dépendances
--   (attendu 4) ; objet posé → lieu « Essai chapiteau » ; renommé suivi 1
--   (1) ; lien alimente → dépendance 0,6 : 1 (1) ; lien retiré → 0 (0) ;
--   objet supprimé → lieu éteint 1 (1)
-- Ensuite : coller 20261029110000_137_objets_plan_lieux.sql en entier,
-- puis les trois lignes d'inscription du README (section 137).
-- =====================================================================
do $m$
declare
  n_lieux int; n_deps int; v_el uuid; v_lieu uuid; v_nom text; v_lien uuid; n1 int; n2 int; n3 int; n4 int; p public.elements_plan; l public.liens_plan;
  ev constant uuid := 'efefb655-39bb-41cb-9590-ae3aece1d1f1';  -- BFMF 2027
begin
  alter table public.lieux add column if not exists element_plan_id uuid references public.elements_plan(id) on delete set null;
  create unique index if not exists lieux_miroir_plan on public.lieux (element_plan_id) where element_plan_id is not null and deleted_at is null;
  alter table public.prc_dependances add column if not exists lien_plan_id uuid references public.liens_plan(id) on delete cascade;
  create index if not exists prc_dependances_lien_plan on public.prc_dependances (lien_plan_id) where lien_plan_id is not null;

  create or replace function public.type_lieu_du_plan(p_categorie public.categorie_element, p_code_catalogue text)
  returns public.type_lieu language sql immutable as $f$
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

  create or replace function public.miroir_lieu_element(p public.elements_plan)
  returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
  declare v_lieu uuid; v_code text; v_type public.type_lieu;
  begin
    select id into v_lieu from lieux where element_plan_id = p.id and deleted_at is null;
    if p.nature is distinct from 'objet' or p.deleted_at is not null or p.centre_lat is null or p.centre_lon is null then
      if v_lieu is not null then update lieux set deleted_at = now() where id = v_lieu; end if;
      return;
    end if;
    v_code := coalesce(nullif(trim(p.code), ''), 'OBJ');
    if exists (select 1 from lieux l where l.evenement_id = p.evenement_id and l.code = v_code and l.deleted_at is null and l.id is distinct from v_lieu) then
      v_code := v_code || '-P';
    end if;
    select type_lieu_du_plan(p.categorie, c.code) into v_type from (select 1) x left join catalogue_equipements c on c.id = p.catalogue_id;
    if v_lieu is null then
      insert into lieux (evenement_id, code, nom, type, latitude, longitude, description, actif, origine, element_plan_id)
      values (p.evenement_id, v_code, coalesce(nullif(trim(p.nom), ''), v_code), v_type, p.centre_lat, p.centre_lon, 'Objet du plan d''implantation', true, 'humain', p.id);
    else
      update lieux set code = v_code, nom = coalesce(nullif(trim(p.nom), ''), v_code), type = v_type, latitude = p.centre_lat, longitude = p.centre_lon where id = v_lieu;
    end if;
  end $f$;

  create or replace function public.trg_miroir_lieu_element() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
  begin perform miroir_lieu_element(new); return new; end $f$;
  drop trigger if exists miroir_lieu_element on public.elements_plan;
  create trigger miroir_lieu_element after insert or update on public.elements_plan for each row execute function public.trg_miroir_lieu_element();

  create or replace function public.miroir_dependance_lien(l public.liens_plan)
  returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
  declare v_de uuid; v_vers uuid; v_code_de text; v_code_vers text; v_poids numeric; v_note text;
  begin
    delete from prc_dependances where lien_plan_id = l.id;
    select li.id, li.code into v_de, v_code_de from lieux li where li.element_plan_id = l.de_id and li.deleted_at is null;
    select li.id, li.code into v_vers, v_code_vers from lieux li where li.element_plan_id = l.vers_id and li.deleted_at is null;
    if v_de is null or v_vers is null or v_de = v_vers then return; end if;
    v_poids := case when l.nature = 'alimente' then 0.6 else 0.5 end;
    v_note := 'Lien de la carte : ' || v_code_de || ' ' || case l.nature when 'alimente' then 'alimente' else 'lié à' end || ' ' || v_code_vers || coalesce(' — ' || nullif(trim(l.note), ''), '');
    insert into prc_dependances (evenement_id, amont_lieu_id, aval_lieu_id, poids, note, origine, lien_plan_id)
    values (l.evenement_id, v_de, v_vers, v_poids, v_note, 'humain', l.id) on conflict (amont_lieu_id, aval_lieu_id) do nothing;
    if l.nature is distinct from 'alimente' then
      insert into prc_dependances (evenement_id, amont_lieu_id, aval_lieu_id, poids, note, origine, lien_plan_id)
      values (l.evenement_id, v_vers, v_de, v_poids, v_note, 'humain', l.id) on conflict (amont_lieu_id, aval_lieu_id) do nothing;
    end if;
  end $f$;

  create or replace function public.trg_miroir_dependance_lien() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
  begin perform miroir_dependance_lien(new); return new; end $f$;
  drop trigger if exists miroir_dependance_lien on public.liens_plan;
  create trigger miroir_dependance_lien after insert or update on public.liens_plan for each row execute function public.trg_miroir_dependance_lien();

  for p in select * from public.elements_plan where deleted_at is null and nature = 'objet' loop perform public.miroir_lieu_element(p); end loop;
  for l in select * from public.liens_plan loop perform public.miroir_dependance_lien(l); end loop;

  -- Tranche 1 : rattrapage sur BFMF 2027 (14 objets, 2 liens entre objets « lié à » → 4 dépendances ; le lien du câble n'en donne pas, un tracé n'est pas un lieu).
  select count(*) into n_lieux from lieux where evenement_id = ev and element_plan_id is not null and deleted_at is null;
  select count(*) into n_deps from prc_dependances where evenement_id = ev and lien_plan_id is not null;
  -- Tranche 2 : un objet posé → un lieu ; renommé → suivi ; supprimé → éteint.
  insert into elements_plan (evenement_id, nom, nature, calque, categorie, forme, forme_echelle, centre_lat, centre_lon, largeur_m, longueur_m, geometrie)
  values (ev, 'Essai chapiteau', 'objet', 'infrastructures', 'autre', 'zone', 'rect', 50.3825, 5.6168, 6, 12, '[[50.3825, 5.6168]]'::jsonb) returning id into v_el;
  select id, nom into v_lieu, v_nom from lieux where element_plan_id = v_el and deleted_at is null;
  update elements_plan set nom = 'Essai renommé' where id = v_el;
  select count(*) into n1 from lieux where id = v_lieu and nom = 'Essai renommé' and deleted_at is null;
  -- Tranche 3 : un lien « alimente » depuis le groupe → une dépendance à 0,6 ; retiré → disparue.
  insert into liens_plan (evenement_id, de_id, vers_id, nature) select ev, id, v_el, 'alimente' from elements_plan where evenement_id = ev and code = 'GE100-01' returning id into v_lien;
  select count(*) into n2 from prc_dependances where lien_plan_id = v_lien and poids = 0.6 and aval_lieu_id = v_lieu;
  delete from liens_plan where id = v_lien;
  select count(*) into n3 from prc_dependances where lien_plan_id = v_lien;
  update elements_plan set deleted_at = now() where id = v_el;
  select count(*) into n4 from lieux where id = v_lieu and deleted_at is not null;
  raise exception 'DRY RUN 137 OK : rattrapage % lieux (attendu 14), % dépendances (attendu 4) ; objet posé → lieu « % » ; renommé suivi % (1) ; lien alimente → dépendance 0,6 : % (1) ; lien retiré → % (0) ; objet supprimé → lieu éteint % (1)', n_lieux, n_deps, v_nom, n1, n2, n3, n4;
end $m$;
