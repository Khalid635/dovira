/**
 * Phase 7 (v1.0) — Smart Download (network-adaptive).
 *
 * Keeps a rolling window of measured speeds (aria2 poll + yt-dlp progress)
 * and a count of recent network failures, then classifies the connection:
 *   fast     — mean > 5 MB/s and stable
 *   medium   — 1–5 MB/s
 *   slow     — < 1 MB/s
 *   unstable — 2+ failures in 5 minutes, or speed varies wildly (CV > 0.6)
 * The queue asks this class for aria2 connections (-x/-s) and yt-dlp
 * fragments (-N) and for the retry delays. No samples yet = medium.
 * Pure logic — no I/O, so it is unit-testable standalone.
 */

export type NetworkClass = 'fast' | 'medium' | 'slow' | 'unstable'

const MB = 1024 * 1024
const MAX_SAMPLES = 30
const FAILURE_WINDOW_MS = 5 * 60 * 1000

export class AdaptiveNet {
  private samples: number[] = []
  private failures: number[] = []

  /** One measured speed (bytes/sec). Zero/negative samples are ignored. */
  sample(speedBps: number): void {
    if (!Number.isFinite(speedBps) || speedBps <= 0) return
    this.samples.push(speedBps)
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
  }

  /** A network failure (timeout / connection error). Pruned after 5 min. */
  noteFailure(): void {
    this.failures.push(Date.now())
    this.pruneFailures()
  }

  private pruneFailures(): void {
    const cutoff = Date.now() - FAILURE_WINDOW_MS
    this.failures = this.failures.filter((t) => t >= cutoff)
  }

  get sampleCount(): number {
    return this.samples.length
  }

  classify(): NetworkClass {
    this.pruneFailures()
    if (this.failures.length >= 2) return 'unstable'
    if (this.samples.length === 0) return 'medium'
    const n = this.samples.length
    const mean = this.samples.reduce((a, b) => a + b, 0) / n
    if (n >= 5) {
      const variance = this.samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0
      if (cv > 0.6) return 'unstable'
    }
    if (mean > 5 * MB) return 'fast'
    if (mean >= 1 * MB) return 'medium'
    return 'slow'
  }

  /**
   * aria2 connections per server (-x) and split (-s). aria2 caps BOTH
   * options at 16 — passing 32 made aria2 reject the option
   * ("We encountered a problem while processing the option
   * '--max-connection-per-server'") and fail the download, so fast stays
   * at 16; medium 16, slow 8, unstable 4 (few connections survive a
   * flaky line better than many).
   */
  connections(): number {
    switch (this.classify()) {
      case 'fast':
        return 16
      case 'medium':
        return 16
      case 'slow':
        return 8
      case 'unstable':
        return 4
    }
  }

  /** yt-dlp concurrent fragments (-N). */
  fragments(): number {
    switch (this.classify()) {
      case 'fast':
        return 8
      case 'medium':
        return 4
      case 'slow':
      case 'unstable':
        return 2
    }
  }

  /** Retry delays in ms: longer gaps when the network is struggling. */
  retryDelaysMs(): number[] {
    const c = this.classify()
    if (c === 'slow' || c === 'unstable') return [5000, 15000, 30000]
    return [2000, 5000, 15000]
  }

  reset(): void {
    this.samples = []
    this.failures = []
  }
}
