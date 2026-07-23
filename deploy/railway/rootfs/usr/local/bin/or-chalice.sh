#!/bin/bash
# Gate chalice on the one-shot init (schema applied + buckets created) and on postgres
# being reachable, since app.py evaluates tenants_exists() at import time.
set -uo pipefail
. /usr/local/bin/or-env.sh

while [ ! -f /data/run/init.done ]; do echo "[chalice] waiting for init..."; sleep 2; done
until pg_isready -h 127.0.0.1 -p "$pg_port" -U "$pg_user" >/dev/null 2>&1; do sleep 1; done

cd /work/api
# --proxy-headers so X-Forwarded-Proto from nginx (https at the Railway edge) is honored,
# which keeps Secure cookies and absolute URLs correct. nginx connects from 127.0.0.1,
# which uvicorn trusts by default.
exec uvicorn app:app --host 127.0.0.1 --port 8000 --proxy-headers --log-level "${S_LOGLEVEL:-warning}"
