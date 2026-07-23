# OpenReplay "reports path" all-in-one image for Railway.
#
# Railway runs one container per service and does not run docker-compose, so this
# image packs the pieces the user-reports feature needs into a single container,
# supervised by supervisord, with all durable state under /data (one Railway volume):
#
#   postgres (metadata, incl. user_reports)   -> /data/pg
#   minio    (annotated screenshot objects)   -> /data/minio
#   redis    (cache paths chalice touches)    -> /data/redis
#   chalice  (the Python dashboard API)        (stateless)
#   nginx    (serves the SPA + routes /api and the object-storage paths)
#
# Deliberately NOT included: ClickHouse, Kafka and the ingestion pipeline. Session
# replay recording and "jump to the exact replay moment" therefore do not work — only
# the report capture/upload/view path. CH_POOL=false keeps chalice from blocking on
# ClickHouse at boot; ClickHouse-backed dashboard endpoints will error at call time.

# ---------------------------------------------------------------------------
# Stage 1 — build the frontend SPA (includes the UserReports dashboard pages)
# ---------------------------------------------------------------------------
FROM node:24-slim AS frontend
WORKDIR /work/frontend
COPY frontend/ ./
RUN cp .env.sample .env
# API_EDP='' in .env.sample => the SPA calls same-origin /api (see app/api_client.ts).
# Heap kept below the repo's 10G default so Railway's builder is less likely to OOM;
# override with NODE_OPTIONS if parcel runs out of memory.
ARG NODE_OPTIONS="--max-old-space-size=6144"
ENV NODE_OPTIONS=$NODE_OPTIONS
# The repo pins Yarn 4 (Berry) via package.json "packageManager"; corepack activates it.
RUN corepack enable
RUN yarn install --immutable || yarn install
RUN yarn build
# build output: /work/frontend/public

# ---------------------------------------------------------------------------
# Stage 2 — install the Python API (chalice) dependencies
# ---------------------------------------------------------------------------
FROM python:3.13-slim-bookworm AS pydeps
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade uv \
    && UV_SYSTEM_PYTHON=true uv pip install --system --no-cache-dir -r requirements.txt

# ---------------------------------------------------------------------------
# Final — all-in-one runtime
# ---------------------------------------------------------------------------
FROM python:3.13-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive

# System services: postgres 17 (PGDG), redis, nginx, supervisord, minio + mc client.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg tini nginx redis-server supervisor gettext-base libpq5; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-17 postgresql-contrib-17; \
    arch="$(dpkg --print-architecture)"; case "$arch" in arm64) m=arm64;; *) m=amd64;; esac; \
    curl -fsSL "https://dl.min.io/server/minio/release/linux-${m}/minio" -o /usr/local/bin/minio; \
    curl -fsSL "https://dl.min.io/client/mc/release/linux-${m}/mc" -o /usr/local/bin/mc; \
    chmod +x /usr/local/bin/minio /usr/local/bin/mc; \
    rm -rf /var/lib/apt/lists/*

# Python runtime (site-packages + console scripts like uvicorn) from the deps stage.
COPY --from=pydeps /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=pydeps /usr/local/bin /usr/local/bin

# Application code (chalice) + its shipped .env defaults (env vars override these).
WORKDIR /work
COPY api/ /work/api/
RUN cp /work/api/env.default /work/api/.env

# Built SPA.
COPY --from=frontend /work/frontend/public /var/www/openreplay

# Postgres schema + the user_reports add-on migration (same files the compose db-migration runs).
COPY scripts/docker-compose/migration-files/init_pg_schema.sql /work/migrations/init_pg_schema.sql
COPY scripts/docker-compose/migration-files/user_reports.sql   /work/migrations/user_reports.sql

# Runtime scripts + supervisord/nginx config (rootfs overlay onto /).
COPY deploy/railway/rootfs/ /
RUN chmod +x /usr/local/bin/or-*.sh

ENV PATH=/usr/lib/postgresql/17/bin:$PATH
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/or-entrypoint.sh"]
