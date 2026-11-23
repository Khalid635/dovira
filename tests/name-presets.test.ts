import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NAME_PRESETS,
  isNamePresetId,
  presetIdForTemplate,
  presetTemplate
} from '../src/main/smart/namePresets.ts'
import {
  NAME_PRESETS as RENDERER_PRESETS,
  presetIdForTemplate as rendererPresetIdForTemplate
} from '../src/renderer/src/util/namePresets.ts'

describe('Filename style presets (Cobalt-inspired)', () => {
  it('has the five presets with the expected templates', () => {
    assert.equal(presetTemplate('title-quality'), '{title} [{height}p]')
    assert.equal(presetTemplate('title'), '{title}')
    assert.equal(presetTemplate('title-uploader'), '{title} - {uploader}')
    assert.equal(presetTemplate('uploader-title-quality'), '{uploader} - {title} [{height}p]')
    assert.equal(presetTemplate('title-date'), '{title} ({date})')
  })

  it('round-trips: preset -> template -> preset', () => {
    for (const id of Object.keys(NAME_PRESETS) as (keyof typeof NAME_PRESETS)[]) {
      assert.equal(presetIdForTemplate(presetTemplate(id)), id)
    }
  })

  it('returns custom for a hand-edited template', () => {
    assert.equal(presetIdForTemplate('{title} - {date}'), 'custom')
    assert.equal(presetIdForTemplate(''), 'custom')
  })

  it('validates preset ids', () => {
    assert.equal(isNamePresetId('title'), true)
    assert.equal(isNamePresetId('custom'), true)
    assert.equal(isNamePresetId('nope'), false)
    assert.equal(isNamePresetId(null), false)
  })

  it('the renderer copy of the preset map matches the main one', () => {
    assert.deepEqual(RENDERER_PRESETS, NAME_PRESETS)
    assert.equal(
      rendererPresetIdForTemplate('{uploader} - {title} [{height}p]'),
      'uploader-title-quality'
    )
  })
})
