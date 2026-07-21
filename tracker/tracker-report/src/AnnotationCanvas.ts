export interface AnnotationCanvasOptions {
  /** Single pen color used for every stroke. */
  penColor: string
  /** Stroke width in CSS pixels. */
  penWidth?: number
}

/**
 * Persistent (non-fading) freehand annotation overlay.
 *
 * Adapted from tracker-assist's AnnotationCanvas: it keeps the same
 * moveTo/lineTo/stroke polyline drawing mechanics but removes the fade-out
 * logic so strokes stay on screen until the report is submitted or cancelled.
 *
 * It also renders a minimal Submit / Cancel toolbar. All DOM it creates is
 * marked `data-openreplay-hidden="1"` so the tracker never records it.
 */
export default class AnnotationCanvas {
  private readonly canvas: HTMLCanvasElement
  private readonly toolbar: HTMLDivElement
  private ctx: CanvasRenderingContext2D | null = null
  private painting = false
  private readonly penColor: string
  private readonly penWidth: number

  private onSubmit: (() => void) | null = null
  private onCancel: (() => void) | null = null

  constructor(opts: AnnotationCanvasOptions) {
    this.penColor = opts.penColor
    this.penWidth = opts.penWidth ?? 8

    this.canvas = document.createElement('canvas')
    this.canvas.setAttribute('data-openreplay-hidden', '1')
    Object.assign(this.canvas.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      // While annotating we DO want pointer events (unlike assist's overlay).
      touchAction: 'none',
      cursor: 'crosshair',
      zIndex: String(2147483647 - 2),
    })

    this.toolbar = this.buildToolbar()
  }

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement('div')
    bar.setAttribute('data-openreplay-hidden', '1')
    Object.assign(bar.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      display: 'flex',
      gap: '8px',
      zIndex: String(2147483647 - 1),
      fontFamily: 'system-ui, sans-serif',
    })

    const cancel = document.createElement('button')
    cancel.setAttribute('data-openreplay-hidden', '1')
    cancel.textContent = 'Cancel'
    Object.assign(cancel.style, {
      padding: '8px 14px',
      border: '1px solid #ccc',
      borderRadius: '6px',
      background: '#fff',
      color: '#333',
      cursor: 'pointer',
    })
    cancel.addEventListener('click', () => this.onCancel?.())

    const submit = document.createElement('button')
    submit.setAttribute('data-openreplay-hidden', '1')
    submit.textContent = 'Submit report'
    Object.assign(submit.style, {
      padding: '8px 14px',
      border: 'none',
      borderRadius: '6px',
      background: '#394EFF',
      color: '#fff',
      cursor: 'pointer',
    })
    submit.addEventListener('click', () => this.onSubmit?.())

    bar.appendChild(cancel)
    bar.appendChild(submit)
    return bar
  }

  private readonly resizeCanvas = () => {
    // Note: resizing a canvas clears it. For the scaffold we resize only on
    // mount; strokes persist for the lifetime of the overlay.
    // TODO(scaffold): preserve strokes across window resize if needed.
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  private lastPosition: [number, number] = [0, 0]

  start = (p: [number, number]) => {
    this.painting = true
    this.lastPosition = p
  }

  stop = () => {
    if (!this.painting) {
      return
    }
    this.painting = false
  }

  move = (p: [number, number]) => {
    if (!this.ctx || !this.painting) {
      return
    }
    // Same polyline mechanics as tracker-assist's AnnotationCanvas.
    this.ctx.globalAlpha = 1.0
    this.ctx.beginPath()
    this.ctx.moveTo(this.lastPosition[0], this.lastPosition[1])
    this.ctx.lineTo(p[0], p[1])
    this.ctx.lineWidth = this.penWidth
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'
    this.ctx.strokeStyle = this.penColor
    this.ctx.stroke()
    this.lastPosition = p
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture?.(e.pointerId)
    this.start([e.clientX, e.clientY])
  }
  private readonly onPointerMove = (e: PointerEvent) => {
    this.move([e.clientX, e.clientY])
  }
  private readonly onPointerUp = () => {
    this.stop()
  }

  private readonly onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    e.preventDefault()
    this.start([t.clientX, t.clientY])
  }
  private readonly onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    e.preventDefault()
    this.move([t.clientX, t.clientY])
  }
  private readonly onTouchEnd = (e: TouchEvent) => {
    e.preventDefault()
    this.stop()
  }

  /**
   * Draw the given screenshot into a fresh canvas, then overlay the strokes,
   * returning the composited canvas ready for export.
   */
  composite(screenshot: HTMLCanvasElement): HTMLCanvasElement {
    const out = document.createElement('canvas')
    out.width = screenshot.width
    out.height = screenshot.height
    const octx = out.getContext('2d')
    if (!octx) {
      return screenshot
    }
    // 1) the (masked) screenshot as the base layer
    octx.drawImage(screenshot, 0, 0, out.width, out.height)
    // 2) the annotation strokes, scaled from viewport space to screenshot space
    octx.drawImage(this.canvas, 0, 0, out.width, out.height)
    return out
  }

  /** Composite + encode the annotated screenshot as a PNG blob. */
  toBlob(screenshot: HTMLCanvasElement): Promise<Blob> {
    const composed = this.composite(screenshot)
    return new Promise((resolve, reject) => {
      composed.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('OpenReplay Report: failed to encode annotation blob'))
        }
      }, 'image/png')
    })
  }

  mount(handlers: { onSubmit: () => void; onCancel: () => void }) {
    this.onSubmit = handlers.onSubmit
    this.onCancel = handlers.onCancel

    document.body.appendChild(this.canvas)
    document.body.appendChild(this.toolbar)
    this.ctx = this.canvas.getContext('2d')
    this.resizeCanvas()

    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false })
  }

  remove() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchend', this.onTouchEnd)

    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
    if (this.toolbar.parentNode) {
      this.toolbar.parentNode.removeChild(this.toolbar)
    }
  }
}
