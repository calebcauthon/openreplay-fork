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
: "${LOGLEVEL:=INFO}"

export PORT OR_DATA PGDATA MINIO_DATA REDIS_DATA FS_DIR \
  OR_PUBLIC_DOMAIN SITE_URL S3_HOST S3_INTERNAL_HOST \
  S3_KEY S3_SECRET sessions_region AWS_DEFAULT_REGION USER_REPORTS_BUCKET \
  pg_host pg_port pg_user pg_password pg_dbname REDIS_STRING CH_POOL ch_host \
  JWT_SECRET JWT_REFRESH_SECRET JWT_SPOT_SECRET JWT_SPOT_REFRESH_SECRET \
  ASSIST_JWT_SECRET ASSIST_KEY root_path LOGLEVEL
