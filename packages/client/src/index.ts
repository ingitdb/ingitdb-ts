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
export { parseCacheControl, effectiveCacheControl, isPinned, freshnessTtlMs, MAX_DELTA_SECONDS, IMMUTABLE_TTL_SECONDS } from './cache/cache-control'
export type { ParsedCacheControl, FreshnessInput } from './cache/cache-control'

// ─── Schema ──────────────────────────────────────────────────────────────────
export { parseCollectionSchema, normalizeCollectionSchema } from './schema/schema'
export type { CollectionSchema, ColumnDef } from './schema/schema'

// ─── YAML Utilities ──────────────────────────────────────────────────────────
export { parseYaml, stringifyYaml } from './utils/yaml'

// ─── Change Management ──────────────────────────────────────────────────────
export { createCommittedChangesStore } from './changes/committed-changes'
