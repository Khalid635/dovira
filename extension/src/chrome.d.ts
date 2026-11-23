/**
 * Minimal typed declarations for the chrome.* APIs the DOVIRA extension
 * uses. Deliberately small — only the methods and fields the code
 * touches — so `tsc` verifies the extension without @types/chrome.
 * Both Chrome (MV3) and Firefox (MV3, 128+) expose this `chrome`
 * namespace.
 */
export {}

declare global {
  interface ChromeCookie {
    domain: string
    hostOnly: boolean
    path: string
    secure: boolean
    expirationDate?: number
    name: string
    value: string
  }

  interface ChromeTab {
    id?: number
    url?: string
    title?: string
  }

  interface ChromeDownloadItem {
    id: number
    url: string
    filename: string
  }

  interface ChromeContextMenuClickInfo {
    menuItemId: string | number
    linkUrl?: string
    srcUrl?: string
    pageUrl?: string
  }

  interface ChromeStorageItems {
    [key: string]: unknown
  }

  // v1.2.0: the 1-minute ping that keeps the app's extension status live.
  interface ChromeAlarm {
    name: string
    scheduledTime: number
    periodInMinutes?: number
  }

  const chrome: {
    runtime: {
      lastError?: { message: string }
      sendMessage: (message: unknown) => Promise<unknown>
      onMessage: {
        addListener: (
          cb: (
            message: unknown,
            sender: { tab?: ChromeTab },
            sendResponse: (response?: unknown) => void
          ) => boolean | void
        ) => void
      }
      onInstalled: { addListener: (cb: (details: { reason: string }) => void) => void }
      // v1.2.0: check in with the app right after the browser starts.
      onStartup: { addListener: (cb: () => void) => void }
      // Next-level: one-click pairing — the app opens the Options page
      // with the token in the URL; the background reports this URL to
      // the app on its status ping so the app knows where to open.
      getURL: (path: string) => string
      openOptionsPage: () => Promise<void>
    }
    alarms: {
      create: (name: string, info: { periodInMinutes: number }) => void
      onAlarm: { addListener: (cb: (alarm: ChromeAlarm) => void) => void }
    }
    tabs: {
      query: (query: { active: boolean; currentWindow: boolean }) => Promise<ChromeTab[]>
    }
    contextMenus: {
      removeAll: (cb?: () => void) => void
      create: (options: { id: string; title: string; contexts: string[] }) => void
      onClicked: {
        addListener: (cb: (info: ChromeContextMenuClickInfo, tab?: ChromeTab) => void) => void
      }
    }
    downloads: {
      onCreated: { addListener: (cb: (item: ChromeDownloadItem) => void) => void }
      cancel: (downloadId: number, cb?: () => void) => void
    }
    cookies: {
      getAll: (details: { url: string }) => Promise<ChromeCookie[]>
    }
    storage: {
      local: {
        get: (keys: string | string[]) => Promise<ChromeStorageItems>
        set: (items: ChromeStorageItems) => Promise<void>
      }
    }
    notifications: {
      create: (options: {
        type: string
        iconUrl: string
        title: string
        message: string
      }) => Promise<string>
    }
    scripting: {
      executeScript: (options: {
        target: { tabId: number }
        func: () => unknown
      }) => Promise<Array<{ result: unknown }>>
    }
  }
}
