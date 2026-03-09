# Pending Changes Management

## Overview

Pending changes are user edits that have been made locally but not yet committed to the Git repository. inGitDB stores these changes in the user's browser until they are explicitly pushed to the Git server.

This document describes how pending changes are managed, storage options, and the implementation details.

---

## Storage Options

### 1. In-Memory Storage (Default)

Changes are stored in memory while the browser session is active.

**Characteristics:**
- **Volatility:** Changes are lost on page refresh or tab close
- **Performance:** Instant access to pending changes
- **Privacy:** No persistent data on disk
- **Use case:** Short-lived edits, demos, or when persistence is not required

**Example:**
```typescript
const changes: Map<string, PendingChange> = new Map()
```

---

### 2. IndexedDB Persistence (Implemented)

Changes are persistently stored in the browser's IndexedDB database, surviving page refreshes and browser restarts.

**Implementation:**
- **Location:** [`packages/client-github/src/changes/pending-changes.ts`](../../packages/client-github/src/changes/pending-changes.ts)
- **Database:** Named `ingitdb-pending`
- **Schema:** Composite key `[userId, repo, branch, collectionId, recordId]`
- **Indexes:**
  - `by-context` — lookup changes for a specific collection
  - `by-repo-branch` — lookup all changes for a repo/branch

**Characteristics:**
- **Durability:** Changes persisted to browser storage (survives refreshes)
- **Capacity:** Typically 50MB+ per domain (browser-dependent)
- **Performance:** Sub-millisecond lookup times via indexes
- **User Control:** Users can explicitly clear pending changes or the entire storage
- **API:** Uses the `idb` library for type-safe IndexedDB access

**Key Methods:**

```typescript
// Load pending changes for a collection
const changes = await loadForCollection(userId, repo, branch, collectionId)

// Load all pending changes for a repo/branch
const allChanges = await loadForRepoBranch(userId, repo, branch)

// Stage a deletion
await stageDelete({ userId, repo, branch, collectionId, recordId })

// Unstage a change
await unstage({ userId, repo, branch, collectionId, recordId })

// Commit all pending changes to Git
await commitAll({ userId, repo, branch, message: 'User edits' })
```

---

### 3. PouchDB Synchronization (Planned)

Future integration with PouchDB/CouchDB for richer synchronization semantics.

**Planned Features:**
- Leverage PouchDB's built-in change tracking and conflict resolution
- Automatic sync with CouchDB-compatible servers (including inGitDB's planned CouchDB adapter)
- Advanced conflict detection: detect when the same record was edited offline and on server
- Automatic conflict markers with manual resolution workflow
- Continuous background sync with configurable intervals

**Related Documentation:**
- See [`pouchdb-integration.md`](./pouchdb-integration.md) for full details on PouchDB integration roadmap

---

## Change Lifecycle

### 1. Staging Changes

When a user edits a record:

1. The edit is applied locally (in-memory or persisted to IndexedDB)
2. The change is marked as "pending" with metadata:
   - `changeType` — `'delete'` | `'update'` | `'create'` (currently only delete is supported)
   - `originalData` — snapshot of the original record
   - `pendingData` — snapshot of the edited record
   - `changedFields` — array of field names that were modified
   - `createdAt` / `updatedAt` — timestamps

### 2. Viewing Pending Changes

Users can inspect all pending changes for a repository or collection:

```typescript
// View pending deletions
const pendingDeletions = await pendingChangesStore.loadForCollection(
  userId,
  'owner/repo',
  'main',
  'countries'
)

pendingDeletions.forEach(change => {
  console.log(`${change.recordId}: ${change.changeType}`)
})
```

### 3. Committing Changes

When the user is ready to push:

```typescript
await pendingChangesStore.commitAll({
  userId,
  repo: 'owner/repo',
  branch: 'main',
  message: 'User edits'
})
```

This:
1. Resolves file paths for all pending changes
2. Groups changes by repo/branch
3. Creates a Git commit with the changes
4. Clears the pending changes from storage
5. Optionally updates the committed changes log (for audit/history)

---

## Data Structure

### PendingChange

```typescript
interface PendingChange {
  userId: string                    // User ID
  repo: string                      // GitHub repo (owner/repo)
  branch: string                    // Git branch
  collectionId: string              // inGitDB collection ID
  recordId: string                  // Record ID within collection
  changeType: 'delete' | 'update' | 'create'
  originalData: Record<string, unknown> | null  // Pre-edit state
  pendingData: Record<string, unknown> | null   // Post-edit state
  changedFields: string[]           // Field names that changed
  createdAt: string                 // ISO timestamp
  updatedAt: string                 // ISO timestamp
}
```

---

## Browser Compatibility

| Storage Option | Chrome | Firefox | Safari | Edge | Mobile |
|---|---|---|---|---|---|
| In-Memory | ✓ | ✓ | ✓ | ✓ | ✓ |
| IndexedDB | ✓ | ✓ | ✓ | ✓ | ✓ (11.3+) |
| PouchDB | ✓ | ✓ | ✓ | ✓ | ✓ (planned) |

---

## Privacy & Security

### IndexedDB Storage

- **Scope:** Data is isolated per origin (protocol + domain + port)
- **Encryption:** Not encrypted by default; browser storage is readable if device is compromised
- **Clearing:** Users can clear all data via browser settings or programmatically
- **User Control:** Explicitly stage/unstage changes before commit

### Recommendations

1. **Production Use:** Consider encrypting sensitive pending changes before persisting to IndexedDB
2. **Shared Devices:** Remind users to clear pending changes before leaving a shared computer
3. **Offline Draft:** PouchDB (future) will add encryption and conflict resolution options

---

## Configuration

### Disabling Persistence

To use only in-memory storage (no IndexedDB):

```typescript
// Option 1: Skip IndexedDB entirely
const memoryOnlyChanges = new Map<string, PendingChange>()

// Option 2: Create client without persistence
const client = createIngitDbClient({
  token: 'ghp_...',
  // pending changes will use in-memory storage only
})
```

### Custom Storage Backend

To use a custom storage backend:

```typescript
const customStore: PendingChangesStore = {
  loadForCollection: async (...) => { /* your implementation */ },
  loadForRepoBranch: async (...) => { /* your implementation */ },
  stageDelete: async (...) => { /* your implementation */ },
  unstage: async (...) => { /* your implementation */ },
  commitAll: async (...) => { /* your implementation */ },
}
```

---

## Future Enhancements

1. **Partial Commits:** Commit a subset of pending changes, not all at once
2. **Draft Management:** Save, load, and manage multiple draft sets
3. **Conflict Detection:** Detect if a record was edited server-side while pending
4. **Encryption:** Encrypt pending changes in IndexedDB for sensitive data
5. **Cloud Backup:** Optional server-side pending changes backup (encrypted)
6. **PouchDB Integration:** Full offline-first sync with conflict resolution

---

## See Also

- [`pouchdb-integration.md`](./pouchdb-integration.md) — Planned PouchDB integration
- [Implementation: `packages/client-github/src/changes/pending-changes.ts`](../../packages/client-github/src/changes/pending-changes.ts)
- [Tests: `packages/client-github/src/changes/pending-changes.spec.ts`](../../packages/client-github/src/changes/pending-changes.spec.ts)
