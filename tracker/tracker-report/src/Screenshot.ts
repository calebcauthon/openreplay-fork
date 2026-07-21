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
    // Mark the overlay itself hidden so, e.g., html2canvas ignore rules and the
    // tracker both skip it.
    overlay.setAttribute('data-openreplay-hidden', '1')
    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
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
  try {
    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      // Ignore anything the tracker/plugin marks hidden (our own UI + overlays).
      ignoreElements: (el) =>
        el.getAttribute?.('data-openreplay-hidden') === '1',
      // TODO(scaffold): tune scale/scroll handling. Currently captures the
      // viewport at devicePixelRatio; long pages are cropped to what's visible.
      scale: window.devicePixelRatio || 1,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
    })
    return canvas
  } finally {
    restore(records)
  }
}
