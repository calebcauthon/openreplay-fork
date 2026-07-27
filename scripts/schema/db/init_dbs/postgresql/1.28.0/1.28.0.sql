\set previous_version 'v1.27.0'
\set next_version 'v1.28.0'
SELECT openreplay_version()                       AS current_version,
       openreplay_version() = :'previous_version' AS valid_previous,
       openreplay_version() = :'next_version'     AS is_next
\gset

\if :valid_previous
\echo valid previous DB version :'previous_version', starting DB upgrade to :'next_version'
BEGIN;
SELECT format($fn_def$
CREATE OR REPLACE FUNCTION openreplay_version()
    RETURNS text AS
$$
SELECT '%1$s'
$$ LANGUAGE sql IMMUTABLE;
$fn_def$, :'next_version')
\gexec

--

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
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    -- GitHub issue auto-filed for this report. Populated asynchronously after the
    -- upload returns, so all four stay NULL until the background task lands. On
    -- failure issue_error holds the reason, which keeps a misconfigured or
    -- rate-limited integration visible in the dashboard instead of silent.
    issue_provider text                 NULL     DEFAULT NULL,
    issue_id       text                 NULL     DEFAULT NULL,
    issue_url      text                 NULL     DEFAULT NULL,
    issue_error    text                 NULL     DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS user_reports_project_id_session_id_idx ON public.user_reports (project_id, session_id);
CREATE INDEX IF NOT EXISTS user_reports_project_id_created_at_idx ON public.user_reports (project_id, created_at DESC);

COMMIT;

\elif :is_next
\echo new version detected :'next_version', nothing to do
\else
\warn skipping DB upgrade of :'next_version', expected previous version :'previous_version', found :'current_version'
\endif
