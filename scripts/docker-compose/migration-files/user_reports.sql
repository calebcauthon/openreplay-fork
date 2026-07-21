-- User-initiated session reports (annotated screenshots).
--
-- Applied on every `make dev` by the db-migration service, AFTER init_pg_schema.sql.
-- Written idempotently (IF NOT EXISTS) on purpose: init_pg_schema.sql is version
-- guarded and only runs against a fresh database, so it can't add this table to an
-- existing volume. This file covers both cases.
--
-- Keep in sync with:
--   scripts/schema/db/init_dbs/postgresql/init_schema.sql        (fresh installs)
--   scripts/schema/db/init_dbs/postgresql/1.28.0/1.28.0.sql      (release migration)

CREATE TABLE IF NOT EXISTS public.user_reports
(
    report_id  uuid                     PRIMARY KEY,
    project_id integer                  NOT NULL REFERENCES public.projects (project_id) ON DELETE CASCADE,
    session_id bigint                   NULL,
    file_key   text                     NOT NULL,
    note       text                     NULL     DEFAULT NULL,
    page_url   text                     NULL     DEFAULT NULL,
    -- replay offset in ms from session start; enables deep-linking to the exact moment
    time_ms    bigint                   NULL     DEFAULT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_reports_project_id_session_id_idx ON public.user_reports (project_id, session_id);
CREATE INDEX IF NOT EXISTS user_reports_project_id_created_at_idx ON public.user_reports (project_id, created_at DESC);
