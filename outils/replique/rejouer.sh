#!/bin/bash
# Rejoue le socle Supabase puis toutes les migrations du dépôt sur la réplique locale (port 5433).
# Usage : rejouer.sh [depuis_numero]   — s'arrête à la première erreur.
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
  out=$($PSQL -d replique -f "$f" 2>&1)
  if [ $? -ne 0 ]; then echo "✗ $n"; echo "$out" | grep -E "ERROR|LINE|DETAIL|HINT|CONTEXT" | head -8; exit 1; fi
  $PSQL -d replique -c "insert into supabase_migrations.schema_migrations (version, name) values ('${n%%_*}', '${n#*_}') on conflict do nothing"
done
echo "✓ toutes les migrations rejouées"
