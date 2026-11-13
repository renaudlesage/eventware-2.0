#!/bin/bash
# Rejoue le socle Supabase puis toutes les migrations du dépôt sur la réplique locale (port 5433).
# Usage : rejouer.sh [depuis_nom_de_fichier]   — s'arrête à la première erreur.
#         JUSQUA=170 rejouer.sh              — s'arrête après la migration de ce numéro (pour éprouver le contrôle).
#
# Se termine par le contrôle des fonctions exposées (migration 171) et ÉCHOUE s'il renvoie une ligne :
# une fonction créée sans « revoke execute … from public, anon » ne passe plus inaperçue.
set -u
P=/var/lib/postgresql/replique
PSQL="psql -h $P -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
DIR=/home/user/eventware-2.0/supabase/migrations
ICI=$(cd "$(dirname "$0")" && pwd)
if [ "${1:-}" = "" ]; then
  $PSQL -d postgres -c "drop database if exists replique" -c "create database replique" || exit 1
  $PSQL -d replique -f "$ICI/00_supabase_stub.sql" || { echo "✗ socle"; exit 1; }
fi
for f in $(ls "$DIR"/*.sql | sort); do
  n=$(basename "$f")
  if [ -n "${1:-}" ] && [[ "$n" < "$1" ]]; then continue; fi
  num=$(echo "$n" | cut -d_ -f2)
  if [ -n "${JUSQUA:-}" ] && [ "$((10#$num))" -gt "$((10#$JUSQUA))" ]; then continue; fi
  out=$($PSQL -d replique -f "$f" 2>&1)
  if [ $? -ne 0 ]; then echo "✗ $n"; echo "$out" | grep -E "ERROR|LINE|DETAIL|HINT|CONTEXT" | head -8; exit 1; fi
  $PSQL -d replique -c "insert into supabase_migrations.schema_migrations (version, name) values ('${n%%_*}', '${n#*_}') on conflict do nothing"
done
if [ -n "${JUSQUA:-}" ]; then echo "✓ migrations rejouées jusqu'à $JUSQUA"; else echo "✓ toutes les migrations rejouées"; fi

# Le contrôle final. À partir de 171, c'est la fonction audit_fonctions_exposees() ; avant, la même requête
# hors fonction (controle-avant-171.sql), pour pouvoir montrer ce que le contrôle aurait vu.
if [ "$($PSQL -d replique -At -c "select to_regprocedure('public.audit_fonctions_exposees()') is not null")" = "t" ]; then
  out=$($PSQL -d replique -At -c "select fonction || ' — ' || probleme from audit_fonctions_exposees()") || { echo "✗ contrôle des fonctions exposées : la requête a échoué"; exit 1; }
else
  out=$($PSQL -d replique -At -f "$ICI/controle-avant-171.sql") || { echo "✗ contrôle des fonctions exposées : la requête a échoué"; exit 1; }
fi
if [ -n "$out" ]; then
  echo "✗ contrôle des fonctions exposées : $(echo "$out" | wc -l) ligne(s), $(echo "$out" | sed 's/ — .*//' | sort -u | wc -l) fonction(s)"
  echo "$out"
  echo "  → chaque fonction créée doit être suivie de « revoke execute … from public, anon » puis du grant voulu (voir supabase/migrations/README.md, « Avant de proposer une migration »)."
  exit 1
fi
echo "✓ contrôle des fonctions exposées : vide"
