#!/bin/sh
# Runs once, when the data directory is empty: a login role for postgres_exporter that can only read statistics.
set -eu
psql -v ON_ERROR_STOP=1 -v password="$EXPORTER_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE postgres_exporter LOGIN PASSWORD :'password';
GRANT pg_monitor TO postgres_exporter;
SQL
