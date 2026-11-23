import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidExtensionOptionsUrl } from '../src/main/util/extensionOptions.ts'

test('extension options URL: chrome + firefox options pages are valid', () => {
  assert.equal(
    isValidExtensionOptionsUrl('chrome-extension://pghibcmjdgijggaomobijgdamabdpken/options.html'),
    true
  )
  assert.equal(
    isValidExtensionOptionsUrl('moz-extension://dovira@khalid635.github.io/options.html'),
    true
  )
  // A query string (e.g. ?token=…) is ignored for the check.
  assert.equal(
    isValidExtensionOptionsUrl(
      'chrome-extension://pghibcmjdgijggaomobijgdamabdpken/options.html?token=abc123'
    ),
    true
  )
})

test('extension options URL: websites and wrong pages are rejected', () => {
  assert.equal(isValidExtensionOptionsUrl('https://example.com/options.html'), false)
  assert.equal(isValidExtensionOptionsUrl('http://127.0.0.1:17530/options.html'), false)
  assert.equal(
    isValidExtensionOptionsUrl('chrome-extension://pghibcmjdgijggaomobijgdamabdpken/popup.html'),
    false
  )
  assert.equal(
    isValidExtensionOptionsUrl(
      'chrome-extension://pghibcmjdgijggaomobijgdamabdpken/options.html.evil'
    ),
    false
  )
  assert.equal(isValidExtensionOptionsUrl(''), false)
  assert.equal(
    isValidExtensionOptionsUrl(`chrome-extension://x/${'a'.repeat(600)}/options.html`),
    false
  )
})
