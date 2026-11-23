import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  extOf,
  classifyKind,
  extractLinks,
  dedupeItems,
  scanPage
} from '../src/main/grabber.ts'
import type { GrabberItem } from '../src/main/types.ts'

function headers(map: Record<string, string>): { get: (k: string) => string | null } {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v
  return { get: (k: string) => lower[k.toLowerCase()] ?? null }
}

type GetRes = {
  ok: boolean
  status: number
  url: string
  headers: { get: (k: string) => string | null }
  text: () => Promise<string>
}

type HeadRes = {
  ok: boolean
  url: string
  headers: { get: (k: string) => string | null }
}

describe('grabber pure helpers', () => {
  it('extOf: path extension, lowercase, empty when none', () => {
    assert.equal(extOf('https://x.example/a/Big.MP4?x=1'), 'mp4')
    assert.equal(extOf('https://x.example/a/noext'), '')
    assert.equal(extOf('https://x.example/a/file.'), '')
    assert.equal(extOf('not a url'), '')
  })

  it('classifyKind by extension', () => {
    assert.equal(classifyKind('https://x.example/a.mp4'), 'video')
    assert.equal(classifyKind('https://x.example/a.mp3'), 'audio')
    assert.equal(classifyKind('https://x.example/a.pdf'), 'document')
    assert.equal(classifyKind('https://x.example/a.zip'), 'archive')
    assert.equal(classifyKind('https://x.example/a.png'), 'image')
    assert.equal(classifyKind('https://x.example/a.html'), null)
    assert.equal(classifyKind('https://x.example/a'), null)
  })

  it('extractLinks: a/img/video/source + srcset, resolves relative, skips junk', () => {
    const html = `
      <a href="/files/report.pdf">pdf</a>
      <a href='https://cdn.example/v.mp4'>video</a>
      <a href="data:text/plain,hi">data</a>
      <a href="javascript:void(0)">js</a>
      <a href="mailto:a@b.c">mail</a>
      <a href="#frag">frag</a>
      <img src="pic.jpg" srcset="pic-2x.jpg 2x, pic-1x.jpg 1x">
      <video src="clip.webm"></video>
      <source src="audio.ogg">
      <a href="https://x.example/page">page</a>
    `
    const links = extractLinks(html, 'https://x.example/dir/page.html')
    assert.deepEqual(links, [
      'https://x.example/files/report.pdf',
      'https://cdn.example/v.mp4',
      'https://x.example/dir/pic.jpg',
      'https://x.example/dir/clip.webm',
      'https://x.example/dir/audio.ogg',
      'https://x.example/page',
      'https://x.example/dir/pic-2x.jpg',
      'https://x.example/dir/pic-1x.jpg'
    ])
  })

  it('dedupeItems: first wins, case-insensitive URL', () => {
    const items: GrabberItem[] = [
      { url: 'https://x.example/A.mp4', filename: 'A.mp4', ext: 'mp4', kind: 'video', sizeBytes: null },
      { url: 'https://x.example/a.mp4', filename: 'a.mp4', ext: 'mp4', kind: 'video', sizeBytes: null },
      { url: 'https://x.example/b.mp4', filename: 'b.mp4', ext: 'mp4', kind: 'video', sizeBytes: null }
    ]
    assert.deepEqual(dedupeItems(items).map((i) => i.url), [
      'https://x.example/A.mp4',
      'https://x.example/b.mp4'
    ])
  })
})

describe('grabber scanPage (fetch stubbed)', () => {
  let origFetch: typeof fetch
  let getHtml: string
  let getStatus: number
  let getContentType: string
  let getContentLength: string | null
  let headByUrl: Record<string, { size: number | null; contentType: string | null; ok: boolean }>
  let getThrows: Error | null

  function installFetch(): void {
    globalThis.fetch = (async (url: string, init?: { method?: string }) => {
      if (init?.method === 'HEAD') {
        const h = headByUrl[url]
        if (!h) return { ok: false, url, headers: headers({}) } as unknown as HeadRes
        return {
          ok: h.ok,
          url,
          headers: headers({
            ...(h.size !== null ? { 'content-length': String(h.size) } : {}),
            ...(h.contentType ? { 'content-type': h.contentType } : {})
          })
        } as unknown as HeadRes
      }
      if (getThrows) throw getThrows
      return {
        ok: getStatus >= 200 && getStatus < 300,
        status: getStatus,
        url,
        headers: headers({
          ...(getContentType ? { 'content-type': getContentType } : {}),
          ...(getContentLength ? { 'content-length': getContentLength } : {})
        }),
        text: async () => getHtml
      } as unknown as GetRes
    }) as typeof fetch
  }

  beforeEach(() => {
    origFetch = globalThis.fetch
    getHtml = ''
    getStatus = 200
    getContentType = 'text/html; charset=utf-8'
    getContentLength = null
    headByUrl = {}
    getThrows = null
    installFetch()
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('invalid URL / non-http(s) -> invalid-url', async () => {
    assert.equal((await scanPage('not a url')).error, 'invalid-url')
    assert.equal((await scanPage('ftp://x.example/f.zip')).error, 'invalid-url')
  })

  it('fetch throw: timeout message -> network, other -> unknown', async () => {
    getThrows = new Error('request timed out')
    assert.equal((await scanPage('https://x.example/p')).error, 'network')
    getThrows = new Error('boom')
    assert.equal((await scanPage('https://x.example/p')).error, 'unknown')
  })

  it('status mapping: 401 forbidden, 404 not-found, 500 network, non-html, too-large', async () => {
    getStatus = 401
    assert.equal((await scanPage('https://x.example/p')).error, 'forbidden')
    getStatus = 404
    assert.equal((await scanPage('https://x.example/p')).error, 'not-found')
    getStatus = 500
    assert.equal((await scanPage('https://x.example/p')).error, 'network')
    getStatus = 200
    getContentType = 'application/json'
    assert.equal((await scanPage('https://x.example/p')).error, 'not-html')
    getContentType = 'text/html'
    getContentLength = String(6 * 1024 * 1024)
    assert.equal((await scanPage('https://x.example/p')).error, 'page-too-large')
  })

  it('happy path: title, known-extension items with HEAD sizes, unknown links via content-type', async () => {
    getHtml = `<html><head><title>  My  Page </title></head><body>
      <a href="film.mp4">film</a>
      <a href="https://cdn.example/doc.pdf">doc</a>
      <a href="https://x.example/download?id=7">dl</a>
      <a href="https://x.example/pic.png">pic</a>
      <a href="film.mp4">dup</a>
    </body></html>`
    headByUrl = {
      'https://x.example/dir/film.mp4': { size: 12345, contentType: 'video/mp4', ok: true },
      'https://cdn.example/doc.pdf': { size: 999, contentType: 'application/pdf', ok: true },
      'https://x.example/download?id=7': { size: 777, contentType: 'application/zip', ok: true },
      'https://x.example/pic.png': { size: null, contentType: 'image/png', ok: true }
    }
    const r = await scanPage('https://x.example/dir/page.html')
    assert.equal(r.ok, true)
    assert.equal(r.title, 'My Page')
    assert.equal(r.items.length, 4)
    const byUrl = new Map(r.items.map((i) => [i.url, i]))
    assert.equal(byUrl.get('https://x.example/dir/film.mp4')?.sizeBytes, 12345)
    assert.equal(byUrl.get('https://x.example/dir/film.mp4')?.kind, 'video')
    assert.equal(byUrl.get('https://cdn.example/doc.pdf')?.kind, 'document')
    assert.equal(byUrl.get('https://x.example/download?id=7')?.kind, 'archive')
    assert.equal(byUrl.get('https://x.example/download?id=7')?.sizeBytes, 777)
    assert.equal(byUrl.get('https://x.example/pic.png')?.sizeBytes, null)
  })

  it('unknown link with no usable HEAD is dropped; HTML body over 5MB -> page-too-large', async () => {
    getHtml = `<a href="https://x.example/mystery">m</a>`
    headByUrl = { 'https://x.example/mystery': { size: null, contentType: null, ok: true } }
    const r = await scanPage('https://x.example/p')
    assert.equal(r.ok, true)
    assert.equal(r.items.length, 0)
    getHtml = 'x'.repeat(5 * 1024 * 1024 + 1)
    assert.equal((await scanPage('https://x.example/p')).error, 'page-too-large')
  })

  it('caps at 200 items', async () => {
    const links = Array.from({ length: 250 }, (_, i) => `<a href="f${i}.mp4">x</a>`).join('')
    getHtml = links
    const r = await scanPage('https://x.example/p')
    assert.equal(r.items.length, 200)
  })
})
