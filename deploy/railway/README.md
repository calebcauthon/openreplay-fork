# OpenReplay on Railway — all-in-one (reports path)

This directory deploys **one Railway service** that runs the slice of OpenReplay needed
for the **user-initiated report** feature: the floating capture/annotate button uploads an
annotated screenshot, and the dashboard lists and views those reports.

Railway runs one container per service and does **not** run OpenReplay's ~26-service
`docker-compose` stack. So this image packs the required pieces into a single container
(supervised by `supervisord`), with all durable state on the single `/data` volume.

## What runs in the container

| Process | State | Role |
|---------|-------|------|
| postgres 17 | `/data/pg` | metadata, incl. the `user_reports` table |
| minio | `/data/minio` | annotated screenshot objects (bucket `user-reports`) |
| redis | `/data/redis` | cache paths chalice touches |
| chalice | — | the Python dashboard API (serves `/api/...`) |
| nginx | — | serves the SPA, routes `/api` → chalice and the bucket paths → minio, on `$PORT` |

## What works / what does not

**Works**
- The floating report button: capture → annotate → upload.
- Upload endpoint `POST /api/{projectId}/user-reports` → object stored in MinIO, row in Postgres.
- Dashboard: log in, list and view reports with the annotated screenshot.

**Does NOT work (by design — the heavy ingestion pipeline is omitted)**
- Session-replay **recording** (no Kafka / sink / ClickHouse).
- The report's "jump to the exact replay moment" link (there is no replay to jump to).
- Any ClickHouse-backed dashboard page (metrics, funnels, session search). These error at
  call time; `CH_POOL=false` keeps them from blocking boot.

## Deploy

The service is wired to build `master` on push. `railway.json` (repo root) points Railway
at `deploy/railway/Dockerfile` (builder = `DOCKERFILE`). Push to `master` → Railway builds
and deploys.

Health check is `/` (nginx serving the SPA). A green deploy means nginx is up; watch the
deploy logs to confirm `postgres`, `minio`, `init` and `chalice` all came up.

### First run

The community edition has **no seeded account**. On first load, open the app and **sign up**
— that creates the tenant + your user (the signup route disappears once a tenant exists).
Then create a project; its `projectId` is what the tracker plugin points at.

## Required environment variables

Non-secret defaults live in `rootfs/usr/local/bin/or-env.sh` (each is "set only if unset",
so Railway values win). These are already set on the service; **rotate the secrets for a
real deployment**:

| Var | Purpose |
|-----|---------|
| `S3_HOST` | **Browser-facing** host baked into presigned URLs. Must equal the public domain (`https://<domain>`). |
| `S3_INTERNAL_HOST` | In-container MinIO for server-side puts (`http://127.0.0.1:9000`). |
| `S3_KEY` / `S3_SECRET` | MinIO credentials (also the MinIO root creds). |
| `pg_password` | Postgres password (used by `initdb` on first boot **and** by chalice). Do not change after the volume is initialized. |
| `SITE_URL` | Public site URL. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_SPOT_SECRET`, `JWT_SPOT_REFRESH_SECRET`, `ASSIST_JWT_SECRET`, `ASSIST_KEY` | Auth secrets. |
| `CH_POOL=false`, `ch_host` | Keep ClickHouse lazy so boot never blocks on it. |

`RAILWAY_PUBLIC_DOMAIN` is injected by Railway; `or-env.sh` derives `S3_HOST`/`SITE_URL`
from it if they aren't set explicitly.

### Optional: auto-file a GitHub issue per report

Set both of the first two and **every** uploaded report opens a GitHub issue — there is no
dashboard step and no way for a reporter to opt out, so expect one issue per button click.
Leave either empty to disable.

| Var | Purpose |
|-----|---------|
| `USER_REPORTS_GITHUB_TOKEN` | Service-level PAT with `repo` scope. The upload endpoint is public (no logged-in user), so the dashboard's per-user GitHub integration cannot be reused here. |
| `USER_REPORTS_GITHUB_REPO` | Target repo, as `owner/name` or a numeric repo id. |
| `USER_REPORTS_GITHUB_LABELS` | Comma-separated labels. Default `OpenReplay,user-report` — filter on these, since filing is automatic. |
| `USER_REPORTS_GITHUB_ASSIGNEES` | Comma-separated GitHub logins. Optional. |
| `USER_REPORTS_PUBLIC_API_URL` | Override the base URL used for the screenshot link. Defaults to `SITE_URL/api`, which is correct here. |

The issue embeds the screenshot inline via `GET /api/{projectId}/user-reports/{reportId}/image`
— a **public, unauthenticated** route, because GitHub's image proxy fetches it anonymously
from its own servers. Two consequences: anyone holding a report's uuid can view that
screenshot, and the image only renders while this deployment is reachable from the public
internet. Filing happens in a background task after the upload is acknowledged, so a
failure never breaks the reporter's submission; the reason is stored on the report and
shown in the dashboard list.

> **`pg_password` caveat:** it seeds the Postgres cluster on the very first boot (empty
> `/data/pg`). Changing it later will not re-seed the cluster and chalice auth to Postgres
> will fail. To change it, also reset the volume (or `ALTER USER` inside the DB).

## Pointing the tracker-report plugin at this deployment

The end-user button lives in the customer's site (the `tracker/tracker-report` package),
not in this stack. Configure its upload endpoint to:

```
https://<your-domain>/api/{projectId}/user-reports
```

(The "tag the OpenReplay session" half of the plugin needs the ingestion pipeline, which is
not deployed here, so only the screenshot upload half functions.)

## Notes / risks

- **Frontend build memory.** `yarn build` (parcel) is memory-heavy. The Dockerfile caps the
  Node heap at 6 GB (`NODE_OPTIONS`); bump the `NODE_OPTIONS` build arg if the builder OOMs.
- **Single container.** Everything shares one container's CPU/RAM; this is a demo/small-scale
  shape, not a scalable production topology. For scale, split into per-component Railway
  services (each stateful one with its own volume) or use the Helm chart.
- **Upload endpoint is unauthenticated** (`POST /{projectId}/user-reports`) and trusts the
  path `projectId` — see `todos.md`. Consider validating the project key before opening this
  publicly.
