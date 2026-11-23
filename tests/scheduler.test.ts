import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DoviraDb } from '../src/main/db.ts'
import { SettingsManager } from '../src/main/settings.ts'
import { SchedulerManager } from '../src/main/scheduler.ts'

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hhmm(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function plusHours(h: number): string {
  const d = new Date(Date.now() + h * 3600_000)
  return hhmm(d)
}

class FakeQueue extends EventEmitter {
  idle = true
  resumed = 0
  startScheduledRunCalls = 0

  async startScheduledRun(): Promise<number> {
    this.startScheduledRunCalls++
    return this.resumed
  }

  isIdle(): boolean {
    return this.idle
  }
}

describe('SchedulerManager', () => {
  let dir: string
  let db: DoviraDb
  let settings: SettingsManager
  let queue: FakeQueue
  let logs: string[]
  let countdowns: (import('../src/main/types.ts').SchedulerCountdown | null)[]
  let sched: SchedulerManager
  let prevDryRun: string | undefined

  function build(): SchedulerManager {
    return new SchedulerManager(
      queue as never,
      settings,
      {
        onCountdown: (c) => countdowns.push(c),
        onLog: (line) => logs.push(line)
      }
    )
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dovira-sched-'))
    db = new DoviraDb(join(dir, 'dovira.db'))
    settings = new SettingsManager(db)
    queue = new FakeQueue()
    logs = []
    countdowns = []
    prevDryRun = process.env['DOVIRA_SCHEDULER_DRY_RUN']
    sched = build()
  })

  afterEach(() => {
    sched.stop()
    if (prevDryRun === undefined) delete process.env['DOVIRA_SCHEDULER_DRY_RUN']
    else process.env['DOVIRA_SCHEDULER_DRY_RUN'] = prevDryRun
    try {
      db.close()
    } catch {
      // Already closed.
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('getStatus: disabled -> null nextRunAt; enabled -> next run today/tomorrow; lastRunAt format', () => {
    let st = sched.getStatus()
    assert.equal(st.enabled, false)
    assert.equal(st.nextRunAt, null)
    assert.equal(st.lastRunAt, null)
    settings.update({ schedulerEnabled: true, schedulerTime: plusHours(2) })
    st = sched.getStatus()
    assert.equal(st.enabled, true)
    assert.ok(st.nextRunAt !== null)
    const next = new Date(st.nextRunAt as string)
    assert.ok(next.getTime() > Date.now())
    assert.ok(next.getTime() - Date.now() < 3 * 3600_000)
    settings.update({ lastSchedulerRun: '2026-11-24', schedulerTime: '02:00' })
    st = sched.getStatus()
    assert.equal(st.lastRunAt, '2026-11-24T02:00:00')
  })

  it('start/stop are idempotent no-ops; cancelCountdown with no countdown does nothing', () => {
    sched.start()
    sched.start()
    sched.stop()
    sched.stop()
    sched.cancelCountdown()
    assert.deepEqual(countdowns, [])
    assert.deepEqual(logs, [])
  })

  it('tick: disabled -> no fire; wrong time -> no fire; matching time fires once per day', async () => {
    const tick = (s: SchedulerManager, d: Date): void =>
      (s as unknown as { tick: (now: Date) => void }).tick(d)
    // Disabled: nothing happens.
    tick(sched, new Date())
    assert.equal(queue.startScheduledRunCalls, 0)
    // Enabled, but the time does not match now.
    settings.update({ schedulerEnabled: true, schedulerTime: plusHours(2) })
    tick(sched, new Date())
    assert.equal(queue.startScheduledRunCalls, 0)
    // Enabled, time matches now -> fires.
    const now = new Date()
    settings.update({ schedulerTime: hhmm(now), lastSchedulerRun: null })
    queue.resumed = 2
    tick(sched, now)
    assert.equal(queue.startScheduledRunCalls, 1)
    assert.equal(settings.get().lastSchedulerRun, todayStr(now))
    // fire() awaits startScheduledRun — the resumed/idle logs land on
    // the next macrotask, so wait before asserting them.
    await new Promise((r) => setTimeout(r, 10))
    assert.ok(logs.some((l) => l.includes('scheduler: fired at')))
    assert.ok(logs.some((l) => l.includes('resumed 2 paused download(s)')))
    assert.ok(logs.some((l) => l.includes('queue already idle')))
    // Same day again -> no second fire.
    tick(sched, now)
    assert.equal(queue.startScheduledRunCalls, 1)
  })

  it('tick: a run with a non-idle queue waits for completions (run watch), then counts down', async () => {
    const tick = (s: SchedulerManager, d: Date): void =>
      (s as unknown as { tick: (now: Date) => void }).tick(d)
    settings.update({ schedulerEnabled: true, schedulerTime: hhmm(new Date()), schedulerAction: 'none', lastSchedulerRun: null })
    queue.idle = false
    queue.resumed = 1
    tick(sched, new Date())
    assert.equal(queue.startScheduledRunCalls, 1)
    // Let fire() resume past its await (queue still non-idle, so the
    // run watch starts) BEFORE flipping the queue idle — flipping it
    // synchronously would take the 'already idle' branch instead.
    await new Promise((r) => setTimeout(r, 50))
    queue.emit('status', { id: 'x', status: 'completed', errorCode: null, errorMessage: null, networkClass: 'fast' })
    queue.idle = true
    await new Promise((r) => setTimeout(r, 1500))
    assert.ok(logs.some((l) => l.includes('run finished, no action configured')))
  })

  it('beginCountdown + execute: dry-run logs instead of shutting down; non-idle aborts', () => {
    process.env['DOVIRA_SCHEDULER_DRY_RUN'] = '1'
    settings.update({ schedulerAction: 'shutdown' })
    const begin = (s: SchedulerManager): void =>
      (s as unknown as { beginCountdown: () => void }).beginCountdown()
    const execute = (s: SchedulerManager, action: 'shutdown' | 'sleep'): void =>
      (s as unknown as { execute: (a: 'shutdown' | 'sleep') => void }).execute(action)
    begin(sched)
    assert.equal(countdowns.length, 1)
    assert.deepEqual(countdowns[0], { action: 'shutdown', secondsLeft: 60 })
    assert.ok(logs.some((l) => l.includes('countdown started')))
    // Direct execute, idle queue, dry-run -> logs, no real shutdown.
    execute(sched, 'shutdown')
    assert.ok(logs.some((l) => l.includes('dry-run — would execute shutdown now')))
    // Non-idle queue -> the action is aborted.
    queue.idle = false
    execute(sched, 'shutdown')
    assert.ok(logs.some((l) => l.includes('no longer idle — action aborted')))
  })

  it('countdown ticks to zero with mock timers, then executes (dry-run) and clears', () => {
    process.env['DOVIRA_SCHEDULER_DRY_RUN'] = '1'
    settings.update({ schedulerAction: 'sleep' })
    mock.timers.enable({ apis: ['setInterval'] })
    try {
      const begin = (s: SchedulerManager): void =>
        (s as unknown as { beginCountdown: () => void }).beginCountdown()
      begin(sched)
      assert.equal(countdowns.length, 1)
      mock.timers.tick(59_000)
      // 59 ticks: 1 second left, still counting down.
      assert.equal(countdowns[countdowns.length - 1]?.secondsLeft, 1)
      mock.timers.tick(1000)
      // 60th tick: countdown ends, dry-run executes, onCountdown(null).
      assert.equal(countdowns[countdowns.length - 1], null)
      assert.ok(logs.some((l) => l.includes('dry-run — would execute sleep now')))
    } finally {
      // Node 24.21 has no mock.timers.disable(); reset() clears the fake
      // timers. These are the last tests in the file, so nothing after
      // this needs real timers.
      mock.timers.reset()
    }
  })

  it('cancelCountdown mid-countdown stops the timer and reports null', () => {
    settings.update({ schedulerAction: 'shutdown' })
    mock.timers.enable({ apis: ['setInterval'] })
    try {
      const begin = (s: SchedulerManager): void =>
        (s as unknown as { beginCountdown: () => void }).beginCountdown()
      begin(sched)
      mock.timers.tick(10_000)
      const seen = countdowns.length
      assert.ok(seen > 1)
      sched.cancelCountdown()
      assert.equal(countdowns[countdowns.length - 1], null)
      assert.ok(logs.some((l) => l.includes('countdown cancelled by user')))
      // Ticking further must not execute anything.
      const before = logs.length
      mock.timers.tick(60_000)
      assert.equal(logs.length, before)
    } finally {
      mock.timers.reset()
    }
  })
})
