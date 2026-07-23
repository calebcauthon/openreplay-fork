#!/bin/bash
# One-shot bootstrap: apply the Postgres schema and create the MinIO buckets, then drop
# a sentinel so chalice may start. Deliberately does NOT `set -e`: it waits for its
# dependencies and always leaves the sentinel so a transient migration hiccup surfaces in
# chalice's logs rather than wedging the whole container. Idempotent across restarts.
set -uo pipefail
. /usr/local/bin/or-env.sh

echo "[init] waiting for postgres..."
until pg_isready -h 127.0.0.1 -p "$pg_port" -U "$pg_user" >/dev/null 2>&1; do sleep 1; done

export PGPASSWORD="$pg_password"
PSQL="psql -h 127.0.0.1 -p $pg_port -U $pg_user -d $pg_dbname"

# init_pg_schema.sql is self-guarding: if the `tenants` table already exists it \q's
# immediately, so re-running on an existing volume is a no-op.
echo "[init] applying base schema (no-op if already initialized)..."
$PSQL -v ON_ERROR_STOP=1 -f /work/migrations/init_pg_schema.sql || \
  echo "[init] base schema step returned non-zero (expected if DB already initialized)"

echo "[init] applying user_reports migration (idempotent)..."
$PSQL -v ON_ERROR_STOP=1 -f /work/migrations/user_reports.sql || \
  echo "[init] WARNING: user_reports migration returned non-zero"

echo "[init] waiting for minio..."
until curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; do sleep 1; done

mc alias set local http://127.0.0.1:9000 "$S3_KEY" "$S3_SECRET" >/dev/null 2>&1 || true
for b in mobs sessions-assets static sourcemaps records spots "$USER_REPORTS_BUCKET"; do
  mc mb --ignore-existing "local/$b" >/dev/null 2>&1 || true
done
mc anonymous set download local/sessions-assets >/dev/null 2>&1 || true

touch /data/run/init.done
echo "[init] done."
