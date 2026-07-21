# OpenReplay Tracker Report plugin

Adds a floating "Report a problem" button to your app. When a user clicks it,
the plugin captures a screenshot of the current viewport, lets the user draw on
it up, and on submit it (A) tags the OpenReplay session with a custom issue and
(B) uploads the annotated screenshot to your backend.

## Markup tools

| Tool   | Behaviour |
| ------ | --------- |
| Select | Click an annotation to select it, drag to move it. `Delete`/`Backspace` removes it, `Esc` deselects. Picking a colour while something is selected recolours it. |
| Pen    | Freehand stroke. |
| Box    | Drag a rectangle; previews while dragging. |
| Text   | Click to place a caret, type, `Enter` to commit (`Esc` cancels). |

Plus a colour palette, `Delete` and `Undo`. Annotations are kept as a shape list
and repainted, so selection, moving and undo all work, and a rectangle previews
as it's dragged; the result is flattened to a PNG on submit.

Undo is snapshot-based and steps back over whole gestures — a drag is one undo,
not one per pointer event. Boxes are hit-tested on their edges rather than their
interior, so a rectangle drawn *around* other annotations doesn't swallow clicks
meant for them. Shapes can be moved and deleted but not resized or reordered;
that would need a full editor (tldraw/Excalidraw/Fabric).

## Installation

```bash
npm i @openreplay/tracker-report
# peer dependency
npm i @openreplay/tracker
```

## Usage

Matches the standard OpenReplay install (the singleton `tracker.configure()`
shape shown in the dashboard's tracking-code snippet):

```js
import { tracker } from '@openreplay/tracker'
import trackerReport from '@openreplay/tracker-report'

tracker.configure({
  projectKey: 'PROJECT_KEY',
  ingestPoint: 'https://your-openreplay-host/ingest',
})

tracker.use(
  trackerReport({
    uploadBase: 'https://your-openreplay-host/api', // backend for screenshot uploads
    projectId: 1234,                                // used in upload URLs
    buttonLabel: 'Report a problem',
    buttonPosition: 'bottom-right',
    penColor: '#E53935',
    issueKey: 'user_report',
  }),
)

tracker.start()
```

> **Order matters.** `use()` must come *after* `configure()`. The singleton's
> `use()` warns and passes `null` if the tracker isn't configured yet, and this
> plugin bails out on a null app — so the button silently never appears.

If you use the class API instead (`@openreplay/tracker/class`), the same
`tracker.use(trackerReport({...}))` call applies to your `new Tracker(...)`
instance.

### Options

| Option           | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `uploadBase`     | Base URL of the API that accepts the upload.                       |
| `projectId`      | Project id for upload URLs (falls back to the live session's).     |
| `buttonLabel`    | Text on the floating trigger button.                               |
| `buttonPosition` | `bottom-right` \| `bottom-left` \| `top-right` \| `top-left`.      |
| `penColor`       | Colour selected when the overlay opens.                            |
| `colors`         | Palette shown in the toolbar (defaults to five).                   |
| `issueKey`       | Custom issue key used to tag the session (default `user_report`).  |
| `onTag`          | Optional override for how the session is tagged (see below).       |

## How the session gets tagged

`tracker.use()` hands plugins the internal `App`, not the public API instance,
so `tracker.issue()` isn't directly reachable. Rather than patch the tracker
bundle, the plugin dispatches the same message the public method does —
`issue(key, payload)` is just `app.send(CustomIssue(key, JSON.stringify(payload)))`,
and `Messages` is a public export of `@openreplay/tracker`. No wiring needed.

The tag payload is:

```jsonc
{
  "report_id": "…",     // correlates with the uploaded screenshot
  "note": "…",
  "page_url": "…",
  "session_url": "…",   // deep link with ?jumpto=<ms>
  "time_ms": 12345      // replay offset when the report was filed
}
```

If you'd rather route the tag through the public API yourself, pass `onTag`:

```js
const tracker = new OpenReplay({ projectKey: '…' })
tracker.use(
  trackerReport({
    uploadBase: 'https://api.example.com',
    onTag: (key, payload) => tracker.issue(key, payload),
  }),
)
```

## Privacy

The screenshot is produced client-side with
[`html2canvas`](https://html2canvas.hertzen.com/). **Before** capture, the
plugin masks the same content OpenReplay masks in the replay: elements matching
`[data-openreplay-hidden]`, `[data-openreplay-masked]`,
`[data-openreplay-obscured]`, and `input[type=password]` are covered with opaque
overlays that are removed immediately after capture. All UI the plugin injects
(button, annotation canvas, toolbar, mask overlays) is marked
`data-openreplay-hidden="1"` so the tracker never records it and it never
appears in the screenshot.

The annotated image never touches OpenReplay's servers unless your `uploadBase`
points at them — it is uploaded to whatever backend you configure.
