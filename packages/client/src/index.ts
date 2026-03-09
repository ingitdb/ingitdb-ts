// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  RecordRow, RecordData, FKView,
  CollectionEntry, DatabaseConfig,
  RepoMeta, RepoSettings,
  PendingChange, PendingChangesStore, CommittedChangesStore
} from './types'

// ─── Client Interface ────────────────────────────────────────────────────────
export type { IngitDbClient, IngitDbClientOptions } from './client'

// ─── Cache ───────────────────────────────────────────────────────────────────
export { cache, createCache, buildCacheKey } from './cache/cache'
export type { Cache, StorageAdapter } from './cache/cache'

// ─── Schema ──────────────────────────────────────────────────────────────────
export { parseCollectionSchema, normalizeCollectionSchema } from './schema/schema'
export type { CollectionSchema, ColumnDef } from './schema/schema'

// ─── YAML Utilities ──────────────────────────────────────────────────────────
export { parseYaml, stringifyYaml } from './utils/yaml'

// ─── Change Management ──────────────────────────────────────────────────────
export { createCommittedChangesStore } from './changes/committed-changes'
