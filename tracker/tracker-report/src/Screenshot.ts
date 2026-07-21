import html2canvas from 'html2canvas'

/**
 * CSS selectors for nodes OpenReplay would obscure in the replay. We blank
 * them before handing the DOM to html2canvas so sensitive content never
 * leaves the browser inside the screenshot.
 */
const MASK_SELECTORS = [
  '[data-openreplay-hidden]',
  '[data-openreplay-masked]',
  '[data-openreplay-obscured]',
  'input[type=password]',
].join(',')

/** Overlay we drop over each masked node; restored (removed) after capture. */
interface MaskRecord {
  el: HTMLElement
  overlay: HTMLElement
}

/**
 * Walk the DOM, cover every sensitive node with an opaque overlay positioned
 * over it, and return the records needed to undo the masking afterwards.
 *
 * We overlay rather than mutate the target's own styles so we never disturb
 * layout or lose the original content.
 */
function maskSensitiveNodes(): MaskRecord[] {
  const records: MaskRecord[] = []
  const nodes = document.querySelectorAll<HTMLElement>(MASK_SELECTORS)

  nodes.forEach((el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      return
    }
    const overlay = document.createElement('div')
    // Hidden from the tracker (it shouldn't record our overlay), but explicitly
    // flagged so html2canvas still paints it — it *is* the masking.
    overlay.setAttribute('data-openreplay-hidden', '1')
    overlay.setAttribute('data-openreplay-mask', '1')
    Object.assign(overlay.style, {
      // Document-space, not viewport-space: a fixed overlay would render at the wrong
      // place if html2canvas rasterises the whole document rather than the viewport.
      position: 'absolute',
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      background: '#000',
      zIndex: String(2147483647 - 3),
      pointerEvents: 'none',
    })
    document.body.appendChild(overlay)
    records.push({ el, overlay })
  })

  return records
}

/** Undo everything maskSensitiveNodes() did. */
function restore(records: MaskRecord[]) {
  records.forEach(({ overlay }) => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay)
    }
  })
}

/**
 * Capture the current viewport to a canvas, with OpenReplay masking applied.
 *
 * Privacy: html2canvas reads the live DOM. We mask sensitive nodes first and
 * always restore, even on failure.
 */
export async function captureScreenshot(): Promise<HTMLCanvasElement> {
  const records = maskSensitiveNodes()
  const scale = window.devicePixelRatio || 1
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  try {
    const raw = await html2canvas(document.documentElement, {
      logging: false,
      useCORS: true,
      // Skip the plugin's own UI (button, toolbar, annotation canvas), but keep the
      // masking overlays — those carry both attributes and must be rasterised.
      ignoreElements: (el) =>
        el.getAttribute?.('data-openreplay-hidden') === '1' &&
        el.getAttribute?.('data-openreplay-mask') !== '1',
      scale,
    })

    // Crop the visible region ourselves rather than via html2canvas's x/y options.
    // Passing those produced a capture offset from the viewport, which put every
    // annotation above the thing it was pointing at. html2canvas may hand back the
    // whole document or just the viewport depending on version and page, so measure
    // what actually came back and crop from there — the annotation overlay is in
    // viewport coordinates, so the result must be exactly the viewport.
    const looksLikeFullDocument = raw.height / scale > viewportHeight + 1
    const maxSourceX = Math.max(0, raw.width - viewportWidth * scale)
    const maxSourceY = Math.max(0, raw.height - viewportHeight * scale)
    const sourceX = looksLikeFullDocument
      ? Math.min(Math.round(scrollX * scale), maxSourceX)
      : 0
    const sourceY = looksLikeFullDocument
      ? Math.min(Math.round(scrollY * scale), maxSourceY)
      : 0

    const out = document.createElement('canvas')
    out.width = Math.round(viewportWidth * scale)
    out.height = Math.round(viewportHeight * scale)
    const ctx = out.getContext('2d')
    if (!ctx) {
      return raw
    }
    ctx.drawImage(
      raw,
      sourceX,
      sourceY,
      out.width,
      out.height,
      0,
      0,
      out.width,
      out.height,
    )
    return out
  } finally {
    restore(records)
  }
}
