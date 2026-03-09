import { createGithubApi, type GithubApi } from './github/github-api'
import { cache as defaultCache, type Cache, type IngitDbClient, type IngitDbClientOptions, createCommittedChangesStore } from '@ingitdb/client'
import { loadDatabaseConfig } from './database/database-config'
import { loadCollectionSchema, loadCollectionRecords } from './collection/collection'
import { loadRecord } from './collection/record'
import { loadRepoMeta } from './repo/repo'
import { loadRepoSettings } from './repo/repo-settings'
import { loadFKViews } from './collection/fk-views'
import { createPendingChangesStore } from './changes/pending-changes'

export type { IngitDbClientOptions }

export interface IngitDbGithubClient extends IngitDbClient {
  githubApi: GithubApi
}

/** Creates a memory-only Cache with no persistence. */
function createMemoryCache(): Cache {
  const store = new Map<string, unknown>()
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      return (store.get(key) as T | undefined) ?? null
    },
    async set<T = unknown>(key: string, value: T): Promise<T> {
      store.set(key, value)
      return value
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
    async clear(): Promise<void> {
      store.clear()
    }
  }
}

/**
 * Creates a fully wired IngitDbGithubClient facade.
 *
 * Respects the `cache` option from `IngitDbClientOptions`:
 * - `cache: false`  → memory-only cache, no IndexedDB persistence
 * - `cache: true` or omitted → IDB-backed cache (default)
 * - `cache: { ttl? }` → IDB-backed cache (TTL is applied per-call)
 *
 * @example
 * ```ts
 * const client = createIngitDbClient({ token: 'ghp_...' })
 * const config = await client.loadDatabaseConfig('owner/repo')
 * ```
 */
export function createIngitDbClient(options?: IngitDbClientOptions): IngitDbGithubClient {
  const githubApi = createGithubApi(options?.token)

  const cacheOption = options?.cache
  const cacheInstance: Cache =
    cacheOption === false
      ? createMemoryCache()  // memory-only, no persistence
      : defaultCache          // IDB-backed via the default cache singleton

  const deps = { githubApi, cache: cacheInstance }

  return {
    githubApi,
    cache: cacheInstance,

    loadDatabaseConfig: (repo, branch) =>
      loadDatabaseConfig(repo, branch, deps),

    loadCollectionSchema: (repo, branch, collectionId, skipCache) =>
      loadCollectionSchema(repo, branch, collectionId, deps, skipCache),

    loadCollectionRecords: (repo, branch, collectionId, schema, collectionPath, skipCache) =>
      loadCollectionRecords(repo, branch, collectionId, schema, collectionPath, deps, skipCache),

    loadRecord: (repo, recordPath, branch) =>
      loadRecord(repo, recordPath, branch, { githubApi }),

    loadRepoMeta: (repo) =>
      loadRepoMeta(repo, { githubApi }),

    loadRepoSettings: (repo, branch, skipCache) =>
      loadRepoSettings(repo, branch, skipCache, deps),

    loadFKViews: (repo, branch, collectionPath, recordKey) =>
      loadFKViews(repo, branch, collectionPath, recordKey, deps),

    createPendingChangesStore: () =>
      createPendingChangesStore(githubApi, cacheInstance),

    createCommittedChangesStore: () =>
      createCommittedChangesStore()
  }
}
