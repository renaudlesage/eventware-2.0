-- =====================================================================
-- 103 — DEUX POLICIES TESTAIENT UNE RESSOURCE QUI N'EXISTE PAS
--
-- La 055 a écrit `a_permission(evenement_id, 'lieux', 'creer')` pour
-- les moyens de premiers secours et les segments de parcours. Or
-- `lieux` n'est pas une ressource de la matrice : elle n'apparaît ni
-- dans `matrice_permissions` ni dans `role_capacites`. `a_permission`
-- ne trouve donc jamais de ligne et répond faux — sauf pour un rôle
-- `tout_pouvoir`, qui court-circuite la matrice (règle R1). Résultat :
-- seul un coordinateur pouvait écrire ces deux tables, quelle que soit
-- la matrice. Un chef d'équipe à qui l'on a donné `parcours:creer`
-- voyait le formulaire et recevait « droits insuffisants ».
--
-- Pourquoi personne ne l'a vu : les essais se font en coordinateur.
-- C'est exactement le cas que le bloc E de droits.sql (rôle SANS
-- tout_pouvoir) existe pour attraper — il est étendu à ces deux tables.
--
-- Ressources retenues, celles des écrans qui écrivent ces tables :
--   segments_parcours        → parcours          (Parcours.jsx)
--   moyens_premiers_secours  → plan_implantation (PlanImplantation.jsx)
-- =====================================================================

begin;

drop policy if exists segments_ecriture on segments_parcours;
create policy segments_ecriture on segments_parcours for all to authenticated
  using (a_permission(evenement_id, 'parcours', 'creer'))
  with check (a_permission(evenement_id, 'parcours', 'creer'));

drop policy if exists moyens_secours_ecriture on moyens_premiers_secours;
create policy moyens_secours_ecriture on moyens_premiers_secours for all to authenticated
  using (a_permission(evenement_id, 'plan_implantation', 'creer'))
  with check (a_permission(evenement_id, 'plan_implantation', 'creer'));

commit;

-- =====================================================================
-- VÉRIFICATION
--
--   select policyname, tablename from pg_policies
--   where qual like '%''lieux''%' or with_check like '%''lieux''%';
--   -- 0 ligne
-- =====================================================================
