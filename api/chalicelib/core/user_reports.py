import logging

import boto3
from botocore.client import Config as BotoConfig

import schemas
from chalicelib.utils import pg_client, helper
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
            """INSERT INTO user_reports(report_id, project_id, session_id, file_key, note, page_url, time_ms)
               VALUES (%(report_id)s, %(project_id)s, %(session_id)s, %(file_key)s, %(note)s, %(page_url)s,
                       %(time_ms)s)
               RETURNING report_id, project_id, session_id, note, page_url, time_ms, created_at, file_key;""",
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
        query = cur.mogrify(f"""SELECT report_id, project_id, session_id, note, page_url, time_ms,
                                       user_reports.created_at, file_key
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
        query = cur.mogrify("""SELECT report_id, project_id, session_id, note, page_url, time_ms,
                                      user_reports.created_at, file_key
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
