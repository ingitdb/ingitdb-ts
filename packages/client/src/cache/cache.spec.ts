import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cache, createCache, buildCacheKey } from './cache'
import type { StorageAdapter } from './cache'

// ---------- helpers -------------------------------------------------------
const makeAdapter = (): StorageAdapter & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>()
  return {
    store,
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: unknown) => { store.set(key, value); return Promise.resolve() }),
    delete: vi.fn((key: string) => { store.delete(key); return Promise.resolve() }),
    clear: vi.fn(() => { store.clear(); return Promise.resolve() })
  }
}

// ---------- buildCacheKey -------------------------------------------------
describe('buildCacheKey', () => {
  it('joins parts with : and prefixes with ingitdb:', () => {
    expect(buildCacheKey('a', 'b', 'c')).toBe('ingitdb:a:b:c')
  })

  it('works with a single part', () => {
    expect(buildCacheKey('only')).toBe('ingitdb:only')
  })
})

// ---------- default memory-only cache singleton ---------------------------
describe('cache (memory-only)', () => {
  beforeEach(async () => { await cache.clear() })

  it('set stores a value and get retrieves it', async () => {
    expect(await cache.set('k', 'v')).toBe('v')
    expect(await cache.get('k')).toBe('v')
  })

  it('get returns null for a missing key', async () => {
    expect(await cache.get('nope')).toBeNull()
  })

  it('delete removes the value', async () => {
    await cache.set('k', 'v')
    await cache.delete('k')
    expect(await cache.get('k')).toBeNull()
  })

  it('clear removes all entries', async () => {
    await cache.set('a', 1)
    await cache.set('b', 2)
    await cache.clear()
    expect(await cache.get('a')).toBeNull()
    expect(await cache.get('b')).toBeNull()
  })

  it('returns null for expired entries', async () => {
    const now = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await cache.set('k', 'val', 100)
    vi.spyOn(Date, 'now').mockReturnValue(now + 200)
    expect(await cache.get('k')).toBeNull()
    vi.restoreAllMocks()
  })

  it('treats Infinity TTL as never-expired', async () => {
    await cache.set('k', 'eternal', Infinity)
    expect(await cache.get('k')).toBe('eternal')
  })
})

// ---------- createCache with adapter (persistent cache) -------------------
describe('createCache(adapter)', () => {
  let adapter: ReturnType<typeof makeAdapter>
  let c: ReturnType<typeof createCache>

  beforeEach(async () => {
    adapter = makeAdapter()
    c = createCache(adapter)
  })

  it('set writes to memory and adapter', async () => {
    await c.set('key', 'hello')
    expect(adapter.set).toHaveBeenCalled()
    expect(await c.get('key')).toBe('hello')
  })

  it('get falls back to adapter on memory miss', async () => {
    const entry = { value: 'from-adapter', updatedAt: Date.now(), expiresAt: Date.now() + 60_000 }
    adapter.store.set('key', entry)

    const result = await c.get('key')
    expect(result).toBe('from-adapter')
    expect(adapter.get).toHaveBeenCalledWith('key')
  })

  it('get caches adapter result in memory on second call', async () => {
    const entry = { value: 'cached', updatedAt: Date.now(), expiresAt: Date.now() + 60_000 }
    adapter.store.set('key', entry)
    await c.get('key')
    vi.mocked(adapter.get).mockClear()
    await c.get('key')
    expect(adapter.get).not.toHaveBeenCalled()
  })

  it('get returns null and deletes expired adapter entry', async () => {
    const entry = { value: 'old', updatedAt: 1000, expiresAt: 1000 }
    adapter.store.set('key', entry)
    expect(await c.get('key')).toBeNull()
    expect(adapter.delete).toHaveBeenCalledWith('key')
  })

  it('delete removes from memory and adapter', async () => {
    await c.set('key', 'val')
    await c.delete('key')
    expect(adapter.delete).toHaveBeenCalledWith('key')
    expect(await c.get('key')).toBeNull()
  })

  it('clear empties memory and adapter', async () => {
    await c.set('a', 1)
    await c.set('b', 2)
    await c.clear()
    expect(adapter.clear).toHaveBeenCalled()
    expect(await c.get('a')).toBeNull()
  })
})
