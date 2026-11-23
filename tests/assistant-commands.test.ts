import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectCommand,
  extractUrls,
  hasCommandToken,
  hasDownloadVerb,
  matchDownloadByName,
  normalizeCommand
} from '../src/main/smart/assistantCommands.ts'
import type { DownloadInfo } from '../src/main/types.ts'

function dl(id: string, title: string, filename: string): DownloadInfo {
  return { id, title, filename } as unknown as DownloadInfo
}

const DOWNLOADS = [
  dl('1', 'Big Buck Bunny', 'big-buck-bunny.mp4'),
  dl('2', 'Lecture 1 — Intro', 'lecture-1.mp4'),
  dl('3', 'Lecture 2 — Loops', 'lecture-2.mp4')
]

describe('assistant commands (next-level)', () => {
  it('Bangla download command with a URL starts a download', () => {
    const r = detectCommand('এইটা ডাউনলোড করো https://example.com/v.mp4', [])
    assert.deepEqual(r, {
      command: { type: 'download', url: 'https://example.com/v.mp4' },
      unmatchedTerm: null
    })
  })

  it('English "download this" with a URL starts a download', () => {
    const r = detectCommand('download this https://example.com/v.mp4 please', [])
    assert.equal(r.command?.type, 'download')
    assert.equal((r.command as { url: string }).url, 'https://example.com/v.mp4')
  })

  it('a bare pasted URL is NOT a command', () => {
    const r = detectCommand('https://example.com/v.mp4', [])
    assert.equal(r.command, null)
    assert.equal(r.unmatchedTerm, null)
  })

  it('a download verb with no link is not a command either', () => {
    const r = detectCommand('download this', [])
    assert.equal(r.command, null)
    assert.equal(hasDownloadVerb(normalizeCommand('download this')), true)
  })

  it('question veto: "why did the download fail?" stays a question', () => {
    const r = detectCommand('why did the download fail for https://example.com/v.mp4?', DOWNLOADS)
    assert.equal(r.command, null)
    assert.equal(r.unmatchedTerm, null)
  })

  it('question veto: Bangla "কেন" also vetoes', () => {
    const r = detectCommand('কেন ডাউনলোড হচ্ছে না https://example.com/v.mp4?', DOWNLOADS)
    assert.equal(r.command, null)
    assert.equal(r.unmatchedTerm, null)
  })

  it('"how do I pause a download?" is a question, not a pause command', () => {
    const r = detectCommand('how do I pause a download?', DOWNLOADS)
    assert.equal(r.command, null)
    assert.equal(r.unmatchedTerm, null)
  })

  it('pause by name matches exactly one download', () => {
    const r = detectCommand('pause Big Buck Bunny', DOWNLOADS)
    assert.deepEqual(r.command, { type: 'pause', id: '1', name: 'Big Buck Bunny' })
  })

  it('Bangla pause verb works too', () => {
    const r = detectCommand('Big Buck Bunny থামাও', DOWNLOADS)
    assert.deepEqual(r.command, { type: 'pause', id: '1', name: 'Big Buck Bunny' })
  })

  it('an ambiguous name reports the term instead of guessing', () => {
    const r = detectCommand('pause lecture', DOWNLOADS)
    assert.equal(r.command, null)
    assert.equal(r.unmatchedTerm, 'lecture')
  })

  it('an unknown name reports the term', () => {
    const r = detectCommand('resume something else entirely', DOWNLOADS)
    assert.equal(r.command, null)
    assert.equal(r.unmatchedTerm, 'something else entirely')
  })

  it('"download next" moves the download to the top', () => {
    const r = detectCommand('download next Lecture 1', DOWNLOADS)
    assert.deepEqual(r.command, { type: 'moveToTop', id: '2', name: 'Lecture 1 — Intro' })
  })

  it('extractUrls strips trailing punctuation', () => {
    assert.deepEqual(extractUrls('see https://example.com/v.mp4, ok?'), [
      'https://example.com/v.mp4'
    ])
  })

  it('hasCommandToken is false for a plain question', () => {
    assert.equal(hasCommandToken(normalizeCommand('what is downloading?')), false)
    assert.equal(matchDownloadByName('', DOWNLOADS), null)
  })
})
