import { execFile } from 'node:child_process'

/** `aria2 version 1.37.0` → "1.37.0". Null when the binary cannot run. */
export function getAria2Version(binaryPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binaryPath, ['--version'], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = stdout.match(/aria2 version ([0-9.]+)/)
      resolve(m ? m[1] : null)
    })
  })
}
