-- =====================================================================
-- 099 — VISIBILITÉ DES JALONS
--
-- Trois niveaux, du plus fermé au plus ouvert :
--
--   coordination — visible de ceux qui peuvent écrire les jalons. Pour
--                  ce qui ne regarde pas l'ensemble des bénévoles : une
--                  négociation en cours, un point de friction avec un
--                  prestataire, une échéance qu'on ne veut pas annoncer
--                  avant qu'elle soit tenue.
--   membres      — visible de tout membre qui a la lecture RH. C'est le
--                  comportement d'aujourd'hui, donc la valeur par
--                  défaut : la migration ne change la visibilité
--                  d'aucun jalon existant.
--   public       — remonte en plus dans la vitrine participant.
--
-- POURQUOI UNE COLONNE ET PAS UNE ÉTIQUETTE. Un tag libre qui décide ce
-- que le public voit se paie tôt ou tard : « Public » avec une
-- majuscule, « publique » au féminin, et le jalon disparaît de la
-- vitrine sans que rien ne le signale ; ou l'inverse, un mot écrit comme
-- note devient une publication. Un type énuméré ne peut pas se tromper
-- d'orthographe, et la base refuse une valeur qui n'existe pas.
--
-- LE LIBELLÉ PUBLIC EST OBLIGATOIRE POUR PUBLIER. Un jalon interne
-- s'appelle « Relancer Misse pour les foodtrucks » ; ce n'est pas ce
-- qu'on affiche à trois mille personnes. La contrainte de vérification
-- rend le cas impossible plutôt qu'improbable : sans libellé public,
-- la base refuse le passage en `public`. Le libellé se choisit dans un
-- catalogue figé côté produit (src/jalonsPublics.js), et c'est le TEXTE
-- retenu qui est stocké, pas un code — un message déjà publié ne doit
-- pas changer de formulation parce que le catalogue a évolué depuis.
-- =====================================================================

begin;

create type visibilite_jalon as enum ('coordination', 'membres', 'public');

alter table jalons
  add column visibilite visibilite_jalon not null default 'membres',
  add column libelle_public text;

comment on column jalons.visibilite is
  'Qui voit ce jalon : coordination (ceux qui l''écrivent), membres (défaut), public (vitrine participant).';
comment on column jalons.libelle_public is
  'Formulation affichée au public, choisie dans le catalogue produit. Exigée dès que visibilite = public.';

alter table jalons
  add constraint jalons_public_exige_libelle
  check (visibilite <> 'public' or libelle_public is not null);

-- ---------------------------------------------------------------------
-- Lecture : qui écrit voit tout, les autres voient à partir de
-- « membres ». Écrit dans cet ordre pour qu'il soit impossible d'avoir
-- le droit de modifier un jalon sans le voir.
-- ---------------------------------------------------------------------
drop policy if exists jalons_lecture on jalons;
create policy jalons_lecture on jalons for select to authenticated
  using (
    deleted_at is null
    and (
      a_permission(evenement_id, 'rh', 'modifier')
      or (visibilite <> 'coordination' and a_permission(evenement_id, 'rh', 'lire'))
    )
  );

-- ---------------------------------------------------------------------
-- Vitrine participant : les jalons publics rejoignent l'horaire.
--
-- Seuls sortent le libellé public, l'échéance et le fait que ce soit
-- tenu ou non — jamais le libellé interne, le responsable, ni le
-- commentaire. Les jalons annulés ne sortent pas : annoncer au public
-- une fermeture de route qui n'aura pas lieu est pire que de ne rien
-- annoncer.
--
-- Le reste de la fonction est repris à l'identique de la version
-- précédente ; seul le bloc `jalons` est nouveau.
-- ---------------------------------------------------------------------
create or replace function contenu_public(p_jeton uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb; v_evenement uuid;
begin
  select e.id into v_evenement
  from evenements e where e.jeton_public = p_jeton and e.deleted_at is null;

  if v_evenement is null then
    raise exception 'Événement inconnu' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'evenement', (
      select jsonb_build_object('nom', e.nom, 'logo_url', e.logo_url,
                                'phase', e.phase, 'mode_parcours', e.mode_parcours,
                                'date_debut', e.date_debut, 'date_fin', e.date_fin)
      from evenements e where e.id = v_evenement
    ),
    'alertes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'niveau', a.niveau, 'titre', a.titre, 'consigne', a.consigne,
        'emise_le', a.emise_le) order by a.emise_le desc), '[]'::jsonb)
      from alertes a
      where a.evenement_id = v_evenement and a.active and a.public and a.deleted_at is null
    ),
    'lieux', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', l.code, 'nom', l.nom, 'type', l.type,
        'latitude', l.latitude, 'longitude', l.longitude,
        'pk_km', l.pk_km) order by l.pk_km nulls last, l.nom), '[]'::jsonb)
      from lieux l
      where l.evenement_id = v_evenement and l.public and l.deleted_at is null
    ),
    'programme', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'titre', p.titre, 'categorie', p.categorie, 'debut', p.debut,
        'duree_min', p.duree_min, 'intervenant', p.intervenant,
        'lieu', coalesce(l.nom, p.lieu_libre)) order by p.debut), '[]'::jsonb)
      from programme p
      left join lieux l on l.id = p.lieu_id
      where p.evenement_id = v_evenement and p.public and p.deleted_at is null
    ),
    'jalons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'libelle', j.libelle_public,
        'echeance', j.echeance,
        'fait', j.statut = 'fait') order by j.echeance nulls last), '[]'::jsonb)
      from jalons j
      where j.evenement_id = v_evenement
        and j.visibilite = 'public'
        and j.libelle_public is not null
        and j.statut <> 'annule'
        and j.deleted_at is null
    ),
    'communications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'titre', c.titre, 'corps', c.corps,
        'lien_url', c.lien_url, 'lien_libelle', c.lien_libelle,
        'publie_le', c.publie_le) order by c.publie_le desc), '[]'::jsonb)
      from communications c
      where c.evenement_id = v_evenement and c.deleted_at is null
        and c.publie_le is not null and c.publie_le <= now()
        and (c.visible_jusqu_au is null or c.visible_jusqu_au > now())
    )
  ) into v;
  return v;
end;
$function$;

-- `create or replace` conserve les droits existants ; on les réaffirme
-- pour que la règle de la 090 reste lisible dans le fichier.
revoke all on function contenu_public(uuid) from public;
grant execute on function contenu_public(uuid) to anon, authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION
--
--   select visibilite, count(*) from jalons where deleted_at is null
--   group by visibilite;
--   -- tout en « membres » juste après la migration
--
-- Puis dans l'application : passer un jalon en « coordination » et
-- vérifier qu'un bénévole ne le voit plus ; en « public » avec un
-- libellé, et vérifier qu'il apparaît dans la vitrine participant.
-- =====================================================================
