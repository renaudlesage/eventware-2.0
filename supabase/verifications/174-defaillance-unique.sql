-- =====================================================================
-- Vérification de la migration 174 — lecture seule.
--
-- À lancer dans le SQL Editor de Supabase, après le « Go 174 » :
-- remplacer le nom de l'événement, exécuter. Rien n'est écrit.
--
-- La fonction se réserve aux personnes qui lisent le plan de
-- l'événement. Le SQL Editor n'est personne : le script se présente
-- donc, le temps de la transaction, comme une personne à tout pouvoir
-- de cet événement, puis annule tout.
--
-- Lecture du résultat : `niveau` 3 = fonction non assurée ou groupe en
-- surcharge ; 2 = élément unique ; 1 = à vérifier ; 0 = tient.
-- =====================================================================
begin;

select set_config('request.jwt.claims',
         json_build_object('role', 'authenticated', 'sub',
           (select me.user_id
              from evenements e
              join membres_evenement me on me.evenement_id = e.id and me.actif and me.deleted_at is null
              join roles r on r.id = me.role_id and r.tout_pouvoir and r.deleted_at is null
             where e.nom = 'BFMF 2027' and e.deleted_at is null
             order by me.created_at limit 1))::text,
         true);

-- 1. Tout le résultat, le plus grave d'abord.
select niveau, fonction, ligne, verdict, detail, element
  from defaillance_unique((select id from evenements where nom = 'BFMF 2027' and deleted_at is null))
 order by niveau desc, ordre, fonction, ligne;

-- 2. Les seuils se règlent à l'appel. Exemple : un DEA à 150 m au plus, un voisinage de 50 m.
-- select niveau, fonction, ligne, verdict, detail
--   from defaillance_unique((select id from evenements where nom = 'BFMF 2027' and deleted_at is null), p_dea_m => 150, p_voisin_m => 50)
--  where niveau > 0 order by niveau desc, ordre;

rollback;

-- 3. Le contrôle des fonctions exposées doit rester vide.
select * from audit_fonctions_exposees();
