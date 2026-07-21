import type { App } from '@openreplay/tracker'
import { Messages } from '@openreplay/tracker'
import AnnotationCanvas from './AnnotationCanvas.js'
import { captureScreenshot } from './Screenshot.js'

/** Payload attached to the session when a report is filed (Path A). */
export interface TagPayload {
  report_id: string
  note: string
  page_url: string
  session_url?: string
  /** Replay offset in ms from session start — the moment the report was filed. */
  time_ms?: number
}

export interface Options {
  /**
   * Base URL of the backend that accepts user-report uploads. Typically your
   * OpenReplay API host, e.g. `https://api.openreplay.com` or, self-hosted,
   * `https://<host>/api`. The report is sent as a single request to
   * `POST ${uploadBase}/{projectId}/user-reports` — image as the raw body,
   * metadata in the query string.
   */
  uploadBase: string
  /**
   * Project id used in the upload URLs. If omitted the plugin tries to read it
   * from `app.getSessionInfo().projectID` at click time.
   * TODO(scaffold): confirm getSessionInfo() exposes projectID at runtime and
   * decide whether this should be required.
   */
  projectId?: string | number
  /** Text shown on the floating trigger button. */
  buttonLabel: string
  /** Corner the floating button is anchored to. */
  buttonPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** Colour selected when the annotation overlay opens. */
  penColor: string
  /** Colour swatches offered in the annotation toolbar. Defaults to five. */
  colors?: string[]
  /**
   * Custom issue key used when tagging the session (Path A).
   * Defaults to `user_report`.
   */
  issueKey: string
  /**
   * Optional override for how the session gets tagged (Path A).
   *
   * By default the plugin dispatches the issue itself via the tracker's public
   * `Messages.CustomIssue` factory, which is exactly what `tracker.issue()`
   * does internally — so no wiring is required. Supply this if you'd rather
   * route the tag through the public API instance yourself:
   *
   * ```js
   * const tracker = new OpenReplay({ projectKey: '...' })
   * tracker.use(trackerReport({
   *   uploadBase: 'https://api.example.com',
   *   onTag: (key, payload) => tracker.issue(key, payload),
   * }))
   * ```
   */
  onTag?: (key: string, payload: TagPayload) => void
}

const defaultOptions: Options = {
  uploadBase: '',
  buttonLabel: 'Report a problem',
  buttonPosition: 'bottom-right',
  penColor: '#E53935',
  issueKey: 'user_report',
}

export default class Report {
  private readonly options: Options
  private button: HTMLButtonElement | null = null
  private annotation: AnnotationCanvas | null = null

  constructor(
    private readonly app: App,
    opts?: Partial<Options>,
  ) {
    this.options = { ...defaultOptions, ...(opts || {}) }
    this.mountButton()
  }

  // ---------------------------------------------------------------------------
  // Trigger button
  // ---------------------------------------------------------------------------

  private mountButton() {
    const btn = document.createElement('button')
    btn.setAttribute('data-openreplay-hidden', '1')
    btn.textContent = this.options.buttonLabel

    const pos = this.options.buttonPosition
    const vertical = pos.startsWith('top') ? { top: '16px' } : { bottom: '16px' }
    const horizontal = pos.endsWith('left') ? { left: '16px' } : { right: '16px' }

    Object.assign(
      btn.style,
      {
        position: 'fixed',
        padding: '10px 16px',
        border: 'none',
        borderRadius: '8px',
        background: '#394EFF',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: String(2147483647 - 4),
      },
      vertical,
      horizontal,
    )

    btn.addEventListener('click', () => {
      void this.beginReport()
    })

    document.body.appendChild(btn)
    this.button = btn
  }

  // ---------------------------------------------------------------------------
  // Report flow
  // ---------------------------------------------------------------------------

  private async beginReport() {
    const reportId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `report-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Hide our own button while capturing so it isn't in the screenshot.
    if (this.button) this.button.style.display = 'none'

    let screenshot: HTMLCanvasElement
    try {
      screenshot = await captureScreenshot()
    } catch (e) {
      this.app.debug.error('OpenReplay Report: screenshot failed', e)
      if (this.button) this.button.style.display = ''
      return
    }

    const annotation = new AnnotationCanvas({
      penColor: this.options.penColor,
      colors: this.options.colors,
    })
    this.annotation = annotation
    annotation.mount({
      screenshot,
      onSubmit: () => {
        void this.submit(reportId)
      },
      onCancel: () => {
        this.teardownOverlay()
      },
    })
  }

  private teardownOverlay() {
    this.annotation?.remove()
    this.annotation = null
    if (this.button) this.button.style.display = ''
  }

  private async submit(reportId: string) {
    const annotation = this.annotation
    if (!annotation) return

    // TODO(scaffold): collect a real note from the user (textarea in the
    // toolbar). Tier 1 ships freehand-only, so note is empty for now.
    const note = ''
    const pageURL = location.href
    const sessionURL = this.app.getSessionURL?.({ withCurrentTime: true })
    const sessionId = this.app.getSessionID?.()
    // Replay offset of the moment the report was filed, so support tooling can
    // jump straight there instead of to the start of the session.
    const timeMs = this.extractJumpTo(sessionURL)

    let blob: Blob
    try {
      blob = await annotation.toBlob()
    } catch (e) {
      this.app.debug.error('OpenReplay Report: encode failed', e)
      this.teardownOverlay()
      return
    }

    // Path A: tag the session in OpenReplay so it's findable.
    this.tagSession({
      report_id: reportId,
      note,
      page_url: pageURL,
      session_url: sessionURL,
      time_ms: timeMs,
    })

    // Path B: upload the annotated screenshot out-of-band.
    try {
      await this.upload(reportId, sessionId, note, pageURL, timeMs, blob)
    } catch (e) {
      this.app.debug.error('OpenReplay Report: upload failed', e)
    }

    this.teardownOverlay()
  }

  // ---------------------------------------------------------------------------
  // Path A: tag the session with a custom issue
  // ---------------------------------------------------------------------------

  /**
   * Attach a custom issue to the current session so the report shows up in
   * OpenReplay's UI and the session becomes findable.
   *
   * `tracker.use()` hands plugins the internal `App`, not the public API
   * wrapper, so `tracker.issue()` isn't directly reachable from here. Rather
   * than patch the tracker package (which would fork the bundle), we dispatch
   * the same message the public method does: `issue(key, payload)` is just
   * `app.send(CustomIssue(key, JSON.stringify(payload)))`, and the
   * `Messages` factory namespace is a public export of `@openreplay/tracker`.
   *
   * Callers who prefer to route through the public API can pass `onTag`.
   */
  private tagSession(payload: TagPayload) {
    const key = this.options.issueKey

    if (this.options.onTag) {
      try {
        this.options.onTag(key, payload)
      } catch (e) {
        this.app.debug.error('OpenReplay Report: onTag threw', e)
      }
      return
    }

    try {
      // Mirrors Tracker.issue(): the payload is JSON-stringified before send.
      this.app.send(Messages.CustomIssue(key, JSON.stringify(payload)))
    } catch (e) {
      this.app.debug.error('OpenReplay Report: failed to tag session', e)
    }
  }

  /**
   * Pull the replay offset out of a session URL built with
   * `{ withCurrentTime: true }` (the tracker appends `?jumpto=<ms>`).
   *
   * Read rather than recomputed so it stays consistent with however OpenReplay
   * defines the offset internally.
   */
  private extractJumpTo(sessionURL: string | undefined): number | undefined {
    if (!sessionURL) return undefined
    const match = /[?&]jumpto=(\d+)/.exec(sessionURL)
    if (!match) return undefined
    const value = Number(match[1])
    return Number.isFinite(value) ? value : undefined
  }

  // ---------------------------------------------------------------------------
  // Path B: POST the annotated screenshot to our API in one request
  // ---------------------------------------------------------------------------

  private resolveProjectId(): string | number | undefined {
    if (this.options.projectId != null) return this.options.projectId
    // TODO(scaffold): confirm this is the right source at runtime.
    const info = this.app.getSessionInfo?.() as { projectID?: string | number } | undefined
    return info?.projectID
  }

  private async upload(
    reportId: string,
    sessionId: string | undefined,
    note: string,
    pageURL: string,
    timeMs: number | undefined,
    blob: Blob,
  ) {
    const base = this.options.uploadBase.replace(/\/+$/, '')
    const projectId = this.resolveProjectId()

    if (!base || projectId == null) {
      // TODO(scaffold): make uploadBase/projectId required or surface an error.
      this.app.debug.error(
        'OpenReplay Report: uploadBase/projectId not configured; skipping upload',
      )
      return
    }

    // Single request: the image is the raw body, metadata rides in the query string.
    // (The API takes the bytes directly — no presign / direct-to-S3 round trip.)
    const params = new URLSearchParams({ reportId })
    if (sessionId) params.set('sessionId', sessionId)
    if (note) params.set('note', note)
    if (pageURL) params.set('pageUrl', pageURL)
    if (timeMs != null) params.set('timeMs', String(timeMs))

    const res = await fetch(`${base}/${projectId}/user-reports?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/png' },
      body: blob,
    })
    if (!res.ok) {
      throw new Error(`upload failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
  }

  // ---------------------------------------------------------------------------

  /** Remove the plugin's DOM. */
  destroy() {
    this.teardownOverlay()
    if (this.button?.parentNode) {
      this.button.parentNode.removeChild(this.button)
    }
    this.button = null
  }
}
