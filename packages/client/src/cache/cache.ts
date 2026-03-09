import { idbCache } from './idb-cache'

const DEFAULT_TTL = 60 * 60 * 1000

interface CacheEntry<T = unknown> {
  value: T
  updatedAt: number
  expiresAt: number
}

const isExpired = (expiresAt: number): boolean => Number.isFinite(expiresAt) && expiresAt <= Date.now()

export const buildCacheKey = (...parts: string[]): string => `ingitdb:${parts.join(':')}`

/** Low-level key-value persistence adapter (e.g. IndexedDB, localStorage). */
export interface StorageAdapter {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

/** Public Cache interface — consumers can implement their own or use the default. */
export interface Cache {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<T>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

/** Factory that creates a Cache instance, optionally backed by a StorageAdapter. */
export function createCache(adapter?: StorageAdapter): Cache {
  const memoryCache = new Map<string, CacheEntry>()

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const inMemory = memoryCache.get(key) as CacheEntry<T> | undefined
      if (inMemory && !isExpired(inMemory.expiresAt)) return inMemory.value
      if (!adapter) {
        memoryCache.delete(key)
        return null
      }
      const persisted = (await adapter.get(key)) as CacheEntry<T> | undefined
      if (!persisted || isExpired(persisted.expiresAt)) {
        if (persisted) await adapter.delete(key)
        memoryCache.delete(key)
        return null
      }
      memoryCache.set(key, persisted)
      return persisted.value
    },
    async set<T = unknown>(key: string, value: T, ttl = DEFAULT_TTL): Promise<T> {
      const entry: CacheEntry<T> = { value, updatedAt: Date.now(), expiresAt: Date.now() + ttl }
      memoryCache.set(key, entry)
      if (adapter) await adapter.set(key, entry)
      return value
    },
    async delete(key: string): Promise<void> {
      memoryCache.delete(key)
      if (adapter) await adapter.delete(key)
    },
    async clear(): Promise<void> {
      memoryCache.clear()
      if (adapter) await adapter.clear()
    }
  }
}

/** Default cache — in-memory + IndexedDB backed. */
export const cache: Cache = createCache(idbCache)
