import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getExtensionDir, isLoadableExtensionDir } from '../src/main/util/paths.ts'

// The repo's extension manifest shape: background worker, content
// script, popup, options page — all at the folder root.
const MANIFEST = {
  manifest_version: 3,
  name: 'DOVIRA',
  version: '1.2.0',
  background: { service_worker: 'background.js' },
  content_scripts: [{ js: ['content.js'], matches: ['<all_urls>'] }],
  action: { default_popup: 'popup.html' },
  options_page: 'options.html'
}
const BUILT_FILES = [
  'background.js',
  'content.js',
  'lib.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js'
]

const tmpRoots: string[] = []
after(() => {
  for (const r of tmpRoots) rmSync(r, { recursive: true, force: true })
})

function makeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dovira-ext-'))
  tmpRoots.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(join(dir, name.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

function manifestDir(withFiles: string[]): string {
  const files: Record<string, string> = { 'manifest.json': JSON.stringify(MANIFEST) }
  for (const f of withFiles) files[f] = '// built'
  return makeDir(files)
}

describe('extension dir (load-path bug fix)', () => {
  it('a complete built dir is loadable', () => {
    const dir = manifestDir(BUILT_FILES)
    assert.equal(isLoadableExtensionDir(dir), true)
    assert.equal(existsSync(join(dir, 'manifest.json')), true)
  })

  it('the source-folder trap: manifest references files that do not exist -> not loadable', () => {
    // This is exactly the bug Khalid hit: extension/ has the manifest
    // but content.js / background.js / popup.html / options.html live
    // only in extension/dist/.
    const dir = manifestDir([])
    assert.equal(isLoadableExtensionDir(dir), false)
  })

  it('missing manifest -> not loadable', () => {
    assert.equal(isLoadableExtensionDir(makeDir({ 'content.js': '// built' })), false)
  })

  it('malformed manifest -> not loadable', () => {
    assert.equal(isLoadableExtensionDir(makeDir({ 'manifest.json': '{nope' })), false)
  })

  it('one missing referenced file -> not loadable', () => {
    const dir = manifestDir(BUILT_FILES.filter((f) => f !== 'options.html'))
    assert.equal(isLoadableExtensionDir(dir), false)
  })

  it('getExtensionDir returns the built dist folder', () => {
    const app = mkdtempSync(join(tmpdir(), 'dovira-app-'))
    tmpRoots.push(app)
    const dist = join(app, 'extension', 'dist')
    mkdirSync(dist, { recursive: true })
    for (const f of ['manifest.json', ...BUILT_FILES]) {
      writeFileSync(join(dist, f), f === 'manifest.json' ? JSON.stringify(MANIFEST) : '// built')
    }
    assert.equal(getExtensionDir(app, join(app, 'resources')), dist)
  })

  it('getExtensionDir never returns the source folder', () => {
    const app = mkdtempSync(join(tmpdir(), 'dovira-app-'))
    tmpRoots.push(app)
    // Source folder only: manifest present, built files absent.
    const src = join(app, 'extension')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'manifest.json'), JSON.stringify(MANIFEST))
    assert.equal(getExtensionDir(app, join(app, 'resources')), null)
  })

  it('getExtensionDir falls back to the installed resources copy', () => {
    const app = mkdtempSync(join(tmpdir(), 'dovira-app-'))
    const resources = mkdtempSync(join(tmpdir(), 'dovira-res-'))
    tmpRoots.push(app, resources)
    const ext = join(resources, 'extension')
    mkdirSync(ext, { recursive: true })
    for (const f of ['manifest.json', ...BUILT_FILES]) {
      writeFileSync(join(ext, f), f === 'manifest.json' ? JSON.stringify(MANIFEST) : '// built')
    }
    assert.equal(getExtensionDir(app, resources), ext)
  })
})
