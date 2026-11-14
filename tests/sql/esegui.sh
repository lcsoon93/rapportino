#!/bin/bash
# Prova le migrazioni e i controlli SQL dell'assistente AI su un Postgres 16 LOCALE (mai sul progetto vero).
# Uso: bash tests/sql/esegui.sh      (serve: pg_ctlcluster 16 main start, utente postgres)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=prova_rapportino_ai
W=$(mktemp -d /tmp/rapportino-sql.XXXX); chmod 755 "$W"
cp supabase/migrations/*.sql tests/sql/*.sql "$W"/; chmod 644 "$W"/*.sql
psql_pg(){ su postgres -c "PGOPTIONS=--client-min-messages=warning psql -X -q -v ON_ERROR_STOP=1 $*"; }
psql_pg "-c 'drop database if exists $DB'" >/dev/null
psql_pg "-c 'create database $DB'" >/dev/null
psql_pg "-d $DB -f $W/stub-supabase.sql" >/dev/null
for f in $(cd "$W" && ls 20*.sql | sort); do psql_pg "-d $DB -f $W/$f" >/dev/null; done
psql_pg "-d $DB -c 'grant all on all tables in schema public to service_role'" >/dev/null
psql_pg "-d $DB -t -f $W/limiti-ai.sql"
psql_pg "-d $DB -t -f $W/rls-ai.sql"
psql_pg "-d $DB -t -f $W/clienti.sql"
# rollback dell'anagrafica e nuova applicazione (la migrazione e' ripetibile)
cp supabase/rollback/20261116090000_anagrafica_clienti_rollback.sql "$W"/; chmod 644 "$W"/*.sql
psql_pg "-d $DB -f $W/20261116090000_anagrafica_clienti_rollback.sql" >/dev/null
psql_pg "-d $DB -t -c \"select 'rollback: ' || (case when to_regclass('public.clienti') is null and not exists (select 1 from information_schema.columns where table_name='rapportini' and column_name='cliente_id') then 'ok' else 'ERRORE' end)\""
psql_pg "-d $DB -f $W/20261116090000_anagrafica_clienti.sql" >/dev/null
psql_pg "-d $DB -f $W/20261116090000_anagrafica_clienti.sql" >/dev/null
echo " migrazione riapplicata due volte: ok"
psql_pg "-c 'drop database $DB'" >/dev/null
rm -rf "$W"
echo "SQL: tutti i controlli superati"
