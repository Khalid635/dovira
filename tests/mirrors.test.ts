import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AdaptiveNet } from '../src/main/smart/adaptive.ts'
import { mirrorUris } from '../src/main/engines/aria2.ts'

const MB = 1024 * 1024

describe('aria2 mirrors (next-level)', () => {
  it('main URL first, mirrors after', () => {
    assert.deepEqual(mirrorUris('https://a.example/f.zip', ['https://b.example/f.zip']), [
      'https://a.example/f.zip',
      'https://b.example/f.zip'
    ])
  })

  it('de-dupes and drops non-http(s) mirrors', () => {
    assert.deepEqual(
      mirrorUris('https://a.example/f.zip', [
        'https://a.example/f.zip',
        'ftp://a.example/f.zip',
        'not a url',
        'https://b.example/f.zip'
      ]),
      ['https://a.example/f.zip', 'https://b.example/f.zip']
    )
  })

  it('caps at main + 5 mirrors', () => {
    const mirrors = Array.from({ length: 8 }, (_, i) => `https://m${i}.example/f.zip`)
    assert.equal(mirrorUris('https://a.example/f.zip', mirrors).length, 6)
  })

  it('no mirrors -> just the main URL', () => {
    assert.deepEqual(mirrorUris('https://a.example/f.zip', []), ['https://a.example/f.zip'])
  })
})

describe('adaptive connections (next-level)', () => {
  function netWith(samples: number[], failures = 0): AdaptiveNet {
    const net = new AdaptiveNet()
    for (const s of samples) net.sample(s)
    for (let i = 0; i < failures; i++) net.noteFailure()
    return net
  }

  it('fast (mean > 5 MB/s) -> 16 connections (aria2 caps -x/-s at 16)', () => {
    assert.equal(netWith(Array(10).fill(10 * MB)).connections(), 16)
  })

  it('medium (1–5 MB/s, or no samples yet) -> 16 connections', () => {
    assert.equal(netWith(Array(10).fill(3 * MB)).connections(), 16)
    assert.equal(new AdaptiveNet().connections(), 16)
  })

  it('slow (< 1 MB/s) -> 8 connections', () => {
    assert.equal(netWith(Array(10).fill(0.5 * MB)).connections(), 8)
  })

  it('unstable (2+ failures in 5 min) -> 4 connections', () => {
    assert.equal(netWith(Array(10).fill(10 * MB), 2).connections(), 4)
  })
})
