-- =====================================================================
-- Migration 052 : référentiels propres à chaque organisation
-- ---------------------------------------------------------------------
-- Défaut de conception trouvé à l'usage : ZP Condroz et HEMECO avaient
-- été chargés comme référentiels globaux — visibles par toute
-- organisation sur la plateforme. Ce sont des règles propres à
-- Ferrières ; une autre organisation, ailleurs, ne doit jamais les
-- voir s'appliquer à son événement.
--
-- organisation_id nullable distingue :
--   NULL  → référentiel partagé, vrai bien commun (RezonWal — une base
--           wallonne, pas propre à une commune).
--   valeur → référentiel propre à CETTE organisation, invisible aux
--            autres. C'est le cas de ZP Condroz et HEMECO, corrigés
--            ici, et de tout référentiel qu'une organisation ajoutera
--            elle-même pour son propre contexte local.
-- =====================================================================

begin;

alter table referentiels add column organisation_id uuid references organisations(id) on delete cascade;
alter table referentiels add column fichier_source_url text;
comment on column referentiels.organisation_id is
  'NULL = référentiel partagé (bien commun, ex. RezonWal). Une valeur = propre à cette organisation, invisible aux autres.';
comment on column referentiels.fichier_source_url is
  'Lien vers le document déposé par l''organisation — la preuve, même si le contenu a été saisi à la main plutôt qu''extrait automatiquement.';

-- Correction : ZP Condroz et HEMECO sont propres à Bucolique Ferrières,
-- pas partagés.
update referentiels set organisation_id = (select id from organisations where nom = 'Bucolique Ferrières')
where code in ('zp-condroz', 'hemeco');

-- RLS : un référentiel partagé (organisation_id null) reste lisible par
-- tous et réservé à l'exploitant en écriture. Un référentiel propre à
-- une organisation devient lisible et modifiable par ses membres ayant
-- la capacité 'referentiels'.
drop policy if exists referentiels_lecture on referentiels;
drop policy if exists referentiels_ecriture on referentiels;

create policy referentiels_lecture on referentiels for select to authenticated
  using (
    organisation_id is null
    or est_exploitant()
    or exists (select 1 from evenements e where e.organisation_id = referentiels.organisation_id and est_membre(e.id))
  );

create policy referentiels_ecriture_exploitant on referentiels for all to authenticated
  using (est_exploitant()) with check (est_exploitant());

create policy referentiels_ecriture_organisation on referentiels for all to authenticated
  using (
    organisation_id is not null and
    exists (select 1 from evenements e where e.organisation_id = referentiels.organisation_id
            and a_permission(e.id,'referentiels','creer'))
  )
  with check (
    organisation_id is not null and
    exists (select 1 from evenements e where e.organisation_id = referentiels.organisation_id
            and a_permission(e.id,'referentiels','creer'))
  );

-- referentiel_items : même logique, en passant par le référentiel
-- parent pour savoir à qui il appartient.
drop policy if exists referentiel_items_lecture on referentiel_items;
drop policy if exists referentiel_items_ecriture on referentiel_items;

create policy referentiel_items_lecture on referentiel_items for select to authenticated
  using (
    exists (
      select 1 from referentiels r where r.id = referentiel_items.referentiel_id
      and (
        r.organisation_id is null
        or est_exploitant()
        or exists (select 1 from evenements e where e.organisation_id = r.organisation_id and est_membre(e.id))
      )
    )
  );

create policy referentiel_items_ecriture on referentiel_items for all to authenticated
  using (
    exists (
      select 1 from referentiels r where r.id = referentiel_items.referentiel_id
      and (
        est_exploitant()
        or (r.organisation_id is not null and
            exists (select 1 from evenements e where e.organisation_id = r.organisation_id
                    and a_permission(e.id,'referentiels','creer')))
      )
    )
  )
  with check (
    exists (
      select 1 from referentiels r where r.id = referentiel_items.referentiel_id
      and (
        est_exploitant()
        or (r.organisation_id is not null and
            exists (select 1 from evenements e where e.organisation_id = r.organisation_id
                    and a_permission(e.id,'referentiels','creer')))
      )
    )
  );

commit;