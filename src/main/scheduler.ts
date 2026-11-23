import { execFile } from 'node:child_process'
import type { QueueManager } from './queue.ts'
import type { SettingsManager } from './settings.ts'
import type { SchedulerAction, SchedulerCountdown, SchedulerStatus, StatusEvent } from './types.ts'

/**
 * Phase 3: timed queue start + optional shutdown/sleep after the run.
 *
 * Every 60s the scheduler checks whether the configured time has arrived.
 * When it fires it resumes all paused downloads and lets the pump start
 * the queue. Once at least one download completes and the queue goes idle,
 * a 60-second countdown starts (shown as a modal with a Cancel button);
 * when it reaches zero the configured action runs.
 *
 * Safety: the action NEVER runs while downloads are still active, and the
 * execute step only ever runs `shutdown /s /t 0` or the Windows sleep
 * call — nothing else. Set DOVIRA_SCHEDULER_DRY_RUN=1 to log the action
 * instead of executing it (used by the Phase 3 test).
 */
export class SchedulerManager {
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private runWatchTimer: ReturnType<typeof setInterval> | null = null
  private countdownTimer: ReturnType<typeof setInterval> | null = null
  private runActive = false
  private runCompleted = 0
  private countdown: SchedulerCountdown | null = null
  // No parameter properties — Node's strip-only test runner cannot
  // parse them; explicit fields instead.
  private queue: QueueManager
  private settings: SettingsManager
  private cb: {
    /** Emitted every second during the countdown; null = countdown ended. */
    onCountdown: (c: SchedulerCountdown | null) => void
    onLog: (line: string) => void
  }

  constructor(
    queue: QueueManager,
    settings: SettingsManager,
    cb: {
      /** Emitted every second during the countdown; null = countdown ended. */
      onCountdown: (c: SchedulerCountdown | null) => void
      onLog: (line: string) => void
    }
  ) {
    this.queue = queue
    this.settings = settings
    this.cb = cb
    // Count completions while a scheduled run is active.
    this.queue.on('status', (ev: StatusEvent) => {
      if (this.runActive && ev.status === 'completed') this.runCompleted++
    })
  }

  start(): void {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => this.tick(), 60_000)
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    this.stopRunWatch()
    this.cancelCountdown()
  }

  /** Current state for the Settings page. */
  getStatus(): SchedulerStatus {
    const s = this.settings.get()
    const lastRunAt =
      s.lastSchedulerRun !== null ? `${s.lastSchedulerRun}T${s.schedulerTime}:00` : null
    return { enabled: s.schedulerEnabled, nextRunAt: this.computeNextRun(), lastRunAt }
  }

  /** The countdown modal's Cancel button. */
  cancelCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
    if (this.countdown) {
      this.cb.onLog('scheduler: countdown cancelled by user')
      this.countdown = null
      this.cb.onCountdown(null)
    }
    this.endRun()
  }

  private tick(now = new Date()): void {
    const s = this.settings.get()
    if (!s.schedulerEnabled) return
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    if (`${hh}:${mm}` !== s.schedulerTime) return
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`
    if (s.lastSchedulerRun === today) return // Already fired today.
    void this.fire(today)
  }

  private async fire(today: string): Promise<void> {
    const s = this.settings.get()
    this.settings.update({ lastSchedulerRun: today })
    this.runActive = true
    this.runCompleted = 0
    this.cb.onLog(`scheduler: fired at ${s.schedulerTime} (action: ${s.schedulerAction})`)
    const resumed = await this.queue.startScheduledRun()
    this.cb.onLog(`scheduler: resumed ${resumed} paused download(s)`)
    // Nothing to wait for (empty queue / nothing resumed)? End the run now.
    if (this.queue.isIdle()) {
      this.cb.onLog('scheduler: queue already idle — nothing to do')
      this.endRun()
      return
    }
    this.startRunWatch()
  }

  private startRunWatch(): void {
    this.stopRunWatch()
    this.runWatchTimer = setInterval(() => {
      if (!this.runActive) return
      if (this.runCompleted > 0 && this.queue.isIdle()) {
        this.stopRunWatch()
        this.beginCountdown()
      }
    }, 1000)
  }

  private stopRunWatch(): void {
    if (this.runWatchTimer) {
      clearInterval(this.runWatchTimer)
      this.runWatchTimer = null
    }
  }

  private endRun(): void {
    this.stopRunWatch()
    this.runActive = false
    this.runCompleted = 0
  }

  private beginCountdown(): void {
    const action = this.settings.get().schedulerAction as SchedulerAction
    this.endRun()
    if (action === 'none') {
      this.cb.onLog('scheduler: run finished, no action configured')
      return
    }
    this.countdown = { action, secondsLeft: 60 }
    this.cb.onLog(`scheduler: countdown started — ${action} in 60s`)
    this.cb.onCountdown(this.countdown)
    this.countdownTimer = setInterval(() => {
      if (!this.countdown) return
      this.countdown.secondsLeft--
      if (this.countdown.secondsLeft <= 0) {
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer)
          this.countdownTimer = null
        }
        const finalAction = this.countdown.action
        this.countdown = null
        this.cb.onCountdown(null)
        this.execute(finalAction)
        return
      }
      this.cb.onCountdown({ ...this.countdown })
    }, 1000)
  }

  private execute(action: 'shutdown' | 'sleep'): void {
    // Re-check idle right before acting — a download started during the
    // countdown must not be interrupted by a shutdown.
    if (!this.queue.isIdle()) {
      this.cb.onLog('scheduler: queue no longer idle — action aborted')
      return
    }
    if (process.env['DOVIRA_SCHEDULER_DRY_RUN'] === '1') {
      this.cb.onLog(`scheduler: dry-run — would execute ${action} now`)
      return
    }
    this.cb.onLog(`scheduler: executing ${action}`)
    if (action === 'shutdown') {
      execFile('shutdown', ['/s', '/t', '0'], (err) => {
        if (err) this.cb.onLog(`scheduler: shutdown failed — ${err.message}`)
      })
    } else {
      execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], (err) => {
        if (err) this.cb.onLog(`scheduler: sleep failed — ${err.message}`)
      })
    }
  }

  private computeNextRun(): string | null {
    const s = this.settings.get()
    if (!s.schedulerEnabled) return null
    const [hh, mm] = s.schedulerTime.split(':').map(Number)
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
}
