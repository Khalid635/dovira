import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatSize,
  formatSpeed,
  formatEta,
  formatDate,
  detectIntent,
  answerQuestion,
  buildModelPrompt,
  type AssistantSnapshot
} from '../src/main/smart/assistant.ts'
import { DEFAULT_SETTINGS } from '../src/main/settings.ts'
import type { DownloadInfo, Settings } from '../src/main/types.ts'

function dl(partial: Partial<DownloadInfo> & { id: string }): DownloadInfo {
  return {
    url: 'https://example.com/f.mp4',
    title: null,
    filename: 'f.mp4',
    savePath: 'C:\\DL\\f.mp4',
    kind: 'video',
    formatLabel: null,
    status: 'queued',
    totalBytes: 0,
    doneBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    errorCode: null,
    errorMessage: null,
    thumbnailUrl: null,
    site: 'example.com',
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    engine: 'aria2',
    formatId: null,
    formatString: null,
    ytdlpState: null,
    sortOrder: 0,
    speedLimitKBps: 0,
    pinned: false,
    ...partial
  }
}

function snap(downloads: DownloadInfo[], settingsPatch: Partial<Settings> = {}): AssistantSnapshot {
  return {
    downloads,
    settings: { ...DEFAULT_SETTINGS, ...settingsPatch },
    appVersion: '1.3.1',
    downloadDir: 'C:\\DL',
    diskFreeBytes: 10_000_000_000
  }
}

describe('assistant formatters', () => {
  it('formatSize / formatSpeed / formatEta / formatDate', () => {
    assert.equal(formatSize(0), '0 B')
    assert.equal(formatSize(-5), '0 B')
    assert.equal(formatSize(1023), '1023 B')
    assert.equal(formatSize(1536), '1.5 KB')
    assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB')
    assert.equal(formatSize(2 * 1024 * 1024 * 1024), '2.0 GB')
    assert.equal(formatSpeed(0), '0 B/s')
    assert.equal(formatSpeed(2048), '2.0 KB/s')
    assert.equal(formatEta(null), '—')
    assert.equal(formatEta(-1), '—')
    assert.equal(formatEta(45), '45s')
    assert.equal(formatEta(90), '1m 30s')
    assert.equal(formatEta(3600), '1h 0m')
    assert.equal(formatDate(new Date(2026, 10, 24).getTime()), '2026-11-24')
    assert.equal(formatDate(NaN), '')
  })
})

describe('assistant detectIntent', () => {
  it('bare greetings (EN + Bangla)', () => {
    assert.equal(detectIntent('hi').intent, 'greeting')
    assert.equal(detectIntent('সালাম').intent, 'greeting')
    assert.equal(detectIntent('hello, what can you do?').intent, 'greeting')
  })

  it('status questions', () => {
    assert.equal(detectIntent('what is downloading?').intent, 'status')
    assert.equal(detectIntent('আমার ডাউনলোডের অবস্থা কী?').intent, 'status')
    assert.equal(detectIntent('my downloads status').intent, 'status')
  })

  it('failed questions', () => {
    assert.equal(detectIntent('why did the download fail?').intent, 'failed')
    assert.equal(detectIntent('download হচ্ছে না কেন?').intent, 'failed')
  })

  it('find with term / kind / status / date filters', () => {
    const d = detectIntent('find my failed video downloads today')
    assert.equal(d.intent, 'find')
    assert.equal(d.kind, 'video')
    assert.equal(d.statusFilter, 'failed')
    assert.equal(d.dateFilter, 'today')
    assert.equal(d.term, '')
    const d2 = detectIntent('show me the lecture video')
    assert.equal(d2.intent, 'find')
    assert.equal(d2.term, 'lecture')
    // A Bangla suffix ("গানটা") is stripped from the term; the kind only
    // matches when the word stands alone ("গান খুঁজে দেখাও" -> audio).
    const d3 = detectIntent('খুঁজে দেখাও গানটা')
    assert.equal(d3.intent, 'find')
    assert.equal(d3.kind, null)
    assert.equal(d3.term, 'গান')
    assert.equal(detectIntent('গান খুঁজে দেখাও').kind, 'audio')
  })

  it('howto with topic (specific topic wins over diagnose)', () => {
    assert.equal(detectIntent('how do I make downloads fast?').intent, 'howto')
    assert.equal(detectIntent('how do I make downloads fast?').topic, 'speed')
    assert.equal(detectIntent('how to add subtitles?').topic, 'subtitles')
    assert.equal(detectIntent('where is the download folder?').topic, 'folder')
    assert.equal(detectIntent('how do I resume a paused download?').topic, 'resume')
    assert.equal(detectIntent('how do I fix the extension?').topic, 'extension')
    assert.equal(detectIntent('how do I diagnose this problem?').topic, 'diagnose')
    assert.equal(detectIntent('how do I do this thing?').topic, null)
  })

  it('FAQ: extension setup / audio / fetch / drm (EN + Bangla)', () => {
    // Extension setup — specific topic wins over the generic 'extension'.
    const setup = detectIntent('how do I set up the extension in Chrome')
    assert.equal(setup.intent, 'howto')
    assert.equal(setup.topic, 'extensionSetup')
    assert.equal(detectIntent('how to install the extension').topic, 'extensionSetup')
    assert.equal(
      detectIntent('ক্রোমে এক্সটেনশন কিভাবে সেটআপ করবো').topic,
      'extensionSetup'
    )
    assert.equal(detectIntent('এক্সটেনশন সেটআপ কিভাবে করব').topic, 'extensionSetup')
    // Generic extension questions stay on the generic topic.
    assert.equal(detectIntent('how do I fix the extension?').topic, 'extension')
    // Audio / MP3.
    assert.equal(detectIntent('how do I download audio as mp3?').topic, 'audio')
    assert.equal(detectIntent('অডিও কিভাবে ডাউনলোড করবো').topic, 'audio')
    // Fetch time — 'why' is a howto word now.
    assert.equal(detectIntent('why does fetching a video take so long?').topic, 'fetch')
    assert.equal(detectIntent('ভিডিও ফেচ করতে এত সময় লাগে কেন?').topic, 'fetch')
    // DRM sites.
    assert.equal(detectIntent('how do I download from Netflix?').topic, 'drm')
    assert.equal(detectIntent("why can't I download from Netflix?").topic, 'drm')
    // 'why' does not steal failure questions.
    assert.equal(detectIntent('why did the download fail?').intent, 'failed')
  })

  it('empty / unintelligible -> fallback; long questions truncated', () => {
    assert.equal(detectIntent('').intent, 'fallback')
    assert.equal(detectIntent('   ').intent, 'fallback')
    assert.equal(detectIntent('blorp zibble').intent, 'fallback')
    const long = `find ${'x'.repeat(600)}`
    assert.equal(detectIntent(long).intent, 'find')
  })

  it('whole-token matching: "hi" inside "this" is not a greeting', () => {
    assert.equal(detectIntent('this is a test').intent, 'fallback')
  })
})

describe('assistant answerQuestion', () => {
  it('status: summary + active rows, capped at 5; today count when idle', () => {
    const active = dl({
      id: 'a1',
      status: 'downloading',
      title: 'Film',
      totalBytes: 1000,
      doneBytes: 500,
      speedBps: 100,
      etaSeconds: 5
    })
    const done = dl({ id: 'a2', status: 'completed', completedAt: Date.now() })
    const ans = answerQuestion(snap([active, done]), 'what is downloading?')
    assert.equal(ans.intent, 'status')
    assert.equal(ans.source, 'rules')
    assert.equal(ans.lines[0].key, 'assistant.statusSummary')
    assert.equal(ans.lines[0].params?.downloading, 1)
    assert.equal(ans.lines[0].params?.completed, 1)
    assert.equal(ans.lines[1].key, 'assistant.statusActive')
    assert.equal(ans.lines[1].params?.pct, 50)
    const idle = answerQuestion(snap([done]), 'status')
    assert.ok(idle.lines.some((l) => l.key === 'assistant.statusToday'))
    const none = answerQuestion(snap([]), 'status')
    assert.ok(none.lines.some((l) => l.key === 'assistant.statusNone'))
  })

  it('failed: none vs first failure + advice key', () => {
    assert.deepEqual(answerQuestion(snap([]), 'what failed?').lines, [
      { key: 'assistant.failedNone' }
    ])
    const bad = dl({ id: 'f1', status: 'failed', title: 'Clip', errorCode: 'network' })
    const ans = answerQuestion(snap([bad]), 'what failed?')
    assert.equal(ans.intent, 'failed')
    assert.equal(ans.lines[0].key, 'assistant.failedName')
    assert.equal(ans.lines[1].key, 'error.network')
    assert.equal(ans.lines[2].key, 'assistant.adviceRetry')
    const login = dl({ id: 'f2', status: 'failed', errorCode: 'loginRequired' })
    assert.equal(answerQuestion(snap([login]), 'failed?').lines[2].key, 'assistant.adviceLogin')
  })

  it('find: filters by kind/status/date/term, caps at 5, none message', () => {
    const now = Date.now()
    const rows = [
      dl({ id: '1', kind: 'video', title: 'Lecture 1', status: 'completed', createdAt: now }),
      dl({ id: '2', kind: 'audio', title: 'Song', status: 'completed', createdAt: now }),
      dl({ id: '3', kind: 'video', title: 'Lecture 2', status: 'failed', createdAt: now })
    ]
    const found = answerQuestion(snap(rows), 'find lecture video')
    assert.equal(found.lines[0].key, 'assistant.findFound')
    assert.equal(found.lines[0].params?.n, 2)
    const none = answerQuestion(snap(rows), 'find nothinghere')
    assert.equal(none.lines[0].key, 'assistant.findNone')
    const failed = answerQuestion(snap(rows), 'find failed downloads')
    assert.equal(failed.lines[0].params?.n, 1)
  })

  it('FAQ answers: setup/audio/fetch/drm keys + folder dir param', () => {
    assert.equal(
      answerQuestion(snap([]), 'how do I set up the extension in Chrome').lines[0].key,
      'assistant.howtoExtensionSetup'
    )
    assert.equal(
      answerQuestion(snap([]), 'ক্রোমে এক্সটেনশন কিভাবে সেটআপ করবো').lines[0].key,
      'assistant.howtoExtensionSetup'
    )
    assert.equal(
      answerQuestion(snap([]), 'how do I download audio as mp3').lines[0].key,
      'assistant.howtoAudio'
    )
    assert.equal(
      answerQuestion(snap([]), 'why does fetching take so long').lines[0].key,
      'assistant.howtoFetch'
    )
    assert.equal(
      answerQuestion(snap([]), "why can't I download from Netflix").lines[0].key,
      'assistant.howtoDrm'
    )
    const folder = answerQuestion(snap([]), 'where is the download folder?')
    assert.equal(folder.lines[0].key, 'assistant.howtoFolder')
    assert.equal(folder.lines[0].params?.dir, 'C:\\DL')
    // A how-question with a download verb is a question, not a command
    // missing its link — the needLink reply must not hijack it.
    const howDl = answerQuestion(snap([]), 'how do I download a video?')
    assert.equal(howDl.intent, 'howto')
    assert.notEqual(howDl.lines[0].key, 'assistant.commandNeedLink')
    // The imperative still asks for the link.
    assert.equal(
      answerQuestion(snap([]), 'download this').lines[0].key,
      'assistant.commandNeedLink'
    )
  })

  it('howto / greeting / fallback intents', () => {
    assert.equal(
      answerQuestion(snap([]), 'how do I speed up downloads?').lines[0].key,
      'assistant.howtoSpeed'
    )
    assert.equal(answerQuestion(snap([]), 'hi').lines[0].key, 'assistant.greeting')
    assert.equal(answerQuestion(snap([]), 'blorp zibble').lines[0].key, 'assistant.fallback')
  })

  it('commands: download with link, control verbs, unmatched name, verb without link', () => {
    const cmd = answerQuestion(snap([]), 'download this https://example.com/film.mp4')
    assert.equal(cmd.intent, 'command')
    assert.deepEqual(cmd.action, { type: 'download', url: 'https://example.com/film.mp4' })
    const rows = [dl({ id: 'x1', title: 'Lecture video', filename: 'lecture.mp4' })]
    const pause = answerQuestion(snap(rows), 'pause the lecture video')
    assert.deepEqual(pause.action, { type: 'pause', id: 'x1', name: 'Lecture video' })
    const miss = answerQuestion(snap(rows), 'pause something else entirely')
    assert.equal(miss.lines[0].key, 'assistant.commandNotFound')
    assert.equal(miss.lines[0].params?.term, 'something else entirely')
    const needLink = answerQuestion(snap([]), 'download this')
    assert.equal(needLink.lines[0].key, 'assistant.commandNeedLink')
    // A question word vetoes the command — "why did it fail?" stays a question.
    const q = answerQuestion(snap(rows), 'why did it fail?')
    assert.equal(q.intent, 'failed')
    assert.equal(q.action, undefined)
  })

  it('buildModelPrompt: compact, no URLs/paths, counts + recent list', () => {
    const rows = [dl({ id: 'm1', title: 'Film', status: 'failed', errorCode: 'network' })]
    const p = buildModelPrompt(snap(rows), 'why did it fail?', 'en')
    assert.match(p, /1 failed/)
    assert.match(p, /Film \[failed\] \(error: network\)/)
    assert.doesNotMatch(p, /example\.com/)
    assert.doesNotMatch(p, /C:\\DL/)
    assert.match(p, /Question: why did it fail\?/)
    const empty = buildModelPrompt(snap([]), 'hi', 'bn')
    assert.match(empty, /\(none\)/)
    assert.match(empty, /in Bangla/)
  })
})
