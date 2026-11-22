/**
 * AI Assistant (post-v1.0, v1.1.0) — rule-based answering.
 *
 * Pure functions over a live snapshot: no Electron, no I/O, no network.
 * The renderer never decides facts — main builds the snapshot (queue list,
 * DB rows, settings) and this module turns a question into a structured
 * answer. The renderer translates the answer lines with the i18n dicts.
 *
 * HARD RULE: every factual claim comes from the snapshot. A download, file,
 * size, or status is never stated unless it is in the snapshot. When the
 * snapshot has nothing to say, the answer says so plainly.
 *
 * No API keys, no paid API, nothing leaves the machine. The optional local
 * model (Ollama / LM Studio) only ever sees the compact prompt built by
 * buildModelPrompt() — download metadata only, no file paths, no URLs.
 */
import type { DownloadInfo, Settings } from '../types'

export type AssistantIntent = 'status' | 'failed' | 'find' | 'howto' | 'greeting' | 'fallback'

export type AssistantSource = 'rules' | 'model'

export type FindKind = 'video' | 'audio' | 'file' | null
export type FindStatus = 'failed' | 'completed' | 'downloading' | 'queued' | null
export type FindDate = 'today' | 'yesterday' | 'week' | null

export type HowtoTopic =
  | 'speed'
  | 'subtitles'
  | 'cookies'
  | 'scheduler'
  | 'extension'
  | 'grabber'
  | 'smart'
  | 'update'
  | 'folder'
  | 'resume'

export interface AssistantSnapshot {
  downloads: DownloadInfo[]
  settings: Settings
  appVersion: string
  downloadDir: string
  diskFreeBytes: number | null
}

/** One translated line of an answer. The renderer renders `t(key, params)`. */
export interface AssistantLine {
  key: string
  params?: Record<string, string | number>
}

export interface AssistantAnswer {
  intent: AssistantIntent
  source: AssistantSource
  lines: AssistantLine[]
  /** Local-model path only: raw model text, shown as-is (not translated). */
  modelText?: string
}

export interface DetectedIntent {
  intent: AssistantIntent
  /** find: the search term ('' when the user asked for a list, not a term). */
  term: string
  kind: FindKind
  statusFilter: FindStatus
  dateFilter: FindDate
  topic: HowtoTopic | null
}

/** Questions longer than this are truncated, never rejected with an error. */
export const MAX_QUESTION_CHARS = 500

// ---------------------------------------------------------------------------
// Small formatters (locale-neutral; Latin digits, as the rest of the app).
// ---------------------------------------------------------------------------

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  return `${formatSize(bps)}/s`
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Intent detection — keyword based, English + Bangla.
//
// Matching is token-based on a normalized question (lowercased, punctuation
// stripped, single spaces): a word matches only as a whole token or a whole
// phrase, so "hi" never matches inside "this" and "file" never matches
// inside "profile". Bangla verb forms vary, so the lists keep the common
// forms — no stemming is attempted.
// ---------------------------------------------------------------------------

const GREETING_WORDS = [
  'hi',
  'hello',
  'hey',
  'salam',
  'assalamu',
  'আসসালামু',
  'সালাম',
  'হ্যালো',
  'হাই',
  'নমস্কার'
]
const STATUS_WORDS = [
  'downloading',
  'ডাউনলোড হচ্ছে',
  'ডাউনলোড হইতেছে',
  'কি ডাউনলোড',
  'কী ডাউনলোড',
  'কতগুলো',
  'কয়টা',
  'my downloads',
  'আমার ডাউনলোড',
  'status',
  'অবস্থা',
  'চলছে',
  'চলতেছে'
]
const FAIL_WORDS = [
  'fail',
  'failed',
  'failure',
  'ব্যর্থ',
  'error',
  'এরর',
  'হলো না',
  'হইলো না',
  'হচ্ছে না',
  'হইতেছে না'
]
const FIND_VERBS = ['find', 'search', 'show', 'list', 'খুঁজো', 'খুঁজে', 'খুঁজ', 'দেখাও', 'দাও', 'দেখান']
const HOW_WORDS = [
  'how do i',
  'how to',
  'how can i',
  'কিভাবে',
  'কীভাবে',
  'কেমনে',
  'কেমন করে',
  'where is',
  'where do i',
  'where can i',
  'কোথায়',
  'কোথায়',
  'কি করলে',
  'কী করলে'
]
const KIND_WORDS: { kind: FindKind; words: string[] }[] = [
  { kind: 'video', words: ['video', 'ভিডিও'] },
  { kind: 'audio', words: ['audio', 'music', 'song', 'অডিও', 'গান', 'মিউজিক'] },
  { kind: 'file', words: ['file', 'zip', 'ফাইল'] }
]
const STATUS_FILTER_WORDS: { status: FindStatus; words: string[] }[] = [
  { status: 'failed', words: ['failed', 'fail', 'ব্যর্থ'] },
  { status: 'completed', words: ['completed', 'complete', 'done', 'শেষ', 'সম্পূর্ণ'] },
  { status: 'downloading', words: ['downloading', 'চলছে', 'চলতেছে'] },
  { status: 'queued', words: ['queued', 'অপেক্ষা'] }
]
const DATE_WORDS: { date: FindDate; words: string[] }[] = [
  { date: 'today', words: ['today', 'আজকে', 'আজ', 'আজকের'] },
  { date: 'yesterday', words: ['yesterday', 'গতকাল', 'গত কাল', 'গতকালের'] },
  {
    date: 'week',
    words: [
      'last week',
      'this week',
      'গত সপ্তাহে',
      'এই সপ্তাহে',
      'গত সপ্তাহ',
      'গত সপ্তাহের',
      'এই সপ্তাহের'
    ]
  }
]
const HOWTO_TOPICS: { topic: HowtoTopic; words: string[] }[] = [
  { topic: 'speed', words: ['speed', 'slow', 'fast', 'limit', 'স্পিড', 'গতি', 'আস্তে', 'ধীর'] },
  {
    topic: 'subtitles',
    words: ['subtitle', 'subtitles', 'caption', 'সাবটাইটেল', 'সাব টাইটেল']
  },
  {
    topic: 'cookies',
    words: ['cookie', 'cookies', 'login', 'sign in', 'কুকি', 'লগইন', 'সাইন ইন']
  },
  { topic: 'scheduler', words: ['scheduler', 'schedule', 'timer', 'শিডিউল', 'সময়', 'সময়'] },
  { topic: 'extension', words: ['extension', 'browser', 'chrome', 'এক্সটেনশন', 'ব্রাউজার'] },
  { topic: 'grabber', words: ['grabber', 'grab', 'page', 'গ্র্যাব', 'পেজ', 'ওয়েবসাইট'] },
  {
    topic: 'smart',
    words: ['smart', 'organizer', 'duplicate', 'organize', 'স্মার্ট', 'অর্গানাইজার', 'ডুপ্লিকেট']
  },
  { topic: 'update', words: ['update yt-dlp', 'update engine', 'yt-dlp update', 'আপডেট'] },
  { topic: 'folder', words: ['folder', 'directory', 'save', 'ফোল্ডার', 'সেভ'] },
  { topic: 'resume', words: ['resume', 'pause', 'পজ', 'রিজিউম', 'থামা'] }
]

/** Lowercase, strip punctuation, collapse spaces. */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,!?।;:"'()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whole-token / whole-phrase match on a normalized question. */
function hasToken(q: string, word: string): boolean {
  return ` ${q} `.includes(` ${word} `)
}

function hasAnyToken(q: string, words: string[]): boolean {
  return words.some((w) => hasToken(q, w))
}

/** Remove every occurrence of a whole-token phrase from a space-padded string. */
function removeToken(s: string, word: string): string {
  return s.split(` ${word} `).join(' ')
}

function isGreetingOnly(q: string): boolean {
  return GREETING_WORDS.some((w) => q === w)
}

/** Strip command / qualifier words, leaving the search term (may be ''). */
function extractTerm(q: string): {
  term: string
  kind: FindKind
  statusFilter: FindStatus
  dateFilter: FindDate
} {
  let s = ` ${q} `
  let dateFilter: FindDate = null
  for (const d of DATE_WORDS) {
    for (const w of d.words) {
      if (s.includes(` ${w} `)) {
        dateFilter = d.date
        s = removeToken(s, w)
      }
    }
  }
  let kind: FindKind = null
  for (const k of KIND_WORDS) {
    for (const w of k.words) {
      if (s.includes(` ${w} `)) {
        kind = k.kind
        s = removeToken(s, w)
      }
    }
  }
  let statusFilter: FindStatus = null
  for (const f of STATUS_FILTER_WORDS) {
    for (const w of f.words) {
      if (s.includes(` ${w} `)) {
        statusFilter = f.status
        s = removeToken(s, w)
      }
    }
  }
  const stripWords = [
    'find me',
    'search for',
    'show me',
    'show my',
    'list my',
    ...FIND_VERBS,
    'আমাকে',
    'আমায়',
    'আমার',
    'my',
    'the',
    'that',
    'ওই',
    'ঐ',
    'এই',
    'please',
    'দয়া করে',
    'downloads',
    'download',
    'ডাউনলোড'
  ]
  for (const w of stripWords) {
    s = removeToken(s, w)
  }
  // Bangla definite suffixes on the last word ("লেকচারটা" → "লেকচার").
  const term = s
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((tok) => tok.replace(/(টা|টি)$/, ''))
    .join(' ')
  return { term, kind, statusFilter, dateFilter }
}

export function detectIntent(rawQuestion: string): DetectedIntent {
  const q = normalize(rawQuestion.trim().slice(0, MAX_QUESTION_CHARS))
  const empty: DetectedIntent = {
    intent: 'fallback',
    term: '',
    kind: null,
    statusFilter: null,
    dateFilter: null,
    topic: null
  }
  if (!q) return empty
  // A bare greeting ("hi", "সালাম") — nothing else in the question.
  if (isGreetingOnly(q)) {
    return { ...empty, intent: 'greeting' }
  }
  // find: a find verb, or "খুঁজ"/"find" anywhere.
  if (hasAnyToken(q, FIND_VERBS)) {
    const { term, kind, statusFilter, dateFilter } = extractTerm(q)
    if (term || kind || statusFilter || dateFilter) {
      return { intent: 'find', term, kind, statusFilter, dateFilter, topic: null }
    }
    return { ...empty, intent: 'fallback' }
  }
  // failed: mentions a failure.
  if (hasAnyToken(q, FAIL_WORDS)) {
    return { ...empty, intent: 'failed' }
  }
  // status: asks what is downloading / how many.
  if (hasAnyToken(q, STATUS_WORDS)) {
    return { ...empty, intent: 'status' }
  }
  // howto: asks how / where.
  if (hasAnyToken(q, HOW_WORDS)) {
    let topic: HowtoTopic | null = null
    for (const t of HOWTO_TOPICS) {
      if (hasAnyToken(q, t.words)) {
        topic = t.topic
        break
      }
    }
    return { ...empty, intent: 'howto', topic }
  }
  // greeting words anywhere ("hi, what can you do?").
  if (
    hasAnyToken(q, GREETING_WORDS) ||
    hasToken(q, 'what can you do') ||
    hasToken(q, 'তুমি কি করতে পারো') ||
    hasToken(q, 'তুমি কী করতে পারো') ||
    hasToken(q, 'সাহায্য')
  ) {
    return { ...empty, intent: 'greeting' }
  }
  return empty
}

// ---------------------------------------------------------------------------
// Answer generation (rules). Lines are i18n keys — the renderer translates.
// ---------------------------------------------------------------------------

function statusCounts(downloads: DownloadInfo[]): Record<string, number> {
  const counts: Record<string, number> = {
    downloading: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    paused: 0,
    cancelled: 0
  }
  for (const d of downloads) {
    if (d.status === 'fetching_info' || d.status === 'processing') counts.downloading++
    else if (d.status in counts) counts[d.status]++
  }
  return counts
}

function isToday(ts: number | null): boolean {
  if (ts === null) return false
  const d = new Date(ts)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function displayName(d: DownloadInfo): string {
  return d.title ?? d.filename
}

function answerStatus(snap: AssistantSnapshot): AssistantLine[] {
  const counts = statusCounts(snap.downloads)
  const lines: AssistantLine[] = [
    {
      key: 'assistant.statusSummary',
      params: {
        downloading: counts.downloading,
        queued: counts.queued,
        completed: counts.completed,
        failed: counts.failed,
        paused: counts.paused
      }
    }
  ]
  const active = snap.downloads.filter(
    (d) => d.status === 'downloading' || d.status === 'fetching_info' || d.status === 'processing'
  )
  for (const d of active.slice(0, 5)) {
    const pct = d.totalBytes > 0 ? Math.round((d.doneBytes / d.totalBytes) * 100) : 0
    lines.push({
      key: 'assistant.statusActive',
      params: {
        name: displayName(d),
        pct,
        speed: d.status === 'downloading' ? formatSpeed(d.speedBps) : '—',
        eta: d.status === 'downloading' ? formatEta(d.etaSeconds) : '—'
      }
    })
  }
  if (active.length === 0) {
    const today = snap.downloads.filter(
      (d) => d.status === 'completed' && isToday(d.completedAt)
    ).length
    if (today > 0) {
      lines.push({ key: 'assistant.statusToday', params: { n: today } })
    } else {
      lines.push({ key: 'assistant.statusNone' })
    }
  }
  return lines
}

/** Advice key per failure code (reuses the §7.8 human-language error text). */
function adviceKeyFor(code: string | null): string {
  switch (code) {
    case 'loginRequired':
    case 'auth':
      return 'assistant.adviceLogin'
    case 'forbidden':
    case 'updateForbidden':
      return 'assistant.adviceUpdate'
    case 'network':
      return 'assistant.adviceRetry'
    case 'no-space':
      return 'assistant.adviceSpace'
    case 'drm':
      return 'assistant.adviceDrm'
    case 'not-found':
    case 'unavailable':
      return 'assistant.adviceGone'
    case 'engine-missing':
      return 'assistant.adviceEngine'
    default:
      return 'assistant.adviceRetry'
  }
}

function answerFailed(snap: AssistantSnapshot): AssistantLine[] {
  const failed = snap.downloads.filter((d) => d.status === 'failed')
  if (failed.length === 0) {
    return [{ key: 'assistant.failedNone' }]
  }
  const d = failed[0]
  const code = d.errorCode ?? 'unknown'
  return [
    { key: 'assistant.failedName', params: { name: displayName(d) } },
    { key: `error.${code}` },
    { key: adviceKeyFor(code) }
  ]
}

function dateMatches(d: DownloadInfo, dateFilter: FindDate): boolean {
  if (dateFilter === null) return true
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000
  if (dateFilter === 'today') return d.createdAt >= startOfToday
  if (dateFilter === 'yesterday')
    return d.createdAt >= startOfToday - dayMs && d.createdAt < startOfToday
  return d.createdAt >= startOfToday - 7 * dayMs // week
}

function answerFind(snap: AssistantSnapshot, det: DetectedIntent): AssistantLine[] {
  const needle = det.term.toLowerCase()
  const matches = snap.downloads.filter((d) => {
    if (det.kind && d.kind !== det.kind) return false
    if (det.statusFilter) {
      // 'downloading' also covers the fetching/processing steps.
      const active = ['downloading', 'fetching_info', 'processing']
      if (
        det.statusFilter === 'downloading'
          ? !active.includes(d.status)
          : d.status !== det.statusFilter
      )
        return false
    }
    if (!dateMatches(d, det.dateFilter)) return false
    if (!needle) return true
    const hay = `${d.title ?? ''} ${d.filename} ${d.site ?? ''}`.toLowerCase()
    return hay.includes(needle)
  })
  if (matches.length === 0) {
    return [
      {
        key: 'assistant.findNone',
        params: { term: det.term || '—' }
      }
    ]
  }
  const lines: AssistantLine[] = [
    { key: 'assistant.findFound', params: { n: Math.min(matches.length, 5) } }
  ]
  for (const d of matches.slice(0, 5)) {
    lines.push({
      key: 'assistant.findOne',
      params: {
        name: displayName(d),
        status: d.status,
        size: d.totalBytes > 0 ? formatSize(d.totalBytes) : '—',
        date: formatDate(d.createdAt)
      }
    })
  }
  return lines
}

function answerHowto(det: DetectedIntent): AssistantLine[] {
  if (det.topic === null) {
    return [{ key: 'assistant.fallback' }]
  }
  const keyByTopic: Record<HowtoTopic, string> = {
    speed: 'assistant.howtoSpeed',
    subtitles: 'assistant.howtoSubtitles',
    cookies: 'assistant.howtoCookies',
    scheduler: 'assistant.howtoScheduler',
    extension: 'assistant.howtoExtension',
    grabber: 'assistant.howtoGrabber',
    smart: 'assistant.howtoSmart',
    update: 'assistant.howtoUpdate',
    folder: 'assistant.howtoFolder',
    resume: 'assistant.howtoResume'
  }
  return [{ key: keyByTopic[det.topic] }]
}

/** Rules-only answer. Lines are i18n keys; the renderer translates them. */
export function answerQuestion(snap: AssistantSnapshot, rawQuestion: string): AssistantAnswer {
  const det = detectIntent(rawQuestion)
  switch (det.intent) {
    case 'status':
      return { intent: 'status', source: 'rules', lines: answerStatus(snap) }
    case 'failed':
      return { intent: 'failed', source: 'rules', lines: answerFailed(snap) }
    case 'find':
      return { intent: 'find', source: 'rules', lines: answerFind(snap, det) }
    case 'howto':
      return { intent: 'howto', source: 'rules', lines: answerHowto(det) }
    case 'greeting':
      return { intent: 'greeting', source: 'rules', lines: [{ key: 'assistant.greeting' }] }
    default:
      return { intent: 'fallback', source: 'rules', lines: [{ key: 'assistant.fallback' }] }
  }
}

// ---------------------------------------------------------------------------
// Local-model prompt — compact snapshot only. No paths, no URLs.
// ---------------------------------------------------------------------------

export function buildModelPrompt(
  snap: AssistantSnapshot,
  rawQuestion: string,
  lang: 'en' | 'bn' = 'bn'
): string {
  const counts = statusCounts(snap.downloads)
  const recent = snap.downloads
    .slice(0, 5)
    .map((d) => `- ${displayName(d)} [${d.status}]${d.errorCode ? ` (error: ${d.errorCode})` : ''}`)
    .join('\n')
  return (
    `You are DOVIRA's download assistant. Answer only about downloads in ` +
    `this app, in ${lang === 'bn' ? 'Bangla' : 'English'}. ` +
    `If you do not know the answer, say so — never invent a download, ` +
    `a file, or a status.\n` +
    `Current state: ${counts.downloading} downloading, ${counts.queued} queued, ` +
    `${counts.completed} completed, ${counts.failed} failed.\n` +
    `Recent downloads:\n${recent || '(none)'}\n` +
    `Question: ${rawQuestion.trim().slice(0, MAX_QUESTION_CHARS)}`
  )
}
