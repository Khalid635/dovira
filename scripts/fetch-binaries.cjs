/**
 * Downloads pinned engine binaries into resources/bin/<platform>/ (git-ignored).
 *
 *   npm run fetch-binaries                  # host platform
 *   npm run fetch-binaries -- --platform mac
 *   npm run fetch-binaries -- --platform linux
 *
 * Plain Node (no build step - Vite 8 ships no esbuild, so this file is .cjs).
 * Windows uses PowerShell Expand-Archive for .zip files; macOS/Linux use
 * `unzip` (zip) and `tar -xJf` (tar.xz), then chmod +x the binaries.
 *
 * Extraction is layout-tolerant: each archive is extracted into a temp
 * dir and the wanted files are found by RECURSIVE search (the documented
 * zipSubdir/binSubdir is only a hint). Upstream archives change their top
 * folder from time to time - the old code hardcoded one layout and died
 * on exactly that (CI run 44979642131). When a file is not found, the
 * error lists the whole extracted tree so the cause is visible in CI.
 *
 * Downloads have a 120s stall timeout - a stalled connection used to hang
 * the script forever (gyan.dev stalled at 2.4 MB on the laptop, 2026-11-22).
 *
 * Windows empty-extraction (CI run 44984348473): the aria2 zip
 * downloaded fine (HTTP 200, non-empty) yet Expand-Archive exited 0
 * with an EMPTY tree. installZip now logs the zip size + magic bytes,
 * counts the extracted tree, and retries an empty tree with `tar -xf`
 * (ships on Windows Server 2025) before failing with all three numbers
 * in the message, so the next diagnosis needs no guessing.
 *
 * Verification per binary:
 * - aria2 (Windows only): no checksum file is published for the Windows
 *   zip - the zip must extract cleanly AND `aria2c --version` must print
 *   the pinned version. macOS/Linux have NO prebuilt aria2 binary at all
 *   (aria2 1.37.0 publishes win zips + source only) - build it from
 *   source with `bash scripts/build-aria2.sh <mac|linux>`; the app falls
 *   back to yt-dlp for plain files when aria2 is absent.
 * - yt-dlp: the release's SHA2-256SUMS file is downloaded and the
 *   binary's SHA-256 is compared before install (all three platforms).
 * - ffmpeg: `ffmpeg -version` (single dash) must print the pinned
 *   version. The build's LICENSE is detected from the configuration line:
 *   gyan.dev 9.0.2 essentials (Windows), evermeet 9.1 (macOS) and BtbN
 *   n9.0 (Linux) are all GPL builds (--enable-gpl, libx264/libx265) -
 *   see THIRD_PARTY_NOTICES.md. GPL is acceptable for a bundled binary
 *   with a source notice; it does not change DOVIRA's own MIT license.
 *   Neither evermeet nor BtbN publishes a checksum file for these
 *   assets, so the version check + GPL detection is the verification.
 *   evermeet ships ffmpeg and ffprobe as SEPARATE single-binary zips
 *   (ffmpeg-9.1.zip has no ffprobe inside - CI run 44979642131 failed
 *   on exactly that), so macOS fetches ffprobe as its own entry.
 *   BtbN prints `ffmpeg version n9.0.2-...` (an 'n' prefix + rolling
 *   build suffix), so the Linux version check allows that prefix.
 * - deno: the release's .sha256sum file is downloaded and compared.
 *   Deno ships PowerShell Get-FileHash output on Windows and GNU/BSD
 *   sums elsewhere - all three styles are parsed.
 * Any failure exits non-zero; nothing is left half-installed.
 */
const {
  createHash,
  createReadStream,
  createWriteStream,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync
} = {
  ...require('node:crypto'),
  ...require('node:fs')
}
const { get } = require('node:https')
const { execFile } = require('node:child_process')
const { join, relative } = require('node:path')

const ROOT = join(__dirname, '..')

// --platform win|mac|linux (default: the host platform).
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
const BIN_DIR = join(ROOT, 'resources', 'bin', PLATFORM)

// A download that makes no progress for this long is dead, not slow.
const DOWNLOAD_TIMEOUT_MS = 120_000

const BINARIES_BY_PLATFORM = {
  win: [
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
      versionCheck: /ffmpeg version n?9\.0\.2/
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
  ],
  mac: [
    {
      name: 'yt-dlp',
      version: '2026.10.26',
      kind: 'exe',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_macos',
      checksumUrl:
        'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/SHA2-256SUMS',
      checksumFile: 'yt-dlp_macos',
      file: 'yt-dlp_macos',
      versionCheck: /2026\.10\.26/
    },
    {
      name: 'ffmpeg',
      version: '9.1',
      kind: 'zip',
      // evermeet publishes no checksum file (only GPG .sig files) - the
      // version check + GPL detection below is the verification. Intel
      // x86_64 only; Apple Silicon runs it through Rosetta 2.
      // evermeet's ffmpeg zip holds ONLY ffmpeg - ffprobe is a separate
      // zip (see the ffprobe entry below).
      url: 'https://evermeet.cx/ffmpeg/ffmpeg-9.1.zip',
      file: 'ffmpeg',
      versionArgs: ['-version'],
      versionCheck: /ffmpeg version n?9\.1/
    },
    {
      name: 'ffprobe',
      version: '9.1',
      kind: 'zip',
      // Separate evermeet zip - ffmpeg-9.1.zip contains no ffprobe.
      url: 'https://evermeet.cx/ffmpeg/ffprobe-9.1.zip',
      file: 'ffprobe',
      versionArgs: ['-version'],
      versionCheck: /ffprobe version n?9\.1/
    },
    {
      name: 'deno',
      version: '2.9.8',
      kind: 'zip',
      url: 'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-apple-darwin.zip',
      checksumUrl:
        'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-apple-darwin.zip.sha256sum',
      checksumFile: 'deno-x86_64-apple-darwin.zip',
      file: 'deno',
      versionCheck: /deno 2\.9\.8/
    }
  ],
  linux: [
    {
      name: 'yt-dlp',
      version: '2026.10.26',
      kind: 'exe',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux',
      checksumUrl:
        'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/SHA2-256SUMS',
      checksumFile: 'yt-dlp_linux',
      file: 'yt-dlp_linux',
      versionCheck: /2026\.10\.26/
    },
    {
      name: 'ffmpeg',
      version: '9.0',
      kind: 'tarxz',
      // BtbN publishes no checksum file for these assets - the version
      // check + GPL detection below is the verification. The 'latest'
      // tag is rolling; the versioned asset name pins the 9.0 build.
      // BtbN prints `ffmpeg version n9.0.2-...` - the check allows the
      // 'n' prefix and any patch suffix.
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz',
      file: 'ffmpeg',
      extraFiles: ['ffprobe'],
      zipSubdir: 'ffmpeg-n9.0-latest-linux64-gpl-9.0',
      binSubdir: 'bin',
      versionArgs: ['-version'],
      versionCheck: /ffmpeg version n?9\.0/
    },
    {
      name: 'deno',
      version: '2.9.8',
      kind: 'zip',
      url: 'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip',
      checksumUrl:
        'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip.sha256sum',
      checksumFile: 'deno-x86_64-unknown-linux-gnu.zip',
      file: 'deno',
      versionCheck: /deno 2\.9\.8/
    }
  ]
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'User-Agent': 'DOVIRA-fetch-binaries/1.0' } }, (res) => {
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
    })
    // A stalled connection must fail instead of hanging forever.
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s: ${url}`))
    })
    req.on('error', reject)
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

/** Best-effort chmod 755 (macOS/Linux only - Windows has no exec bit). */
function makeExecutable(path) {
  if (PLATFORM === 'win') return
  try {
    chmodSync(path, 0o755)
  } catch {
    // A read-only dir must not fail the install - the app re-tries at startup.
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    if (line) {
      expected = line.split(/\s+/)[0].toLowerCase()
    } else {
      // BSD format: "SHA256 (filename) = <hash>"
      const m = sums.match(
        new RegExp(`^SHA256\\s*\\(${escapeRegExp(spec.checksumFile)}\\)\\s*=\\s*([0-9a-fA-F]+)`, 'm')
      )
      if (!m) throw new Error(`${spec.name}: ${spec.checksumFile} missing from checksum file`)
      expected = m[1].toLowerCase()
    }
  }
  const actual = (await sha256File(downloadedPath)).toLowerCase()
  if (expected !== actual) {
    throw new Error(`${spec.name}: checksum mismatch (expected ${expected}, got ${actual})`)
  }
}

/** Recursively find `filename` under `dir`. Returns the full path or null. */
function findInTree(dir, filename) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (e.isFile() && e.name === filename) return join(dir, e.name)
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findInTree(join(dir, e.name), filename)
      if (found) return found
    }
  }
  return null
}

/** Relative paths of everything under `dir` (capped) - for error messages. */
function listTree(dir, max = 40) {
  const out = []
  const walk = (d) => {
    if (out.length >= max) return
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= max) return
      const p = join(d, e.name)
      out.push(relative(dir, p) + (e.isDirectory() ? '/' : ''))
      if (e.isDirectory()) walk(p)
    }
  }
  walk(dir)
  return out
}

/** Number of files (not dirs) under `dir`, recursive. */
function countTree(dir) {
  let n = 0
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isFile()) n++
      else if (e.isDirectory()) walk(join(d, e.name))
    }
  }
  walk(dir)
  return n
}

/** First 4 bytes of a file as lowercase hex (archive magic). */
function magicBytes(path) {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(4)
    const read = readSync(fd, buf, 0, 4, 0)
    return buf.subarray(0, read).toString('hex')
  } finally {
    closeSync(fd)
  }
}

/**
 * Move the wanted files out of the extracted tree into BIN_DIR, then
 * verify the main binary runs and prints the pinned version.
 * `extractDir` is the temp dir the archive was extracted into; it is
 * removed afterwards. The wanted files are found by recursive search -
 * the documented zipSubdir/binSubdir is only a hint, never a hard path.
 */
async function finishArchive(spec, archivePath, extractDir) {
  const files = [spec.file, ...(spec.extraFiles ?? [])]
  for (const f of files) {
    const hinted = spec.zipSubdir
      ? join(extractDir, spec.zipSubdir, spec.binSubdir ?? '', f)
      : join(extractDir, f)
    const found = existsSync(hinted) ? hinted : findInTree(extractDir, f)
    if (!found) {
      const tree = listTree(extractDir).join('\n  ')
      throw new Error(
        `${spec.name}: ${f} not found after extraction. Extracted tree:\n  ${tree || '(empty)'}`
      )
    }
    const target = join(BIN_DIR, f)
    if (found !== target) renameSync(found, target)
    makeExecutable(target)
  }
  rmSync(archivePath, { force: true })
  rmSync(extractDir, { recursive: true, force: true })
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

async function installZip(spec) {
  const zipPath = join(BIN_DIR, `${spec.name}-${spec.version}.zip`)
  console.log(`Downloading ${spec.name} ${spec.version}...`)
  await download(spec.url, zipPath)
  const zipSize = statSync(zipPath).size
  if (zipSize === 0) throw new Error(`${spec.name}: downloaded file is empty`)
  // CI run 44984348473: the win aria2 zip downloaded (HTTP 200,
  // non-empty) yet Expand-Archive exited 0 with an EMPTY tree. Log size
  // + magic bytes so the next failure names the cause instead of
  // guessing (a non-PK magic means the "zip" is an error page; a valid
  // zip + empty tree after two extractors points at antivirus quarantine,
  // e.g. Windows Defender removing aria2c.exe on write).
  const magic = magicBytes(zipPath)
  console.log(`${spec.name}: downloaded ${zipSize} bytes, magic ${magic}`)
  if (!magic.startsWith('504b')) {
    throw new Error(
      `${spec.name}: downloaded file is not a zip (size ${zipSize} bytes, magic ${magic} — expected PK..)`
    )
  }
  if (spec.checksumUrl) await verifyChecksum(spec, zipPath)
  const extractDir = join(BIN_DIR, `.extract-${spec.name}`)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  if (PLATFORM === 'win') {
    await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`
    ])
  } else {
    await execAsync('unzip', ['-o', zipPath, '-d', extractDir])
  }
  let count = countTree(extractDir)
  console.log(`${spec.name}: extracted ${count} file(s)`)
  let tarCount = null
  if (count === 0 && PLATFORM === 'win') {
    // Expand-Archive silently accepted a bad zip (or antivirus removed
    // the files on write). Retry with tar, which ships on Windows
    // Server 2025 / Windows 10 1803+ and reads zips independently.
    console.log(`${spec.name}: Expand-Archive produced an empty tree — retrying with tar -xf...`)
    try {
      await execAsync('tar', ['-xf', zipPath, '-C', extractDir])
    } catch (err) {
      console.log(`${spec.name}: tar -xf failed: ${err.message}`)
    }
    tarCount = countTree(extractDir)
    console.log(`${spec.name}: after tar -xf, extracted ${tarCount} file(s)`)
    count = tarCount
  }
  if (count === 0) {
    throw new Error(
      `${spec.name}: extraction produced an empty tree (zip size ${zipSize} bytes, magic ${magic}, ` +
        `Expand-Archive files 0${tarCount !== null ? `, tar files ${tarCount}` : ''}). ` +
        `If the zip is valid, antivirus (e.g. Windows Defender) likely removed the files on write.`
    )
  }
  await finishArchive(spec, zipPath, extractDir)
}

async function installTarXz(spec) {
  const tarPath = join(BIN_DIR, `${spec.name}-${spec.version}.tar.xz`)
  console.log(`Downloading ${spec.name} ${spec.version}...`)
  await download(spec.url, tarPath)
  if (statSync(tarPath).size === 0) throw new Error(`${spec.name}: downloaded file is empty`)
  if (spec.checksumUrl) await verifyChecksum(spec, tarPath)
  const extractDir = join(BIN_DIR, `.extract-${spec.name}`)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  await execAsync('tar', ['-xJf', tarPath, '-C', extractDir])
  await finishArchive(spec, tarPath, extractDir)
}

async function installExe(spec) {
  const target = join(BIN_DIR, spec.file)
  const tmpPath = join(BIN_DIR, `${spec.file}.new`)
  console.log(`Downloading ${spec.name} ${spec.version}...`)
  await download(spec.url, tmpPath)
  if (statSync(tmpPath).size === 0) throw new Error(`${spec.name}: downloaded file is empty`)
  if (spec.checksumUrl) await verifyChecksum(spec, tmpPath)
  renameSync(tmpPath, target)
  makeExecutable(target)
  const { stdout } = await execAsync(target, ['--version'])
  if (!spec.versionCheck.test(stdout)) {
    throw new Error(`${spec.name} version check failed after install:\n${stdout}`)
  }
  console.log(`${spec.name} ${spec.version} installed at ${target}`)
}

async function main() {
  mkdirSync(BIN_DIR, { recursive: true })
  for (const spec of BINARIES_BY_PLATFORM[PLATFORM]) {
    const target = join(BIN_DIR, spec.file)
    if (existsSync(target)) {
      try {
        makeExecutable(target)
        const args = spec.name === 'ffmpeg' || spec.name === 'ffprobe' ? ['-version'] : ['--version']
        const { stdout } = await execAsync(target, args)
        if (spec.versionCheck.test(stdout)) {
          // ffmpeg also needs ffprobe next to it.
          const extraOk = (spec.extraFiles ?? []).every((f) => existsSync(join(BIN_DIR, f)))
          if (extraOk) {
            console.log(`${spec.name} ${spec.version} already present - skipping.`)
            continue
          }
        }
      } catch {
        // Present but broken - re-download below.
      }
    }
    if (spec.kind === 'zip') await installZip(spec)
    else if (spec.kind === 'tarxz') await installTarXz(spec)
    else await installExe(spec)
  }
  if (PLATFORM !== 'win') {
    console.log(
      'Note: aria2 is not fetched on macOS/Linux (no prebuilt binary exists). ' +
        'Build it with: bash scripts/build-aria2.sh ' +
        PLATFORM +
        ' - without it, plain files download through yt-dlp and torrents are unavailable.'
    )
  }
  console.log('All binaries ready.')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
