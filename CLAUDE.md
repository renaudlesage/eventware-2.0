# Eventware 2.0 — repères pour une session Claude Code

Application de coordination d'événements (React 18, Vite, Supabase, déployée sur Vercel). Ren, l'unique mainteneur, travaille depuis le navigateur et lit le français : commentaires, messages de commit, descriptions de PR et réponses sont en français.

## Ce qui ne se fait jamais sans son accord

- **Appliquer une migration en production.** Seulement sur son « Go NNN », par l'outil Supabase (projet `kunvnnfejhnuhflycyfz`), puis inscription dans `supabase_migrations.schema_migrations` et dans le README des migrations. Jamais `supabase db push`, aucun `DROP`.
- **Fusionner une PR.** Seulement sur son « Fusionne ». Une fusion dans `main` déploie en production.
- **Déployer une fonction serveur ou toucher à un secret.** Les secrets se saisissent de son côté.

## Migrations

Les règles sont dans `supabase/migrations/README.md`, section « Avant de proposer une migration ». L'essentiel :

- un fichier `supabase/migrations/<YYYYMMDDHHMMSS>_<NNN>_<nom>.sql`, idempotent, encadré par `begin; … commit;` ; on ne modifie jamais une migration existante ;
- **toute fonction créée est suivie de `revoke execute … from public, anon`, puis du `grant` voulu**, et fige son `search_path`. Une fonction publique par jeton s'ajoute à la liste `voulues` de `audit_fonctions_exposees()` ;
- un test `outils/replique/tests/<NNN>.sql` (aides `tests.connecter`, `tests.anonyme`, `tests.ok`, `tests.refuse`, `tests.erreur`), un script en lecture seule dans `supabase/verifications/` s'il y a quelque chose à vérifier en production, une section dans le README.

## Vérifier avant de proposer

- `npm run build`.
- La réplique locale : `outils/replique/rejouer.sh` rejoue toutes les migrations et **échoue si `audit_fonctions_exposees()` renvoie une ligne** ; puis les tests (`outils/replique/README.md`).
- Le banc d'essai : `node outils/banc-essai/lancer.mjs [écran…]` monte les écrans sur un faux Supabase, en bureau, téléphone et tablette.
- La production se lit (lecture seule) pour vérifier une hypothèse ; elle ne se modifie pas pour l'éprouver.

## Application

- Couleurs et tailles : les jetons de `src/styles.css` (voir `docs/design-tokens.md`), aucune couleur en dur ; composants existants avant d'en créer.
- Messages d'erreur par `texteErreur` (`src/erreurs.js`) ; écritures par `modifierOuRefuser` (`src/ecriture.js`) ou, sur le terrain, `ecrireOuEmpiler` (`src/fileEcritures.js`).
- Tutoiement dans toute l'application, pages des bénévoles et des participants comprises ; les pages des autorités restent impersonnelles.
- Les pages publiques par jeton (`?sos=`, `?poste=`, avis, autorité) n'affichent ni nom ni numéro personnel.

## Livraison

Une branche, une PR vers `main`. La description de la PR dit ce qui a été vérifié et comment, ce qui ne l'a pas été, et ce que Ren doit faire lui-même.
