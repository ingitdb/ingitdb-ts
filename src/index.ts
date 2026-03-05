// ─── Facade ──────────────────────────────────────────────────────────────────
export { createIngitDbClient } from './client'
export type { IngitDbClient, IngitDbClientOptions } from './client'

// ─── GitHub API ──────────────────────────────────────────────────────────────
export { createGithubApi, buildCommitMessage } from './github/github-api'
export type {
  GithubApi,
  RateLimit,
  FileTextResult,
  PutFileParams,
  DeleteFileParams
} from './github/github-api'

// ─── Cache ───────────────────────────────────────────────────────────────────
export { cache, buildCacheKey } from './cache/cache'
export type { Cache } from './cache/cache'

// ─── Schema ──────────────────────────────────────────────────────────────────
export { parseCollectionSchema, normalizeCollectionSchema } from './schema/schema'
export type { CollectionSchema, ColumnDef } from './schema/schema'

// ─── YAML Utilities ──────────────────────────────────────────────────────────
export { parseYaml, stringifyYaml } from './utils/yaml'

// ─── Collection ──────────────────────────────────────────────────────────────
export {
  resolveCollectionPath,
  loadCollectionSchema,
  loadCollectionRecords,
  resolveDataPath
} from './collection/collection'
export type { RecordRow, CollectionDeps } from './collection/collection'

// ─── Record ──────────────────────────────────────────────────────────────────
export { loadRecord } from './collection/record'
export type { RecordData, RecordDeps } from './collection/record'

// ─── FK Views ────────────────────────────────────────────────────────────────
export { loadFKViews } from './collection/fk-views'
export type { FKView, FKViewDeps } from './collection/fk-views'

// ─── Database Config ─────────────────────────────────────────────────────────
export { loadDatabaseConfig } from './database/database-config'
export type { DatabaseConfig, CollectionEntry, DatabaseConfigDeps } from './database/database-config'

// ─── Repository ──────────────────────────────────────────────────────────────
export { loadRepoMeta } from './repo/repo'
export type { RepoMeta, RepoDeps } from './repo/repo'

// ─── Repository Settings ────────────────────────────────────────────────────
export {
  loadRepoSettings,
  getRequiredLanguages,
  getOptionalLanguages,
  getAllSupportedLanguages
} from './repo/repo-settings'
export type { RepoSettings, RepoSettingsDeps } from './repo/repo-settings'

// ─── Change Management ──────────────────────────────────────────────────────
export { createPendingChangesStore } from './changes/pending-changes'
export type { PendingChange, PendingChangesStore } from './changes/pending-changes'

export { createCommittedChangesStore } from './changes/committed-changes'
export type { CommittedChangesStore } from './changes/committed-changes'
