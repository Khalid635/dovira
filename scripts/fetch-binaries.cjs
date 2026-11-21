/**
 * Downloads pinned engine binaries into resources/bin/win/ (git-ignored).
 *
 *   npm run fetch-binaries
 *
 * Plain Node (no build step — Vite 8 ships no esbuild, so this file is .cjs).
 * Windows-only (uses PowerShell Expand-Archive for .zip files).
 * aria2's GitHub release publishes no checksum file for the Windows zip,
 * so verification is: the zip must extract cleanly AND `aria2c --version`
 * must print the pinned version. If either fails, the script exits non-zero.
 */
const { createWriteStream, existsSync, mkdirSync, rmSync, renameSync } = require('node:fs')
const { get } = require('node:https')
const { execFile } = require('node:child_process')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const BIN_DIR = join(ROOT, 'resources', 'bin', 'win')

const BINARIES = [
  {
    name: 'aria2',
    version: '1.37.0',
    url: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
    file: 'aria2c.exe',
    zipSubdir: 'aria2-1.37.0-win-64bit-build1',
    versionCheck: /aria2 version 1\.37\.0/
  }
  // Phase 2 adds: yt-dlp, ffmpeg, deno
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

async function main() {
  mkdirSync(BIN_DIR, { recursive: true })
  for (const spec of BINARIES) {
    const target = join(BIN_DIR, spec.file)
    if (existsSync(target)) {
      try {
        const { stdout } = await execAsync(target, ['--version'])
        if (spec.versionCheck.test(stdout)) {
          console.log(`${spec.name} ${spec.version} already present — skipping.`)
          continue
        }
      } catch {
        // Present but broken — re-download below.
      }
    }
    const zipPath = join(BIN_DIR, `${spec.name}-${spec.version}.zip`)
    console.log(`Downloading ${spec.name} ${spec.version}...`)
    await download(spec.url, zipPath)
    await execAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${BIN_DIR}' -Force`
    ])
    const extracted = join(BIN_DIR, spec.zipSubdir, spec.file)
    if (!existsSync(extracted)) {
      throw new Error(`Expected ${extracted} after extraction — layout changed upstream?`)
    }
    renameSync(extracted, target)
    rmSync(zipPath, { force: true })
    rmSync(join(BIN_DIR, spec.zipSubdir), { recursive: true, force: true })
    const { stdout } = await execAsync(target, ['--version'])
    if (!spec.versionCheck.test(stdout)) {
      throw new Error(`${spec.name} version check failed after install:\n${stdout}`)
    }
    console.log(`${spec.name} ${spec.version} installed at ${target}`)
  }
  console.log('All binaries ready.')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
