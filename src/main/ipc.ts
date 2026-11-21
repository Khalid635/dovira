import { BrowserWindow, Notification, dialog, ipcMain, shell, app } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import type { DoviraDb } from './db'
import type { SettingsManager } from './settings'
import type { QueueManager } from './queue'
import { getAria2Version } from './engines/versions'
import { diskFreeBytes } from './util/paths'
import type { Settings } from './types'

export interface IpcDeps {
  queue: QueueManager
  settings: SettingsManager
  db: DoviraDb
  aria2Binary: string
  getMainWindow: () => BrowserWindow | null
}

/**
 * IPC contract (§5). Main re-validates every input — the UI is never trusted.
 * Events: dovira:download:progress (~500ms), dovira:download:status,
 * dovira:toast.
 */
export function registerIpc(deps: IpcDeps): void {
  const { queue, settings } = deps

  ipcMain.handle('dovira:downloads:list', () => queue.list())
  ipcMain.handle('dovira:downloads:add', (_e, url: unknown) =>
    typeof url === 'string' ? queue.add(url) : { ok: false, error: 'invalid-url' }
  )
  ipcMain.handle('dovira:downloads:pause', (_e, id: unknown) =>
    typeof id === 'string' ? queue.pause(id) : false
  )
  ipcMain.handle('dovira:downloads:resume', (_e, id: unknown) =>
    typeof id === 'string' ? queue.resume(id) : false
  )
  ipcMain.handle('dovira:downloads:cancel', (_e, id: unknown) =>
    typeof id === 'string' ? queue.cancel(id) : false
  )
  ipcMain.handle('dovira:downloads:remove', (_e, id: unknown, deleteFile: unknown) =>
    typeof id === 'string' ? queue.remove(id, deleteFile === true) : false
  )
  ipcMain.handle('dovira:downloads:retry', (_e, id: unknown) =>
    typeof id === 'string' ? queue.retry(id) : false
  )
  ipcMain.handle('dovira:downloads:openFile', (_e, id: unknown) => {
    if (typeof id !== 'string') return false
    const d = queue.get(id)
    if (d && existsSync(d.savePath)) {
      void shell.openPath(d.savePath)
      return true
    }
    return false
  })
  ipcMain.handle('dovira:downloads:showInFolder', (_e, id: unknown) => {
    if (typeof id !== 'string') return false
    const d = queue.get(id)
    if (d) {
      shell.showItemInFolder(d.savePath)
      return true
    }
    return false
  })
  ipcMain.handle('dovira:settings:get', () => settings.get())
  ipcMain.handle('dovira:settings:set', (_e, patch: unknown) => {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return settings.get()
    }
    return settings.update(patch as Partial<Settings>)
  })
  ipcMain.handle('dovira:app:info', async () => ({
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    nodeVersion: process.versions.node ?? '',
    aria2Version: await getAria2Version(deps.aria2Binary),
    downloadDir: settings.get().downloadDir,
    diskFreeBytes: diskFreeBytes(settings.get().downloadDir)
  }))
  ipcMain.handle('dovira:pickFolder', async () => {
    const win = deps.getMainWindow()
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  // Forward queue events to the window; show a Windows toast on completion.
  queue.on('progress', (p) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('dovira:download:progress', p)
    }
  })
  queue.on('status', (s) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('dovira:download:status', s)
    }
    if (s.status === 'completed' && Notification.isSupported()) {
      const d = queue.get(s.id)
      if (d) {
        try {
          const n = new Notification({ title: 'DOVIRA', body: `Download complete: ${d.filename}` })
          n.on('click', () => shell.showItemInFolder(d.savePath))
          n.show()
        } catch {
          // Notifications must never break the download flow.
        }
      }
    }
  })
  queue.on('toast', (t) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('dovira:toast', t)
    }
  })
}
