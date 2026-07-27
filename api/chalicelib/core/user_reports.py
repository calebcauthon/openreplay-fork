import logging

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

import schemas
from chalicelib.utils import pg_client, helper
from chalicelib.utils import github_client_v3
from chalicelib.utils.storage import StorageClient
from decouple import config

logger = logging.getLogger(__name__)


def _upload_client():
    """boto3 client used for SERVER-SIDE puts.

    StorageClient is built from S3_HOST, which is the *browser-facing* endpoint — it has
    to be, because that host gets baked into the presigned URLs we hand out. In a normal
    deployment that host is also reachable from the API pod, so one client serves both.
    Locally it is not: S3_HOST is https://localhost, and inside this container
    "localhost" is the container itself, not MinIO.

    So when S3_INTERNAL_HOST is set we build a second client pointed at the in-network
    endpoint and use it for uploads only. Presigned sharing URLs keep coming from
    StorageClient so they stay resolvable by the browser.
    """
    internal = config("S3_INTERNAL_HOST", default=None)
    if not internal:
        return StorageClient.client
    return boto3.client(
        "s3", endpoint_url=internal,
        aws_access_key_id=config("S3_KEY"), aws_secret_access_key=config("S3_SECRET"),
        config=BotoConfig(signature_version="s3v4"),
        region_name=config("sessions_region", default="us-east-1"),
        verify=not config("S3_DISABLE_SSL_VERIFY", default=False, cast=bool))

# Bucket that stores end-user report attachments (screenshots, logs, notes, ...).
# TODO(scaffold): USER_REPORTS_BUCKET must be added to config / helm values (see report).
BUCKET = config("USER_REPORTS_BUCKET", default="user-reports")

# TODO(scaffold): the EE assist_records feature tags uploaded objects for retention via
#  `chalicelib.utils.storage.extra` (vault/default). That `extra` helper does NOT exist in the
#  community storage package, so retention tagging is intentionally omitted here. Wire it up if
#  user reports need lifecycle/vault handling.


def generate_file_key(project_id, report_id):
    # Mirrors the assist_records key scheme (`<project_id>/<hash>`), but report_id is already a
    # unique uuid generated client-side, so no md5 hashing is required.
    return f"{project_id}/{report_id}"


# Columns shared by every read path. Kept in one place so the three SELECTs below stay in
# sync as the issue-linkage columns evolve.
_READ_COLUMNS = """report_id, project_id, session_id, note, page_url, time_ms,
                   user_reports.created_at, file_key,
                   issue_provider, issue_id, issue_url, issue_error"""


def get_report_image(project_id: int, report_id: str):
    """PUBLIC: return the raw screenshot bytes for a report, or None if it doesn't exist.

    Serving the image ourselves (rather than handing out a presigned S3 link) is what
    makes the GitHub issue's inline `![screenshot](...)` render permanently: presigned
    URLs expire, and SigV4 caps them at 7 days regardless of what we ask for.
    """
    params = {"project_id": project_id, "report_id": report_id}
    with pg_client.PostgresClient() as cur:
        cur.execute(cur.mogrify("""SELECT file_key
                                   FROM user_reports
                                   WHERE project_id=%(project_id)s AND report_id=%(report_id)s
                                   LIMIT 1;""", params))
        row = cur.fetchone()
    if not row:
        return None
    try:
        obj = _upload_client().get_object(Bucket=BUCKET, Key=row["file_key"])
    except ClientError as e:
        # Row without an object (bucket wiped, lifecycle rule, failed upload). This route is
        # public and hit by GitHub's image proxy, so answer 404 rather than a 500 traceback.
        logger.warning(f"user-reports: object missing for report {report_id}: {e}")
        return None
    return obj["Body"].read(), obj.get("ContentType") or "image/png"


# Upload guard rails. nginx allows 100m on this vhost; screenshots are ~0.3-2MB, so a
# 20MB ceiling leaves plenty of headroom while bounding what an unauthenticated caller
# can push into the bucket in one request.
MAX_IMAGE_BYTES = 20 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}


def upload_report(project_id: int, report_id: str, image: bytes, content_type: str,
                  session_id=None, note=None, page_url=None, time_ms=None):
    """PUBLIC: accept the annotated screenshot bytes directly and persist the report.

    The image is sent as the raw request body rather than multipart/form-data: the API
    image does not ship `python-multipart`, so FastAPI's UploadFile/Form would fail at
    runtime. Raw body + query-string metadata needs no extra dependency.
    """
    if not image:
        raise ValueError("empty image body")
    if len(image) > MAX_IMAGE_BYTES:
        raise ValueError(f"image too large: {len(image)} bytes (max {MAX_IMAGE_BYTES})")
    content_type = (content_type or "image/png").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError(f"unsupported content-type: {content_type}")

    key = generate_file_key(project_id=project_id, report_id=report_id)
    # StorageClient's ABC only exposes presigned-URL helpers, so go through a boto3
    # client for the server-side put (see _upload_client for the endpoint split).
    _upload_client().put_object(Bucket=BUCKET, Key=key, Body=image, ContentType=content_type)

    params = {"project_id": project_id, "report_id": report_id, "session_id": session_id,
              "file_key": key, "note": note, "page_url": page_url,
              "time_ms": time_ms}
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify(
            f"""INSERT INTO user_reports(report_id, project_id, session_id, file_key, note, page_url, time_ms)
                VALUES (%(report_id)s, %(project_id)s, %(session_id)s, %(file_key)s, %(note)s, %(page_url)s,
                        %(time_ms)s)
                RETURNING {_READ_COLUMNS};""",
            params)
        cur.execute(query)
        result = helper.dict_to_camel_case(cur.fetchone())
        result["URL"] = StorageClient.get_presigned_url_for_sharing(
            bucket=BUCKET, key=result.pop("fileKey"),
            expires_in=config("PRESIGNED_URL_EXPIRATION", cast=int, default=900)
        )
    return result


def search_reports(project_id: int, session_id=None, page: int = 1, limit: int = 200,
                   context: schemas.CurrentContext = None):
    # JWT-guarded (dashboard/support). ProjectAuthorizer already validated the user's access to
    # projectId, so filtering by project_id (plus optional session_id) is sufficient here.
    conditions = ["user_reports.project_id=%(project_id)s"]
    params = {"project_id": project_id, "p_start": (page - 1) * limit, "p_limit": limit}
    if session_id is not None:
        conditions.append("user_reports.session_id=%(session_id)s")
        params["session_id"] = session_id
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify(f"""SELECT {_READ_COLUMNS}
                                FROM user_reports
                                WHERE {" AND ".join(conditions)}
                                ORDER BY user_reports.created_at DESC
                                LIMIT %(p_limit)s OFFSET %(p_start)s;""", params)
        cur.execute(query)
        rows = helper.list_to_camel_case(cur.fetchall())
        for r in rows:
            r["URL"] = StorageClient.get_presigned_url_for_sharing(
                bucket=BUCKET, key=r.pop("fileKey"),
                expires_in=config("PRESIGNED_URL_EXPIRATION", cast=int, default=900)
            )
    return rows


def get_report(project_id: int, report_id: str, context: schemas.CurrentContext = None):
    # JWT-guarded. Returns the single report enriched with a fresh pre-signed share URL.
    params = {"project_id": project_id, "report_id": report_id}
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify(f"""SELECT {_READ_COLUMNS}
                               FROM user_reports
                               WHERE user_reports.project_id=%(project_id)s
                                 AND user_reports.report_id=%(report_id)s
                               LIMIT 1;""", params)
        cur.execute(query)
        result = helper.dict_to_camel_case(cur.fetchone())
        if result:
            result["URL"] = StorageClient.get_presigned_url_for_sharing(
                bucket=BUCKET, key=result.pop("fileKey"),
                expires_in=config("PRESIGNED_URL_EXPIRATION", cast=int, default=900)
            )
    return result


# ---------------------------------------------------------------------------
# GitHub issue auto-filing
#
# Every uploaded report files an issue. The upload endpoint is PUBLIC — there is no
# logged-in dashboard user, so the per-user PAT the dashboard integration relies on
# (`oauth_authentication`, see chalicelib/core/issue_tracking/github.py) does not exist
# in this code path. Filing therefore uses a service-level token from config, and is
# disabled unless both USER_REPORTS_GITHUB_TOKEN and USER_REPORTS_GITHUB_REPO are set.
#
# Because it is automatic and unauthenticated, one noisy reporter becomes one noisy
# issue per click. Label filtering on the GitHub side is the intended mitigation.
# ---------------------------------------------------------------------------

ISSUE_PROVIDER = "github"


def _csv_config(key, default=""):
    return [v.strip() for v in config(key, default=default).split(",") if v.strip()]


def _github_settings():
    """Resolve the service-token settings, or None when auto-filing is not configured."""
    token = config("USER_REPORTS_GITHUB_TOKEN", default=None)
    repo = config("USER_REPORTS_GITHUB_REPO", default=None)
    if not token or not repo:
        return None
    repo = repo.strip().strip("/")
    return {
        "token": token,
        # Accept "owner/name" (what an admin configures) or the numeric repo id the
        # dashboard integration passes around (see issue_tracking/github_issue.py).
        "path": f"/repos/{repo}/issues" if "/" in repo else f"/repositories/{repo}/issues",
        "labels": _csv_config("USER_REPORTS_GITHUB_LABELS", "OpenReplay,user-report"),
        "assignees": _csv_config("USER_REPORTS_GITHUB_ASSIGNEES"),
    }


def _dashboard_url():
    return config("SITE_URL", default="").rstrip("/")


def _public_api_url():
    """Base URL that GitHub's image proxy will hit to fetch the screenshot.

    Defaults to SITE_URL + /api, where the API is mounted in a standard deployment.
    Override via USER_REPORTS_PUBLIC_API_URL when the API is exposed elsewhere. Note the
    instance must be reachable from the public internet for the inline image to render.
    """
    explicit = config("USER_REPORTS_PUBLIC_API_URL", default=None)
    return explicit.rstrip("/") if explicit else f"{_dashboard_url()}/api"


def _issue_content(report):
    """Render the issue title and markdown body for a report row (snake_case keys)."""
    project_id, report_id = report["project_id"], report["report_id"]
    note = (report.get("note") or "").strip()
    # First line of the note makes the best title; fall back to the report's short id.
    title = note.splitlines()[0][:120] if note else f"User report {str(report_id)[:8]}"

    lines = [
        f"![Annotated screenshot]({_public_api_url()}/{project_id}/user-reports/{report_id}/image)",
        "",
    ]
    if note:
        lines += [f"> {line}" for line in note.splitlines()] + [""]
    if report.get("page_url"):
        lines.append(f"- **Page:** {report['page_url']}")
    if report.get("created_at"):
        lines.append(f"- **Reported:** {report['created_at'].isoformat()}")
    if report.get("session_id") is not None:
        replay = f"{_dashboard_url()}/{project_id}/session/{report['session_id']}"
        time_ms = report.get("time_ms")
        if time_ms is not None and time_ms >= 0:
            # Same deep-link the dashboard builds; drops the reviewer at the exact moment.
            replay += f"?jumpto={int(time_ms)}"
        lines.append(f"- **Replay:** {replay}")
    lines.append(f"- **Report:** {_dashboard_url()}/{project_id}/user-reports/{report_id}")
    lines += ["", "<sub>Filed automatically by OpenReplay from a user-submitted report.</sub>"]

    return title, "\n".join(lines)


def _record_issue(project_id, report_id, issue_id=None, issue_url=None, error=None):
    """Persist the outcome of a filing attempt. Never raises — it runs on the error path."""
    try:
        with pg_client.PostgresClient() as cur:
            cur.execute(cur.mogrify(
                """UPDATE user_reports
                   SET issue_provider=%(provider)s, issue_id=%(issue_id)s,
                       issue_url=%(issue_url)s, issue_error=%(error)s
                   WHERE project_id=%(project_id)s AND report_id=%(report_id)s;""",
                {"provider": ISSUE_PROVIDER, "issue_id": issue_id, "issue_url": issue_url,
                 "error": error, "project_id": project_id, "report_id": report_id}))
    except Exception:
        logger.exception(f"user-reports: could not record issue state for report {report_id}")


def file_github_issue(project_id: int, report_id: str):
    """Create the GitHub issue for a freshly uploaded report.

    Entry point for the BackgroundTask scheduled by the upload endpoint, so it runs after
    the response has already been sent. Every failure is swallowed and written to
    `issue_error` instead: the report itself is safely persisted either way, and the
    end-user submitting it can do nothing about a broken integration.
    """
    settings = _github_settings()
    if settings is None:
        # WARNING, not DEBUG: deployments run at INFO, so a debug line here made a disabled
        # integration look identical to one that never ran at all. Name the missing var --
        # "no token/repo configured" sent someone hunting through the whole env chain.
        missing = [k for k in ("USER_REPORTS_GITHUB_TOKEN", "USER_REPORTS_GITHUB_REPO")
                   if not config(k, default=None)]
        logger.warning(f"user-reports: skipping issue filing for report {report_id} — "
                       f"auto-filing is off because {' and '.join(missing)} is empty")
        return

    logger.info(f"user-reports: filing GitHub issue for report {report_id} "
                f"in {settings['path']}")
    try:
        with pg_client.PostgresClient() as cur:
            cur.execute(cur.mogrify(
                """SELECT report_id, project_id, session_id, note, page_url, time_ms, created_at
                   FROM user_reports
                   WHERE project_id=%(project_id)s AND report_id=%(report_id)s LIMIT 1;""",
                {"project_id": project_id, "report_id": report_id}))
            report = cur.fetchone()
        if not report:
            logger.warning(f"user-reports: report {report_id} not found, skipping issue filing")
            return

        title, body = _issue_content(report)
        payload = {"title": title, "body": body, "labels": settings["labels"]}
        if settings["assignees"]:
            payload["assignees"] = settings["assignees"]

        issue = github_client_v3.githubV3Request(settings["token"]).post(settings["path"], body=payload)
        # githubV3Request.post returns the parsed body without checking the status code, so
        # detect failure by absence of the issue number rather than by an exception.
        if not isinstance(issue, dict) or "number" not in issue:
            detail = issue.get("message", issue) if isinstance(issue, dict) else issue
            raise RuntimeError(f"GitHub rejected the issue: {str(detail)[:300]}")

        _record_issue(project_id, report_id,
                      issue_id=str(issue["number"]), issue_url=issue.get("html_url"))
        logger.info(f"user-reports: filed {issue.get('html_url')} for report {report_id}")
    except Exception as e:
        logger.exception(f"user-reports: failed to file GitHub issue for report {report_id}")
        _record_issue(project_id, report_id, error=str(e)[:500])
