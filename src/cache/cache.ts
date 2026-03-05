import { idbCache } from './idb-cache'

const DEFAULT_TTL = 60 * 60 * 1000

interface CacheEntry<T = unknown> {
  value: T
  updatedAt: number
  expiresAt: number
}

const memoryCache = new Map<string, CacheEntry>()

export const buildCacheKey = (...parts: string[]): string => `ingitdb:${parts.join(':')}`

/** Public Cache interface — consumers can implement their own or use the default. */
export interface Cache {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<T>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

const isExpired = (expiresAt: number): boolean => Number.isFinite(expiresAt) && expiresAt <= Date.now()

/** Default cache implementation backed by in-memory Map + IndexedDB. */
export const cache: Cache = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const inMemory = memoryCache.get(key) as CacheEntry<T> | undefined
    if (inMemory && !isExpired(inMemory.expiresAt)) return inMemory.value
    const persisted = (await idbCache.get(key)) as CacheEntry<T> | undefined
    if (!persisted || isExpired(persisted.expiresAt)) {
      if (persisted) await idbCache.delete(key)
      memoryCache.delete(key)
      return null
    }
    memoryCache.set(key, persisted)
    return persisted.value
  },
  async set<T = unknown>(key: string, value: T, ttl = DEFAULT_TTL): Promise<T> {
    const entry: CacheEntry<T> = { value, updatedAt: Date.now(), expiresAt: Date.now() + ttl }
    memoryCache.set(key, entry)
    await idbCache.set(key, entry)
    return value
  },
  async delete(key: string): Promise<void> {
    memoryCache.delete(key)
    await idbCache.delete(key)
  },
  async clear(): Promise<void> {
    memoryCache.clear()
    await idbCache.clear()
  }
}
