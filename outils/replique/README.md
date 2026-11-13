# Réplique locale de la base

Un PostgreSQL 16 local qui rejoue toutes les migrations du dépôt, pour éprouver une migration **avant** de la proposer en production. Rien ici ne touche Supabase.

## Ce qu'il faut

PostgreSQL 16 installé (`/usr/lib/postgresql/16`), un cluster qui écoute sur le port 5433 avec son socket dans `/var/lib/postgresql/replique` :

```sh
P=/var/lib/postgresql/replique
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D $P/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D $P/data -o "-p 5433 -k $P -c listen_addresses=''" -l $P/log start
```

## Rejouer

```sh
outils/replique/rejouer.sh                  # recrée la base, socle Supabase simulé, puis 001 → dernière
outils/replique/rejouer.sh 20261102120000   # seulement à partir de ce nom de fichier
JUSQUA=170 outils/replique/rejouer.sh       # s'arrête après la migration de ce numéro
```

Le rejeu **se termine par le contrôle des fonctions exposées** (`audit_fonctions_exposees()`, migration 171) et échoue s'il renvoie une ligne : une fonction créée sans `revoke execute … from public, anon`, ouverte à `PUBLIC` ou sans `search_path` ne passe plus. Le socle reproduit pour cela les droits par défaut de Supabase (`EXECUTE` accordé à `anon`, `authenticated` et `service_role` sur toute nouvelle fonction de `public`, en plus du droit `PUBLIC` de PostgreSQL) — vérifié le 12/11 : une fois la 173 jouée, les 207 fonctions ont sur la réplique exactement les droits de la production. Avant 171 la fonction n'existe pas ; `controle-avant-171.sql` porte la même requête, pour montrer ce que le contrôle aurait vu (`JUSQUA=170` : 40 fonctions).

`00_supabase_stub.sql` fournit ce que Supabase apporte hors migrations : les rôles `anon`, `authenticated`, `service_role`, le schéma `auth` (`users`, `uid()`, `jwt()`), le schéma `storage`, les extensions et l'activation automatique de RLS sur toute nouvelle table.

## Tester

`tests/00_jeu.sql` pose un jeu d'essai (deux organisations, deux événements, un coordinateur et un bénévole dans A, un coordinateur dans B, un exploitant) et quatre aides : `tests.erreur(requête)` (ce que répond une requête qui échoue, pour distinguer un refus de droits sur la fonction d'un refus par sa garde interne), `tests.connecter(utilisateur)`, `tests.anonyme()`, `tests.ok(condition, libellé)`. Un test par migration, `tests/NNN.sql`, rejouable :

```sh
PS="psql -h /var/lib/postgresql/replique -p 5433 -U postgres -d replique -v ON_ERROR_STOP=1 -q"
$PS -f outils/replique/tests/00_jeu.sql
for n in 155 156 157 159 160 158 161 162 163 164 165 166 167 168 169 170 171 172; do $PS -f outils/replique/tests/$n.sql; done
```

L'ordre compte un peu : 157 suppose 155 et 156 (profil complet, aucun bloquant), 159 suppose 157 (dossier déposé), 161 suppose 159 (lien d'instruction).

Chaque contrôle réussi s'affiche `✓` ; le premier échec arrête le script.
