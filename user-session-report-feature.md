# User-Initiated Session Report + Annotated Screenshot

## What I want

Right now OpenReplay only records users passively. I want to give end-users a way to
**initiate** something themselves — not just be recorded.

Specifically: a **button the end-user can click** that does two things:

1. **Tags the session** they're currently on (so it's flagged and findable in OpenReplay).
2. Lets them **take a screenshot of what's on their screen right there**, **draw/annotate
   on it**, and **include that** with the report.

The drawing should be **full-on drawing** — real freehand + markup, not a fixed/ephemeral
pointer.

## Where it lives (architecture)

- **Do not modify the injected OpenReplay bundle.** We'd be forking their code and every
  upgrade would break.
- Build the button, screenshot capture, and annotation UI in **our own code** — either an
  app module/component or a separate OpenReplay tracker plugin (`tracker.use(...)`, modeled
  on `tracker-assist`). Either way it's *our* package, not a bundle edit.
- Our code **talks to the injected OpenReplay JS through its public API** (the `tracker.*`
  methods). "Talking to the injected JS" just means calling those methods on the tracker
  instance — no rebuilding the bundle.

## How the pieces connect

Because OpenReplay's tag API is **JSON-only** (`tracker.event()` / `tracker.issue()`
`JSON.stringify` the payload — there is no public way to attach an image to a session), the
report splits into two paths:

- **Tag → into OpenReplay.** Call `tracker.issue('user_report', {...})` to flag the session.
  Grab a deep link with `tracker.getSessionURL({ withCurrentTime: true })`.
- **Annotated screenshot → to our own backend.** Upload the image blob to our endpoint,
  correlated by the session URL / ID so we can tie the picture back to the exact replay
  moment.

End result: in our support tooling, open a report → see the annotated screenshot → click the
session URL to jump straight to that moment in the OpenReplay replay.

## Screenshot + annotation mechanics

- **Capture:** `html2canvas` (rasterize the DOM) — no browser prompt. (`getDisplayMedia()`
  gives a true screenshot but forces a "pick a window to share" prompt — worse UX.)
- **Annotate:** overlay a `<canvas>`, let the user draw, then composite the annotation canvas
  over the screenshot canvas → `canvas.toBlob()` → upload.
- **Drawing scope** — a raw canvas allows unlimited drawing. Tiers of effort:
  - *Freehand pen* — one color, draw anywhere. Small.
  - *Markup toolkit* — pen + arrow + rectangle + text + highlighter + color/undo. Medium; we
    implement each tool on the canvas.
  - *Full editor* — selectable/movable/resizable objects (Excalidraw-style). Use a library
    (tldraw / Excalidraw / Fabric.js), don't hand-roll.
  - A raw canvas is **raster**: once drawn, strokes are pixels. Object-level editing needs the
    library route.

## Notes / constraints

- **Privacy:** `html2canvas` captures the raw DOM — OpenReplay's input masking /
  `data-openreplay-hidden` does **not** apply to the screenshot. If sensitive fields are on
  screen, they'd leak into the image unless we re-apply masking before capture.
- **Not reusing Assist annotation.** OpenReplay already has an annotation canvas
  (`tracker/tracker-assist/src/AnnotationCanvas.ts`), but it is **agent-initiated, live, and
  ephemeral** — the support agent draws on the user's screen during a live call/remote-control
  session, and the strokes fade after ~4s. Nothing is saved to the replay. We're only
  borrowing its ~40 lines of `moveTo`/`lineTo`/`stroke` drawing mechanics as a reference; the
  live Assist flow itself is not part of this feature.
- **Not reusing Assist live support.** Assist's live session is started by the agent from the
  dashboard; the end-user only gets an accept/deny consent popup. There is no native
  "user requests a session" button — which is why we're building the user-initiated path
  ourselves.
