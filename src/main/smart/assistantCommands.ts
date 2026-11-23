/**
 * Next-level: AI Assistant commands — the assistant DOES things.
 *
 * A chat message can be a command, not just a question:
 *   "download this https://…" / "এইটা ডাউনলোড করো https://…"
 *   "pause <name>" / "resume <name>" / "cancel <name>" /
 *   "retry <name>" / "download <name> next"
 *
 * Rule-based only (like the rest of the assistant) — no model, no API
 * key, nothing leaves the machine. A bare pasted URL is NOT a command:
 * a download command needs a link AND a download verb. And a question
 * is never a command: any question word (why/how/what/when/where, কেন/
 * কী/কিভাবে/কেমন/কখন/কোথায়) vetoes the whole message, so "why did the
 * download fail for <url>?" and "how do I pause a download?" stay
 * questions. Commands never reach the local model.
 *
 * Pure functions over the download list — no I/O, unit-tested in
 * tests/assistant-commands.test.ts.
 */
import type { DownloadInfo } from '../types'

export type AssistantCommand =
  | { type: 'download'; url: string }
  | { type: 'pause' | 'resume' | 'cancel' | 'retry' | 'moveToTop'; id: string; name: string }

/** Lowercase, strip punctuation, collapse spaces (same rule as assistant.ts). */
export function normalizeCommand(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,!?।;:"'()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whole-token / whole-phrase match on a space-padded normalized string. */
function hasToken(padded: string, word: string): boolean {
  return padded.includes(` ${word} `)
}

/** http(s) URLs in the raw text (trailing punctuation stripped). */
export function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const m of text.match(/https?:\/\/[^\s<>"')]+/g) ?? []) {
    out.push(m.replace(/[.,!?।;:'")\]]+$/, ''))
  }
  return out
}

const DOWNLOAD_VERBS = ['download', 'ডাউনলোড', 'নামাও', 'নাও']

/** Does the message contain a download verb (a verb, not just a URL)? */
export function hasDownloadVerb(normalized: string): boolean {
  const q = ` ${normalized} `
  return DOWNLOAD_VERBS.some((w) => hasToken(q, w))
}

/** Does the message ask to download something (a verb, not just a URL)? */
export function hasCommandToken(normalized: string): boolean {
  const q = ` ${normalized} `
  return (
    DOWNLOAD_VERBS.some((w) => hasToken(q, w)) || CONTROL_VERBS.some((v) => hasToken(q, v.phrase))
  )
}

/**
 * Question words — their presence means the message is a question,
 * never a command. Checked before any verb, so "why did the download
 * fail?" and "how do I pause a download?" are never executed.
 */
const QUESTION_WORDS = [
  'why',
  'how',
  'what',
  'when',
  'where',
  'which',
  'who',
  'কেন',
  'কী',
  'কিভাবে',
  'কীভাবে',
  'কেমন',
  'কখন',
  'কোথায়',
  'কোথায়',
  'কোনটা',
  'কোনটি'
]

type ControlType = 'pause' | 'resume' | 'cancel' | 'retry' | 'moveToTop'

const CONTROL_VERBS: { type: ControlType; phrase: string }[] = [
  { type: 'moveToTop', phrase: 'move to top' },
  { type: 'moveToTop', phrase: 'download next' },
  { type: 'moveToTop', phrase: 'সবার আগে' },
  { type: 'moveToTop', phrase: 'প্রথমে' },
  { type: 'pause', phrase: 'pause' },
  { type: 'pause', phrase: 'পজ' },
  { type: 'pause', phrase: 'থামাও' },
  { type: 'pause', phrase: 'থামা' },
  { type: 'resume', phrase: 'resume' },
  { type: 'resume', phrase: 'রিজিউম' },
  { type: 'resume', phrase: 'আবার শুরু' },
  { type: 'resume', phrase: 'চালু করো' },
  { type: 'cancel', phrase: 'cancel' },
  { type: 'cancel', phrase: 'বাতিল' },
  { type: 'cancel', phrase: 'ক্যানসেল' },
  { type: 'cancel', phrase: 'ক্যান্সেল' },
  { type: 'cancel', phrase: 'বন্ধ করো' },
  { type: 'retry', phrase: 'retry' },
  { type: 'retry', phrase: 'আবার চেষ্টা' },
  { type: 'retry', phrase: 'পুনরায়' }
]

/** Filler words stripped from a control command, leaving the name. */
const CONTROL_FILLERS = [
  'the',
  'a',
  'this',
  'that',
  'download',
  'ডাউনলোড',
  'আমার',
  'আমাকে',
  'আমায়',
  'please',
  'দয়া করে',
  'টা',
  'টি'
]

/**
 * The download name in a control command: the message minus the control
 * verb and filler words ("pause the lecture video" → "lecture video").
 */
export function extractControlTerm(normalized: string, phrase: string): string {
  let s = ` ${normalized} `
  s = s.split(` ${phrase} `).join(' ')
  // moveToTop's "download next" leaves a bare "download" behind.
  for (const w of ['download next', 'move to top', 'download', 'ডাউনলোড', ...CONTROL_FILLERS]) {
    s = s.split(` ${w} `).join(' ')
  }
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((tok) => tok.replace(/(টা|টি)$/, ''))
    .join(' ')
}

/**
 * Substring match on title/filename (case-insensitive). Returns the
 * download only when EXACTLY ONE matches — zero or several matches
 * mean "ask the user to be specific", never a guess.
 */
export function matchDownloadByName(term: string, downloads: DownloadInfo[]): DownloadInfo | null {
  const needle = term.toLowerCase().trim()
  if (!needle) return null
  const hits = downloads.filter((d) =>
    `${d.title ?? ''} ${d.filename}`.toLowerCase().includes(needle)
  )
  return hits.length === 1 ? hits[0] : null
}

export interface DetectedCommand {
  /** The command to execute (null = not a command). */
  command: AssistantCommand | null
  /**
   * A control term that matched nothing (or matched several) — the
   * assistant answers "couldn't find <term>" instead of acting.
   * Null when the message was not a control command at all.
   */
  unmatchedTerm: string | null
}

/**
 * Detect a command in a chat message. Questions (any question word)
 * are never commands. A download needs a URL + a download verb.
 * A control verb needs a name that matches exactly one download.
 */
export function detectCommand(rawQuestion: string, downloads: DownloadInfo[]): DetectedCommand {
  const normalized = normalizeCommand(rawQuestion)
  const q = ` ${normalized} `
  if (QUESTION_WORDS.some((w) => hasToken(q, w))) {
    return { command: null, unmatchedTerm: null }
  }
  const urls = extractUrls(rawQuestion)
  if (urls.length > 0 && DOWNLOAD_VERBS.some((w) => hasToken(q, w))) {
    return { command: { type: 'download', url: urls[0] }, unmatchedTerm: null }
  }
  for (const verb of CONTROL_VERBS) {
    if (!hasToken(q, verb.phrase)) continue
    const term = extractControlTerm(normalized, verb.phrase)
    if (!term) return { command: null, unmatchedTerm: null }
    const match = matchDownloadByName(term, downloads)
    if (match) {
      return {
        command: { type: verb.type, id: match.id, name: match.title ?? match.filename },
        unmatchedTerm: null
      }
    }
    return { command: null, unmatchedTerm: term }
  }
  return { command: null, unmatchedTerm: null }
}
