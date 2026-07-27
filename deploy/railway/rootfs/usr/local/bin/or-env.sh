#!/bin/bash
# Baked runtime defaults for the all-in-one image.
#
# Every value is set ONLY IF UNSET (`: "${VAR:=default}"`), so anything configured in
# Railway (secrets, overrides) wins. python-decouple reads os.environ before /work/api/.env,
# so these exports also override the shipped env.default. Sourced by every or-*.sh script;
# re-sourcing is idempotent.

# --- paths / volume layout (all durable state under the single /data volume) ---
: "${PORT:=8080}"
: "${OR_DATA:=/data}"
: "${PGDATA:=${OR_DATA}/pg}"
: "${MINIO_DATA:=${OR_DATA}/minio}"
: "${REDIS_DATA:=${OR_DATA}/redis}"
: "${FS_DIR:=${OR_DATA}/fs}"

# --- public, browser-facing host ---
# Railway injects RAILWAY_PUBLIC_DOMAIN at runtime once the service has a domain.
# S3_HOST MUST be this public host: it is baked into the presigned URLs the browser
# fetches, and nginx routes /user-reports/* (and the other bucket paths) to MinIO.
: "${OR_PUBLIC_DOMAIN:=${RAILWAY_PUBLIC_DOMAIN:-localhost}}"
: "${SITE_URL:=https://${OR_PUBLIC_DOMAIN}}"
: "${S3_HOST:=https://${OR_PUBLIC_DOMAIN}}"
# Server-side puts by chalice go to the in-container MinIO, not back out through the edge.
: "${S3_INTERNAL_HOST:=http://127.0.0.1:9000}"

# --- object storage (MinIO). S3_KEY/S3_SECRET double as the MinIO root credentials. ---
: "${S3_KEY:=openreplaykey}"
: "${S3_SECRET:=openreplaysecret0}"
: "${sessions_region:=us-east-1}"
: "${AWS_DEFAULT_REGION:=us-east-1}"
: "${USER_REPORTS_BUCKET:=user-reports}"

# --- GitHub issue auto-filing for user reports (OPT-IN: set the first two in Railway) ---
# Every uploaded report files an issue. A service-level PAT with `repo` scope is required
# because the upload endpoint is public — there is no logged-in user whose token we could
# reuse. REPO takes "owner/name" or a numeric repo id. Leave TOKEN/REPO empty to disable.
#
# The issue body embeds the screenshot through the public
# /{projectId}/user-reports/{reportId}/image route. That resolves to SITE_URL/api here,
# which on Railway is a real public domain, so GitHub's image proxy can fetch it.
: "${USER_REPORTS_GITHUB_TOKEN:=}"
: "${USER_REPORTS_GITHUB_REPO:=}"
: "${USER_REPORTS_GITHUB_LABELS:=OpenReplay,user-report}"
: "${USER_REPORTS_GITHUB_ASSIGNEES:=}"
: "${USER_REPORTS_PUBLIC_API_URL:=}"

# --- postgres (local) ---
: "${pg_host:=127.0.0.1}"
: "${pg_port:=5432}"
: "${pg_user:=postgres}"
: "${pg_password:=openreplaypg}"
: "${pg_dbname:=postgres}"

# --- redis (local) ---
: "${REDIS_STRING:=redis://127.0.0.1:6379}"

# --- ClickHouse is NOT deployed. Keep the pool OFF so chalice never blocks on it at
#     boot; ch_host is set only so ch_client's import-time config doesn't demand
#     CLICKHOUSE_HOST. CH-backed dashboard endpoints will error when actually called. ---
: "${CH_POOL:=false}"
: "${ch_host:=127.0.0.1}"

# --- secrets (OVERRIDE THESE IN RAILWAY) ---
: "${JWT_SECRET:=change_me_jwt}"
: "${JWT_REFRESH_SECRET:=change_me_jwt_refresh}"
: "${JWT_SPOT_SECRET:=change_me_jwt_spot}"
: "${JWT_SPOT_REFRESH_SECRET:=change_me_jwt_spot_refresh}"
: "${ASSIST_JWT_SECRET:=change_me_assist_jwt}"
: "${ASSIST_KEY:=change_me_assist_key}"

: "${root_path:=/api}"
# WARNING (not INFO): at INFO chalice's log_all_requests middleware emits one line
# per request and apscheduler logs every job run, which on Railway trips the
# 500-logs/sec/replica limit. WARNING still surfaces non-2xx and slow-request logs.
: "${LOGLEVEL:=WARNING}"

# The ingestion/backend microservices (http, sink, ender, storage, ...) are NOT part of
# this reports-only image. get_health() (hit by the SPA's /health poll) otherwise probes
# all of them at their k8s DNS names; each unreachable probe dumps a full urllib3
# connection traceback (~300 log lines per /health call), which alone trips Railway's
# 500-logs/sec limit. Skipping the group leaves the real checks (postgres/redis/ssl).
: "${SKIP_H_BACKENDSERVICES:=true}"

export PORT OR_DATA PGDATA MINIO_DATA REDIS_DATA FS_DIR \
  OR_PUBLIC_DOMAIN SITE_URL S3_HOST S3_INTERNAL_HOST \
  S3_KEY S3_SECRET sessions_region AWS_DEFAULT_REGION USER_REPORTS_BUCKET \
  USER_REPORTS_GITHUB_TOKEN USER_REPORTS_GITHUB_REPO USER_REPORTS_GITHUB_LABELS \
  USER_REPORTS_GITHUB_ASSIGNEES USER_REPORTS_PUBLIC_API_URL \
  pg_host pg_port pg_user pg_password pg_dbname REDIS_STRING CH_POOL ch_host \
  JWT_SECRET JWT_REFRESH_SECRET JWT_SPOT_SECRET JWT_SPOT_REFRESH_SECRET \
  ASSIST_JWT_SECRET ASSIST_KEY root_path LOGLEVEL SKIP_H_BACKENDSERVICES
