-- =====================================================================
-- Migration 047 : suivi d'état par critère météo
-- ---------------------------------------------------------------------
-- Nécessaire pour détecter une VRAIE transition — pas seulement « c'est
-- orange en ce moment », mais « c'est devenu orange » ou « c'est revenu
-- au vert ». Sans mémoire de l'état précédent, impossible de distinguer
-- une hausse d'une baisse, ou de savoir qu'un retour à la normale doit
-- être consigné.
--
-- Une ligne par critère et par événement, mise à jour à chaque
-- changement réel de niveau — pas à chaque évaluation.
-- =====================================================================

create table veille_etat_criteres (
  evenement_id uuid not null references evenements(id) on delete cascade,
  critere      text not null,
  niveau       text not null default 'vert',
  depuis       timestamptz not null default clock_timestamp(),
  updated_at   timestamptz not null default now(),
  primary key (evenement_id, critere)
);

alter table veille_etat_criteres enable row level security;

create policy veille_etat_lecture on veille_etat_criteres for select to authenticated
  using (a_permission(evenement_id,'alertes','creer'));
create policy veille_etat_ecriture on veille_etat_criteres for insert to authenticated
  with check (a_permission(evenement_id,'alertes','creer'));
create policy veille_etat_maj on veille_etat_criteres for update to authenticated
  using (a_permission(evenement_id,'alertes','creer'))
  with check (a_permission(evenement_id,'alertes','creer'));