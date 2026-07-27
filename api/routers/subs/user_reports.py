from typing import Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Request
from starlette.responses import Response

import schemas
from chalicelib.core import user_reports
from or_dependencies import OR_context
from routers.base import get_routers

public_app, app, app_apikey = get_routers(tags=["user-reports"])


# ---------------------------------------------------------------------------
# PUBLIC endpoints (no JWT): the end-user's browser (no dashboard login) calls
# these. They are validated by project scope only.
# TODO(scaffold): these are intentionally public (the one divergence from the
#  fully-JWT'd assist_records feature). Consider validating the tracker project
#  token / project_key against `projects` before issuing an upload URL or
#  inserting a row, to prevent unauthenticated abuse of arbitrary projectIds.
# ---------------------------------------------------------------------------
@public_app.post('/{projectId}/user-reports', tags=["user-reports"])
async def upload_user_report(projectId: int, request: Request,
                             background_tasks: BackgroundTasks,
                             reportId: str,
                             sessionId: Optional[int] = None,
                             note: Optional[str] = None,
                             pageUrl: Optional[str] = None,
                             timeMs: Optional[int] = None):
    """Accept the annotated screenshot in one request.

    The image is the raw request body (Content-Type: image/png); metadata rides in the
    query string. Multipart would be the conventional choice, but the API image lacks
    `python-multipart`, so UploadFile/Form would raise at runtime.
    """
    image = await request.body()
    try:
        data = user_reports.upload_report(
            project_id=projectId, report_id=reportId, image=image,
            content_type=request.headers.get("content-type"),
            session_id=sessionId, note=note, page_url=pageUrl, time_ms=timeMs)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Filing runs after the response is sent so the end-user never waits on (or sees a
    # failure from) the GitHub API. The issue link lands on the row a moment later; the
    # payload returned here always has issueUrl=None.
    background_tasks.add_task(user_reports.file_github_issue,
                              project_id=projectId, report_id=reportId)
    return {"data": data}


@public_app.get('/{projectId}/user-reports/{reportId}/image', tags=["user-reports"])
def get_user_report_image(projectId: int, reportId: str):
    """PUBLIC: serve the screenshot bytes under a stable, permanent URL.

    Deliberately unauthenticated: this URL is embedded as an inline image in the
    auto-filed GitHub issue, and GitHub's camo proxy fetches it anonymously from its own
    servers. That means anyone holding the report's uuid can view the screenshot, and the
    instance must be publicly reachable for the image to render at all.
    """
    result = user_reports.get_report_image(project_id=projectId, report_id=reportId)
    if result is None:
        raise HTTPException(status_code=404, detail="report not found")
    image, content_type = result
    # Immutable: a report's screenshot is written once at upload and never replaced.
    return Response(content=image, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


# ---------------------------------------------------------------------------
# JWT-guarded endpoints (dashboard / support reads). Access is enforced by
# JWTAuth + ProjectAuthorizer("projectId") baked into `app` by get_routers().
# ---------------------------------------------------------------------------
@app.get('/{projectId}/user-reports', tags=["user-reports"])
def get_user_reports(projectId: int, sessionId: Optional[int] = None, page: int = 1, limit: int = 200,
                     context: schemas.CurrentContext = Depends(OR_context)):
    return {"data": user_reports.search_reports(project_id=projectId, session_id=sessionId,
                                                page=page, limit=limit, context=context)}


@app.get('/{projectId}/user-reports/{reportId}', tags=["user-reports"])
def get_user_report(projectId: int, reportId: str, context: schemas.CurrentContext = Depends(OR_context)):
    return {"data": user_reports.get_report(project_id=projectId, report_id=reportId, context=context)}
