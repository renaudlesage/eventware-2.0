-- =====================================================================
-- 151 — LES CATÉGORIES DE DEMANDE NAISSENT AVEC L'ÉVÉNEMENT
--       (retour de Ren, 29/10)
--
-- Sur BFMF 2027, « Nouvelle demande » n'offrait aucune catégorie : les
-- sept catégories fermées de la 060 n'avaient été semées que dans les
-- événements qui existaient alors. Un événement créé depuis n'en a
-- aucune, et une demande ne peut pas être injectée sans catégorie.
--
-- Ici : une fonction qui sème les sept catégories standard dans un
-- événement (celles qu'il n'a pas déjà, par code) ; on l'applique à
-- tout événement sans catégorie ; et un déclencheur la joue à la
-- création de chaque événement, comme les rôles et la veille météo.
-- Les catégories restent modifiables (import CSV, vidage). Aucun DROP.
-- =====================================================================

begin;

create or replace function public.semer_types_mission(p_evenement uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  insert into types_mission (evenement_id, code, libelle, categorie, priorite, delai_cible_min)
  select p_evenement, v.code, v.libelle, v.categorie, v.priorite::priorite_mission, v.delai
  from (values
    ('transport',   'Transport de personnes',           'transport_personnes', 'P3', 30),
    ('reappro',     'Réappro boissons / consommables',  'reappro_boissons',    'P3', 45),
    ('caisse',      'Monnaie / caisse',                 'monnaie_caisse',      'P3', 30),
    ('sanitaire',   'Sanitaire',                        'sanitaire',           'P2', 20),
    ('energie',     'Énergie / éclairage',              'energie',             'P2', 20),
    ('amenagement', 'Aménagement / installation',       'amenagement',         'P4', 60),
    ('securite',    'Sécurité — situation à risque',    'securite',            'P1', 10)
  ) as v(code, libelle, categorie, priorite, delai)
  where not exists (
    select 1 from types_mission t
    where t.evenement_id = p_evenement and t.code = v.code and t.deleted_at is null);
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.semer_types_mission(uuid) is
  '(151) Sème les sept catégories de demande standard dans un événement (celles qu''il n''a pas déjà).';
-- Fonction de service : jouée par le déclencheur et les migrations, pas par /rpc/.
revoke all on function public.semer_types_mission(uuid) from public, anon, authenticated;

-- Les événements qui n'ont aucune catégorie (BFMF 2027 et tout
-- événement créé après la 060).
select semer_types_mission(e.id)
from evenements e
where e.deleted_at is null
  and not exists (select 1 from types_mission t where t.evenement_id = e.id and t.deleted_at is null);

create or replace function public.trg_types_mission_nouvel_evenement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform semer_types_mission(new.id);
  return null;
end;
$$;
revoke all on function public.trg_types_mission_nouvel_evenement() from public, anon, authenticated;

create or replace trigger types_mission_nouvel_evenement after insert on evenements
  for each row execute function trg_types_mission_nouvel_evenement();

commit;

-- =====================================================================
-- VÉRIFICATION
--   select e.nom, count(t.id) from evenements e
--   left join types_mission t on t.evenement_id = e.id and t.deleted_at is null
--   where e.deleted_at is null group by e.nom;  -- 7 partout au moins
-- =====================================================================
