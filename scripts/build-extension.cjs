// Phase 5: build the browser extension — TypeScript -> extension/dist
// plus the static files (manifest, HTML, icons) next to the output.
// Run via `npm run build:extension` (also part of `npm run build`, so
// every installer ships the built extension). Exits non-zero on failure.
const { spawnSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const extDir = join(root, 'extension')
const distDir = join(extDir, 'dist')

function fail(msg) {
  console.error(`[build-extension] ${msg}`)
  process.exit(1)
}

// 1. TypeScript -> extension/dist (background.js, content.js, popup.js,
// options.js, lib.js). The extension has its own tsconfig; the app's
// typecheck does not cover it. Invoke the local tsc directly (no shell,
// no npx) to avoid shell-escaping pitfalls on Windows.
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const tsc = spawnSync(process.execPath, [tscBin, '-p', join(extDir, 'tsconfig.json')], {
  cwd: root,
  stdio: 'inherit'
})
if (tsc.status !== 0) fail('tsc failed')

// 2. Static files.
mkdirSync(distDir, { recursive: true })
cpSync(join(extDir, 'manifest.json'), join(distDir, 'manifest.json'))
for (const file of ['popup.html', 'options.html']) {
  cpSync(join(extDir, 'src', file), join(distDir, file))
}
mkdirSync(join(distDir, 'icons'), { recursive: true })
const iconSrc = join(extDir, 'icons', 'icon.png')
if (!existsSync(iconSrc)) fail('extension/icons/icon.png is missing')
cpSync(iconSrc, join(distDir, 'icons', 'icon.png'))

// 3. Sanity: manifest parses, its version matches package.json, and
// every expected output exists.
const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf-8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
if (manifest.version !== pkg.version) {
  fail(`manifest version ${manifest.version} != package.json version ${pkg.version}`)
}
for (const f of ['background.js', 'content.js', 'popup.js', 'options.js', 'lib.js']) {
  if (!existsSync(join(distDir, f))) fail(`missing output: ${f}`)
}
console.log(`[build-extension] OK — extension/dist ready (v${manifest.version})`)
