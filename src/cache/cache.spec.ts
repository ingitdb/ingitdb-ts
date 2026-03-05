import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- mock idb-cache ------------------------------------------------
const idbStore = vi.hoisted(() => new Map<string, unknown>())

vi.mock('./idb-cache', () => ({
  idbCache: {
    get: vi.fn((key: string) => Promise.resolve(idbStore.get(key))),
    set: vi.fn((key: string, value: unknown) => { idbStore.set(key, value); return Promise.resolve() }),
    delete: vi.fn((key: string) => { idbStore.delete(key); return Promise.resolve() }),
    clear: vi.fn(() => { idbStore.clear(); return Promise.resolve() }),
    keys: vi.fn(() => Promise.resolve([...idbStore.keys()]))
  }
}))

const { cache, buildCacheKey } = await import('./cache')
const { idbCache } = await import('./idb-cache')

// ---------- tests ---------------------------------------------------------
describe('buildCacheKey', () => {
  it('joins parts with : and prefixes with ingitdb:', () => {
    expect(buildCacheKey('a', 'b', 'c')).toBe('ingitdb:a:b:c')
  })

  it('works with a single part', () => {
    expect(buildCacheKey('only')).toBe('ingitdb:only')
  })
})

describe('cache', () => {
  beforeEach(async () => {
    await cache.clear()
    vi.clearAllMocks()
    idbStore.clear()
  })

  // ── set ─────────────────────────────────────────────────────────────────
  describe('set', () => {
    it('stores value in memory and IDB, returns the value', async () => {
      const returned = await cache.set('key', 'hello')
      expect(returned).toBe('hello')
      const result = await cache.get('key')
      expect(result).toBe('hello')
    })
  })

  // ── get ─────────────────────────────────────────────────────────────────
  describe('get', () => {
    it('returns cached value from memory (not expired)', async () => {
      await cache.set('key', 'from-mem')
      const result = await cache.get('key')
      expect(result).toBe('from-mem')
    })

    it('returns null for missing key (memory miss + IDB miss)', async () => {
      expect(await cache.get('nope')).toBeNull()
    })

    it('returns null for expired in-memory entry and deletes from IDB', async () => {
      const now = 1_000_000
      vi.spyOn(Date, 'now').mockReturnValue(now)
      await cache.set('key', 'val', 100)            // expiresAt = 1_000_100
      vi.spyOn(Date, 'now').mockReturnValue(now + 200) // past expiry
      expect(await cache.get('key')).toBeNull()
      // idbCache.delete should have been called for the expired IDB entry
      expect(idbCache.delete).toHaveBeenCalledWith('key')
      vi.restoreAllMocks()
    })

    it('falls back to IDB on memory miss and stores in memory', async () => {
      // Clear everything, then put directly in IDB
      await cache.clear()
      idbStore.clear()
      const entry = { value: 'from-idb', updatedAt: Date.now(), expiresAt: Date.now() + 60_000 }
      idbStore.set('key', entry)

      const result = await cache.get('key')
      expect(result).toBe('from-idb')
      // On second call, should come from memory (no extra IDB get)
      vi.mocked(idbCache.get).mockClear()
      const result2 = await cache.get('key')
      expect(result2).toBe('from-idb')
    })

    it('returns null and deletes expired IDB entry (persisted exists but expired)', async () => {
      await cache.clear()
      idbStore.clear()
      const entry = { value: 'expired', updatedAt: 1000, expiresAt: 1000 }
      idbStore.set('key', entry)
      expect(await cache.get('key')).toBeNull()
      expect(idbCache.delete).toHaveBeenCalledWith('key')
    })

    it('treats non-finite expiresAt (Infinity) as never expired', async () => {
      await cache.set('key', 'eternal', Infinity) // expiresAt = Infinity
      const result = await cache.get('key')
      expect(result).toBe('eternal')
    })
  })

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('removes from memory and IDB', async () => {
      await cache.set('key', 'val')
      await cache.delete('key')
      expect(await cache.get('key')).toBeNull()
    })
  })

  // ── clear ───────────────────────────────────────────────────────────────
  describe('clear', () => {
    it('empties memory and IDB', async () => {
      await cache.set('a', 1)
      await cache.set('b', 2)
      await cache.clear()
      expect(await cache.get('a')).toBeNull()
      expect(await cache.get('b')).toBeNull()
    })
  })
})
