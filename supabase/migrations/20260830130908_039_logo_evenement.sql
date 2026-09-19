-- =====================================================================
-- Migration 039 : logo par événement
-- ---------------------------------------------------------------------
-- Un client qui installe l'app doit voir SON logo, pas celui d'Eventware.
-- Deux usages du même fichier, deux contraintes différentes :
--   décoratif — affiché dans l'app, sur les écrans publics
--   icône PWA — l'app SPA étant statique, le manifeste est échangé côté
--   client au chargement (voir logoPwa.js), pas généré côté serveur.
--
-- Le chemin de stockage commence par l'evenement_id : c'est ce qui
-- permet à la policy de vérifier qu'on écrit dans SON dossier, sans
-- table de correspondance supplémentaire.
-- =====================================================================

begin;

alter table evenements add column logo_url text;

comment on column evenements.logo_url is
  'URL publique du logo dans le bucket "logos". Utilisé à la fois comme décoration et comme base de l''icône PWA générée côté client.';

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Lecture publique : le logo apparaît sur les écrans participant et
-- autorité, consultés sans compte.
create policy logos_lecture on storage.objects for select
  using (bucket_id = 'logos');

-- Écriture réservée à qui peut modifier les référentiels de l'événement
-- dont le chemin porte l'identifiant — premier segment du chemin.
create policy logos_ecriture on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and a_permission((storage.foldername(name))[1]::uuid, 'referentiels', 'creer')
  );

create policy logos_remplacement on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and a_permission((storage.foldername(name))[1]::uuid, 'referentiels', 'creer')
  );

create policy logos_suppression on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and a_permission((storage.foldername(name))[1]::uuid, 'referentiels', 'creer')
  );

-- ---------------------------------------------------------------------
-- Accès public minimal pour l'écran participant : nom et logo de
-- l'événement, sans rien exposer d'autre. La table evenements reste
-- fermée à anon ; ce chemin est le seul autorisé.
-- ---------------------------------------------------------------------
create or replace function evenement_public(p_jeton uuid)
returns table (nom text, logo_url text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select e.nom, e.logo_url from evenements e
  where e.jeton_public = p_jeton and e.deleted_at is null;
$$;

revoke all on function evenement_public(uuid) from public;
grant execute on function evenement_public(uuid) to anon, authenticated;

commit;