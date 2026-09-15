-- =====================================================================
-- 041 — CLOISONNER LE STOCKAGE
--
-- Constat du 15/09/2026, en préparant le lot 2.
--
-- Le compartiment `referentiels` est public et sa policy d'écriture ne
-- vérifiait rien : `bucket_id = 'referentiels'`, point. Tout compte
-- connecté pouvait y déposer un fichier, et n'importe qui pouvait
-- lister puis télécharger l'ensemble. Or Conformite.jsx y range les
-- documents réglementaires, par `organisation_id` — donc par client.
-- Un organisateur lisait les documents d'un autre.
--
-- Trois corrections :
--
--   1. L'écriture est réservée à qui appartient à l'organisation dont
--      le dossier porte le nom.
--   2. La suppression, qui n'existait pas, est ouverte aux mêmes — sans
--      elle, un fichier déposé par erreur restait là pour toujours.
--   3. Les policies de lecture larges sur `referentiels` et `logos`
--      sont retirées. Un compartiment public sert ses fichiers par URL
--      directe sans passer par RLS : les liens publics continuent donc
--      de fonctionner. Ce que ces policies autorisaient en plus, c'était
--      de LISTER le contenu — ce dont aucun écran n'a besoin, et que
--      personne ne devrait pouvoir faire.
--
-- Ce que cette migration ne fait pas : rendre `referentiels` privé.
-- Conformite.jsx construit des URL publiques et les stocke dans
-- `referentiels.fichier_source_url` ; basculer le compartiment en privé
-- casserait les liens déjà enregistrés. À reprendre le jour où ces
-- documents contiendront autre chose que de la réglementation publique.
-- =====================================================================

begin;

-- Appartenance à une organisation : l'exploitant passe partout, un
-- membre passe sur les organisations où il tient un événement.
create or replace function appartient_organisation(p_organisation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select est_exploitant() or exists (
    select 1 from evenements e
    join membres_evenement m on m.evenement_id = e.id
    where e.organisation_id = p_organisation
      and m.user_id = auth.uid()
      and m.actif
      and m.deleted_at is null
  );
$$;

revoke all on function appartient_organisation(uuid) from public, anon;
grant execute on function appartient_organisation(uuid) to authenticated;

-- 1 & 2 — écriture et suppression cloisonnées par organisation
drop policy if exists referentiels_stockage_ecriture on storage.objects;
create policy referentiels_stockage_ecriture on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'referentiels'
    and appartient_organisation(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists referentiels_stockage_suppression on storage.objects;
create policy referentiels_stockage_suppression on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'referentiels'
    and appartient_organisation(((storage.foldername(name))[1])::uuid)
  );

-- 3 — plus de listage. Les URL publiques ne passent pas par ici.
drop policy if exists referentiels_stockage_lecture on storage.objects;
drop policy if exists logos_lecture on storage.objects;

commit;

-- =====================================================================
-- VÉRIFICATION
--
-- (a) Les liens publics déjà enregistrés fonctionnent toujours :
--     ouvrir un document depuis l'écran Conformité, et le logo d'un
--     événement depuis le bandeau.
--
-- (b) Le dépôt d'un nouveau document réglementaire fonctionne toujours
--     depuis Conformité, pour un membre de l'organisation.
--
-- (c) Plus aucune policy de lecture large :
--     select polname from pg_policy
--     where polrelid = 'storage.objects'::regclass and polcmd = 'r';
--     -- ne doit rester que pieces_lecture, qui vérifie l'appartenance
-- =====================================================================
