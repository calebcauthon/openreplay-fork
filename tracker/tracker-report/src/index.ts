import type { App } from '@openreplay/tracker'
import type { Options } from './Report.js'
import Report from './Report.js'

/**
 * OpenReplay tracker-report plugin.
 *
 * Two-level factory: the outer function captures plugin options at
 * `tracker.use(trackerReport({...}))` time; the inner function is what the
 * tracker calls with the live `App` instance once tracking starts.
 */
export default function (opts?: Partial<Options>) {
  return function (app: App | null, _appOptions: Record<string, any> = {}) {
    if (app === null) {
      return
    }
    if (
      !app.checkRequiredVersion ||
      !app.checkRequiredVersion('REQUIRED_TRACKER_VERSION')
    ) {
      console.warn(
        "OpenReplay Report: couldn't load. The minimum required version of @openreplay/tracker@REQUIRED_TRACKER_VERSION is not met",
      )
      return
    }

    const report = new Report(app, opts)
    app.debug.log(report)
    return report
  }
}

export type { Options }
