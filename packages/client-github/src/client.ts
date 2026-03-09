import { createGithubApi, type GithubApi } from './github/github-api'
import { createCache, type Cache, type IngitDbClient, type IngitDbClientOptions } from '@ingitdb/client'
import { idbCache } from './cache/idb-cache'
import { createIdbCommittedChangesStore } from './changes/idb-committed-changes'
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
      ? createCache()        // memory-only, no persistence
      : createCache(idbCache) // IDB-backed (default for browser)

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
      createIdbCommittedChangesStore()
  }
}
