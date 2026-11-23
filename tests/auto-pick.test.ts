import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickHeight, pickSubtitles } from '../src/main/smart/autoPick.ts'
import {
  pickHeight as pickHeightRenderer,
  pickSubtitles as pickSubtitlesRenderer
} from '../src/renderer/src/util/autoPick.ts'

describe('auto-pick (next-level)', () => {
  it('pickHeight: highest available at or below the cap', () => {
    assert.equal(pickHeight([2160, 1080, 720, 480], 1080), 1080)
    assert.equal(pickHeight([2160, 1080, 720], 720), 720)
    assert.equal(pickHeight([1080, 720], 2160), 1080)
  })

  it('pickHeight: all above the cap -> lowest available', () => {
    assert.equal(pickHeight([2160, 1440], 1080), 1440)
  })

  it('pickHeight: no heights -> null (audio-only)', () => {
    assert.equal(pickHeight([], 1080), null)
    assert.equal(pickHeight([0, -1], 1080), null)
  })

  it('pickSubtitles: preferred manual language first', () => {
    assert.deepEqual(pickSubtitles(['bn', 'en'], ['en'], 'bn', true), {
      lang: 'bn',
      autoSubs: false
    })
  })

  it('pickSubtitles: English next when the preferred language is missing', () => {
    assert.deepEqual(pickSubtitles(['en', 'fr'], [], 'bn', true), {
      lang: 'en',
      autoSubs: false
    })
  })

  it('pickSubtitles: first manual subtitle when neither is there', () => {
    assert.deepEqual(pickSubtitles(['fr', 'de'], [], 'bn', true), {
      lang: 'fr',
      autoSubs: false
    })
  })

  it('pickSubtitles: auto-captions as a fallback, flagged autoSubs', () => {
    assert.deepEqual(pickSubtitles([], ['bn', 'en'], 'bn', true), {
      lang: 'bn',
      autoSubs: true
    })
    assert.deepEqual(pickSubtitles([], ['en'], 'bn', true), { lang: 'en', autoSubs: true })
  })

  it('pickSubtitles: setting off -> null', () => {
    assert.equal(pickSubtitles(['bn', 'en'], ['en'], 'bn', false), null)
  })

  it('pickSubtitles: nothing available -> null', () => {
    assert.equal(pickSubtitles([], [], 'bn', true), null)
  })

  it('renderer mirror matches the main-process pickers', () => {
    const cases: { heights: number[]; cap: number }[] = [
      { heights: [2160, 1080, 720], cap: 1080 },
      { heights: [2160], cap: 720 },
      { heights: [], cap: 1080 }
    ]
    for (const c of cases) {
      assert.equal(pickHeightRenderer(c.heights, c.cap), pickHeight(c.heights, c.cap))
    }
    assert.deepEqual(
      pickSubtitlesRenderer(['bn', 'en'], ['en'], 'bn', true),
      pickSubtitles(['bn', 'en'], ['en'], 'bn', true)
    )
    assert.deepEqual(
      pickSubtitlesRenderer([], ['en'], 'bn', true),
      pickSubtitles([], ['en'], 'bn', true)
    )
  })
})
