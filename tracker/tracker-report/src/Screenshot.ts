/**
 * CSS selectors for nodes OpenReplay would obscure in the replay. We blank
 * them before the DOM is captured so sensitive content never
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

/** A place sensitive nodes can live, and the document its overlays belong in. */
interface MaskScope {
  root: Document | ShadowRoot
  doc: Document
}

/**
 * Everything that ends up in the capture: the page itself plus, recursively, its open
 * shadow roots and same-origin iframes. A querySelectorAll on the document alone reaches
 * none of the nested ones, so their sensitive nodes would be photographed unmasked.
 */
function collectScopes(): MaskScope[] {
  const scopes: MaskScope[] = [{ root: document, doc: document }]
  for (let i = 0; i < scopes.length; i++) {
    const { root, doc } = scopes[i]
    root.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.shadowRoot) {
        scopes.push({ root: el.shadowRoot, doc })
      }
      if (el.tagName === 'IFRAME') {
        // null for a cross-origin frame, which the capture can't read either.
        const inner = (el as HTMLIFrameElement).contentDocument
        if (inner && inner.body) {
          scopes.push({ root: inner, doc: inner })
        }
      }
    })
  }
  return scopes
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

  collectScopes().forEach(({ root, doc }) => {
    const view = doc.defaultView
    if (!view) {
      return
    }
    root.querySelectorAll<HTMLElement>(MASK_SELECTORS).forEach((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        return
      }
      const overlay = doc.createElement('div')
      // Hidden from the tracker (it shouldn't record our overlay), but explicitly
      // flagged so the capture still paints it — it *is* the masking.
      overlay.setAttribute('data-openreplay-hidden', '1')
      overlay.setAttribute('data-openreplay-mask', '1')
      Object.assign(overlay.style, {
        // Document-space, not viewport-space, so the overlay stays glued to its node
        // however the capture maps the document onto the viewport.
        position: 'absolute',
        left: `${rect.left + view.scrollX}px`,
        top: `${rect.top + view.scrollY}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        background: '#000',
        zIndex: String(2147483647 - 3),
        pointerEvents: 'none',
      })
      // In the node's own document, so an iframe clips and scrolls its overlays itself.
      doc.body.appendChild(overlay)
      records.push({ el, overlay })
    })
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
 * The plugin's own UI (button, toolbar, annotation canvas), which must stay out of the
 * capture. The masking overlays carry the same hidden flag but are the one exception —
 * they *are* the masking, so they must be rasterised.
 */
function isPluginUi(el: Element): boolean {
  return (
    el.getAttribute('data-openreplay-hidden') === '1' &&
    el.getAttribute('data-openreplay-mask') !== '1'
  )
}

/**
 * The colour the browser paints behind the page: the root element's background, or the
 * body's when the root has none. The capture is transparent wherever no element paints,
 * so this goes underneath it to keep the live page from showing through the backdrop.
 */
function pageBackground(): string {
  const transparent = /^(transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/
  for (const el of [document.documentElement, document.body]) {
    const color = el ? getComputedStyle(el).backgroundColor : ''
    if (color && !transparent.test(color)) {
      return color
    }
  }
  return '#fff'
}

/**
 * Capture the current viewport to a canvas, with OpenReplay masking applied.
 *
 * Rendering is done by the browser itself: snapdom copies each element's *computed*
 * style into an SVG snapshot and lets the browser paint it. That matters because the
 * picture no longer depends on the page's stylesheets surviving a copy — html2canvas
 * re-laid-out a clone of the document, and any styling it couldn't carry over
 * (constructable stylesheets, shadow DOM, iframes) silently came out unstyled.
 *
 * Privacy: the snapshot reads the live DOM. We mask sensitive nodes first and always
 * restore, even on failure.
 */
export async function captureScreenshot(): Promise<HTMLCanvasElement> {
  const records = maskSensitiveNodes()
  const scale = window.devicePixelRatio || 1
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  try {
    // Loaded on demand so the renderer stays out of the host app's main bundle; it is
    // only needed once someone actually files a report.
    const { snapdom } = await import('@zumer/snapdom')
    const raw = await snapdom.toCanvas(document.documentElement, {
      clip: 'viewport',
      dpr: scale,
      // Check every box against the live page and pin any that drifted, so text can't
      // re-wrap in the snapshot and shift things out from under the annotations.
      reconcile: true,
      // Left in the default 'hide' mode: with excludeMode 'remove', snapdom 3.2.0 draws
      // the contents of scrolled containers outside their box.
      exclude: isPluginUi,
    })

    // The annotation overlay is in viewport coordinates, so the result must be exactly
    // the viewport. The capture rounds its size its own way (it has come back a pixel
    // short), so paint it onto a canvas of known size rather than trusting it.
    const out = document.createElement('canvas')
    out.width = Math.round(viewportWidth * scale)
    out.height = Math.round(viewportHeight * scale)
    const ctx = out.getContext('2d')
    if (!ctx) {
      return raw
    }
    ctx.fillStyle = pageBackground()
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(raw, 0, 0)
    return out
  } finally {
    restore(records)
  }
}
