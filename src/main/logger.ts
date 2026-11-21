import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

let logPath: string | null = null
let initialized = false
let origLog: (...args: unknown[]) => void = console.log.bind(console)
let origWarn: (...args: unknown[]) => void = console.warn.bind(console)
let origError: (...args: unknown[]) => void = console.error.bind(console)

function line(level: string, msg: string): string {
  return `[${new Date().toISOString()}] [${level}] ${msg}\n`
}

function formatArg(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`
  if (typeof a === 'string') return a
  try {
    return JSON.stringify(a) ?? String(a)
  } catch {
    return String(a)
  }
}

function write(level: string, msg: string): void {
  if (!logPath) return
  try {
    appendFileSync(logPath, line(level, msg))
  } catch {
    // Logging must never break the app.
  }
}

/**
 * Main-process file logger. The 2026-11-22 Settings bug was unobservable
 * after the fact — no logs existed anywhere on disk — so the main process
 * now writes everything to <userData>/dovira.log: startup, the
 * renderer-mount bridge ping, console output, and uncaught errors.
 */
export function initLogger(userData: string): string {
  logPath = join(userData, 'dovira.log')
  if (initialized) return logPath
  initialized = true
  // The path itself goes to stdout first, so a terminal run shows where
  // the log lives even if the file write below fails.
  origLog(`[dovira] log file: ${logPath}`)
  write('info', 'DOVIRA main starting')
  origLog = console.log.bind(console)
  origWarn = console.warn.bind(console)
  origError = console.error.bind(console)
  console.log = (...args: unknown[]) => {
    write('info', args.map(formatArg).join(' '))
    origLog(...args)
  }
  console.warn = (...args: unknown[]) => {
    write('warn', args.map(formatArg).join(' '))
    origWarn(...args)
  }
  console.error = (...args: unknown[]) => {
    write('error', args.map(formatArg).join(' '))
    origError(...args)
  }
  process.on('uncaughtException', (err) => {
    write('fatal', `uncaughtException: ${formatArg(err)}`)
    origError(err)
  })
  process.on('unhandledRejection', (reason) => {
    write('fatal', `unhandledRejection: ${formatArg(reason)}`)
    origError(reason)
  })
  return logPath
}

/** Append one line to the log file (no console mirror). */
export function logMain(level: 'info' | 'warn' | 'error', msg: string): void {
  write(level, msg)
}
