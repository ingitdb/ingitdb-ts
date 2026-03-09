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

### 4. Firestore Cloud Storage (Planned)

Cloud-based pending changes storage using Google Cloud Firestore, enabling continuity across multiple devices and seamless synchronization.

**Implementation:**
- **Library:** `@ingitdb/firestore` (under development)
- **Backend:** Google Cloud Firestore
- **Collection Structure:** `users/{userId}/pending-changes/{changeId}`
- **Real-time Sync:** Firestore listeners for live updates across devices

**Characteristics:**
- **Multi-Device Continuity:** Access and edit pending changes on any authenticated device
- **Cloud Persistence:** Offsite backup of draft changes; resilient to device loss
- **Real-Time Synchronization:** Live updates when changes are made on other devices
- **Network Efficiency:** Only syncs changed fields using Firestore's delta updates
- **Offline Support:** Local caching with automatic sync when connectivity restored
- **Authentication:** Integrated with Firebase Authentication
- **Scalability:** Serverless architecture handles any number of users/devices
- **Cost:** Pay-per-read/write model; minimal cost for inactive users

**Planned Features:**
- Real-time presence indicators (see who else is editing)
- Automatic conflict resolution with last-write-wins or custom merging
- Change history and audit logs in Firestore
- Cross-device notifications when changes are committed
- Selective sync (choose which device syncs which changes)
- Encryption at rest (Firebase Security Rules + client-side encryption option)

**Key Methods:**

```typescript
import { createFirestorePendingChangesStore } from '@ingitdb/firestore'
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

const firebaseApp = initializeApp({ /* config */ })
const firestore = getFirestore(firebaseApp)
const auth = getAuth(firebaseApp)

const store = createFirestorePendingChangesStore(firestore, auth)

// Load pending changes synced across devices
const changes = await store.loadForCollection(userId, repo, branch, collectionId)

// Stage a change (automatically synced to cloud)
await store.stageDelete({ userId, repo, branch, collectionId, recordId })

// Listen for real-time changes from other devices
store.onChangesUpdated((changes) => {
  console.log('Changes updated from another device:', changes)
})

// Commit changes (clears pending state across all devices)
await store.commitAll({ userId, repo, branch, message: 'User edits' })
```

**Use Cases:**
1. **Mobile + Desktop Workflows:** Start editing on phone, continue on laptop seamlessly
2. **Team Collaboration:** Share pending changes across team members' devices (with permissions)
3. **Disaster Recovery:** Never lose draft edits—they're automatically backed up to cloud
4. **Offline-First + Cloud:** Combine local IndexedDB with Firestore sync for best of both
5. **Multi-Tab Consistency:** Keep pending changes in sync across browser tabs/windows

**Configuration:**

```typescript
// Simple setup with Firebase config
const store = createFirestorePendingChangesStore(firestore, auth, {
  syncInterval: 5000,           // Sync every 5 seconds (optional)
  encryptChanges: true,         // Client-side encryption (optional)
  conflictResolution: 'last-write-wins', // or 'manual' for UI resolution
})
```

**Security Considerations:**
- Firestore Security Rules restrict access to the authenticated user's own pending changes
- Optional client-side encryption layer for sensitive data
- Changes are cleared from cloud storage after successful Git commit
- Audit trail available for compliance requirements

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
| Firestore | ✓ | ✓ | ✓ | ✓ | ✓ (Firebase SDK support) |

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

1. **Partial Commits:** Commit a subset of pending changes, not all at once (all backends)
2. **Draft Management:** Save, load, and manage multiple named draft sets (Firestore)
3. **Conflict Detection:** Detect if a record was edited server-side while pending (Firestore planned)
4. **Encryption:** Client-side encryption for sensitive pending changes (Firestore planned)
5. **Team Collaboration:** Share pending changes with team members (Firestore planned)
6. **PouchDB Integration:** Full offline-first sync with conflict resolution (planned)
7. **Analytics:** Track pending change patterns, commit frequency, and size metrics (Firestore planned)
8. **Mobile Push Notifications:** Notify when changes are synced or conflicts detected (Firestore planned)

---

## See Also

- [`pouchdb-integration.md`](./pouchdb-integration.md) — Planned PouchDB integration
- `@ingitdb/firestore` — Cloud-based pending changes (planned library)
- [Implementation: `packages/client-github/src/changes/pending-changes.ts`](../../packages/client-github/src/changes/pending-changes.ts) — IndexedDB implementation
- [Tests: `packages/client-github/src/changes/pending-changes.spec.ts`](../../packages/client-github/src/changes/pending-changes.spec.ts)
