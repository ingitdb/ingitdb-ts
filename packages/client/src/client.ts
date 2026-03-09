import type { Cache } from './cache/cache'
import type { DatabaseConfig, RecordRow, RecordData, FKView, RepoMeta, RepoSettings, PendingChangesStore, CommittedChangesStore } from './types'
import type { CollectionSchema } from './schema/schema'

export interface IngitDbClientOptions {
  token?: string
  cache?: boolean | { ttl?: number }
}

export interface IngitDbClient {
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
