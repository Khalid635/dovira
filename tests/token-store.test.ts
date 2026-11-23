import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadExtensionToken,
  storeExtensionToken,
  type TokenCrypto,
  type TokenStore
} from '../src/main/tokenStore.ts'
import { DEFAULT_SETTINGS } from '../src/main/settings.ts'
import type { Settings } from '../src/main/types.ts'

function makeStore(patch: Partial<Settings> = {}): { store: TokenStore; get: () => Settings } {
  let current: Settings = { ...DEFAULT_SETTINGS, ...patch }
  const store: TokenStore = {
    get: () => ({ ...current }),
    update: (p: Partial<Settings>) => {
      current = { ...current, ...p }
      return { ...current }
    }
  }
  return { store, get: () => current }
}

/** Fake crypto: "encryption" is a reversible prefix; can be toggled off / made to fail. */
function makeCrypto(opts: { available?: boolean; failOn?: 'encrypt' | 'decrypt' } = {}): TokenCrypto {
  const available = opts.available ?? true
  return {
    isAvailable: () => available,
    encrypt: (plain: string) => {
      if (opts.failOn === 'encrypt') throw new Error('encrypt boom')
      return `ENC:${plain}`
    },
    decrypt: (ciphertext: string) => {
      if (opts.failOn === 'decrypt') throw new Error('decrypt boom')
      if (!ciphertext.startsWith('ENC:')) throw new Error('bad ciphertext')
      return ciphertext.slice(4)
    }
  }
}

describe('tokenStore', () => {
  it('fresh token: generated, stored encrypted, 64 hex chars', () => {
    const { store, get } = makeStore()
    const loaded = loadExtensionToken(store, makeCrypto())
    assert.equal(loaded.storage, 'encrypted')
    assert.equal(loaded.migrated, false)
    assert.equal(loaded.warning, undefined)
    assert.match(loaded.token, /^[0-9a-f]{64}$/)
    assert.equal(get().extensionTokenEncrypted, `ENC:${loaded.token}`)
    assert.equal(get().extensionToken, '')
  })

  it('fresh token with no crypto: legacy + warning', () => {
    const { store, get } = makeStore()
    const loaded = loadExtensionToken(store, makeCrypto({ available: false }))
    assert.equal(loaded.storage, 'legacy')
    assert.equal(loaded.warning, 'encryption-unavailable')
    assert.equal(get().extensionToken, loaded.token)
    assert.equal(get().extensionTokenEncrypted, '')
  })

  it('legacy plaintext migrates to encrypted storage with the SAME token', () => {
    const { store, get } = makeStore({ extensionToken: 'old-token-123' })
    const loaded = loadExtensionToken(store, makeCrypto())
    assert.equal(loaded.token, 'old-token-123')
    assert.equal(loaded.storage, 'encrypted')
    assert.equal(loaded.migrated, true)
    assert.equal(get().extensionToken, '')
    assert.equal(get().extensionTokenEncrypted, 'ENC:old-token-123')
  })

  it('legacy token stays legacy when encryption is unavailable or fails', () => {
    const { store } = makeStore({ extensionToken: 'tok' })
    const r1 = loadExtensionToken(store, makeCrypto({ available: false }))
    assert.equal(r1.storage, 'legacy')
    assert.equal(r1.warning, 'encryption-unavailable')
    const r2 = loadExtensionToken(store, makeCrypto({ failOn: 'encrypt' }))
    assert.equal(r2.storage, 'legacy')
    assert.equal(r2.token, 'tok')
  })

  it('encrypted token decrypts; corrupt ciphertext falls back to legacy, then to fresh', () => {
    const { store } = makeStore({ extensionTokenEncrypted: 'ENC:secret-token' })
    const loaded = loadExtensionToken(store, makeCrypto())
    assert.equal(loaded.token, 'secret-token')
    assert.equal(loaded.storage, 'encrypted')
    assert.equal(loaded.migrated, false)

    const { store: store2 } = makeStore({
      extensionTokenEncrypted: 'GARBAGE-NOT-ENC',
      extensionToken: 'fallback-token'
    })
    const r2 = loadExtensionToken(store2, makeCrypto())
    assert.equal(r2.token, 'fallback-token')
    assert.equal(r2.migrated, true)

    const { store: store3 } = makeStore({ extensionTokenEncrypted: 'GARBAGE-NOT-ENC' })
    const r3 = loadExtensionToken(store3, makeCrypto())
    assert.equal(r3.storage, 'encrypted')
    assert.equal(r3.migrated, false)
    assert.match(r3.token, /^[0-9a-f]{64}$/)
  })

  it('storeExtensionToken: encrypted when possible, legacy otherwise', () => {
    const { store, get } = makeStore()
    assert.equal(storeExtensionToken(store, 'new-token', makeCrypto()), 'encrypted')
    assert.equal(get().extensionTokenEncrypted, 'ENC:new-token')
    assert.equal(storeExtensionToken(store, 't2', makeCrypto({ available: false })), 'legacy')
    assert.equal(get().extensionToken, 't2')
    assert.equal(storeExtensionToken(store, 't3', makeCrypto({ failOn: 'encrypt' })), 'legacy')
    assert.equal(get().extensionToken, 't3')
  })
})
