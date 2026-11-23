import { describe, it, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  discardExtensionRequest,
  discardPendingExtensionRequest,
  peekAnyExtensionRequest,
  peekExtensionRequest,
  setExtensionRequest,
  takeExtensionRequest
} from '../src/main/extensionRequests.ts'
import type { ExtensionDownloadRequest } from '../src/main/extensionRequests.ts'
import { cookiesFileHash, FetchInfoCache } from '../src/main/util/fetchInfoCache.ts'

// Dialog-first extension handoff (2026-11-24): the Local API stores an
// extension send instead of awaiting yt-dlp extraction inline (~7–11 s
// blocked the extension POST). The renderer opens the Add dialog at
// once; the IPC handlers take the request when the user confirms.
const tmpRoot = mkdtempSync(join(tmpdir(), 'dovira-ext-handoff-'))
after(() => rmSync(tmpRoot, { recursive: true, force: true }))
afterEach(() => discardPendingExtensionRequest())

function cookiesFile(name: string, content: string): string {
  const file = join(tmpRoot, name)
  writeFileSync(file, content, 'utf-8')
  return file
}

function request(url: string, cookiesFilePath: string | null): ExtensionDownloadRequest {
  return {
    url,
    cookiesFile: cookiesFilePath,
    userAgent: 'Mozilla/5.0',
    referer: 'https://www.youtube.com/',
    headers: ['User-Agent: Mozilla/5.0'],
    mirrors: []
  }
}

const URL = 'https://www.youtube.com/watch?v=A46yjvbtrVU'

describe('pending extension request (dialog-first handoff)', () => {
  it('peek returns the request for its URL, null for any other URL', () => {
    setExtensionRequest(request(URL, null))
    assert.equal(peekExtensionRequest(URL)?.url, URL)
    assert.equal(peekExtensionRequest('https://www.youtube.com/watch?v=other'), null)
    assert.equal(peekAnyExtensionRequest()?.url, URL)
  })

  it('take consumes the request but keeps the temp cookies file (the queue owns it)', () => {
    const file = cookiesFile('take.txt', '# Netscape HTTP Cookie File\n')
    setExtensionRequest(request(URL, file))
    const taken = takeExtensionRequest(URL)
    assert.equal(taken?.url, URL)
    assert.equal(taken?.cookiesFile, file)
    assert.equal(takeExtensionRequest(URL), null)
    assert.equal(peekAnyExtensionRequest(), null)
    assert.equal(existsSync(file), true)
  })

  it('take with a non-matching URL is a no-op', () => {
    const file = cookiesFile('take-miss.txt', 'cookies')
    setExtensionRequest(request(URL, file))
    assert.equal(takeExtensionRequest('https://example.com/other'), null)
    assert.equal(peekExtensionRequest(URL)?.url, URL)
    assert.equal(existsSync(file), true)
  })

  it('discard clears the slot AND deletes the temp cookies file (no download started)', () => {
    const file = cookiesFile('discard.txt', 'cookies')
    setExtensionRequest(request(URL, file))
    discardExtensionRequest(URL)
    assert.equal(peekAnyExtensionRequest(), null)
    assert.equal(existsSync(file), false)
  })

  it('discard with a non-matching URL is a no-op', () => {
    const file = cookiesFile('discard-miss.txt', 'cookies')
    setExtensionRequest(request(URL, file))
    discardExtensionRequest('https://example.com/other')
    assert.equal(peekExtensionRequest(URL)?.url, URL)
    assert.equal(existsSync(file), true)
  })

  it('a second send replaces the first and deletes its temp cookies file', () => {
    const first = cookiesFile('first.txt', 'cookies-one')
    const second = cookiesFile('second.txt', 'cookies-two')
    setExtensionRequest(request(URL, first))
    setExtensionRequest(request('https://www.youtube.com/watch?v=other', second))
    assert.equal(peekExtensionRequest(URL), null)
    assert.equal(peekAnyExtensionRequest()?.cookiesFile, second)
    assert.equal(existsSync(first), false)
    assert.equal(existsSync(second), true)
  })

  it('discardPending clears whatever is pending and deletes its temp file', () => {
    const file = cookiesFile('shutdown.txt', 'cookies')
    setExtensionRequest(request(URL, file))
    discardPendingExtensionRequest()
    assert.equal(peekAnyExtensionRequest(), null)
    assert.equal(existsSync(file), false)
  })
})

describe('cookies content-hash cache key (fetchInfo cache bug)', () => {
  it('cookiesFileHash: same content, different files -> same hash', () => {
    const a = cookiesFile(
      'hash-a.txt',
      '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n'
    )
    const b = cookiesFile(
      'hash-b.txt',
      '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n'
    )
    assert.equal(cookiesFileHash(a), cookiesFileHash(b))
    assert.equal(typeof cookiesFileHash(a), 'string')
  })

  it('cookiesFileHash: different content -> different hash; missing file -> null', () => {
    const a = cookiesFile('hash-c.txt', 'one')
    const b = cookiesFile('hash-d.txt', 'two')
    assert.notEqual(cookiesFileHash(a), cookiesFileHash(b))
    assert.equal(cookiesFileHash(join(tmpRoot, 'no-such-file.txt')), null)
    assert.equal(cookiesFileHash(null), null)
    assert.equal(cookiesFileHash(undefined), null)
  })

  it('cache key: same URL + same cookies content in different temp files -> SAME key', () => {
    // Regression test: the Local API writes a fresh random-named temp
    // cookies file per send, so keying on the path made the 5-min cache
    // never hit for extension sends (two ~10 s fetches 17 s apart).
    const content = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n'
    const a = cookiesFile('key-a.txt', content)
    const b = cookiesFile('key-b.txt', content)
    const keyA = FetchInfoCache.key(URL, {
      cookiesHash: cookiesFileHash(a),
      userAgent: 'Mozilla/5.0',
      referer: 'https://www.youtube.com/'
    })
    const keyB = FetchInfoCache.key(URL, {
      cookiesHash: cookiesFileHash(b),
      userAgent: 'Mozilla/5.0',
      referer: 'https://www.youtube.com/'
    })
    assert.equal(keyA, keyB)
  })

  it('cache key: different cookies content -> different key', () => {
    const a = cookiesFile('key-c.txt', 'cookies-one')
    const b = cookiesFile('key-d.txt', 'cookies-two')
    const keyA = FetchInfoCache.key(URL, { cookiesHash: cookiesFileHash(a) })
    const keyB = FetchInfoCache.key(URL, { cookiesHash: cookiesFileHash(b) })
    assert.notEqual(keyA, keyB)
  })
})
