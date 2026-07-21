from typing import Optional

from fastapi import Depends, HTTPException, Request

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
        return {"data": user_reports.upload_report(
            project_id=projectId, report_id=reportId, image=image,
            content_type=request.headers.get("content-type"),
            session_id=sessionId, note=note, page_url=pageUrl, time_ms=timeMs)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
