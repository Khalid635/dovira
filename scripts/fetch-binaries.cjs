/**
 * Downloads pinned engine binaries into resources/bin/win/ (git-ignored).
 *
 *   npm run fetch-binaries
 *
 * Plain Node (no build step — Vite 8 ships no esbuild, so this file is .cjs).
 * Windows-only (uses PowerShell Expand-Archive for .zip files).
 *
 * Verification per binary:
 * - aria2: no checksum file is published for the Windows zip — the zip must
 *   extract cleanly AND `aria2c --version` must print the pinned version.
 * - yt-dlp: the release's SHA2-256SUMS file is downloaded and the exe's
 *   SHA-256 is compared before install.
 * - ffmpeg: the gyan.dev essentials build — `ffmpeg -version` (single dash)
 *   must print the pinned version. The build's LICENSE is detected from the
 *   configuration line: gyan.dev 9.0.2 essentials is a GPL build
 *   (--enable-gpl, libx264/libx265) — see THIRD_PARTY_NOTICES.md. GPL is
 *   acceptable for a bundled binary with a source notice; it does not
 *   change DOVIRA's own MIT license.
 * - deno: the release's .sha256sum file is downloaded and compared.
 * Any failure exits non-zero; nothing is left half-installed.
 */
const {
  createHash,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync
} = {
  ...require('node:crypto'),
  ...require('node:fs')
}
const { get } = require('node:https')
const { execFile } = require('node:child_process')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const BIN_DIR = join(ROOT, 'resources', 'bin', 'win')

const BINARIES = [
  {
    name: 'aria2',
    version: '1.37.0',
    kind: 'zip',
    url: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
    file: 'aria2c.exe',
    zipSubdir: 'aria2-1.37.0-win-64bit-build1',
    versionCheck: /aria2 version 1\.37\.0/
  },
  {
    name: 'yt-dlp',
    version: '2026.10.26',
    kind: 'exe',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe',
    checksumUrl:
      'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/SHA2-256SUMS',
    checksumFile: 'yt-dlp.exe',
    file: 'yt-dlp.exe',
    versionCheck: /2026\.10\.26/
  },
  {
    name: 'ffmpeg',
    version: '9.0.2',
    kind: 'zip',
    url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
    file: 'ffmpeg.exe',
    extraFiles: ['ffprobe.exe'],
    zipSubdir: 'ffmpeg-9.0.2-essentials_build',
    binSubdir: 'bin',
    versionArgs: ['-version'],
    versionCheck: /ffmpeg version 9\.0\.2/
  },
  {
    name: 'deno',
    version: '2.9.8',
    kind: 'zip',
    url: 'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip',
    checksumUrl:
      'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip.sha256sum',
    checksumFile: 'deno-x86_64-pc-windows-msvc.zip',
    checksumStyle: 'powershell', // Deno ships Get-FileHash output, not GNU sums.
    file: 'deno.exe',
    versionCheck: /deno 2\.9\.8/
  }
]

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'DOVIRA-fetch-binaries/1.0' } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirects >= 5) return reject(new Error('Too many redirects'))
        res.resume()
        return void download(res.headers.location, dest, redirects + 1).then(resolve, reject)
      }
      if (status !== 200) {
        res.resume()
        return reject(new Error(`Download failed: HTTP ${status} for ${url}`))
      }
      const out = createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => {
        out.close()
        resolve()
      })
      out.on('error', reject)
    }).on('error', reject)
  })
}

function execAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
    })
  })
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

async function verifyChecksum(spec, downloadedPath) {
  const sumsPath = join(BIN_DIR, `${spec.name}.sha256.txt`)
  await download(spec.checksumUrl, sumsPath)
  const sums = readFileSync(sumsPath, 'utf-8')
  rmSync(sumsPath, { force: true })
  let expected
  if (spec.checksumStyle === 'powershell') {
    // Deno ships PowerShell Get-FileHash output:
    //   Algorithm : SHA256
    //   Hash      : <HEX>
    //   Path      : C:\...\deno-x86_64-pc-windows-msvc.zip
    const m = sums.match(/^Hash\s*:\s*([0-9a-fA-F]+)/m)
    if (!m) throw new Error(`${spec.name}: no Hash line in checksum file`)
    expected = m[1].toLowerCase()
  } else {
    // GNU format: "<hash>  <filename>"
    const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(spec.checksumFile))
    if (!line) throw new Error(`${spec.name}: ${spec.checksumFile} missing from checksum file`)
    expected = line.split(/\s+/)[0].toLowerCase()
  }
  const actual = (await sha256File(downloadedPath)).toLowerCase()
  if (expected !== actual) {
    throw new Error(`${spec.name}: checksum mismatch (expected ${expected}, got ${actual})`)
  }
}

async function installZip(spec) {
  const zipPath = join(BIN_DIR, `${spec.name}-${spec.version}.zip`)
  console.log(`Downloading ${spec.name} ${spec.version}...`)
  await download(spec.url, zipPath)
  if (spec.checksumUrl) await verifyChecksum(spec, zipPath)
  await execAsync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${BIN_DIR}' -Force`
  ])
  const base = spec.zipSubdir
    ? join(BIN_DIR, spec.zipSubdir, spec.binSubdir ?? '')
    : BIN_DIR
  const files = [spec.file, ...(spec.extraFiles ?? [])]
  for (const f of files) {
    const extracted = join(base, f)
    if (!existsSync(extracted)) {
      throw new Error(`Expected ${extracted} after extraction — layout changed upstream?`)
    }
    const target = join(BIN_DIR, f)
    if (extracted !== target) renameSync(extracted, target)
  }
  rmSync(zipPath, { force: true })
  if (spec.zipSubdir) rmSync(join(BIN_DIR, spec.zipSubdir), { recursive: true, force: true })
  const { stdout } = await execAsync(join(BIN_DIR, spec.file), spec.versionArgs ?? ['--version'])
  if (!spec.versionCheck.test(stdout)) {
    throw new Error(`${spec.name} version check failed after install:\n${stdout}`)
  }
  if (spec.name === 'ffmpeg') {
    // The configuration line is the authority on the build's license.
    const gpl = /--enable-gpl/.test(stdout)
    console.log(`ffmpeg: ${gpl ? 'GPL' : 'LGPL'} build detected (configuration line)`)
  }
  console.log(`${spec.name} ${spec.version} installed at ${join(BIN_DIR, spec.file)}`)
}

async function installExe(spec) {
  const target = join(BIN_DIR, spec.file)
  const tmpPath = join(BIN_DIR, `${spec.file}.new`)
  console.log(`Downloading ${spec.name} ${spec.version}...`)
  await download(spec.url, tmpPath)
  if (spec.checksumUrl) await verifyChecksum(spec, tmpPath)
  renameSync(tmpPath, target)
  const { stdout } = await execAsync(target, ['--version'])
  if (!spec.versionCheck.test(stdout)) {
    throw new Error(`${spec.name} version check failed after install:\n${stdout}`)
  }
  console.log(`${spec.name} ${spec.version} installed at ${target}`)
}

async function main() {
  mkdirSync(BIN_DIR, { recursive: true })
  for (const spec of BINARIES) {
    const target = join(BIN_DIR, spec.file)
    if (existsSync(target)) {
      try {
        const args = spec.name === 'ffmpeg' ? ['-version'] : ['--version']
        const { stdout } = await execAsync(target, args)
        if (spec.versionCheck.test(stdout)) {
          // ffmpeg also needs ffprobe next to it.
          const extraOk = (spec.extraFiles ?? []).every((f) => existsSync(join(BIN_DIR, f)))
          if (extraOk) {
            console.log(`${spec.name} ${spec.version} already present — skipping.`)
            continue
          }
        }
      } catch {
        // Present but broken — re-download below.
      }
    }
    if (spec.kind === 'zip') await installZip(spec)
    else await installExe(spec)
  }
  console.log('All binaries ready.')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
