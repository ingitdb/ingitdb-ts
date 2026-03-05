import { createGithubApi, type GithubApi } from './github/github-api'
import { cache as defaultCache, type Cache } from './cache/cache'
import { loadDatabaseConfig, type DatabaseConfig } from './database/database-config'
import { loadCollectionSchema, loadCollectionRecords, type RecordRow } from './collection/collection'
import { loadRecord, type RecordData } from './collection/record'
import { loadRepoMeta, type RepoMeta } from './repo/repo'
import { loadRepoSettings, type RepoSettings } from './repo/repo-settings'
import { loadFKViews, type FKView } from './collection/fk-views'
import { createPendingChangesStore, type PendingChangesStore } from './changes/pending-changes'
import { createCommittedChangesStore, type CommittedChangesStore } from './changes/committed-changes'
import type { CollectionSchema } from './schema/schema'

export interface IngitDbClientOptions {
  token?: string
  cache?: boolean | { ttl?: number }
}

export interface IngitDbClient {
  githubApi: GithubApi
  cache: Cache
  loadDatabaseConfig(repo: string, branch?: string): Promise<DatabaseConfig>
  loadCollectionSchema(repo: string, branch: string | undefined, collectionId: string, skipCache?: boolean): Promise<{ schema: CollectionSchema; schemaYaml: string; collectionPath: string }>
  loadCollectionRecords(repo: string, branch: string | undefined, collectionId: string, schema: CollectionSchema, collectionPath: string, skipCache?: boolean): Promise<{ records: RecordRow[]; ingrColumnTypes: Record<string, string> }>
  loadRecord(repo: string, recordPath: string, branch?: string): Promise<RecordData>
  loadRepoMeta(repo: string): Promise<RepoMeta>
  loadRepoSettings(repo: string, branch?: string, skipCache?: boolean): Promise<RepoSettings>
  loadFKViews(repo: string, branch: string | undefined, collectionPath: string, recordKey: string): Promise<FKView[]>
  createPendingChangesStore(): PendingChangesStore
  createCommittedChangesStore(): CommittedChangesStore
}

/**
 * Creates a fully wired IngitDbClient facade.
 *
 * @example
 * ```ts
 * const client = createIngitDbClient({ token: 'ghp_...' })
 * const config = await client.loadDatabaseConfig('owner/repo')
 * ```
 */
export function createIngitDbClient(options?: IngitDbClientOptions): IngitDbClient {
  const githubApi = createGithubApi(options?.token)

  // For now, always use the default IDB-backed cache.
  // `cache: false` or custom cache support can be added later.
  const cacheInstance: Cache = defaultCache

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
