// ─── Client Facade ────────────────────────────────────────────────────────────
export { createIngitDbClient } from './client'
export type { IngitDbGithubClient } from './client'
export type { IngitDbClientOptions } from '@ingitdb/client'

// ─── GitHub API ───────────────────────────────────────────────────────────────
export { createGithubApi, buildCommitMessage } from './github/github-api'
export type {
  GithubApi,
  RateLimit,
  FileTextResult,
  PutFileParams,
  DeleteFileParams
} from './github/github-api'

// ─── Change Management ────────────────────────────────────────────────────────
export { createPendingChangesStore } from './changes/pending-changes'
export { createIdbCommittedChangesStore } from './changes/idb-committed-changes'

// ─── Cache ───────────────────────────────────────────────────────────────────
export { idbCache } from './cache/idb-cache'

// ─── Implementation Functions ─────────────────────────────────────────────────
export {
  resolveCollectionPath,
  loadCollectionSchema,
  loadCollectionRecords,
  resolveDataPath
} from './collection/collection'
export type { CollectionDeps } from './collection/collection'

export { loadRecord } from './collection/record'
export type { RecordDeps } from './collection/record'

export { loadFKViews } from './collection/fk-views'
export type { FKViewDeps } from './collection/fk-views'

export { loadDatabaseConfig } from './database/database-config'
export type { DatabaseConfigDeps } from './database/database-config'

export { loadRepoMeta } from './repo/repo'
export type { RepoDeps } from './repo/repo'

export {
  loadRepoSettings,
  getRequiredLanguages,
  getOptionalLanguages,
  getAllSupportedLanguages
} from './repo/repo-settings'
export type { RepoSettingsDeps } from './repo/repo-settings'
