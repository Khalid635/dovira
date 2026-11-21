/**
 * Phase 3: speed graph. Pure functions (no imports) so they can be tested
 * with plain Node, outside the renderer.
 */

/** One point of the speed-graph polyline, in SVG coordinates. */
export interface GraphPoint {
  x: number
  y: number
}

/**
 * Map per-second speed samples (bytes/s, oldest first) onto an SVG canvas.
 * The newest sample sits at the right edge; the peak sample touches the
 * top. A single sample renders as a flat line at its own height.
 */
export function speedGraphPoints(samples: number[], width: number, height: number): GraphPoint[] {
  if (samples.length === 0) return []
  const max = Math.max(...samples, 1)
  if (samples.length === 1) {
    const y = height - (samples[0] / max) * height
    return [
      { x: 0, y },
      { x: width, y }
    ]
  }
  return samples.map((s, i) => ({
    x: (i / (samples.length - 1)) * width,
    y: height - (s / max) * height
  }))
}

/** "x1,y1 x2,y2 …" for an SVG polyline's points attribute. */
export function speedGraphPolyline(samples: number[], width: number, height: number): string {
  return speedGraphPoints(samples, width, height)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
}
