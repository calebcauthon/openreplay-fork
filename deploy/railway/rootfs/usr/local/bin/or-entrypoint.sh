#!/bin/bash
# PID 1 (under tini). One-time host prep, then hand off to supervisord which keeps
# postgres / redis / minio / chalice / nginx running.
set -euo pipefail
. /usr/local/bin/or-env.sh

echo "[entrypoint] OR_PUBLIC_DOMAIN=${OR_PUBLIC_DOMAIN}  S3_HOST=${S3_HOST}  PORT=${PORT}"

# --- data dirs on the /data volume ---
mkdir -p "$OR_DATA" "$PGDATA" "$MINIO_DATA" "$REDIS_DATA" "$FS_DIR" /data/run \
         /var/run/postgresql /var/log/openreplay
chown -R postgres:postgres "$PGDATA" /var/run/postgresql
# The volume mount point itself may be root-owned; PGDATA must be postgres-owned.
chown postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

# --- first-boot postgres cluster init ---
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[entrypoint] initializing postgres cluster at $PGDATA"
  printf '%s' "$pg_password" > /tmp/pgpw
  su postgres -c "initdb -D '$PGDATA' -U '$pg_user' --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/pgpw --encoding=UTF8"
  rm -f /tmp/pgpw
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = ${pg_port}"
  } >> "$PGDATA/postgresql.conf"
  echo "host all all 127.0.0.1/32 scram-sha-256" >> "$PGDATA/pg_hba.conf"
else
  echo "[entrypoint] reusing existing postgres cluster at $PGDATA"
fi

# --- render nginx config with the runtime PORT ---
envsubst '${PORT}' < /etc/openreplay/nginx.conf.template > /etc/nginx/conf.d/openreplay.conf
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

echo "[entrypoint] starting supervisord"
exec supervisord -c /etc/supervisor/conf.d/openreplay.conf -n
