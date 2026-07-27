import APIClient from 'App/api_client';

import BaseService from './BaseService';

/**
 * Note: the API runs rows through `helper.dict_to_camel_case`, so the wire
 * format is camelCase even though the DB columns are snake_case. `URL` is
 * injected after the conversion and keeps its casing.
 */
export interface IUserReport {
  reportId: string;
  sessionId: string | number | null;
  note: string | null;
  pageUrl: string | null;
  createdAt: string;
  /** Replay offset in ms from session start; null when the tracker couldn't resolve it. */
  timeMs: number | null;
  /** Presigned image link for the annotated screenshot. */
  URL?: string;
  /**
   * Issue auto-filed for this report. The API files it in a background task *after*
   * acknowledging the upload, so a freshly created report reads back with all four
   * null for a moment. `issueError` is set instead of `issueUrl` when filing failed,
   * which is the only place a misconfigured integration surfaces.
   */
  issueProvider: string | null;
  issueId: string | null;
  issueUrl: string | null;
  issueError: string | null;
}

/**
 * Build the in-app replay path for a report, deep-linked to the exact moment
 * the report was filed.
 *
 * `timeMs` is the tracker's `?jumpto=` offset (ms from session start), captured
 * at click time via `getSessionURL({ withCurrentTime: true })`. Falls back to
 * the session start when it's unavailable.
 *
 * Callers still need to wrap the result in `withSiteId(..., siteId)`.
 */
export function reportSessionPath(
  report: Pick<IUserReport, 'sessionId' | 'timeMs'>,
  sessionRoute: (id: string) => string,
): string | null {
  if (report.sessionId == null) return null;
  const path = sessionRoute(String(report.sessionId));
  return report.timeMs != null && report.timeMs >= 0
    ? `${path}?jumpto=${Math.round(report.timeMs)}`
    : path;
}

interface FetchFilter {
  page?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  query?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  userId?: string;
}

interface ReportData {
  session_id: string | number;
  note?: string;
  page_url?: string;
}

/**
 * Support-facing service for annotated-screenshot "user reports".
 *
 * Endpoints (base `/api`, siteId/projectId auto-prefixed by APIClient —
 * see `siteIdRequiredPaths` in api_client.ts which now includes `/user-reports`):
 *   GET  /{projectId}/user-reports            -> list of IUserReport (URL is presigned)
 *   GET  /{projectId}/user-reports/{reportId} -> one IUserReport (URL is presigned)
 *   PUT  /{projectId}/user-reports            -> reserve presigned upload URL (tracker plugin)
 *   POST /{projectId}/user-reports/done       -> confirm uploaded file (tracker plugin)
 *
 * Modeled on RecordingsService (reserveUrl/presign -> saveFile -> confirmFile ->
 * fetchRecordings -> fetchRecording), including the `.then(r => r.json().then(j => j.data))`
 * unwrap convention.
 */
export default class UserReportsService extends BaseService {
  constructor(client?: APIClient) {
    super(client);
  }

  /** GET /{projectId}/user-reports */
  fetchReports(filters?: FetchFilter): Promise<IUserReport[]> {
    return this.client
      .get('/user-reports', filters)
      .then((r) => r.json().then((j) => j.data));
  }

  /** GET /{projectId}/user-reports/{reportId} */
  fetchReport(reportId: string | number): Promise<IUserReport> {
    return this.client
      .get(`/user-reports/${reportId}`)
      .then((r) => r.json().then((j) => j.data));
  }

  // ---------------------------------------------------------------------------
  // Upload flow. These are called by the tracker plugin, not the dashboard, but
  // are provided for completeness / parity with RecordingsService.
  // ---------------------------------------------------------------------------

  /** Reserve a presigned PUT URL for the annotated screenshot upload. */
  presignReport(data: ReportData): Promise<{ URL: string; key: string }> {
    return this.client
      .put('/user-reports', data)
      .then((r) => r.json().then((j) => j.data));
  }

  /** Upload the annotated screenshot blob to the presigned URL. */
  saveFile(url: string, file: Blob): Promise<boolean> {
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    }).then(() => true);
  }

  /** Confirm the uploaded file, persisting the report record. */
  confirmReport(data: ReportData, key: string): Promise<IUserReport> {
    return this.client
      .post('/user-reports/done', { ...data, key })
      .then((r) => r.json().then((j) => j.data));
  }
}
