import { describe, it, beforeEach, afterEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cp = require('node:child_process')

// Mock installed at MODULE SCOPE, before any import of the code under test:
// Node snapshots ESM named imports from CJS modules at first import, so a
// mock.method installed in a later describe's beforeEach does NOT intercept
// a module that was already imported in an earlier describe.

type FakeChild = EventEmitter & {
  stderr: EventEmitter
  kill: () => boolean
  killed: boolean
}

let spawnCalls: { file: string; args: string[] }[] = []
let spawnChild: FakeChild | null = null
mock.method(cp, 'spawn', (file: string, args: string[]) => {
  spawnCalls.push({ file, args: [...args] })
  const child = new EventEmitter() as unknown as FakeChild
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  spawnChild = child
  return child as never
})

after(() => mock.restoreAll())

type RpcCall = { method: string; params: unknown[]; body: string }

function fakeFetchResult(result: unknown): unknown {
  return { ok: true, json: async () => ({ result }) }
}

describe('aria2 rpc (fetch stubbed)', () => {
  let origFetch: typeof fetch
  let calls: RpcCall[]
  let nextResult: unknown
  let nextError: { code: number; message: string } | null
  let Aria2Manager: typeof import('../src/main/engines/aria2.ts').Aria2Manager

  beforeEach(async () => {
    origFetch = globalThis.fetch
    calls = []
    nextResult = 'gid-1'
    nextError = null
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        method: string
        params: unknown[]
      }
      calls.push({ method: body.method, params: body.params, body: String(init?.body) })
      if (nextError) return { ok: true, json: async () => ({ error: nextError }) }
      return fakeFetchResult(nextResult)
    }) as typeof fetch
    const mod = await import('../src/main/engines/aria2.ts')
    Aria2Manager = mod.Aria2Manager
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  function manager(): import('../src/main/engines/aria2.ts').Aria2Manager {
    return new Aria2Manager('C:\\aria2c.exe', 'C:\\DL')
  }

  it('addUri / addUris send the token first and the URI list; rpc id increments', async () => {
    const m = manager()
    const gid = await m.addUri('https://x.example/f.zip', { dir: 'C:\\DL' })
    assert.equal(gid, 'gid-1')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'aria2.addUri')
    const params = calls[0].params as unknown[]
    assert.match(String(params[0]), /^token:/)
    // rpc() builds params as [token, ...callerParams]; addUri passes [[url], options].
    assert.deepEqual(params[1], ['https://x.example/f.zip'])
    assert.deepEqual(params[2], { dir: 'C:\\DL' })
    assert.match(calls[0].body, /"id":1/)

    const gid2 = await m.addUris(
      'https://a.example/f.zip',
      ['https://b.example/f.zip', 'https://a.example/f.zip'],
      {}
    )
    assert.equal(gid2, 'gid-1')
    const p2 = calls[1].params as unknown[]
    assert.deepEqual(p2[1], ['https://a.example/f.zip', 'https://b.example/f.zip'])
    assert.match(calls[1].body, /"id":2/)
  })

  it('tellStatus / pause / unpause / remove / changeOption / changeGlobalOption', async () => {
    const m = manager()
    nextResult = { gid: 'g1', status: 'active', totalLength: '100', completedLength: '40', downloadSpeed: '10', uploadSpeed: '0', connections: '4', dir: 'C:\\DL' }
    const st = await m.tellStatus('g1')
    assert.equal(st.status, 'active')
    assert.equal(st.totalLength, '100')
    assert.equal(calls[0].method, 'aria2.tellStatus')
    await m.pause('g1')
    assert.equal(calls[1].method, 'aria2.pause')
    await m.unpause('g1')
    assert.equal(calls[2].method, 'aria2.unpause')
    await m.remove('g1')
    assert.equal(calls[3].method, 'aria2.remove')
    await m.removeDownloadResult('g1')
    assert.equal(calls[4].method, 'aria2.removeDownloadResult')
    await m.changeOption('g1', { 'max-download-limit': '512000' })
    assert.equal(calls[5].method, 'aria2.changeOption')
    await m.changeGlobalOption({ 'max-overall-download-limit': '0' })
    assert.equal(calls[6].method, 'aria2.changeGlobalOption')
  })

  it('an RPC error throws with the daemon message', async () => {
    const m = manager()
    nextError = { code: 1, message: 'No such download.' }
    await assert.rejects(() => m.tellStatus('gone'), /No such download\./)
  })
})

describe('aria2 start/stop (spawn mocked)', () => {
  let origFetch: typeof fetch
  let Aria2Manager: typeof import('../src/main/engines/aria2.ts').Aria2Manager

  beforeEach(async () => {
    origFetch = globalThis.fetch
    spawnCalls = []
    spawnChild = null
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ result: { version: '1.37.0' } })
    })) as typeof fetch
    const mod = await import('../src/main/engines/aria2.ts')
    Aria2Manager = mod.Aria2Manager
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('start spawns with the daemon flags, waits for RPC, then isReady', async () => {
    const m = new Aria2Manager('C:\\bin\\aria2c.exe', 'C:\\DL')
    assert.equal(m.isReady(), false)
    await m.start()
    assert.equal(m.isReady(), true)
    assert.equal(spawnCalls.length, 1)
    assert.equal(spawnCalls[0].file, 'C:\\bin\\aria2c.exe')
    const args = spawnCalls[0].args
    for (const flag of [
      '--enable-rpc',
      '--rpc-listen-all=false',
      '--dir=C:\\DL',
      '--continue=true',
      '--disable-ipv6',
      '--max-connection-per-server=16',
      '--split=16',
      '--enable-dht=true',
      '--bt-enable-lpd=true'
    ]) {
      assert.ok(args.includes(flag), `missing flag ${flag}`)
    }
    assert.ok(args.some((a) => a.startsWith('--rpc-listen-port=')))
    assert.ok(args.some((a) => a.startsWith('--rpc-secret=')))
    // A second start() is a no-op while ready.
    await m.start()
    assert.equal(spawnCalls.length, 1)
    await m.stop()
    assert.equal(m.isReady(), false)
    assert.equal(spawnChild?.killed, true)
  })

  it('stderr lines land in getLastLog (capped at 50)', async () => {
    const m = new Aria2Manager('C:\\bin\\aria2c.exe', 'C:\\DL')
    await m.start()
    for (let i = 0; i < 55; i++) {
      spawnChild?.stderr.emit('data', Buffer.from(`line ${i}\n`))
    }
    const log = m.getLastLog()
    assert.ok(!log.includes('line 0\n'))
    assert.ok(log.includes('line 54'))
    assert.equal(log.split('\n').length, 50)
    await m.stop()
  })

  it('a spawn error clears readiness and fires onUnexpectedExit', async () => {
    const m = new Aria2Manager('C:\\bin\\aria2c.exe', 'C:\\DL')
    let exits = 0
    m.onUnexpectedExit = () => {
      exits++
    }
    await m.start()
    assert.equal(m.isReady(), true)
    spawnChild?.emit('error', new Error('spawn failed'))
    assert.equal(m.isReady(), false)
    assert.equal(exits, 1)
    await m.stop()
  })
})
