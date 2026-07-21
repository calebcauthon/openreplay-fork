# User Session Reports — open work

Follow-ups from building the user-initiated bug report feature
(`feat/user-session-reports`). Grouped by priority; each item notes *why* it
matters, since that's the part that isn't recoverable from the diff.

---

## 1. Blocking — must fix before this is used for real

- [ ] **The upload endpoint is unauthenticated and trusts the path `projectId`.**
      `POST /{projectId}/user-reports` has no auth at all: anyone can write rows
      and push images into the bucket against *any* project. Demonstrated with a
      plain `curl`, no credentials. It is public by design — the end user's
      browser has no dashboard session — but it needs to validate the tracker's
      project token / `projects.project_key` before accepting an upload.
      Marked `# TODO(scaffold):` in `api/routers/subs/user_reports.py` and
      `api/chalicelib/core/user_reports.py`.

---

## 2. Product gaps — the feature works, but is thin

- [ ] **The user can't type anything.** There is no text field; `note` is
      hard-coded to `''` (`tracker/tracker-report/src/Report.ts`). Someone can
      circle a broken button but can't say what went wrong. For a feature called
      "report a problem" this is the biggest hole.
- [ ] **No feedback after submitting.** The overlay just disappears. On failure
      the error only reaches `app.debug.error` in the console, so a user whose
      report was lost has no idea. Needs at least a sent/failed state.
- [ ] **The user never sees what actually gets sent.** They draw on the *live*
      page, but the uploaded image is the *masked* capture — circle a masked
      field and the final image shows a circle around an opaque box. Drawing on
      the captured screenshot instead would fix this and make the privacy
      behaviour visible.
- [ ] **No undo or clear.** It's a raster canvas, so a stray stroke can only be
      escaped by cancelling and starting over.
- [ ] **The button is always visible, everywhere.** No way to trigger the flow
      from the host app's own UI. Exposing `open()` on the returned instance
      (plus a way to suppress the floating button) would let a site wire it to an
      existing "Feedback" menu.

---

## 3. Cleanups — small, known, low risk

- [ ] **Remove the debug diagnostic from the Activity panel.** When a report
      can't be resolved it dumps raw property names — that was my debugging aid,
      not product copy. `frontend/app/components/DataManagement/Activity/EventDetailsModal.tsx`.
      Keep the graceful fallback, drop the key list.
- [ ] **`html2canvas` is imported eagerly**, adding ~400 kB to the host app's
      main bundle on every page view. Move it behind a dynamic `import()` inside
      `captureScreenshot()` so it loads only when someone files a report.
- [ ] **Verify the standalone User Reports page renders.** The list + detail
      views (`frontend/app/components/UserReports/`) are scaffolded, routed and
      in the nav, but never actually opened — the Activity panel turned out to be
      what was wanted. Either confirm it works or remove it.

---

## 4. Upstream / repo hygiene (not ours, but they bite)

- [ ] **Report the `SessionConfirmStatus` build break upstream.** `LiveOverlay.tsx`
      imported a symbol that exists nowhere in the tree, so `yarn build` failed
      outright at HEAD. Fixed locally in `90e0751` with a local enum that
      preserves behaviour; better upstream than carried.
- [ ] **`gen:icons` rewrites `SVG.tsx` destructively.** Every `yarn build`
      regenerates it as roughly **−2214/+1135 lines** versus what's committed, so
      it shows as modified after each build and could silently drop icon
      definitions if committed by accident. The committed file and the generator
      have diverged; worth reconciling.
- [ ] **Missing frontend assets return `200`, not `404`.** The frontend image's
      nginx has `error_page 404 =200 /index.html`, so a stale chunk answers 200
      with `content-type: text/html`. This makes stale-bundle failures completely
      silent — no failed request to see. Cost real debugging time; consider
      excluding hashed assets from that fallback.

---

## 5. Production readiness (local-only so far)

- [ ] **`USER_REPORTS_BUCKET` only exists in local compose.** Real deploys need
      it in the helm values, alongside bucket provisioning (mirror wherever
      `ASSIST_RECORDS_BUCKET` is defined). Same for `S3_INTERNAL_HOST`, which
      exists because `S3_HOST` is browser-facing.
- [ ] **No rollback migration** for `1.28.0`. There are paired rollback scripts
      up to `1.26.0` under `scripts/schema/db/rollback_dbs/postgresql/`; add one
      if the release process expects them.
- [ ] **No S3 retention tagging.** `assist_records` tags uploaded objects for
      lifecycle/vault handling via `chalicelib.utils.storage.extra`, which does
      not exist in the community storage package — so it was omitted. Wire it up
      if user reports need retention handling.
- [ ] **Schema divergences to confirm are intentional:** `user_reports.created_at`
      uses `timestamptz DEFAULT now()` while the rest of the schema tends toward
      `timestamp DEFAULT timezone('utc', now())`; and `session_id` is a plain
      `bigint` with no FK, where `assist_records` uses
      `REFERENCES sessions(session_id) ON DELETE SET NULL`.
- [ ] **`make dev-clean` was never tested.** It drops data volumes, so I didn't
      run it. The logic should hold (fresh DB → `init_pg_schema.sql` + the
      idempotent `user_reports.sql`; buckets from `minio.sh`), but it's unproven.

---

## 6. Deferred by design

- [ ] **Tier 2 markup toolkit** — arrow, rectangle, text, highlighter, colour,
      undo. Purely additive on the same raster canvas.
- [ ] **Tier 3 object editor** — selectable/movable shapes via tldraw/Excalidraw/
      Fabric. Only worth it if object-level re-editing is actually needed.
- [ ] **Publish `@openreplay/tracker-report`.** It is vendored into the host app
      via `npm run sync:user-report`, which means changes must be synced to two
      places. Publishing (or a workspace link) removes that step.
- [ ] **Capture is viewport-only** and window resize mid-annotation clears
      strokes. Full-page capture and resize-safe strokes if either becomes
      annoying.

---

## Known environment quirk

ClickHouse exits with code 133 under arm64 emulation on this machine and has
restarted at least once mid-session. It backs the Activity page, so if events
stop appearing, check `docker ps -a | grep clickhouse` before debugging the
feature itself.
