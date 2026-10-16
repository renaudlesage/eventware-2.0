# Migrations

Projet Supabase `kunvnnfejhnuhflycyfz`. Un fichier par migration,
nommé `<version>_<name>.sql` où `version` est l'horodatage
`YYYYMMDDHHMMSS` attribué par Supabase et `name` commence par un numéro
de série à trois chiffres.

## Trois séries

### 001 → 087 : l'historique enregistré par Supabase

Ces fichiers sont la copie **exacte** de
`supabase_migrations.schema_migrations` (colonne `statements`, les
instructions jointes par une ligne vide). Nom et horodatage viennent de
la base, pas du dépôt : ce sont eux qui font foi. Ne pas les modifier —
un écart entre le fichier et la ligne enregistrée rendrait toute
reconstruction douteuse.

Particularité héritée de la période où les migrations partaient à la
main : les numéros `060` et `061` existent plusieurs fois (cinq lignes
en base pour ces deux numéros, avec des noms différents). L'ordre réel
est donné par l'horodatage, unique. La série compte donc **90 lignes**
pour 87 numéros :

| Version | Nom |
|---|---|
| `20260908194432` | `060_trigger_quantite_stock` |
| `20260908194633` | `061_annulation_correctif_060` |
| `20260908202637` | `060_types_mission_categories_fermees` |
| `20260909040017` | `060_typage_quantite_transport` |
| `20260909040125` | `061_permissions_transports` |

### 088 → 099 : appliquées à la main, enregistrées après coup

Ces douze migrations ont été exécutées via l'éditeur SQL du tableau de
bord entre le 15 et le 18 septembre 2026, puis enregistrées dans
`schema_migrations` le 19/09 avec le bloc ci-dessous (à conserver :
il est rejouable sans effet). Leur horodatage
dans le nom de fichier est celui de leur écriture, pas celui d'un
enregistrement Supabase.

Elles portaient les numéros 037 → 048 dans le dépôt, en collision avec
les vrais 037 → 048 de la base. Elles ont été renumérotées ainsi :

| Ancien | Nouveau | Fichier |
|---|---|---|
| 037 | 088 | `20260915190000_088_durcissement.sql` |
| 038 | 089 | `20260915193000_089_veille_meteo_nouvel_evenement.sql` |
| 039 | 090 | `20260915200000_090_surface_api_anonyme.sql` |
| 040 | 091 | `20260915210000_091_suppression_logique.sql` |
| 041 | 092 | `20260915220000_092_cloisonner_stockage.sql` |
| 042 | 093 | `20260915230000_093_reprise_bfmf2026.sql` |
| 043 | 094 | `20260916100000_094_lien_groupe_equipe.sql` |
| 044 | 095 | `20260916140000_095_communes_province_liege.sql` |
| 045 | 096 | `20260916150000_096_zones_police_wallonie.sql` |
| 046 | 097 | `20260916160000_097_zones_secours_wallonie.sql` |
| 047 | 098 | `20260916180000_098_reconduire_evenement.sql` |
| 048 | 099 | `20260918090000_099_visibilite_jalons.sql` |

Pour que l'historique enregistré soit complet **sans rejouer le SQL**,
insérer les douze lignes suivantes dans `schema_migrations`. La colonne
`statements` reçoit un simple commentaire : le texte réel est dans ce
dossier, et rejouer les instructions casserait (objets déjà existants).

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260915190000', '088_durcissement',                  array['-- appliquée manuellement le 2026-09-15 via l''éditeur SQL']),
  ('20260915193000', '089_veille_meteo_nouvel_evenement', array['-- appliquée manuellement le 2026-09-15 via l''éditeur SQL']),
  ('20260915200000', '090_surface_api_anonyme',           array['-- appliquée manuellement le 2026-09-15 via l''éditeur SQL']),
  ('20260915210000', '091_suppression_logique',           array['-- appliquée manuellement le 2026-09-15 via l''éditeur SQL']),
  ('20260915220000', '092_cloisonner_stockage',           array['-- appliquée manuellement le 2026-09-15 via l''éditeur SQL']),
  ('20260915230000', '093_reprise_bfmf2026',              array['-- appliquée manuellement le 2026-09-15 via l''éditeur SQL']),
  ('20260916100000', '094_lien_groupe_equipe',            array['-- appliquée manuellement le 2026-09-16 via l''éditeur SQL']),
  ('20260916140000', '095_communes_province_liege',       array['-- appliquée manuellement le 2026-09-16 via l''éditeur SQL']),
  ('20260916150000', '096_zones_police_wallonie',         array['-- appliquée manuellement le 2026-09-16 via l''éditeur SQL']),
  ('20260916160000', '097_zones_secours_wallonie',        array['-- appliquée manuellement le 2026-09-16 via l''éditeur SQL']),
  ('20260916180000', '098_reconduire_evenement',          array['-- appliquée manuellement le 2026-09-16 via l''éditeur SQL']),
  ('20260918090000', '099_visibilite_jalons',             array['-- appliquée manuellement le 2026-09-18 via l''éditeur SQL'])
on conflict (version) do nothing;
```

### 100 à 103 : appliquées le 19/09 (éditeur SQL, enregistrées)

Les quatre correctifs de l'audit du 18/09 — retrait d'un membre (100),
reconduction (101), bucket `referentiels` (102), ressource `lieux`
inexistante (103). Leurs lignes d'historique ont été insérées à la
main ; l'historique est continu de 001 à 103.

### 104 à 106 : à appliquer — lot 9

| Fichier | Corrige |
|---|---|
| `20260919090000_104_rpc_sous_controle.sql` | Six RPC `security definer` exécutables par tout compte connecté sans vérifier l'appartenance à l'événement ; quatre fonctions jamais appelées par l'application révoquées |
| `20260919091000_105_prise_de_mission.sql` | Un bénévole ne pouvait pas prendre une mission sans titulaire (« Je prends » → droits insuffisants) ; la policy ne parle plus de rôles, seulement de capacités |
| `20260919092000_106_autorite_sans_nominatif.sql` | Le lien autorité, consulté sans compte, montrait l'alerte nominative d'un MAYDAY (nom, position) ; il ne reçoit plus qu'un compte. `groupes_sans_nouvelles` et `jauge_courante` sont dédoublées en version interne (sans contrôle, pour ce lien) et publique (vérifiée) |

Éprouvées ensemble dans une transaction annulée : `droits.sql` complet,
39 lignes OK, blocs L, M, N compris.

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260919090000', '104_rpc_sous_controle',        array['-- appliquée manuellement via l''éditeur SQL']),
  ('20260919091000', '105_prise_de_mission',         array['-- appliquée manuellement via l''éditeur SQL']),
  ('20260919092000', '106_autorite_sans_nominatif',  array['-- appliquée manuellement via l''éditeur SQL'])
on conflict (version) do nothing;
```

Une fois ces lignes en place, la série est continue de 001 à 106.

### 107 et 108 : à appliquer — lot 11 (campagne de tests du 20/09)

| Fichier | Corrige |
|---|---|
| `20260920100000_107_campagne_tests.sql` | Logo irremplaçable (pas de policy SELECT sur le bucket) ; retour impossible d'un membre retiré (exploitant et code d'invitation) ; « coordination » lisible par tout `rh:modifier` ; le responsable d'une action peut la faire avancer ; `mon_terrain` renvoie le titulaire ; un chauffeur bénévole prend un transport ; les traces sont un référentiel ; `evenement_public` dit si le SOS est actif ; `reprendre_groupe_comme_equipe` |
| `20260920101000_108_matrice_resserree.sql` | Matrice standard : chef d'équipe sans `referentiels:creer/modifier`, bénévole sans `logistique:creer/modifier` ni `rh:modifier`, ressource fantôme `transports` retirée — **et réalignement des événements existants sur ces quatre points**. À lire avant d'appliquer : c'est une décision de produit, pas un correctif |

Éprouvées ensemble dans une transaction annulée : `droits.sql` complet,
51 lignes OK (une IGNORÉ faute de jalon vivant sur BFMF2027), blocs O à
T compris. Appliquer la 107 **avant** de déployer l'application : la page
participant et Mon terrain lisent des colonnes qu'elle ajoute.

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260920100000', '107_campagne_tests',     array['-- appliquée manuellement via l''éditeur SQL']),
  ('20260920101000', '108_matrice_resserree',  array['-- appliquée manuellement via l''éditeur SQL'])
on conflict (version) do nothing;
```

Une fois ces lignes en place, la série est continue de 001 à 108.

> État constaté le 24/09 : 107 et 108 sont **appliquées** (la fonction
> `reprendre_groupe_comme_equipe` existe, `transports` a disparu de la
> matrice) mais **pas enregistrées** — l'historique s'arrête à 106.
> Le bloc d'enregistrement ci-dessous (109) les reprend.

### 109 : à appliquer — la page autorité redevient un outil de travail (24/09)

| Fichier | Fait |
|---|---|
| `20260924080000_109_autorite_operationnelle.sql` | `acces_autorite.niveau` (`situation` / `operationnel`) ; `contacts.visible_autorite` (rien par défaut, seul un coordinateur coche) ; table `documents_autorite` ; `situation_autorite` renvoie les interventions une par une, les recherches (où et quand, jamais qui), les groupes sur le parcours, la veille météo, les accès secours, les repères, les tronçons et le brancardage, les ressources (DEA, eau, coupures, moyens), les installations à risque, le programme, le plan radio, les contacts cochés et les documents |

Éprouvée dans une transaction annulée avec les blocs N et U de
`droits.sql` : 9 lignes OK. Au niveau « situation », aucun texte libre ;
au niveau « opérationnel », les descriptions ; aux deux, ni nom ni numéro
de l'appelant, de la personne recherchée ou de son accompagnant. Appliquer
la 109 **avant** de déployer l'application : Réglages › Partage lit
`documents_autorite` et `contacts.visible_autorite`.

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260920100000', '107_campagne_tests',          array['-- appliquée manuellement via l''éditeur SQL']),
  ('20260920101000', '108_matrice_resserree',       array['-- appliquée manuellement via l''éditeur SQL']),
  ('20260924080000', '109_autorite_operationnelle', array['-- appliquée manuellement via l''éditeur SQL'])
on conflict (version) do nothing;
```

### 110 : appliquée le 26/09 (par Claude, via l'outil Supabase) — audit 4.8 et 4.9

| Fichier | Fait |
|---|---|
| `20260926090000_110_references_et_codes.sql` | Références REC- des recherches et codes FR- des fiches réflexe attribués par la base (plus de collision après une suppression) ; unicité des codes de lieux, équipes, types de mission, matériel et contacts sur les seules lignes vivantes (un code supprimé se réimporte) |

Éprouvée en transaction annulée, puis appliquée et inscrite dans l'historique en une seule transaction. Bloc V de `droits.sql`.

### 111 : appliquée le 26/09 (par Claude, via l'outil Supabase) — vider un événement

| Fichier | Fait |
|---|---|
| `20260926110000_111_vider_evenement.sql` | `vider_evenement(evenement, blocs, confirmation, simulation)` : suppression réelle par bloc (activité, préparation, bénévoles, parcours, plan, référentiels, conformité), réservée au tout pouvoir, confirmation par le nom, interdite en exploitation, simulation pour afficher les comptes, ligne « majeur » au journal. Stocks ramenés à leur quantité d'avant les mouvements, groupes remis à « inscrit » |

Éprouvée en transaction annulée sur Rando VTT (chef d'équipe refusé, exploitation refusée, mauvais nom refusé, activité vidée en gardant les lieux, stock 6 → 10, journal réduit à la ligne du vidage ; puis tous les blocs), puis appliquée et inscrite.

### 112 : appliquée le 26/09 (par Claude, via l'outil Supabase) — supprimer un événement

| Fichier | Fait |
|---|---|
| `20260926120000_112_supprimer_evenement.sql` | Corbeille de la console Plateforme, réservée à l'exploitant : `supprimer_evenement(evenement, confirmation)` (suppression logique, nom retapé, refusée en exploitation, ligne au journal), `restaurer_evenement(evenement)` (vérifie le quota), `purger_evenement(evenement, confirmation)` (seulement depuis la corbeille : membres d'abord, puis l'événement et ses 47 tables en cascade ; les fichiers du stockage restent), `evenements_supprimes()` |

Éprouvée en transaction annulée (non-exploitant refusé, mauvais nom refusé, corbeille puis restauration, purge hors corbeille refusée, exploitation refusée), puis appliquée et inscrite.

### 113 : appliquée le 14/10 par Ren dans le SQL Editor (script autovérifié `appliquer-113-sql-editor.sql`) — dette de la base

| Fichier | Fait |
|---|---|
| `20261003090000_113_dette_base.sql` | 25 index de clés étrangères (les 10 `evenement_id` signalés et les liens suivis par les cascades) ; fusion, par table et par commande, des policies doubles de 17 tables (OU des anciennes conditions : mêmes droits, une évaluation) ; `auth.uid()` enveloppé en `(select auth.uid())` ; `trg_horodatage` sur les 8 tables dont `updated_at` ne bougeait pas |

Le script s'est vérifié lui-même avant de valider : 0 écart de visibilité (20 tables × chaque compte), 0 policy en double, suppression logique directe toujours possible. Inscrite après la 114 dans le temps, avant elle par numéro. Les six index « jamais utilisés » sont gardés exprès (base de test trop petite pour s'en servir).

### 114 : appliquée le 14/10 (par Claude, via l'outil Supabase) — Précurseur

| Fichier | Fait |
|---|---|
| `20261005060000_114_precurseur.sql` | Module Précurseur livré par Ren (fichier d'origine `20261004_precurseur_module_eventware.sql`) : 5 tables `prc_*`, vues de charge par lieu, grappes, mémoire des incidents, déclencheur sur `missions`, grappes dans la main courante. Trois retouches : verrou par événement dans `prc_actualiser_grappes`, déclencheur qui ne bloque jamais une demande, ressource `precurseur` dans `matrice_permissions` |

Éprouvée en transaction annulée sur Rando VTT (grappe détectée puis modifiée et résorbée au fil des clôtures, chef d'équipe en lecture et refusé en écriture, demande enregistrée malgré une erreur de calcul provoquée), puis appliquée et inscrite. L'outil Supabase refuse désormais toute requête contenant `DROP` : les `drop … if exists` du fichier, sans objet sur une première installation, ont été omis à l'application. Appliquée avant la 113, qui porte un numéro plus bas.

### 115 : appliquée le 15/10 (par Claude, via l'outil Supabase) — implantation à l'échelle

| Fichier | Fait |
|---|---|
| `20261015200000_115_implantation_echelle.sql` | `catalogue_equipements` (44 fiches standard + fiches par organisation : dimensions, calque, puissance, eau, public, distance de sécurité) ; `elements_plan` gagne centre, largeur, longueur, rotation, puissance consommée/produite, `alimente_par`, besoin/source/raccord d'eau, public, distance de sécurité, fournisseur — `geometrie` reste le polygone calculé, lu par tous les autres écrans ; code attribué par la base (`PREFIXE-nn`, security definer pour voir les lignes supprimées) ; `fonds_plan` + bucket privé `plans` ; `supprimer_logiquement` accepte `elements_plan` |

Éprouvée en transaction annulée (codes GE60-01 puis GE60-02 après suppression, chef d'équipe lit le catalogue et ne peut écrire au standard, retire un objet en exploitation, fond calé), puis appliquée et inscrite. Aucun DROP.

### 116 : appliquée le 15/10 (par Claude, via l'outil Supabase) — demandes similaires

| Fichier | Fait |
|---|---|
| `20261015210000_116_demandes_similaires.sql` | module livré par Ren (fichier d'origine `20261015_demandes_similaires.sql`) : extensions `pg_trgm` et `unaccent` dans le schéma `extensions` ; table `demande_vocabulaire` (synonymes et mots vides, commun = `evenement_id` NULL, surcharge par événement, CRUD sous `referentiels/modifier`) ; `normaliser_demande` (minuscules, sans accents, « étape 2 » → `etape2`, synonymes, mots vides) ; `score_similarite` (trigrammes ou mots partagés) ; `missions_similaires(événement, titre, description, lieu, exclure, seuil, auteur, date)` → doublon / complément / récurrence sur 6 h, security invoker (RLS des missions). Repris tel quel sauf : `drop … if exists` retirés (sans objet, et l'outil refuse tout DROP) ; policy `gestion FOR ALL` scindée en insert / update / delete pour ne pas recréer une policy double sur SELECT (113) |

Éprouvée en transaction annulée par rejeu des 68 demandes réelles de BFMF 2026 avec les lieux et émetteurs du jeu de Ren : 7 suggestions, les mêmes que son évaluation (029 doublon de 026, 033 récurrence de 025, 042 et 067 compléments, 053, 061, 063). Appliquée et inscrite. Sur les données de production, les demandes BFMF importées n'ont ni lieu ni auteur : la fonction y serait bruyante, mais la fenêtre de 6 h les met hors jeu.

### 117 : appliquée le 15/10 (par Claude, via l'outil Supabase) — barriérage et pictogrammes

| Fichier | Fait |
|---|---|
| `20261015220000_117_barrierage_pictos.sql` | `nature` (objet / ligne / picto) et `picto` sur `catalogue_equipements` et `elements_plan`, `quantite` sur `elements_plan` ; les barrières standard (HERAS, NADAR, CRASH) passent en nature `ligne` : le tracé est `geometrie`, `largeur_m` la longueur d'un module, `longueur_m` le total, `quantite` le nombre de barrières ; 16 pictogrammes de sécurité (sortie, sortie de secours, sens d'évacuation, rassemblement, extincteur, RIA, hydrant, DEA, premiers soins, téléphone, coupures élec/gaz, eau potable, interdit, danger, PMR) dessinés par l'application. Les contraintes `forme in ('rect','cercle')` de la 115 sont laissées telles quelles (les retoucher demanderait un DROP CONSTRAINT) |

Éprouvée en transaction annulée (insertion d'un picto → code `SORTIE-01`, d'une ligne de 12 Heras), puis appliquée et inscrite. Aucun DROP.

### 118 : appliquée le 15/10 (par Claude, via l'outil Supabase) — réseaux d'électricité et d'eau

| Fichier | Fait |
|---|---|
| `20261015230000_118_reseaux.sql` | `catalogue_equipements` et `elements_plan` gagnent `reseau` (electricite / eau), `tension_v`, `phases`, `calibre_a`, `differentiel_ma`, `ip`, `section_mm2`, `type_cable`, `diametre_mm` ; `elements_plan` gagne `de_id` / `vers_id` (un câble ou une conduite va d'un objet à un autre) et `terre` (mise à la terre vérifiée). Les groupes et l'armoire standard reçoivent tension, phases, calibre, différentiel, IP. Catalogue : raccordements réseau 63 / 125 A, coffrets de distribution 32 / 63 / 125 A, câbles H07RN-F 3G1,5 → 5G35, raccordement eau, répartiteur, conduites 19 → 50 mm |

Éprouvée en transaction annulée (GE60 → câble 5G16 → coffret 63 A, codes `CAB5G16-01`), puis appliquée et inscrite. Aucun DROP.

### 119 : appliquée le 15/10 (par Claude, via l'outil Supabase) — taille des pictogrammes

| Fichier | Fait |
|---|---|
| `20261015234000_119_taille_pictos.sql` | les pictogrammes se dessinent à l'échelle : `largeur_m` = taille au plan, 3 m par défaut (catalogue et les 3 pictos déjà posés, qui étaient à 0,5 m) |

## Ne jamais rejouer 088 → 119 par `db push` sans les lignes ci-dessus

Sans enregistrement, `supabase db push` considérerait ces migrations
comme nouvelles et les rejouerait : `create type visibilite_jalon`
échouerait (le type existe), et la commande s'arrêterait là.

## Reconstruire un projet neuf

Rejouer les fichiers dans l'ordre des horodatages (c'est l'ordre
lexicographique des noms de fichiers). `supabase db push` le fait ; un
`psql -f` en boucle aussi.

## Ce qui n'est PAS ici

Aucune donnée client, à une exception assumée : `093_reprise_bfmf2026`
réimporte l'historique de l'édition 2026 (référentiels, créneaux,
missions, transports) avec `origine = 'import'`. Le reste des
référentiels d'un événement (lieux, équipes, matériel…) se charge
exclusivement par formulaire ou par import CSV depuis l'app. Jamais par
édition d'un fichier source — c'est ce mode de travail qui a provoqué
la perte de données de BFMF 2026.

La matrice de permissions, les rôles standard, les fiches réflexe
standard et les référentiels géographiques (communes, zones de police
et de secours wallonnes) sont du contenu produit, semé par migration.

## Dépendance d'environnement, hors migrations

Le projet a été créé avec l'option **« Enable automatic RLS »** cochée.
Elle installe une fonction `rls_auto_enable` et un event trigger qui
activent RLS sur toute nouvelle table du schéma public.

Ce filet n'est pas dans les migrations — il vient de Supabase, pas de
nous. Sur un projet neuf reconstruit depuis ce repo, **cocher la même
option à la création**, sinon une table ajoutée sans `enable row level
security` serait exposée en clair.

## Test d'isolation

Critère de sortie de phase 1, à rejouer après toute modification des
policies (voir aussi `../verifications/droits.sql`) :

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid_utilisateur>","role":"authenticated"}';
select count(*) from evenements;
```

Un utilisateur ne doit voir que les événements dont il est membre.
