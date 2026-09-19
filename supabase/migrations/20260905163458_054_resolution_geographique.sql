-- =====================================================================
-- Migration 054 : résolution géographique de la bibliothèque partagée
-- ---------------------------------------------------------------------
-- Une commune sait dans quelle province, quelle zone de police et
-- quelle zone de secours elle se trouve. Un événement qui se rattache
-- à une commune peut donc se voir proposer automatiquement les
-- référentiels partagés déjà vérifiés pour cette zone — sans que
-- personne n'ait à les chercher un par un.
--
-- Un référentiel partagé (organisation_id null) porte désormais une
-- date de dernière vérification, et un zone_nom qui doit correspondre
-- exactement à celui d'une commune pour être proposé automatiquement.
-- zone_nom vide = base universelle (RezonWal), proposée partout.
-- =====================================================================

begin;

create table communes (
  nom                 text primary key,
  province             text not null,
  zone_police          text,
  zone_secours         text,
  derniere_verification date,
  notes                text
);

comment on table communes is
  'Résolution commune → province → zone de police → zone de secours, pour proposer automatiquement les référentiels partagés déjà vérifiés pour ce territoire.';

alter table communes enable row level security;
create policy communes_lecture on communes for select to authenticated using (true);
create policy communes_ecriture on communes for all to authenticated
  using (est_exploitant()) with check (est_exploitant());

-- Seedé avec la seule commune réellement vérifiée à ce stade — pas de
-- couverture large improvisée en amont d'un vrai besoin client.
insert into communes (nom, province, zone_police, zone_secours, derniere_verification, notes)
values ('Ferrières', 'Liège', 'Condroz', 'HEMECO', current_date,
  'Zone de police confirmée à l''article 58 du RGP Condroz (Ferrières y figure explicitement). Zone de secours HEMECO reprise de la synthèse de l''organisateur — à confirmer par une source primaire si possible.');

alter table evenements add column commune text;
comment on column evenements.commune is
  'Commune de l''événement — permet de résoudre automatiquement la zone de police et la zone de secours applicables.';

update evenements set commune = 'Ferrières'
where id = '7e2c829c-e5c7-4302-8db3-6a7afd96c5b6';

alter table referentiels add column derniere_verification date;
comment on column referentiels.derniere_verification is
  'Date de dernière relecture du texte source. Un référentiel partagé sans vérification récente doit être signalé comme tel plutôt que de laisser croire à une fraîcheur qu''il n''a pas.';

update referentiels set derniere_verification = current_date
where code in ('rezonwal', 'zp-condroz', 'hemeco');

commit;