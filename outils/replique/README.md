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
```

`00_supabase_stub.sql` fournit ce que Supabase apporte hors migrations : les rôles `anon`, `authenticated`, `service_role`, le schéma `auth` (`users`, `uid()`, `jwt()`), le schéma `storage`, les extensions et l'activation automatique de RLS sur toute nouvelle table.

## Tester

`tests/00_jeu.sql` pose un jeu d'essai (deux organisations, deux événements, un coordinateur et un bénévole dans A, un coordinateur dans B, un exploitant) et trois aides : `tests.connecter(utilisateur)`, `tests.anonyme()`, `tests.ok(condition, libellé)`. Un test par migration, `tests/NNN.sql`, rejouable :

```sh
PS="psql -h /var/lib/postgresql/replique -p 5433 -U postgres -d replique -v ON_ERROR_STOP=1 -q"
$PS -f outils/replique/tests/00_jeu.sql
for n in 155 156 157 159 160 158 161 162 163 164 165 166 167 168; do $PS -f outils/replique/tests/$n.sql; done
```

L'ordre compte un peu : 157 suppose 155 et 156 (profil complet, aucun bloquant), 159 suppose 157 (dossier déposé), 161 suppose 159 (lien d'instruction).

Chaque contrôle réussi s'affiche `✓` ; le premier échec arrête le script.
