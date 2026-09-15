-- =====================================================================
-- 042 — REPRISE DE L'HISTORIQUE BFMF 2026
--
-- Import des 24 clés `app_store` de l'ancien projet (compte Bucolique)
-- dans un événement dédié BFMF2026, en phase clôture. L'historique
-- reste distinct de BFMF2027 : ce qui est réutilisable sera repris par
-- duplication le moment venu, pas mélangé ici.
--
-- Toutes les lignes portent origine = 'import' : elles sont donc
-- reconnaissables, et un réimport ne les confondra pas avec une saisie.
--
-- Ce qui N'EST PAS repris, faute de destination fidèle :
--   * les 26 bénévoles ne deviennent pas des membres — membres_evenement
--     exige un compte auth, qu'ils n'ont pas. Ils sont rangés en
--     contacts, et leurs créneaux gardent le nom du titulaire en
--     consigne. Un historique, pas une fausse affectation.
--   * la photo de la publication du 10/07 (940 Ko en base64) est livrée
--     à part : une image n'a pas sa place dans une colonne texte.
--   * jauge (compteurs vides), main-courante et incidents-carte
--     (tableaux vides) n'ont rien à reprendre.
--
-- À VÉRIFIER AVANT DE LANCER : les deux dates du festival ci-dessous.
-- Elles servent à replacer les créneaux et les heures « j1 / j2 », que
-- l'ancienne application stockait sans date.
-- =====================================================================

begin;

do $$
declare
  v_ev  uuid;
  v_org uuid;
  v_mod jsonb;
  v_j1  date := date '2026-07-18';   -- <== jour 1 du festival
  v_j2  date := date '2026-07-19';   -- <== jour 2
begin

-- L'événement doit être rattaché à l'organisation qui porte la licence,
-- pas à l'organisation d'essai par défaut : le déclencheur
-- trg_modules_sous_licence refuse tout module non souscrit.
select id, modules_autorises into v_org, v_mod
from organisations where nom ilike 'Bucolique%' and deleted_at is null limit 1;

if v_org is null then
  raise exception 'Organisation Bucolique introuvable — créez-la avant l''import.';
end if;

insert into evenements (nom, slug, geometrie, phase, date_debut, date_fin,
                        mode_parcours, modules, organisation_id, archive)
select 'BFMF2026', 'bfmf2026', 'hybride', 'cloture', v_j1, v_j2, 'groupes',
       -- Exactement les modules autorisés par la licence : pas un de plus.
       v_mod, v_org, true
returning id into v_ev;

-- ---------- 26 bénévoles → contacts ----------
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-01', 'Renaud Lesage', 'Coordinateur technique & sécurité', '+32 494 22 29 33', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-02', 'Jérôme Grosjean', 'Directeur d''événement', '+32 477 99 48 42', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-03', 'Simon Paquay', 'Responsable bar site', '+32 486 47 74 65', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-04', 'Grégori Rixhon', 'Responsable bar site', '+32 472 11 35 75', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-05', 'Nathalie Seron', 'Responsable bar site', '+32 498 79 78 36', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-06', 'Jérôme Fagnoul', 'Responsable bar site', '+32 496 30 76 08', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-07', 'Emmanuelle Warzée', 'Responsable bar site', '+32 498 07 56 48', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-08', 'Laurane Feron', 'Responsable Étape 1', '+32 496 35 89 26', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-09', 'Alexandre Sacré', 'Responsable Étape 1', '+32 479 05 09 81', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-10', 'Raphaël Lambotte', 'Responsable Étape 2', '+32 496 57 23 71', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-11', 'Lorent Lamberty', 'Responsable Étape 3', '+32 496 10 60 21', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-12', 'Jean-Christophe Mortehan', 'Responsable Étape 3', '+32 475 62 00 16', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-13', 'Sébastien Cruwels', 'Volante', '+32 492 84 06 32', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-14', 'Benoît Giminne', 'Volante', '+32 471 21 38 28', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-15', 'Axel Denteneer', 'Volante', '+32 494 25 31 35', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-16', 'Elodie Lesuisse', 'Trésorier', '+32492962397', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-17', 'Isalyne Dries', 'Trésorier', '+32 498 36 39 84', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-18', 'Anne Rixhon', 'Accompagnateur Balade', '+32 494 92 02 79', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-19', 'Charles Philippe', 'Accompagnateur Balade', '+32 497 13 83 19', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-20', 'Justine Vanguestaine', 'Accompagnateur Balade', '+32 479 12 37 43', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-21', 'Anicée Peeters', 'Accompagnateur Balade', '+32 494 41 36 90', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-22', 'Martin Lesuisse', 'Accompagnateur Balade', '+32 491 59 84 24', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-23', 'Anne-Aymone Guillot', 'Accompagnateur Balade', '+32 496 95 20 57', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-24', 'Zoé Godard', 'Accompagnateur Balade', '+32 498 15 37 91', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-25', 'Marie Grandprez', 'Accompagnateur Balade', '+32 495 62 55 36', 'bénévole 2026', 'import');
insert into contacts (evenement_id, code, nom, fonction, telephone, categorie, origine) values (v_ev, 'BV-26', 'Christophe Piels', 'Accompagnateur Balade', '+32 495 32 12 65', 'bénévole 2026', 'import');

-- ---------- créneaux tenus en 2026 (titulaire en consigne) ----------
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-001', 'Coordinateur technique & sécurité', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '04:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '04:00')::timestamptz + interval '1 day' else (v_j1 + time '04:00')::timestamptz end, 1, '2026 — tenu par Renaud Lesage', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-002', 'Coordinateur technique & sécurité', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '02:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '02:00')::timestamptz + interval '1 day' else (v_j2 + time '02:00')::timestamptz end, 1, '2026 — tenu par Renaud Lesage', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-003', 'Directeur d''événement', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '04:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '04:00')::timestamptz + interval '1 day' else (v_j1 + time '04:00')::timestamptz end, 1, '2026 — tenu par Jérôme Grosjean', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-004', 'Directeur d''événement', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '02:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '02:00')::timestamptz + interval '1 day' else (v_j2 + time '02:00')::timestamptz end, 1, '2026 — tenu par Jérôme Grosjean', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-005', 'Bar site', (v_j1 + time '12:00')::timestamptz, case when (v_j1 + time '18:00')::timestamptz <= (v_j1 + time '12:00')::timestamptz then (v_j1 + time '18:00')::timestamptz + interval '1 day' else (v_j1 + time '18:00')::timestamptz end, 1, '2026 — tenu par Simon Paquay', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-006', 'Bar site', (v_j1 + time '21:00')::timestamptz, case when (v_j1 + time '00:00')::timestamptz <= (v_j1 + time '21:00')::timestamptz then (v_j1 + time '00:00')::timestamptz + interval '1 day' else (v_j1 + time '00:00')::timestamptz end, 1, '2026 — tenu par Simon Paquay', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-007', 'Bar site', (v_j2 + time '10:00')::timestamptz, case when (v_j2 + time '16:00')::timestamptz <= (v_j2 + time '10:00')::timestamptz then (v_j2 + time '16:00')::timestamptz + interval '1 day' else (v_j2 + time '16:00')::timestamptz end, 1, '2026 — tenu par Simon Paquay', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-008', 'Bar site', (v_j2 + time '22:00')::timestamptz, case when (v_j2 + time '00:30')::timestamptz <= (v_j2 + time '22:00')::timestamptz then (v_j2 + time '00:30')::timestamptz + interval '1 day' else (v_j2 + time '00:30')::timestamptz end, 1, '2026 — tenu par Simon Paquay', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-009', 'Bar site', (v_j1 + time '18:00')::timestamptz, case when (v_j1 + time '21:00')::timestamptz <= (v_j1 + time '18:00')::timestamptz then (v_j1 + time '21:00')::timestamptz + interval '1 day' else (v_j1 + time '21:00')::timestamptz end, 1, '2026 — tenu par Grégori Rixhon', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-010', 'Bar site', (v_j2 + time '00:00')::timestamptz, case when (v_j2 + time '02:30')::timestamptz <= (v_j2 + time '00:00')::timestamptz then (v_j2 + time '02:30')::timestamptz + interval '1 day' else (v_j2 + time '02:30')::timestamptz end, 1, '2026 — tenu par Grégori Rixhon', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-011', 'Bar site', (v_j2 + time '10:00')::timestamptz, case when (v_j2 + time '14:30')::timestamptz <= (v_j2 + time '10:00')::timestamptz then (v_j2 + time '14:30')::timestamptz + interval '1 day' else (v_j2 + time '14:30')::timestamptz end, 1, '2026 — tenu par Grégori Rixhon', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-012', 'Bar site', (v_j2 + time '19:00')::timestamptz, case when (v_j2 + time '22:00')::timestamptz <= (v_j2 + time '19:00')::timestamptz then (v_j2 + time '22:00')::timestamptz + interval '1 day' else (v_j2 + time '22:00')::timestamptz end, 1, '2026 — tenu par Grégori Rixhon', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-013', 'Bar site', (v_j1 + time '18:00')::timestamptz, case when (v_j1 + time '21:00')::timestamptz <= (v_j1 + time '18:00')::timestamptz then (v_j1 + time '21:00')::timestamptz + interval '1 day' else (v_j1 + time '21:00')::timestamptz end, 1, '2026 — tenu par Nathalie Seron', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-014', 'Bar site', (v_j2 + time '00:00')::timestamptz, case when (v_j2 + time '02:30')::timestamptz <= (v_j2 + time '00:00')::timestamptz then (v_j2 + time '02:30')::timestamptz + interval '1 day' else (v_j2 + time '02:30')::timestamptz end, 1, '2026 — tenu par Nathalie Seron', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-015', 'Bar site', (v_j2 + time '10:00')::timestamptz, case when (v_j2 + time '16:00')::timestamptz <= (v_j2 + time '10:00')::timestamptz then (v_j2 + time '16:00')::timestamptz + interval '1 day' else (v_j2 + time '16:00')::timestamptz end, 1, '2026 — tenu par Nathalie Seron', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-016', 'Bar site', (v_j2 + time '19:00')::timestamptz, case when (v_j2 + time '22:00')::timestamptz <= (v_j2 + time '19:00')::timestamptz then (v_j2 + time '22:00')::timestamptz + interval '1 day' else (v_j2 + time '22:00')::timestamptz end, 1, '2026 — tenu par Nathalie Seron', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-017', 'Bar site', (v_j2 + time '16:00')::timestamptz, case when (v_j2 + time '19:00')::timestamptz <= (v_j2 + time '16:00')::timestamptz then (v_j2 + time '19:00')::timestamptz + interval '1 day' else (v_j2 + time '19:00')::timestamptz end, 1, '2026 — tenu par Jérôme Fagnoul', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-018', 'Bar site', (v_j2 + time '22:00')::timestamptz, case when (v_j2 + time '00:30')::timestamptz <= (v_j2 + time '22:00')::timestamptz then (v_j2 + time '00:30')::timestamptz + interval '1 day' else (v_j2 + time '00:30')::timestamptz end, 1, '2026 — tenu par Jérôme Fagnoul', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-019', 'Bar site', (v_j2 + time '16:00')::timestamptz, case when (v_j2 + time '19:00')::timestamptz <= (v_j2 + time '16:00')::timestamptz then (v_j2 + time '19:00')::timestamptz + interval '1 day' else (v_j2 + time '19:00')::timestamptz end, 1, '2026 — tenu par Emmanuelle Warzée', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-020', 'Bar site', (v_j2 + time '22:00')::timestamptz, case when (v_j2 + time '00:30')::timestamptz <= (v_j2 + time '22:00')::timestamptz then (v_j2 + time '00:30')::timestamptz + interval '1 day' else (v_j2 + time '00:30')::timestamptz end, 1, '2026 — tenu par Emmanuelle Warzée', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-021', 'Étape 1', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Laurane Feron', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-022', 'Étape 1', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '23:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '23:00')::timestamptz + interval '1 day' else (v_j2 + time '23:00')::timestamptz end, 1, '2026 — tenu par Laurane Feron', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-023', 'Étape 1', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Alexandre Sacré', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-024', 'Étape 1', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '23:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '23:00')::timestamptz + interval '1 day' else (v_j2 + time '23:00')::timestamptz end, 1, '2026 — tenu par Alexandre Sacré', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-025', 'Étape 2', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Raphaël Lambotte', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-026', 'Étape 2', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '23:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '23:00')::timestamptz + interval '1 day' else (v_j2 + time '23:00')::timestamptz end, 1, '2026 — tenu par Raphaël Lambotte', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-027', 'Étape 3', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Lorent Lamberty', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-028', 'Étape 3', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '23:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '23:00')::timestamptz + interval '1 day' else (v_j2 + time '23:00')::timestamptz end, 1, '2026 — tenu par Lorent Lamberty', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-029', 'Étape 3', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Jean-Christophe Mortehan', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-030', 'Étape 3', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '23:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '23:00')::timestamptz + interval '1 day' else (v_j2 + time '23:00')::timestamptz end, 1, '2026 — tenu par Jean-Christophe Mortehan', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-031', 'Volante', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Sébastien Cruwels', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-032', 'Volante', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '23:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '23:00')::timestamptz + interval '1 day' else (v_j2 + time '23:00')::timestamptz end, 1, '2026 — tenu par Sébastien Cruwels', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-033', 'Volante', (v_j1 + time '10:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '10:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Benoît Giminne', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-034', 'Volante', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '16:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '16:00')::timestamptz + interval '1 day' else (v_j2 + time '16:00')::timestamptz end, 1, '2026 — tenu par Benoît Giminne', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-035', 'Volante', (v_j1 + time '10:00')::timestamptz, case when (v_j1 + time '23:00')::timestamptz <= (v_j1 + time '10:00')::timestamptz then (v_j1 + time '23:00')::timestamptz + interval '1 day' else (v_j1 + time '23:00')::timestamptz end, 1, '2026 — tenu par Axel Denteneer', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-036', 'Volante', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '16:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '16:00')::timestamptz + interval '1 day' else (v_j2 + time '16:00')::timestamptz end, 1, '2026 — tenu par Axel Denteneer', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-037', 'Trésorier', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '04:00')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '04:00')::timestamptz + interval '1 day' else (v_j1 + time '04:00')::timestamptz end, 1, '2026 — tenu par Elodie Lesuisse', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-038', 'Trésorier', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '02:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '02:00')::timestamptz + interval '1 day' else (v_j2 + time '02:00')::timestamptz end, 1, '2026 — tenu par Elodie Lesuisse', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-039', 'Trésorier', (v_j1 + time '08:00')::timestamptz, case when (v_j1 + time '23:59')::timestamptz <= (v_j1 + time '08:00')::timestamptz then (v_j1 + time '23:59')::timestamptz + interval '1 day' else (v_j1 + time '23:59')::timestamptz end, 1, '2026 — tenu par Isalyne Dries', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-040', 'Trésorier', (v_j2 + time '08:00')::timestamptz, case when (v_j2 + time '02:00')::timestamptz <= (v_j2 + time '08:00')::timestamptz then (v_j2 + time '02:00')::timestamptz + interval '1 day' else (v_j2 + time '02:00')::timestamptz end, 1, '2026 — tenu par Isalyne Dries', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-041', 'Accompagnateur balade 13h', (v_j1 + time '13:00')::timestamptz, case when (v_j1 + time '18:20')::timestamptz <= (v_j1 + time '13:00')::timestamptz then (v_j1 + time '18:20')::timestamptz + interval '1 day' else (v_j1 + time '18:20')::timestamptz end, 1, '2026 — tenu par Anne Rixhon', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-042', 'Accompagnateur balade 11h', (v_j2 + time '11:00')::timestamptz, case when (v_j2 + time '16:20')::timestamptz <= (v_j2 + time '11:00')::timestamptz then (v_j2 + time '16:20')::timestamptz + interval '1 day' else (v_j2 + time '16:20')::timestamptz end, 1, '2026 — tenu par Anne Rixhon', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-043', 'Accompagnateur balade 13h', (v_j1 + time '13:00')::timestamptz, case when (v_j1 + time '18:20')::timestamptz <= (v_j1 + time '13:00')::timestamptz then (v_j1 + time '18:20')::timestamptz + interval '1 day' else (v_j1 + time '18:20')::timestamptz end, 1, '2026 — tenu par Charles Philippe', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-044', 'Accompagnateur balade 14h30', (v_j1 + time '14:30')::timestamptz, case when (v_j1 + time '19:20')::timestamptz <= (v_j1 + time '14:30')::timestamptz then (v_j1 + time '19:20')::timestamptz + interval '1 day' else (v_j1 + time '19:20')::timestamptz end, 1, '2026 — tenu par Justine Vanguestaine', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-045', 'Accompagnateur balade 13h', (v_j2 + time '13:00')::timestamptz, case when (v_j2 + time '18:20')::timestamptz <= (v_j2 + time '13:00')::timestamptz then (v_j2 + time '18:20')::timestamptz + interval '1 day' else (v_j2 + time '18:20')::timestamptz end, 1, '2026 — tenu par Justine Vanguestaine', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-046', 'Accompagnateur balade 14h30', (v_j1 + time '14:30')::timestamptz, case when (v_j1 + time '19:20')::timestamptz <= (v_j1 + time '14:30')::timestamptz then (v_j1 + time '19:20')::timestamptz + interval '1 day' else (v_j1 + time '19:20')::timestamptz end, 1, '2026 — tenu par Anicée Peeters', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-047', 'Accompagnateur balade 11h', (v_j2 + time '11:00')::timestamptz, case when (v_j2 + time '16:20')::timestamptz <= (v_j2 + time '11:00')::timestamptz then (v_j2 + time '16:20')::timestamptz + interval '1 day' else (v_j2 + time '16:20')::timestamptz end, 1, '2026 — tenu par Anicée Peeters', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-048', 'Accompagnateur balade 16h', (v_j1 + time '16:00')::timestamptz, case when (v_j1 + time '21:20')::timestamptz <= (v_j1 + time '16:00')::timestamptz then (v_j1 + time '21:20')::timestamptz + interval '1 day' else (v_j1 + time '21:20')::timestamptz end, 1, '2026 — tenu par Martin Lesuisse', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-049', 'Accompagnateur balade 16h', (v_j1 + time '16:00')::timestamptz, case when (v_j1 + time '21:20')::timestamptz <= (v_j1 + time '16:00')::timestamptz then (v_j1 + time '21:20')::timestamptz + interval '1 day' else (v_j1 + time '21:20')::timestamptz end, 1, '2026 — tenu par Anne-Aymone Guillot', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-050', 'Accompagnateur balade 13h', (v_j2 + time '13:00')::timestamptz, case when (v_j2 + time '18:20')::timestamptz <= (v_j2 + time '13:00')::timestamptz then (v_j2 + time '18:20')::timestamptz + interval '1 day' else (v_j2 + time '18:20')::timestamptz end, 1, '2026 — tenu par Zoé Godard', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-051', 'Accompagnateur balade 14h30', (v_j2 + time '14:30')::timestamptz, case when (v_j2 + time '19:20')::timestamptz <= (v_j2 + time '14:30')::timestamptz then (v_j2 + time '19:20')::timestamptz + interval '1 day' else (v_j2 + time '19:20')::timestamptz end, 1, '2026 — tenu par Marie Grandprez', 'exploitation', 'import');
insert into creneaux (evenement_id, code, poste, debut, fin, besoin, consignes, phase, origine) values (v_ev, 'CR-052', 'Accompagnateur balade 14h30', (v_j2 + time '14:30')::timestamptz, case when (v_j2 + time '19:20')::timestamptz <= (v_j2 + time '14:30')::timestamptz then (v_j2 + time '19:20')::timestamptz + interval '1 day' else (v_j2 + time '19:20')::timestamptz end, 1, '2026 — tenu par Christophe Piels', 'exploitation', 'import');

-- ---------- inventaires de bar → matériel ----------
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-001', 'test', 'Bars', coalesce(5.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-002', 'Caisse chips sel', 'Bar étape 1', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-003', 'Caisse chips paprika', 'Bar étape 1', coalesce(2.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-004', 'Caisse thym-romarin', 'Bar étape 1', coalesce(0.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-005', 'Caisse chips chili citron', 'Bar étape 1', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-006', 'casier eau plate', 'Bar étape 1', coalesce(3.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-007', 'casier eau pèt', 'Bar étape 1', coalesce(3.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-008', 'casier limonade', 'Bar étape 1', coalesce(0.3,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-009', 'carton paola', 'Bar étape 1', coalesce(4.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-010', 'jus de pomme', 'Bar étape 1', coalesce(3.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-011', 'vin blanc', 'Bar étape 1', coalesce(12.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-012', 'vin rouge', 'Bar étape 1', coalesce(10.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-013', 'placebo', 'Bar étape 1', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-014', 'fut badjawe', 'Bar étape 1', coalesce(15.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-015', 'cidre', 'Bar étape 1', coalesce(0.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-016', 'caisse chips sel', 'Bar étape 2', coalesce(4.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-017', 'caisse chips paprika', 'Bar étape 2', coalesce(4.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-018', 'caisse chips thym-romarin', 'Bar étape 2', coalesce(2.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-019', 'caisse chips chili citron', 'Bar étape 2', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-020', 'casier eau plate', 'Bar étape 2', coalesce(4.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-021', 'casier eau pèt', 'Bar étape 2', coalesce(4.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-022', 'casier limonade', 'Bar étape 2', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-023', 'jus de pome', 'Bar étape 2', coalesce(6.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-024', 'carton paola', 'Bar étape 2', coalesce(8.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-025', 'maitrank', 'Bar étape 2', coalesce(18.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-026', 'vin blanc', 'Bar étape 2', coalesce(18.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-027', 'vin rouge', 'Bar étape 2', coalesce(12.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-028', 'fut baffe', 'Bar étape 2', coalesce(25.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-029', 'caisse chips sel', 'Bar étape 3', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-030', 'caisse chips paprika', 'Bar étape 3', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-031', 'caisse chips thym-romarin', 'Bar étape 3', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-032', 'caisse chips chili citron', 'Bar étape 3', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-033', 'casier eau plate', 'Bar étape 3', coalesce(2.5,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-034', 'casier eau pèt', 'Bar étape 3', coalesce(3.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-035', 'casier limonade', 'Bar étape 3', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-036', 'jus de pomme', 'Bar étape 3', coalesce(3.5,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-037', 'carton paola', 'Bar étape 3', coalesce(4.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-038', 'maitrank', 'Bar étape 3', coalesce(15.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-039', 'vin blanc', 'Bar étape 3', coalesce(12.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-040', 'vin rouge', 'Bar étape 3', coalesce(11.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-041', 'fut matin calme', 'Bar étape 3', coalesce(12.5,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-042', 'Lupulus Placebo', 'Bar étape 3', coalesce(1.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-043', 'Lupulus Pils', 'Bar plaine', coalesce(40.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-044', 'Experiment''ale Dynamite', 'Bar plaine', coalesce(20.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-045', 'Misery Animal Farmhouse', 'Bar plaine', coalesce(7.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-046', 'Lesse Chinette', 'Bar plaine', coalesce(20.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-047', 'Minnes Sangl''IPA', 'Bar plaine', coalesce(20.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-048', 'Lupulus Fructus', 'Bar plaine', coalesce(10.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-049', 'Lupuls Placebo', 'Bar plaine', coalesce(14.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-050', 'Lupulus Bleuette', 'Bar plaine', coalesce(10.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-051', 'Paola Cola', 'Bar plaine', coalesce(10.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-052', 'Minnolade', 'Bar plaine', coalesce(5.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-053', 'Villers Eau pétillante', 'Bar plaine', coalesce(20.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-054', 'Villers Eau plate', 'Bar plaine', coalesce(20.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-055', 'Jus de Pomme', 'Bar plaine', coalesce(10.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-056', 'Villers Limonade', 'Bar plaine', coalesce(4.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-057', 'Maitrank', 'Bar plaine', coalesce(44.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-058', 'Pêket', 'Bar plaine', coalesce(20.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-059', 'Vin Blanc', 'Bar plaine', coalesce(46.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-060', 'Vin Rouge', 'Bar plaine', coalesce(12.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-061', 'caisse chips sel', 'Bar plaine', coalesce(5.0,0), 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'STK-062', 'caisse chips paprika', 'Bar plaine', coalesce(5.0,0), 'import');

-- ---------- trousseau → matériel ----------
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-001', 'Remorque mazout + sabot', 'clé — clou 1 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-002', 'Clé Alex', 'clé — clou 2 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-003', 'Container stockage', 'clé — clou 3 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-004', 'Jeunesse Burnontige', 'clé — clou 4 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-005', 'Remorque Office du tourisme', 'clé — clou 5 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-006', 'Chapiteau backstage', 'clé — clou 6 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-007', 'Remorque frigo Dispas', 'clé — clou 7 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-008', 'Remorque Tom', 'clé — clou 8 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-009', 'Merlo petit', 'clé — clou 9 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-010', 'Merlo grand', 'clé — clou 10 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-011', 'Nissan', 'clé — clou 11 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-012', 'Groupe électrogène Mitch', 'clé — clou 12 · Disponible', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'K-013', 'Remorque Nadar', 'clé — clou 13 · Disponible', 1, 'import');

-- ---------- postes radio → matériel, canaux → canaux_radio ----------
insert into canaux_radio (evenement_id, numero, libelle, bande, ordre, origine) values (v_ev, '9', 'PMR4.1 (ch.9)', 'pmr446', 10, 'import');
insert into canaux_radio (evenement_id, numero, libelle, bande, ordre, origine) values (v_ev, '10', 'PMR5 (ch.10 / 5)', 'pmr446', 20, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'QG#03', 'Poste radio QG#03', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'QG#02', 'Poste radio QG#02', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'QG#01', 'Poste radio QG#01', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'UV5R#RÉSERVE', 'Poste radio UV5R#RÉSERVE', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'UV5R#06', 'Poste radio UV5R#06', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'UV5R#05', 'Poste radio UV5R#05', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'UV5R#04', 'Poste radio UV5R#04', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'UV5R#03', 'Poste radio UV5R#03', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'UV5R#02', 'Poste radio UV5R#02', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'UV5R#01', 'Poste radio UV5R#01', 'radio — PMR4.1 (ch.9) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'BF888#06', 'Poste radio BF888#06', 'radio — PMR5 (ch.10 / 5) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'BF888#05', 'Poste radio BF888#05', 'radio — PMR5 (ch.10 / 5) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'BF888#04', 'Poste radio BF888#04', 'radio — PMR5 (ch.10 / 5) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'BF888#03', 'Poste radio BF888#03', 'radio — PMR5 (ch.10 / 5) · QG · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'BF888#02', 'Poste radio BF888#02', 'radio — PMR5 (ch.10 / 5) · Qg · Retournée (en charge)', 1, 'import');
insert into materiel (evenement_id, code, nom, categorie, quantite, origine) values (v_ev, 'BF888#01', 'Poste radio BF888#01', 'radio — PMR5 (ch.10 / 5) · QG · Retournée (en charge)', 1, 'import');

-- ---------- 74 missions logistiques ----------
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-074', 'logistique', 'Rapatrier du jus de pomme des étapes vers le Backstage svp (1 ou 2 cubi) merci', 'Réf. d''origine LOG-2026-074. Rapatrier du jus de pomme des étapes vers le Backstage svp (1 ou 2 cubi) merci

19:02 — Demande creee automatiquement par profil de session: TOMMY (Directeur d''événement)
19:48 — En cours -- par Volante (app terrain)
20:01 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-073', 'logistique', 'Toilette backstage pleine. Il faut la changer ou la vider', 'Réf. d''origine LOG-2026-073. Toilette backstage pleine. Il faut la changer ou la vider

18:39 — Demande creee automatiquement par profil de session: Manu Paquay (Opérateur QG)', 'P1', 'resolue', null, true, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-072', 'logistique', 'Ramener jeton étape site principal', 'Réf. d''origine LOG-2026-072. Ramener jeton étape site principal

18:37 — Demande creee automatiquement par profil de session: Grégori (Responsable bar site)', 'P1', 'resolue', null, true, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-071', 'logistique', 'Besoin d’un transport étape 3 vers site principal', 'Réf. d''origine LOG-2026-071. Besoin d’un transport étape 3 vers site principal

18:07 — Demande creee automatiquement par profil de session: Pipo (Directeur d''événement)
18:31 — En cours -- par Volante (app terrain)
18:35 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-070', 'logistique', 'Dégager souris derrières régie', 'Réf. d''origine LOG-2026-070. Dégager souris derrières régie

16:59 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)
17:15 — Pris en charge -- par Régis (Opérateur QG)
17:19 — Démarré -- par Régis (Opérateur QG)', 'P3', 'resolue', 'Log-Volante 2', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-069', 'logistique', 'Pq pour l’étape 3', 'Réf. d''origine LOG-2026-069. Pq pour l’étape 3

16:36 — Demande creee automatiquement par profil de session: Pipo (Directeur d''événement)
18:41 — En cours -- par Volante (app terrain)
18:44 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'TRSP-8161', 'logistique', 'Transport Staff / bénévole : spectateur (×1) — Étape 2 → Étape 3', 'Réf. d''origine TRSP-8161. Transport Staff / bénévole : spectateur (×1) — Étape 2 → Étape 3', 'P2', 'attribuee', 'Équipe volante', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-067', 'logistique', 'Et 2 jus de pomme', 'Réf. d''origine LOG-2026-067. Et 2 jus de pomme

15:44 — Demande creee automatiquement par profil de session: Raphaël (Directeur d''événement)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-066', 'logistique', 'Il nous faut 1 casier d’eau pétillante et du PQ. Dans 40 minutes la volante pour droper un', 'Réf. d''origine LOG-2026-066. Il nous faut 1 casier d’eau pétillante et du PQ. Dans 40 minutes la volante pour droper un spectateur.

15:41 — Demande creee automatiquement par profil de session: Raphaël (Directeur d''événement)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-065', 'logistique', 'Rapatriement tabouret piano scène trois (quand terminé) pour Saule ! Attention à ne pas ab', 'Réf. d''origine LOG-2026-065. Rapatriement tabouret piano scène trois (quand terminé) pour Saule ! Attention à ne pas abîmer le tabouret s’il vous plais.

15:25 — Demande creee automatiquement par profil de session: TOMMY (Directeur d''événement)', 'P3', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-064', 'logistique', 'Un bac de placebo et un transport de coffre ou vers scène principale', 'Réf. d''origine LOG-2026-064. Un bac de placebo et un transport de coffre ou vers scène principale

15:17 — Demande creee automatiquement par profil de session: Pipo (Directeur d''événement)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-063', 'logistique', 'Pick up et dépose de 4 personnes du backstage à l’étape 1', 'Réf. d''origine LOG-2026-063. Pick up et dépose de 4 personnes du backstage à l’étape 1

15:15 — Demande creee automatiquement par profil de session: Manu Paquay (Opérateur QG)
15:28 — Démarré -- par Benoît (Directeur d''événement)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-062', 'logistique', 'Mettre le Lyno gris  sur le plancher quand la 3 est partie du site', 'Réf. d''origine LOG-2026-062. Mettre le Lyno gris  sur le plancher quand la 3 est partie du site

15:07 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)', 'P3', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-061', 'logistique', 'Drop 1 personne sur étape 3', 'Réf. d''origine LOG-2026-061. Drop 1 personne sur étape 3

14:41 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
14:46 — En cours -- par Volante (app terrain)
14:57 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-060', 'logistique', 'Rapatrier Panda du carrefour de Burnontige, a côté de chez mes parents, jusqu''au site', 'Réf. d''origine LOG-2026-060. Rapatrier Panda du carrefour de Burnontige, a côté de chez mes parents, jusqu''au site

14:39 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
14:43 — Pris en charge -- par REN (Coordinateur technique & sécurité)', 'P1', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-059', 'logistique', 'Transport d''une personne de la scène 1 a la 2 à  14h50', 'Réf. d''origine LOG-2026-059. Transport d''une personne de la scène 1 a la 2 à  14h50

14:12 — Demande creee automatiquement par profil de session: Alex (Responsable Étape 1)', 'P2', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-058', 'logistique', 'Placebo 1 casier et Paola cola 2 cartons à livrer', 'Réf. d''origine LOG-2026-058. Placebo 1 casier et Paola cola 2 cartons à livrer

13:53 — Demande creee automatiquement par profil de session: Raphaël (Directeur d''événement)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-057', 'logistique', 'Remplissage évier WC public', 'Réf. d''origine LOG-2026-057. Remplissage évier WC public

13:45 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
15:55 — Démarré -- par Régis (Opérateur QG)
15:55 — Résolue -- par Régis (Opérateur QG)', 'P2', 'resolue', 'Log-Volante 1', false, 'ok', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-56', 'logistique', '1 casier de Placebo pour Laurane', 'Réf. d''origine LOG-56. 1 casier de Placebo pour Laurane

13:47 — Pris en charge -- par Benoît (Directeur d''événement)
13:50 — Démarré -- par REN (Coordinateur technique & sécurité)
14:04 — En cours -- par Volante (app terrain)
14:13 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-055', 'logistique', 'Table de calcul actuelle étape 1 et sauces pour carottes (mayo ou cocktail)', 'Réf. d''origine LOG-2026-055. Table de calcul actuelle étape 1 et sauces pour carottes (mayo ou cocktail)

13:31 — Demande creee automatiquement par profil de session: Laurane (Responsable Étape 1)
14:04 — En cours -- par Volante (app terrain)
14:13 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-054', 'logistique', 'Dropper 2 bacs de Placebo et 6 personnes a ''l''étape 2', 'Réf. d''origine LOG-2026-054. Dropper 2 bacs de Placebo et 6 personnes a ''l''étape 2

13:17 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
13:53 — Démarré -- par Benoît (Directeur d''événement)
13:54 — Résolue -- par Benoît (Directeur d''événement)', 'P2', 'resolue', 'Log-Volante 1', false, 'Effectué', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-053', 'logistique', 'Accompagner l’équipe Nsangu depuis backstage vers étape 3', 'Réf. d''origine LOG-2026-053. Accompagner l’équipe Nsangu depuis backstage vers étape 3

12:40 — Demande creee automatiquement par profil de session: Manu Paquay (Opérateur QG)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-052', 'logistique', 'Pick up d’une personne depuis backstage vers étape 1. Membre de l’équipe de Charles', 'Réf. d''origine LOG-2026-052. Pick up d’une personne depuis backstage vers étape 1. Membre de l’équipe de Charles

12:35 — Demande creee automatiquement par profil de session: Manu Paquay (Opérateur QG)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-051', 'logistique', 'Table de calcul bar svp, elle a disparu', 'Réf. d''origine LOG-2026-051. Table de calcul bar svp, elle a disparu

12:22 — Demande creee automatiquement par profil de session: Laurane (Responsable Étape 1)
12:44 — En cours -- par Volante (app terrain)
12:44 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-050', 'logistique', 'Est ce qu''il reste serait possible d''avoir du vin blanc sur bar site (retour d''étape si pa', 'Réf. d''origine LOG-2026-050. Est ce qu''il reste serait possible d''avoir du vin blanc sur bar site (retour d''étape si pas de vente)?

10:48 — Demande creee automatiquement par profil de session: Grégori (Responsable bar site)', 'P3', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-049', 'logistique', 'On veut bien un multiprise et le saucisson, de préférence découpé ou alors avec ce qu''il f', 'Réf. d''origine LOG-2026-049. On veut bien un multiprise et le saucisson, de préférence découpé ou alors avec ce qu''il faut pour découper

09:55 — Demande creee automatiquement par profil de session: Laurane (Responsable Étape 1)
10:19 — Démarré -- par Benoît (Directeur d''événement)
10:38 — Résolue -- par Benoît (Directeur d''événement)', 'P3', 'resolue', 'Log-Volante 1', false, 'C''est livré !', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-048', 'logistique', '[DEMANDE URGENTE] Autre', 'Réf. d''origine LOG-2026-048. [DEMANDE URGENTE] Autre

21:54 — Demande urgente déclenchée par Ren (Coordination sécurité)
21:55 — Pris en charge -- par Ren (Coordination sécurité)
21:55 — Démarré -- par Ren (Coordination sécurité)
21:55 — Résolue -- par Ren (Coordination sécurité)', 'P1', 'resolue', null, true, 'rien', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-047', 'logistique', 'aller décharger (compter et ramener au bar zone princi) les jetons de la scène 3', 'Réf. d''origine LOG-2026-047. aller décharger (compter et ramener au bar zone princi) les jetons de la scène 3

21:21 — Demande creee automatiquement par profil de session: Ren (Coordination sécurité)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-046', 'logistique', 'checker que les jetons et la caisse de la scène 2 soient revenus', 'Réf. d''origine LOG-2026-046. checker que les jetons et la caisse de la scène 2 soient revenus

21:20 — Demande creee automatiquement par profil de session: Ren (Coordination sécurité)
23:04 — Démarré -- par REN (QG)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-045', 'logistique', 'A t on récupéré les jetons des étapes (et caisses au passage) ? On en manque aux jetons', 'Réf. d''origine LOG-2026-045. A t on récupéré les jetons des étapes (et caisses au passage) ? On en manque aux jetons

21:00 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)', 'P3', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-044', 'logistique', 'Remplir 200l mazout - Ferme de la House , Au clocher 13 Ferrières', 'Réf. d''origine LOG-2026-044. Remplir 200l mazout - Ferme de la House , Au clocher 13 Ferrières

20:37 — Demande creee automatiquement par profil de session: Ren (Coordination sécurité)
20:53 — En cours -- par Volante (app terrain)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-043', 'logistique', 'Il faut modifier l’heure du pick up a Gite La Fiole Ambiance de 20h30 à 21h', 'Réf. d''origine LOG-2026-043. Il faut modifier l’heure du pick up a Gite La Fiole Ambiance de 20h30 à 21h

20:26 — Demande creee automatiquement par profil de session: Manu Paquay (Opérateur QG)
20:35 — Pris en charge -- par Ren (Coordination sécurité)
20:35 — Démarré -- par Ren (Coordination sécurité)
20:35 — Résolue -- par Ren (Coordination sécurité)', 'P1', 'resolue', null, false, 'ok', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-042', 'logistique', 'Il me faut aussi des cruches et de la lupulus placebo', 'Réf. d''origine LOG-2026-042. Il me faut aussi des cruches et de la lupulus placebo

19:54 — Demande creee automatiquement par profil de session: Pipo (Directeur d''événement)
20:10 — En cours -- par Volante (app terrain)
20:25 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-041', 'logistique', 'Essuies pour une groupe trempé', 'Réf. d''origine LOG-2026-041. Essuies pour une groupe trempé

19:44 — Demande creee automatiquement par profil de session: Pipo (Directeur d''événement)
20:10 — En cours -- par Volante (app terrain)
20:25 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-040', 'logistique', 'Niveau bas fuel sur le groupe blanc derrière la cuisine backstage', 'Réf. d''origine LOG-2026-040. Niveau bas fuel sur le groupe blanc derrière la cuisine backstage

19:33 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'TRSP-3322', 'logistique', 'Transport Staff / bénévole : Mélanie, Karine, Laurie, Stéphane (×4) — Backstage plaine → É', 'Réf. d''origine TRSP-3322. Transport Staff / bénévole : Mélanie, Karine, Laurie, Stéphane (×4) — Backstage plaine → Étape 3

14:46 — En cours -- par Volante (app terrain)
14:46 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Équipe volante', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-038', 'logistique', 'Lift cidrerie', 'Réf. d''origine LOG-2026-038. Lift cidrerie

18:27 — Demande creee automatiquement par profil de session: Laurane (Responsable Étape 1)
18:28 — Pris en charge -- par Laurane (Responsable Étape 1)
18:28 — Démarré -- par Laurane (Responsable Étape 1)
18:28 — Résolue -- par Laurane (Responsable Étape 1)', 'P1', 'resolue', null, false, 'Annulé', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'TRSP-2975', 'logistique', 'Transport Artiste / groupe : EV (×2) — Backstage plaine → Gîte La Fiole Ambiance', 'Réf. d''origine TRSP-2975. Transport Artiste / groupe : EV (×2) — Backstage plaine → Gîte La Fiole Ambiance

13:26 — En cours -- par Volante (app terrain)
13:26 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Équipe volante', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'TRSP-5402', 'logistique', 'Transport Artiste / groupe : EV (×2) — Gite La Fiole Ambiance → Backstage plaine', 'Réf. d''origine TRSP-5402. Transport Artiste / groupe : EV (×2) — Gite La Fiole Ambiance → Backstage plaine

13:26 — En cours -- par Volante (app terrain)
13:26 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Équipe volante', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'TRSP-4231', 'logistique', 'Transport Staff / bénévole : Charles, Pierre, Colin, Zélie (×4) — Backstage plaine → Étape', 'Réf. d''origine TRSP-4231. Transport Staff / bénévole : Charles, Pierre, Colin, Zélie (×4) — Backstage plaine → Étape 1

13:26 — En cours -- par Volante (app terrain)
13:26 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Équipe volante', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'TRSP-4447', 'logistique', 'Transport Staff / bénévole : Mathieu, Arnaud, Stéphanie (×3) — Backstage plaine → Étape 2', 'Réf. d''origine TRSP-4447. Transport Staff / bénévole : Mathieu, Arnaud, Stéphanie (×3) — Backstage plaine → Étape 2

13:26 — En cours -- par Volante (app terrain)
13:26 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Équipe volante', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-033', 'logistique', 'Besoin de jeton bar site', 'Réf. d''origine LOG-2026-033. Besoin de jeton bar site

17:45 — Demande creee automatiquement par profil de session: Grégori (Responsable bar site)
18:11 — En cours -- par Volante (app terrain)
18:11 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', true, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-032', 'logistique', 'Compléter les stocks de départ balade dans l''applo', 'Réf. d''origine LOG-2026-032. Compléter les stocks de départ balade dans l''applo

17:42 — Demande creee automatiquement par profil de session: Laurane (Responsable Étape 1)
18:07 — Pris en charge -- par Ren (Coordination sécurité)
18:07 — Démarré -- par Ren (Coordination sécurité)', 'P2', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-031', 'logistique', 'Lupulus placebo', 'Réf. d''origine LOG-2026-031. Lupulus placebo

17:40 — Demande creee automatiquement par profil de session: Raphaël (Directeur d''événement)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-030', 'logistique', 'Vérifier au retour des balades que les sorties zones tech et bacstage sont fermées pour le', 'Réf. d''origine LOG-2026-030. Vérifier au retour des balades que les sorties zones tech et bacstage sont fermées pour les.gens reviennent bien par le dessus du site

17:30 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-029', 'logistique', 'Aller chercher seau de jetons de la food a l''étape 2 et la ramener sur le site.', 'Réf. d''origine LOG-2026-029. Aller chercher seau de jetons de la food a l''étape 2 et la ramener sur le site.

16:57 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
17:01 — En cours -- par Volante (app terrain)
17:08 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-028', 'logistique', 'Enlever heras et installer plaque flèches parking', 'Réf. d''origine LOG-2026-028. Enlever heras et installer plaque flèches parking

16:56 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
18:47 — En cours -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 2', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-027', 'logistique', 'Venir chercher 2 personnes sur le site principal pour l’étape 3', 'Réf. d''origine LOG-2026-027. Venir chercher 2 personnes sur le site principal pour l’étape 3

16:44 — Demande creee automatiquement par profil de session: Manu Paquay (Opérateur QG)
17:22 — Démarré -- par Sébastien (Volante)
17:23 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 2', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-026', 'logistique', 'Aller rechercher sceau jetons Foodtruck étape 2', 'Réf. d''origine LOG-2026-026. Aller rechercher sceau jetons Foodtruck étape 2

16:36 — Demande creee automatiquement par profil de session: Elo (Autre)
16:49 — En cours -- par Volante (app terrain)
17:10 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', true, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-025', 'logistique', 'Besoin de jeton bar site (plus aucun stock)', 'Réf. d''origine LOG-2026-025. Besoin de jeton bar site (plus aucun stock)

16:33 — Demande creee automatiquement par profil de session: Grégori (Responsable bar site)
16:38 — Pris en charge -- par REN (QG)
16:49 — En cours -- par Volante (app terrain)
17:10 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-024', 'logistique', 'Il faudrait envoyer un runner chercher les clés à la chambre d’Hote « au doux Chardon ». L', 'Réf. d''origine LOG-2026-024. Il faudrait envoyer un runner chercher les clés à la chambre d’Hote « au doux Chardon ». L’adresse est Aisne 8 à Aisne

15:38 — Demande creee automatiquement par profil de session: Manu Paquay (Opérateur QG)
16:07 — Démarré -- par Benoît (Directeur d''événement)
16:49 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-023', 'logistique', 'Problème intime', 'Réf. d''origine LOG-2026-023. Problème intime

15:22 — Demande creee automatiquement par profil de session: Elo (Autre)
15:30 — Démarré -- par Axel (Volante)
15:45 — Résolue -- par Axel (Volante)', 'P1', 'resolue', 'Log-Volante 1', true, 'Dépose en loge', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-022', 'logistique', 'Verre à vin (à l''occasion d''ici la 3eme balade)', 'Réf. d''origine LOG-2026-022. Verre à vin (à l''occasion d''ici la 3eme balade)

15:18 — Demande creee automatiquement par profil de session: Laurane (Responsable Étape 1)
15:30 — Démarré -- par Axel (Volante)
15:45 — Résolue -- par Axel (Volante)', 'P3', 'resolue', 'Log-Volante 1', false, 'Ok', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-021', 'logistique', 'Transport serviettes hygiéniques artiste scène 1, les donner à Laurane', 'Réf. d''origine LOG-2026-021. Transport serviettes hygiéniques artiste scène 1, les donner à Laurane

15:14 — Demande creee automatiquement par profil de session: Renaud (Coordinateur sécurité)', 'P3', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-020', 'logistique', 'Reappro eau plate backstage', 'Réf. d''origine LOG-2026-020. Reappro eau plate backstage

15:11 — Demande creee automatiquement par profil de session: Renaud (Coordinateur sécurité)
15:13 — Pris en charge -- par Renaud (Coordinateur sécurité)
15:13 — Démarré -- par Renaud (Coordinateur sécurité)
15:13 — Résolue -- par Renaud (Coordinateur sécurité)', 'P2', 'resolue', null, false, 'Ok', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-019', 'logistique', 'Ajouter panneau parking artiste a la route', 'Réf. d''origine LOG-2026-019. Ajouter panneau parking artiste a la route

14:50 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
15:16 — En cours -- par Volante (app terrain)
15:16 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-018', 'logistique', 'Amener panneau bols apéritifs sur la 1, se trouve au bar site principal', 'Réf. d''origine LOG-2026-018. Amener panneau bols apéritifs sur la 1, se trouve au bar site principal

14:16 — Demande creee automatiquement par profil de session: Elo (Autre)
14:33 — En cours -- par Volante (app terrain)
14:54 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 2', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-017', 'logistique', 'Récupérer jetons déjà consommés étape 1', 'Réf. d''origine LOG-2026-017. Récupérer jetons déjà consommés étape 1

14:10 — Demande creee automatiquement par profil de session: Elo (Autre)
14:32 — En cours -- par Volante (app terrain)
15:05 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Log-Volante 1', true, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-016', 'logistique', 'Ouvrir Heras pour recharge foodtruck patatrak', 'Réf. d''origine LOG-2026-016. Ouvrir Heras pour recharge foodtruck patatrak

13:44 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
13:59 — En cours -- par Volante (app terrain)
13:59 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-015', 'logistique', 'Accrocher guirlande tissu sur sangle bleu Isa', 'Réf. d''origine LOG-2026-015. Accrocher guirlande tissu sur sangle bleu Isa

13:17 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)
17:23 — En cours -- par Volante (app terrain)
17:23 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 2', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-014', 'logistique', 'Fermer structure live painting Isa', 'Réf. d''origine LOG-2026-014. Fermer structure live painting Isa

13:16 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)
13:29 — Pris en charge -- par Renaud (Coordinateur sécurité)
13:29 — Démarré -- par Renaud (Coordinateur sécurité)
13:29 — Résolue -- par Renaud (Coordinateur sécurité)', 'P1', 'resolue', null, false, 'Fzit', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-013', 'logistique', 'Couvrir un barbelé à l entrée de la scène, besoin d''un tapis de +/_ 1m /3m', 'Réf. d''origine LOG-2026-013. Couvrir un barbelé à l entrée de la scène, besoin d''un tapis de +/_ 1m /3m

12:55 — Demande creee automatiquement par profil de session: Alex (Responsable Étape 1)
13:14 — En cours -- par Volante (app terrain)
13:56 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-012', 'logistique', 'Carotte de 10 cent urgent jetons', 'Réf. d''origine LOG-2026-012. Carotte de 10 cent urgent jetons

12:28 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)
12:37 — En cours -- par Volante (app terrain)
12:37 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-011', 'logistique', '2 piquets animation enfant', 'Réf. d''origine LOG-2026-011. 2 piquets animation enfant

12:21 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)
17:33 — En cours -- par Volante (app terrain)
17:34 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 2', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-010', 'logistique', 'Tringle manquante', 'Réf. d''origine LOG-2026-010. Tringle manquante

12:10 — Demande creee automatiquement par profil de session: Laurane (Responsable Étape 1)
12:31 — En cours -- par Volante (app terrain)
12:36 — Resolue -- par Volante (app terrain)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-009', 'logistique', 'Erreur de remorque frigo nous avons la 3', 'Réf. d''origine LOG-2026-009. Erreur de remorque frigo nous avons la 3

12:00 — Demande creee automatiquement par profil de session: Alex (Responsable Étape 1)
12:31 — En cours -- par Volante (app terrain)
12:36 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', true, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-008', 'logistique', 'Installation dernier food truck', 'Réf. d''origine LOG-2026-008. Installation dernier food truck

11:50 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)
12:36 — En cours -- par Volante (app terrain)
12:36 — Resolue -- par Volante (app terrain)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-007', 'logistique', 'Sandwichs prêts chambre froide', 'Réf. d''origine LOG-2026-007. Sandwichs prêts chambre froide

11:41 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)
12:40 — En cours -- par Volante (app terrain)
14:00 — Resolue -- par Volante (app terrain)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-006', 'logistique', 'Briefing scout parking Renaud', 'Réf. d''origine LOG-2026-006. Briefing scout parking Renaud

11:39 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)', 'P1', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-005', 'logistique', 'QR code prêts', 'Réf. d''origine LOG-2026-005. QR code prêts

11:39 — Demande creee automatiquement par profil de session: Isalyne (Directeur d''événement)', 'P2', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-004', 'logistique', 'Transport groyoe électronique étape 3', 'Réf. d''origine LOG-2026-004. Transport groyoe électronique étape 3

11:37 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)', 'P1', 'resolue', null, false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-003', 'logistique', 'Enlever le matos devant l''entrée avec le merlot', 'Réf. d''origine LOG-2026-003. Enlever le matos devant l''entrée avec le merlot

11:17 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)', 'P2', 'resolue', 'Log-Volante 2', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-002', 'logistique', 'Placer 3 nadar dans le parking comme parking vélo', 'Réf. d''origine LOG-2026-002. Placer 3 nadar dans le parking comme parking vélo

09:48 — Demande creee automatiquement par profil de session: Jérôme (Directeur d''événement)', 'P3', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, qui_concerne, bloquant, resolution, phase, origine) values (v_ev, 'LOG-2026-001', 'logistique', 'Test passage vers volante Test', 'Réf. d''origine LOG-2026-001. Test passage vers volante Test

09:30 — Demande creee automatiquement par profil de session: Renaud (Coordinateur sécurité)', 'P1', 'resolue', 'Log-Volante 1', false, null, 'exploitation', 'import');

-- ---------- 11 incidents sanitaires → missions ----------
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-001', 'logistique', 'Plus de papier toilette', 'WC Plaine · Plaine · pris par Renaud · résolu par PC Course (Radio)', 'P3', 'resolue', '2026-08-16T19:29:24.875Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-002', 'logistique', 'Poubelle qui deborde', 'Poubelles Foodtrucks · Site festival · pris par Renaud · résolu par PC Course (Radio)', 'P3', 'resolue', '2026-08-16T19:18:04.340Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-003', 'logistique', 'Poubelle qui deborde', 'Poubelles Etape 3 · Etape 3 · résolu par PC Course (Radio)', 'P3', 'resolue', '2026-08-16T17:35:57.403Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-004', 'logistique', 'Lave-mains sans eau / savon', 'WC Plaine · checker eau et rajouter savon · résolu par PC Course (Radio)', 'P3', 'resolue', null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-005', 'logistique', 'Plus de papier toilette', 'WC Plaine · résolu par PC Course (Radio)', 'P3', 'resolue', null, 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-006', 'logistique', 'Proprete a revoir', 'WC Plaine · Plaine · pris par Hugo Diefels · résolu par Hugo Diefels', 'P3', 'resolue', '2026-08-16T13:15:21.377Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-007', 'logistique', 'Plus de papier toilette', 'WC Plaine · Plaine · résolu par PC Course (Radio)', 'P3', 'resolue', '2026-08-16T12:14:22.988Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-008', 'logistique', 'Plus de papier toilette', 'WC Plaine - PMR · Plaine · pris par William scouts · résolu par William scouts', 'P3', 'resolue', '2026-08-15T20:45:14.032Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-009', 'logistique', 'Proprete a revoir', 'WC Plaine · Plaine · Plus d eau · pris par William scouts · résolu par William scouts', 'P3', 'resolue', '2026-08-15T19:35:58.203Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-010', 'logistique', 'Plus de papier toilette', 'WC Plaine · Plaine · pris par Bastien · résolu par Bastien', 'P3', 'resolue', '2026-08-15T13:39:24.409Z', 'exploitation', 'import');
insert into missions (evenement_id, reference, module, titre, description, priorite, statut, resolue_le, phase, origine) values (v_ev, 'SAN-2026-011', 'logistique', 'Proprete a revoir', 'Urinoir Plaine · Plaine · pris par Romain Fassin · résolu par Romain Fassin', 'P3', 'resolue', '2026-08-15T09:46:34.959Z', 'exploitation', 'import');

-- ---------- 20 transports ----------
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-001', 'Étape 2', 'Étape 3', '50.37828, 5.64549', '50.38817, 5.62891', coalesce(1,1), 'staff', null, null, 'resolue', 'Vitara', 'chauffeur', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-002', 'Étape 3', 'Backstage plaine', '50.38817, 5.62891', '50.3842, 5.6201', coalesce(3,1), 'staff', null, null, 'resolue', 'Vitara', 'chauffeur', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-003', 'Backstage plaine', 'Étape 2', '50.3842, 5.6201', '50.37828, 5.64549', coalesce(1,1), 'artiste', null, null, 'resolue', 'Vitara', 'chauffeur', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-004', 'Étape 1', 'Étape 2', '50.37858, 5.6279', '50.37828, 5.64549', coalesce(1,1), 'staff', 'REN', 'Alexandre Sacré 0479/050981', 'resolue', 'Vitara', 'chauffeur', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-005', 'Backstage plaine', 'Étape 3', '50.3842, 5.6201', '50.38817, 5.62891', coalesce(2,1), 'artiste', null, null, 'resolue', 'Vitara', 'chauffeur', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-006', 'Backstage plaine', 'Comfort Energy Aywaille', '50.3842, 5.6201', 'Av. de la Libération 33, 4920 Aywaille', coalesce(400,1), 'technique', null, null, 'resolue', null, 'chauffeur', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-007', 'Gite La Fiole AMbiance', 'Backstage plaine', 'Voie du Thier 16, 4190 Ferrières', '50.3842, 5.6201', coalesce(2,1), 'artiste', 'Manu', null, 'resolue', 'Vitara', 'chauffeur', 'leger', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-008', 'Backstage plaine', 'Étape 3', '50.3842, 5.6201', '50.38817, 5.62891', coalesce(4,1), 'staff', null, null, 'resolue', null, 'volante', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-009', 'Étape 1', 'Gare des Guillemins', '50.37858, 5.6279', 'Place des Guillemins 2, 4000 Liège', coalesce(2,1), 'artiste', null, null, 'resolue', 'Ferribus', 'chauffeur', 'leger', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-010', 'Backstage plaine', 'Gîte La Fiole Ambiance', '50.3842, 5.6201', 'Voie du Thier 16, 4190 Ferrières', coalesce(2,1), 'artiste', null, null, 'resolue', null, 'volante', 'leger', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-011', 'Backstage plaine', 'Étape 1', '50.3842, 5.6201', '50.37858, 5.6279', coalesce(4,1), 'staff', null, null, 'resolue', null, 'volante', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-012', 'Backstage plaine', 'Étape 2', '50.3842, 5.6201', '50.37828, 5.64549', coalesce(3,1), 'staff', 'ELO', null, 'resolue', null, 'volante', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-013', 'Backstage plaine', 'Étape 3', '50.3842, 5.6201', '50.38817, 5.62891', coalesce(3,1), 'staff', 'Elo', null, 'resolue', null, 'volante', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-014', 'Backstage plaine', 'Étape 2', '50.3842, 5.6201', '50.37828, 5.64549', coalesce(4,1), 'staff', 'Elo', null, 'resolue', null, 'volante', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-015', 'Backstage plaine', 'Étape 1', '50.3842, 5.6201', '50.37858, 5.6279', coalesce(4,1), 'staff', 'Elo', null, 'resolue', null, 'volante', 'aucun', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-016', 'Backstage plaine', 'Hôtel YUST', '50.3842, 5.6201', 'Esplanade Simone Veil 2, 4000 Liège', coalesce(1,1), 'artiste', null, null, 'resolue', 'Ferribus', 'chauffeur', 'leger', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-017', 'Backstage plaine', 'Hôtel YUST', '50.3842, 5.6201', 'Esplanade Simone Veil 2, 4000 Liège', coalesce(3,1), 'artiste', null, null, 'resolue', 'Ferribus', 'chauffeur', 'leger', null, 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-018', 'Gare des Guillemins', 'Backstage plaine', 'Place des Guillemins 2, 4000 Liège', '50.3842, 5.6201', coalesce(2,1), 'artiste', 'Eric Vanguestaine', '0033633909382', 'resolue', 'Vitara', 'chauffeur', 'leger', 'Contact = Antoine', 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-019', 'Gare des Guillemins', 'Backstage plaine', 'Place des Guillemins 2, 4000 Liège', '50.3842, 5.6201', coalesce(3,1), 'artiste', 'Eric Vanguestaine', '0033677527311', 'resolue', 'Vitara', 'chauffeur', 'leger', 'Contact = Victor', 'import');
insert into transports (evenement_id, reference, depart_libre, arrivee_libre, adresse_depart, adresse_arrivee, nb_personnes, motif, demandeur, contact, statut, vehicule, type_transport, volume_materiel, precisions, origine) values (v_ev, 'TRA-2026-020', 'Gare des Guillemins', 'Étape 1', 'Place des Guillemins 2, 4000 Liège', '50.37858, 5.6279', coalesce(2,1), 'artiste', 'Eric Vanguestaine', '0033616796962', 'resolue', 'Vitara', 'chauffeur', 'leger', 'Contact = Sandra', 'import');

-- ---------- 100 entrées de REX ----------
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Ranger le matériel a sa place dans les racks d''heras', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-27T15:44:41.222Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Réfléchir a des structures pour les différentes bâches', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-26T08:45:02.429Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Acheter sangles moyennes pour éviter les prêt et perte de chacun', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-26T08:44:30.388Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Consulter d''autres sociétés pour les réceptions elec et meca.', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-26T08:44:03.216Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Demander la.livraison des groupes le jeudi', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-26T08:43:25.219Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Sur les billets, supprimé les heures d''événement dans l''en-tête car ca prête a confusion avec les heures.de balade réservées', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-24T08:03:38.684Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Regarder pour utiliser le paperpote de paypuce avec comme articles les.jetons et les différents types d''entrée', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-21T06:54:25.993Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Indiquer sur les enveloppes partenaire qui est avec et sans bracelet', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-21T06:53:50.765Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Compléter feuille rôle entrées avec la marche a suivre pour les partenaires et rappeler qu''il faut leur donner 1 gobelet vide de depart pour la caution.', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-21T06:53:31.965Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'rex', 'Raspberry pi avec écran tactile pour gestion sortie du frigo bar principal', 'gene', 'a_arbitrer', 'Renaud', '2026-08-20T11:52:29.949Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Pain traditionnel ou gris pour les sandwichs mais j’ai pt déjà dit', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-20T10:26:30.213Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'rex', 'Utiliser les check-lists d''ouverture...', 'gene', 'a_arbitrer', 'Renaud', '2026-08-20T09:30:18.819Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Mieux gérer les retours de fin de démontage. Planning demontage indispensable. Travailler dès le depart dans le tableau in/out pour que chacun inscrive ses fournisseurs et leurs dated', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-20T09:00:31.537Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Commander paola zero', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-20T08:59:31.507Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Utiliser l''application payperpot de chez paypuce pour pouvoir definir des articles ( jetons, entrées, ...)', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-19T08:37:04.581Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Îlots de tri site avec des poubelles 200l intradel', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-19T08:22:47.738Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', '2 x 1100 l de tout venant en plus
1 x 1100 l de pmc en plus', 'gene', 'a_arbitrer', 'Alex', '2026-08-19T08:22:39.430Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Acheter une caisse euro à compartiment pour ranger et trier les vis', 'gene', 'a_arbitrer', 'Renaud', '2026-08-19T07:14:25.988Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Acheter portrait clefs pour identifier les clefs du cleffier avec un numéro', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-19T07:05:37.151Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Préciser dans la convention food qu''ils gardent leurs jetons et qu''on compte tout a la fin...seulement si nouveaux jetons commandés', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-19T05:29:31.821Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Mettre une feuille explicative plus détaillée aux entrées :
- différents tarifs pour les soirées 
- cases a cocher pour compter entrées sur places
- explications bracelets autorisés 
- idéal, telephone sans code avec lien pour les guests', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-18T19:05:04.841Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Nouvelle devanture de bar principale tubes métalliques qui s''emboîtent horizontaux et lattes de bois vertical. Prévoir des supports a assembler entre les éléments de bar de Dispas', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-18T11:12:02.502Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Mettre un ruban led ou des petites ampoules sur la libellule', 'gene', 'a_arbitrer', 'Renaud', '2026-08-18T09:15:15.254Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'On veut le même gars de chateau chapiteau et son 04', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-18T09:11:14.778Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Imposer le plateau de la commune pour les heras', 'gene', 'a_arbitrer', 'Renaud', '2026-08-18T09:09:50.406Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', '1 pot à vis par scène de balade', 'gene', 'a_arbitrer', 'Renaud', '2026-08-18T09:09:22.715Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Pas assez de vin blanc', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-18T06:02:37.962Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', '100 chips en trop. A voir si garder cette quantité en sécurité', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-18T06:02:24.242Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Groupe WhatsApp pour les « fidèles », dans un seul sens ( eux ne peuvent pas parler) en mode newsletter un peu', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-17T19:14:15.684Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Remplacer les sacs îlots de tri par des poubelles', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T19:07:22.169Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Faire un ou deux we bricolage construction', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T19:06:30.676Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Remplacer devanture bar', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T19:06:04.502Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Demander 4 hommes et le merlot de la commune pour poser et retirer les heras. Incister', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T18:45:06.986Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Dans demande logistique intégrer un champs faisabilité', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T18:32:20.056Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Affichage sur différents types d''écran', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T18:29:57.886Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Sur la scène en A, mettre les boulons d’en bas à l’extérieur sinon chiant pour démonter', 'gene', 'a_arbitrer', 'Elo', '2026-08-17T15:05:37.955Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Racheter des bioboxs supplémentaires', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T14:41:55.629Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Dispas lundi après-midi', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T13:24:11.285Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Créér une place de parking pour Éric', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T13:20:30.761Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Parking organisation : garder un couloir de sécurité et de logistique autour du site', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T13:19:19.004Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Créer un mini dashboard individuel : planning, mes demandes,...', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T13:18:39.568Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Prévenir les foodtrucks et le gin qu''ils ne peuvent pas prendre les tickets partenaire', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T10:26:10.402Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Préciser couleur des jetons au foodtrucks', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T10:24:47.880Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Feuille de reçu pour les relevés de jetons au foodtruck', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T08:47:13.837Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Inclure des cendriers dans le matos loge étapes', 'gene', 'a_arbitrer', 'Renaud', '2026-08-17T08:33:42.451Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Pas de retour avant le mardi si possible', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T07:47:20.681Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Au moins 5 ou 6 îlots de tri sur le site principal', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T06:58:19.727Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Bloc-note dans l''appli', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T06:57:13.824Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Prévoir "tarif" bar', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-17T06:51:19.341Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'stocks', 'Double alime radio 2x2
4 postes fixes PMR4446
2 raspbery pi avec 2 écrans 16/9 + clavier et souris sans fil
Tableau blanc', 'gene', 'a_arbitrer', 'REN', '2026-08-16T22:11:24.480Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'stocks', 'les inventaires bars ont dysfonctionnés : enregistrés mais ont disparus pour la scène 2 et 3', 'gene', 'a_arbitrer', 'REN', '2026-08-16T21:03:13.108Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'dashboard', 'Fluidifir la naivgation depuis le dashboard vers les différentes fonctionnalités  exemple pop-up plutot que de devoir aller dans l''app dédiée, donner accès à toutes les infos depuis le dashboard, ne pas devoir aller dans l''app dédiée', 'gene', 'a_arbitrer', 'REN', '2026-08-16T21:01:11.933Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Mettre les danceuses ou il y a de la lumière ou mettre de la lumière aux danceuses', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-16T19:28:38.137Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Mettre les remettre frigo de niveau', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-16T19:05:07.554Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Mettre de la Boum sur chaque etape', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-16T19:04:53.715Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'dashboard', 'pouvoir "décocher" le statut "attribué"', 'gene', 'a_arbitrer', 'REN', '2026-08-16T16:06:37.830Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'volante', 'Tête de vis identique sur les montages déco sur les scènes pour faciliter le démontage', 'gene', 'a_arbitrer', 'Sébastien', '2026-08-16T15:14:55.163Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'volante', 'Plus de pq sur scènes 123', 'gene', 'a_arbitrer', 'Sébastien', '2026-08-16T15:13:58.068Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Décaler l''arrière d''1 m vers l''exterieur', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-16T14:30:47.474Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'voir l''heure à laquelle à été poster la mission', 'gene', 'a_arbitrer', 'Régis', '2026-08-16T13:42:56.100Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'balade-light', 'Salut Renaud, l’app nous informe que nous sommes déjà rentrés!? C’est avec mon numéro. Jean-Luc', 'gene', 'a_arbitrer', 'Anonyme', '2026-08-16T13:18:27.656Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'mettre un statut "vu" ou ''en traitement", qqch comme ça pour les missions, voire pouvoir y mettre un commentaire du QG visible par l''initateur', 'gene', 'a_arbitrer', 'Régis', '2026-08-16T12:01:55.553Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'pouvoir changer moniteur attribution mission (type passer de logistique à sanitaire)', 'gene', 'a_arbitrer', 'Régis', '2026-08-16T11:52:56.608Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'dashboard', 'Pour la volante : créer une fonctionnalité similaire à Transports : attribution des missions par chauffeur', 'gene', 'a_arbitrer', 'REN', '2026-08-16T11:40:52.608Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'volante', 'Donner accès à l''app transport à Manu P. pour qu''il encode les transports ailleurs qu''en logistique', 'gene', 'a_arbitrer', 'REN', '2026-08-16T11:27:12.112Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Mettre des bouchons d''oreille sur les étapes', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-16T11:09:37.887Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'balade', 'avoir la possibilité de voir qui envoie la mission depuis le dashboard', 'gene', 'a_arbitrer', 'Régis', '2026-08-16T10:29:50.024Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'stocks', 'Doubler caisse gobelet vide sur les étapes', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-16T01:50:51.189Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'stocks', 'Cahier des charges sécurité : rappeler la nécessité d''avoir un affichage de leur assurance "ce site est surveillé par..."', 'gene', 'a_arbitrer', 'Renaud', '2026-08-16T00:14:13.449Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'stocks', 'Fournir des bracelets aux prestataires balade pour faciliter leur accès plaine', 'gene', 'a_arbitrer', 'Renaud', '2026-08-16T00:09:27.499Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'transport', 'avoir accès à un kaléidoscope des responsables avec photos (déso, j''ai vraiment du mal avec les prénoms!)', 'gene', 'a_arbitrer', 'Régis', '2026-08-15T22:50:10.913Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'chauffeur', 'Si possible avoir les arrivance des trains directement sur l’app ex " eurostar depuis paris"', 'gene', 'a_arbitrer', 'Anonyme', '2026-08-15T18:36:48.896Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'chauffeur', 'Possibilité de pourvoir revenir en arrière sur les étapes faites ou avoir un menu déroulant avec toutes les proposition ^^', 'gene', 'a_arbitrer', 'Anonyme', '2026-08-15T18:35:25.424Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Pas assez de poubelle sur le site principal 
4 personnes ont déjà fait la remarque', 'gene', 'a_arbitrer', 'Nalu', '2026-08-15T18:09:44.128Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Quand le groupe joue plus fort, mettre des bouchons d’oreille dans la caisse.', 'gene', 'a_arbitrer', 'Raphaël', '2026-08-15T17:19:21.479Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Pain gris ou tradi pour les sandwichs bénévoles', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T15:58:27.529Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'balade-light', 'On demande des boules quies à l’étape 2', 'gene', 'a_arbitrer', 'Anonyme', '2026-08-15T15:24:03.810Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Îlot de tri supp sur site car plus grand', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T14:12:39.181Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'planning', 'Ça serait super d’avoir une notification quand une demande a été prise en charge
Manu', 'gene', 'a_arbitrer', 'Manu Paquay', '2026-08-15T14:12:37.217Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'augmenter racks vente jetons sur plaine (+ de monde qu''avant)', 'gene', 'a_arbitrer', 'Ren', '2026-08-15T14:06:23.164Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'racheter jetons', 'gene', 'a_arbitrer', 'Ren', '2026-08-15T14:05:54.946Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'dashboard', 'trier les run par heure', 'gene', 'a_arbitrer', 'REN', '2026-08-15T13:40:46.580Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'transport', 'mettre une horloge dans toutes les app', 'gene', 'a_arbitrer', 'REN', '2026-08-15T13:38:06.661Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Idées de prix aux jetons', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T13:32:15.372Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Refaire des bourses +++ tout parti à la deuxième balade. Noter: donner une bourse à partir de 100 jetons achetés', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T13:18:19.552Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Sac vert ou poubelle verte', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T13:05:26.352Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Racheter des jetons', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T13:02:13.911Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'indiquer, à l''instar de la cartographie linéaire, la position des groupes de balade sur la map ops', 'gene', 'a_arbitrer', 'Ren', '2026-08-15T13:00:38.465Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'planning', 'Recommander des jetons', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-15T12:47:21.289Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'mettre des nominettes sur le front des bénévoles', 'gene', 'a_arbitrer', 'Ren', '2026-08-15T12:44:11.826Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'sanitaire', 'ajouter possibilité de rappel de missions (pop up?) et pouvoir faire passer une mission en priorité quand plusieurs attribuées.', 'gene', 'a_arbitrer', 'Ren', '2026-08-15T11:42:06.845Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'sanitaire', 'IRM : ajouter pluie/orage (risques + heures', 'gene', 'a_arbitrer', 'Ren', '2026-08-15T11:40:49.349Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'volante', 'Dire au traiteur de la 2 de pas bloquer le passage avec sa camionnette pour l''arrière bar (remorque frigo)', 'gene', 'a_arbitrer', 'Sébastien', '2026-08-15T10:47:32.654Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'sanitaire', '13m pour les bandes parking c''est juste juste', 'gene', 'a_arbitrer', 'Renaud', '2026-08-15T10:25:00.506Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Faire une zone bénévoles (chill zone, stock affaires personnelles, etc) prêt de logistique ?', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T09:53:15.773Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Prévoir un responsable montage site et un balade', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-15T08:55:12.327Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Mieux finaliser la coordo avant le montage', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-15T08:54:53.758Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Prévoir 2 membres autonomes Bucolique qui n''ont pas de premier rôle le samedi pour finaliser le montage.', 'gene', 'a_arbitrer', 'Jérôme', '2026-08-15T08:54:34.288Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'logistique', 'Réinvestir dans une imprimante', 'gene', 'a_arbitrer', 'Isalyne', '2026-08-15T08:27:07.301Z');
insert into rex_entrees (evenement_id, nature, module, constat, impact, statut, porteur, created_at) values (v_ev, 'dysfonctionnement', 'inconnue', 'Comptabiliser le nombre de flèches pour adéquation picto etc', 'gene', 'a_arbitrer', 'Renaud', '2026-08-14T06:52:26.091Z');

-- ---------- signalement participant ----------
insert into signalements (evenement_id, reference, cle_client, type, description, contact, latitude, longitude, precision_m, statut, emis_le, recu_le, clos_le) values (v_ev, 'SOS-2026-001', gen_random_uuid(), 'malaise', 'Urgence médicale / Malaise — Test', null, 50.5321618, 5.2728506, 12.0, 'clos', '2026-09-02T14:00:35.398Z', '2026-09-02T14:00:35.398Z', '2026-09-02T14:00:35.398Z');

-- ---------- recherche de personne ----------
insert into recherches (evenement_id, reference, nom, description, dernier_lieu, statut, circonstances, created_at) values (v_ev, 'RCH-2026-001', 'CHIEN', 'Chien noir collier rouge, perdu entre la scène 2 et la scène 3', 'Parcours : E2 -> E3', 'retrouve', '17:52 — Recherche lancee par REN (QG)
18:34 — RETROUVE(E) — par Ren (Coordination sécurité)', '2026-08-15T15:52:31.137Z');

-- ---------- 6 groupes de balade ----------
insert into groupes (evenement_id, code, nom, effectif_prevu, accompagnateur_libre, statut, commentaire, origine) values (v_ev, 'G-2026-01', 'Groupe 13h', 370, 'Charles, Luka, Jean-Luc, Anne', 'arrive', 'Départ 1
12:51 — Groupe créé -- 370 participants, 4 accompagnateurs
13:40 — Position: En transit → Etape 1
14:49 — Position: Etape 1 — Rue Sainte-Barbe
14:49 — Position: En transit → Etape 2
16:28 — Position: Etape 2 — Rue de Jehonhe
16:28 — Position: En transit → Etape 3
18:11 — Position: Etape 3 — Rue de la Chapelle
18:11 — Position: En transit → retour Point 0
18:52 — Position: Rentré au Point 0', 'import');
insert into groupes (evenement_id, code, nom, effectif_prevu, accompagnateur_libre, statut, commentaire, origine) values (v_ev, 'G-2026-02', 'Groupe 14h30', 370, 'Justine, Son mec, Anicée', 'arrive', 'Départ 1
14:43 — Groupe créé -- 370 participants, 3 accompagnateurs
14:55 — Départ Point 0 confirmed -- par Alex (Responsable Étape 1)
15:11 — Position: Etape 1 — Rue Sainte-Barbe
16:14 — Position: En transit -> Etape 2 (1,7 km) -- par Alex (Responsable Étape 1)
16:55 — Position: Etape 2 — Rue de Jehonhe
18:01 — Position: En transit → Etape 3
18:49 — Position: Etape 3 — Rue de la Chapelle
19:53 — Position: En transit → retour Point 0
20:24 — Position: Rentré au Point 0', 'import');
insert into groupes (evenement_id, code, nom, effectif_prevu, accompagnateur_libre, statut, commentaire, origine) values (v_ev, 'G-2026-03', 'Groupe 16h', 289, 'Lesuise, Lesuisse, Lesuisse, Lesuisse', 'arrive', 'Départ 3
16:40 — Groupe créé -- 289 participants, 4 accompagnateurs
16:44 — Position: En transit → Etape 1
17:07 — Position: Etape 1 — Rue Sainte-Barbe
17:47 — Position: En transit → Etape 2
18:24 — Position: Etape 2 — Rue de Jehonhe
19:29 — Position: En transit → Etape 3
20:37 — Position: Etape 3 — Rue de la Chapelle
21:16 — Position: En transit → retour Point 0
21:51 — Position: Rentré au Point 0', 'import');
insert into groupes (evenement_id, code, nom, effectif_prevu, accompagnateur_libre, statut, commentaire, origine) values (v_ev, 'G-2026-04', 'Groupe 13h', 255, 'x, x, x, x', 'arrive', 'Départ 2
13:44 — Groupe créé -- 255 participants, 4 accompagnateurs
13:45 — Départ Point 0 confirmed -- par REN (Coordinateur technique & sécurité)
13:52 — Position: Etape 1 — Rue Sainte-Barbe
14:46 — Position: En transit → Etape 2
15:11 — Position: Etape 2 — Rue de Jehonhe
16:16 — Position: En transit → Etape 3
17:54 — Position: Etape 3 — Rue de la Chapelle
18:06 — Position: En transit → retour Point 0
18:30 — Position: Rentré au Point 0', 'import');
insert into groupes (evenement_id, code, nom, effectif_prevu, accompagnateur_libre, statut, commentaire, origine) values (v_ev, 'G-2026-05', 'Groupe 11h00', 273, 'X, X, X, X', 'arrive', 'Départ 1
15:07 — Groupe créé -- 273 participants, 4 accompagnateurs
15:07 — Départ Point 0 confirmed -- par REN (Coordinateur technique & sécurité)
15:07 — Position: Etape 1 - Rue Sainte-Barbe -- par REN (Coordinateur technique & sécurité)
15:07 — Position: En transit -> Etape 2 (1,7 km) -- par REN (Coordinateur technique & sécurité)
15:07 — Position: Etape 2 - Rue de Jehonhe -- par REN (Coordinateur technique & sécurité)
15:07 — Position: En transit -> Etape 3 (2,5 km) -- par REN (Coordinateur technique & sécurité)
16:12 — Position: Etape 3 — Rue de la Chapelle
16:38 — Position: En transit → retour Point 0
16:38 — Position: Rentré au Point 0', 'import');
insert into groupes (evenement_id, code, nom, effectif_prevu, accompagnateur_libre, statut, commentaire, origine) values (v_ev, 'G-2026-06', 'Groupe 14h30', 255, 'X, X, X, X', 'arrive', 'Départ 3
15:15 — Groupe créé -- 255 participants, 4 accompagnateurs
15:15 — Position: En transit → Etape 1
15:31 — Position: Etape 1 — Rue Sainte-Barbe
16:26 — Position: En transit → Etape 2
16:54 — Position: Etape 2 — Rue de Jehonhe
17:53 — Position: En transit → Etape 3
18:39 — Position: Etape 3 — Rue de la Chapelle
19:52 — Position: En transit → retour Point 0
20:17 — Position: Rentré au Point 0', 'import');

-- ---------- alertes et consignes de 2026 ----------
insert into alertes (evenement_id, niveau, titre, message, active, emise_le, public) values (v_ev, 'urgence', 'Cellule de crise', 'Autre consigne generale · Clé de voiture noire et dorée de marque Renault et paire de lunettes enfants vertes/turquoise perdus pendant la balade. Se trouve au QG · QG', false, now(), false);
insert into alertes (evenement_id, niveau, titre, message, active, emise_le, public) values (v_ev, 'vigilance', 'Alerte logistique', 'Autre · Site grande scène · Ren (Coordination sécurité)', false, now(), false);
insert into alertes (evenement_id, niveau, titre, message, active, emise_le, public) values (v_ev, 'vigilance', 'Alerte balade', 'Urgence médicale · Étape 1 → Étape 2 · REN (Coordination sécurité)', false, now(), false);
insert into alertes (evenement_id, niveau, titre, message, active, emise_le, public) values (v_ev, 'information', 'Consigne volante', 'Chien · REN', false, now(), false);

-- ---------- publications au public ----------
insert into communications (evenement_id, titre, corps, publie_le) values (v_ev, 'Publication 2026 — consigne', 'ℹ️ La situation est sous contrôle. Les équipes de secours sont sur place. Merci de votre calme et de votre coopération. Prochain point d''information à venir.', '2026-07-19T19:25:30.600Z');
insert into communications (evenement_id, titre, corps, publie_le) values (v_ev, 'Publication 2026 — publication', 'test', '2026-07-11T07:03:25.773Z');

  raise notice 'BFMF2026 importé : %', v_ev;
end
$$;

commit;

-- =====================================================================
-- VÉRIFICATION
--   select 'contacts', count(*) from contacts c join evenements e on e.id=c.evenement_id where e.slug='bfmf2026'
--   union all select 'creneaux', count(*) from creneaux x join evenements e on e.id=x.evenement_id where e.slug='bfmf2026'
--   union all select 'materiel', count(*) from materiel x join evenements e on e.id=x.evenement_id where e.slug='bfmf2026'
--   union all select 'missions', count(*) from missions x join evenements e on e.id=x.evenement_id where e.slug='bfmf2026'
--   union all select 'rex',      count(*) from rex_entrees x join evenements e on e.id=x.evenement_id where e.slug='bfmf2026'
--   union all select 'transports', count(*) from transports x join evenements e on e.id=x.evenement_id where e.slug='bfmf2026';
-- =====================================================================