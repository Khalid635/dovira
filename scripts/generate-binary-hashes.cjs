/**
 * Regenerates src/main/binary-hashes.json from the binaries in
 * resources/bin/<platform>/ — the known-good SHA-256 manifest the app
 * verifies its engine binaries against at startup.
 *
 *   npm run generate-hashes                  # host platform
 *   npm run generate-hashes -- --platform mac
 *
 * Re-run after bumping a pinned binary in scripts/fetch-binaries.cjs, or
 * the startup check will warn that the new binary is unexpected. Only
 * hashes the files that exist — a platform with no local binaries (e.g.
 * macOS aria2, which is built from source) simply contributes nothing,
 * and those engines report "unknown" instead of failing the check.
 * The yt-dlp hash must match the release's published SHA2-256SUMS; the
 * script prints the file list so that can be eyeballed.
 */
const { createHash, createReadStream } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const platformArg = process.argv.indexOf('--platform')
const PLATFORM =
  platformArg >= 0 && process.argv[platformArg + 1]
    ? process.argv[platformArg + 1]
    : process.platform === 'darwin'
      ? 'mac'
      : process.platform === 'linux'
        ? 'linux'
        : 'win'
if (!['win', 'mac', 'linux'].includes(PLATFORM)) {
  console.error(`Unknown platform: ${PLATFORM} (expected win, mac or linux)`)
  process.exit(1)
}

const ENGINE_FILES = {
  win: {
    aria2: 'aria2c.exe',
    'yt-dlp': 'yt-dlp.exe',
    ffmpeg: 'ffmpeg.exe',
    deno: 'deno.exe'
  },
  mac: { 'yt-dlp': 'yt-dlp_macos', ffmpeg: 'ffmpeg', deno: 'deno' },
  linux: { 'yt-dlp': 'yt-dlp_linux', ffmpeg: 'ffmpeg', deno: 'deno' }
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function main() {
  const binDir = join(ROOT, 'resources', 'bin', PLATFORM)
  const manifestPath = join(ROOT, 'src', 'main', 'binary-hashes.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : {}
  const files = ENGINE_FILES[PLATFORM]
  const next = {}
  for (const [name, file] of Object.entries(files)) {
    const full = join(binDir, file)
    if (!existsSync(full)) {
      console.log(`skip ${name}: ${file} not found in resources/bin/${PLATFORM}`)
      continue
    }
    next[name] = await sha256File(full)
    console.log(`${name}: ${file} -> ${next[name]}`)
  }
  if (Object.keys(next).length === 0) {
    console.error(`No binaries found in ${binDir} — run "npm run fetch-binaries" first.`)
    process.exit(1)
  }
  manifest[PLATFORM] = next
  mkdirSync(join(ROOT, 'src', 'main'), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  console.log(`Wrote ${PLATFORM} hashes to src/main/binary-hashes.json`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
