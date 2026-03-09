// ─── Collection ──────────────────────────────────────────────────────────────
export type RecordRow = Record<string, unknown>

export interface RecordData {
  _path: string
  _sha?: string
  [key: string]: unknown
}

export interface FKView {
  refColId: string
  fkField: string
  columns: string[]
  columnTypes: Record<string, string>
  records: Record<string, unknown>[]
}

// ─── Database Config ─────────────────────────────────────────────────────────
export interface CollectionEntry { id: string; path: string }

export interface DatabaseConfig {
  rawYaml: string
  collections: CollectionEntry[]
  views: unknown[]
  triggers: unknown[]
  subscribers: unknown[]
}

// ─── Repository ──────────────────────────────────────────────────────────────
export interface RepoMeta {
  permissions?: { push?: boolean }
  [key: string]: unknown
}

export interface RepoSettings {
  languages: { required?: string; optional?: string }[]
}

// ─── Change Management ───────────────────────────────────────────────────────
export interface PendingChange {
  userId: string
  repo: string
  branch: string
  collectionId: string
  recordId: string
  changeType: 'create' | 'update' | 'delete'
  originalData: Record<string, unknown> | null
  pendingData: Record<string, unknown> | null
  changedFields: string[]
  createdAt: string
  updatedAt: string
}

export interface CommittedChangesStore {
  add(changes: PendingChange[]): Promise<void>
  loadForCollection(userId: string, repo: string, branch: string, collectionId: string): Promise<PendingChange[]>
  removeSettled(userId: string, repo: string, branch: string, collectionId: string, settledIds: string[]): Promise<void>
  isCommittedDeletion(recordId: string): boolean
}

export interface PendingChangesStore {
  stageDelete(params: {
    userId: string; repo: string; branch: string; collectionId: string; recordId: string
  }): Promise<void>
  unstage(params: {
    userId: string; repo: string; branch: string; collectionId: string; recordId: string
  }): Promise<void>
  loadForCollection(userId: string, repo: string, branch: string, collectionId: string): Promise<PendingChange[]>
  loadForRepoBranch(userId: string, repo: string, branch: string): Promise<PendingChange[]>
  commitAll(params: {
    userId: string; repo: string; branch: string; message: string
  }, committedChangesStore?: CommittedChangesStore): Promise<void>
  clearAll(userId: string, repo: string, branch: string): Promise<void>
}
