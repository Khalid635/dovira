/**
 * Local API pairing token, stored encrypted when the OS offers it.
 *
 * The token used to live as plaintext in Settings (extensionToken, in the
 * SQLite settings table). It now lives encrypted with Electron safeStorage
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux) in the new
 * `extensionTokenEncrypted` setting. The migration keeps the SAME token
 * value, so an already-paired browser extension keeps working.
 *
 * Pure: no Electron imports — the caller passes a TokenCrypto adapter (the
 * real one wraps safeStorage; tests pass a fake). Settings access goes
 * through the SettingsManager shape, so this compiles standalone.
 */
import { randomBytes } from 'node:crypto'
import type { Settings } from './types'

export interface TokenCrypto {
  isAvailable(): boolean
  /** Encrypt plaintext -> base64 ciphertext. Throws on failure. */
  encrypt(plain: string): string
  /** Decrypt base64 ciphertext -> plaintext. Throws on failure. */
  decrypt(ciphertext: string): string
}

export interface TokenStore {
  get(): Settings
  update(patch: Partial<Settings>): Settings
}

export type TokenStorageKind = 'encrypted' | 'legacy'

export interface LoadedToken {
  token: string
  storage: TokenStorageKind
  /** True when a legacy plaintext token was just moved into encrypted storage. */
  migrated: boolean
  /** Set when encryption is unavailable and the token stays plaintext. */
  warning?: string
}

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Load the pairing token, migrating a legacy plaintext token into
 * encrypted storage on first sight. Generates + stores a fresh token
 * when none exists. Never throws — worst case is a fresh legacy token.
 * An undecryptable ciphertext is replaced (it is unusable), never kept.
 */
export function loadExtensionToken(store: TokenStore, crypto: TokenCrypto): LoadedToken {
  const settings = store.get()
  const encrypted = settings.extensionTokenEncrypted
  if (typeof encrypted === 'string' && encrypted.length > 0 && crypto.isAvailable()) {
    try {
      const token = crypto.decrypt(encrypted)
      if (token) return { token, storage: 'encrypted', migrated: false }
    } catch {
      // Corrupt ciphertext — fall through to the legacy token, if any,
      // else a fresh token below (which overwrites the dead ciphertext).
    }
  }
  const legacy = settings.extensionToken
  if (typeof legacy === 'string' && legacy.length > 0) {
    if (crypto.isAvailable()) {
      try {
        const ciphertext = crypto.encrypt(legacy)
        if (ciphertext) {
          store.update({ extensionTokenEncrypted: ciphertext, extensionToken: '' })
          return { token: legacy, storage: 'encrypted', migrated: true }
        }
      } catch {
        // Encryption failed — keep the legacy token (below).
      }
    }
    return {
      token: legacy,
      storage: 'legacy',
      migrated: false,
      warning: 'encryption-unavailable'
    }
  }
  const token = generateToken()
  if (crypto.isAvailable()) {
    try {
      const ciphertext = crypto.encrypt(token)
      if (ciphertext) {
        store.update({ extensionTokenEncrypted: ciphertext, extensionToken: '' })
        return { token, storage: 'encrypted', migrated: false }
      }
    } catch {
      // Fall through to legacy storage.
    }
  }
  store.update({ extensionToken: token, extensionTokenEncrypted: '' })
  return { token, storage: 'legacy', migrated: false, warning: 'encryption-unavailable' }
}

/** Persist a token (e.g. after Regenerate), encrypted when possible. */
export function storeExtensionToken(
  store: TokenStore,
  token: string,
  crypto: TokenCrypto
): TokenStorageKind {
  if (crypto.isAvailable()) {
    try {
      const ciphertext = crypto.encrypt(token)
      if (ciphertext) {
        store.update({ extensionTokenEncrypted: ciphertext, extensionToken: '' })
        return 'encrypted'
      }
    } catch {
      // Fall through to legacy storage.
    }
  }
  store.update({ extensionToken: token, extensionTokenEncrypted: '' })
  return 'legacy'
}
