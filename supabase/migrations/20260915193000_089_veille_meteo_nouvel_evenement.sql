-- =====================================================================
-- 089 — Seuils de veille météo pour tout nouvel événement
--
-- La migration 036 a semé `veille_meteo` pour les événements qui
-- existaient ce jour-là. Rien ne le faisait pour les suivants, et le
-- front ne sait que faire un `update`, jamais un `insert` : tout
-- événement créé après le 27/08 naissait donc sans seuils, et
-- `Meteo.jsx` sortait sur `if (!seuils) return null`. Le bloc Veille
-- météo disparaissait en silence, sans message — constaté sur BFMF2027.
--
-- Défaut de commercialisation plus que de test : chaque futur client
-- aurait eu le même écran vide, sans aucun moyen d'y remédier depuis
-- l'interface.
-- =====================================================================

begin;

-- Rattrapage des événements créés après la 036
insert into veille_meteo (evenement_id)
select e.id
from evenements e
left join veille_meteo v on v.evenement_id = e.id
where v.evenement_id is null;

-- Et pour tous les suivants : un événement naît avec ses seuils, comme
-- il naît avec ses rôles standard. Les valeurs par défaut de la table
-- font le reste ; elles restent modifiables dans l'écran Météo.
create or replace function trg_veille_nouvel_evenement()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into veille_meteo (evenement_id)
  values (new.id)
  on conflict (evenement_id) do nothing;
  return null;
end;
$$;

-- Même règle qu'en 088 : une fonction de trigger n'a rien à faire sur
-- /rpc/. Sans ce revoke, on rouvrirait à `anon` ce qu'on vient de
-- fermer.
revoke all on function trg_veille_nouvel_evenement()
  from public, anon, authenticated;

drop trigger if exists veille_nouvel_evenement on evenements;
create trigger veille_nouvel_evenement after insert on evenements
  for each row execute function trg_veille_nouvel_evenement();

commit;
