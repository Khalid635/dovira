import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const en = JSON.parse(
  readFileSync(join(here, '../src/renderer/src/i18n/en.json'), 'utf-8')
) as Record<string, string>
const bn = JSON.parse(
  readFileSync(join(here, '../src/renderer/src/i18n/bn.json'), 'utf-8')
) as Record<string, string>

describe('i18n key sets (en + bn must match exactly)', () => {
  it('has identical key sets', () => {
    assert.deepEqual(Object.keys(bn).sort(), Object.keys(en).sort())
  })

  it('has the Cobalt-features keys in both languages', () => {
    const keys = [
      'quickPaste.pasteDownload',
      'quickPaste.invalid',
      'quickPaste.noClipboard',
      'dialog.mediaItems',
      'dialog.mediaItemsHint',
      'settings.namePreset',
      'settings.namePresetHint',
      'settings.namePresetTitle',
      'settings.namePresetTitleQuality',
      'settings.namePresetTitleUploader',
      'settings.namePresetUploaderTitleQuality',
      'settings.namePresetTitleDate',
      'settings.namePresetCustom',
      'extension.apiDocs',
      'extension.apiDocsHint'
    ]
    for (const key of keys) {
      assert.ok(key in en, `missing en key ${key}`)
      assert.ok(key in bn, `missing bn key ${key}`)
      assert.ok(en[key].length > 0 && bn[key].length > 0)
    }
  })

  it('keeps the {n} placeholder in the media-items hint in both languages', () => {
    assert.ok(en['dialog.mediaItemsHint'].includes('{n}'))
    assert.ok(bn['dialog.mediaItemsHint'].includes('{n}'))
  })
})
