# PouchDB Integration

## Overview

This document outlines the integration of PouchDB/CouchDB with inGitDB to enable offline-first capabilities, local data caching, and seamless synchronization with Git-backed data repositories.

---

## Why PouchDB/CouchDB Integration?

### Strategic Advantages

1. **Offline-First Architecture**
   - PouchDB is purpose-built for offline-first applications. It enables full read/write capability on the client even when the server is unavailable.
   - Users can continue working with cached data, and all changes are automatically queued for sync when connectivity is restored.

2. **Proven Synchronization Protocol**
   - The CouchDB replication protocol is battle-tested across hundreds of thousands of deployments.
   - PouchDB implements this protocol faithfully, ensuring reliable bi-directional sync between client and server.
   - No need to invent custom sync logic—leverage decades of distributed database expertise.

3. **Git as the Canonical Store**
   - By implementing a CouchDB-compatible HTTP API layer over inGitDB (Approach A from the proposal), we make Git the single source of truth.
   - Every sync becomes a reviewable Git commit, enabling full audit trails and code review of data changes.
   - AI agents and CI/CD pipelines can inspect data history alongside code history.

4. **Unlocking the PouchDB Ecosystem**
   - PouchDB has a mature ecosystem of tools, libraries, and plugins for offline-first web and mobile apps.
   - Existing PouchDB applications can use inGitDB as a sync target without modification—just point to a different URL.
   - Enables zero-friction adoption for teams already familiar with PouchDB patterns.

5. **Modern Web App Experience**
   - Users get instant UI responsiveness—no waiting for server round-trips on every action.
   - Network reliability is decoupled from app usability.
   - Pending changes are visually queued and synced in the background, improving perceived performance.

---

## Core Features

### 1. Local Caching of Collections and View Data

Store frequently accessed collections and computed views locally in the browser or Node.js environment:

- **What gets cached:**
  - Full collection documents (optionally filtered by query/selector)
  - Materialized view results
  - Metadata (document counts, update sequences, schema definitions)

- **How it works:**
  - PouchDB automatically maintains a local store (IndexedDB in browsers, LevelDB in Node.js)
  - On first sync, inGitDB data is replicated to the local PouchDB instance
  - Subsequent reads come from local storage at sub-millisecond latency
  - Background sync keeps the cache fresh without blocking the UI

- **Benefits:**
  - Instant data availability without network latency
  - Reduced server load through local caching
  - Improved mobile performance on high-latency networks

---

### 2. Pending Changes Management

Store uncommitted and/or unpushed changes locally as an alternative or complement to IndexedDB:

- **What gets tracked:**
  - New documents created offline
  - Edits to existing documents
  - Marked-for-deletion documents
  - Merge conflict resolutions

- **Storage Options:**
  - **Default:** PouchDB's built-in store (IndexedDB/LevelDB)
  - **Alternative:** Custom store adapters for specialized use cases (file-based, encrypted, etc.)
  - **Browser-side:** Leverages browser's persistent storage for safe offline drafting
  - **Server-side:** Optional checkpoint mechanism for disaster recovery

- **Change Tracking:**
  - Dirty flag on each document (changed locally but not synced)
  - Generation counter to detect conflicts
  - Automatic conflict markers visible in the UI

- **Benefits:**
  - Never lose user edits due to network failures
  - Explicit visibility of what's waiting to be synced
  - Seamless conflict detection when syncing resumes

---

### 3. Pro-Active Background Pre-loading and Caching

Intelligently pre-fetch and cache relevant data in the background:

- **Smart Prefetching Strategies:**
  - Predictive loading based on user navigation patterns (next likely pages/sections)
  - Eager loading of related documents (e.g., load all records in a collection when viewing one)
  - Scheduled background sync during idle time (e.g., every 5 minutes when user is inactive)

- **Implementation Approach:**
  - Leverage PouchDB's `continuous: true` changes feed to stay synchronized in the background
  - Use the browser's idle callback API or service worker to perform prefetch without blocking main thread
  - Periodic background sync in Node.js via scheduled tasks

- **Cache Invalidation:**
  - Time-based expiry (optional: refresh cache every N minutes)
  - Event-based invalidation (when user navigates to a new section)
  - Server-driven invalidation (server signals which docs have changed via the changes feed)

- **Benefits:**
  - Seamless, instant access to preloaded data
  - Reduced perceived latency for common workflows
  - Minimal server impact—efficient delta sync, not full refreshes

---

### 4. Offline Capability: View, Edit, and Sync

Full offline support with seamless transition to online:

- **Offline Read Operations:**
  - Query local cache using PouchDB's allDocs, find, and spatial query APIs
  - Access computed views stored locally
  - Full text search via local indexes

- **Offline Write Operations:**
  - Create, update, delete documents locally
  - All changes are persisted to local storage immediately
  - UI reflects changes instantly (optimistic updates)

- **Conflict Detection & Resolution:**
  - PouchDB detects when the same document was edited offline and on server
  - Conflicts are marked with `_conflicts` metadata
  - User can manually resolve using a conflict resolution UI
  - Or use deterministic conflict resolution rules (last-write-wins, custom merge logic)
  - Resolved conflicts become Git commits, preserving full history

- **Reconnection Handling:**
  - When network is restored, PouchDB automatically initiates sync
  - Pending changes are pushed to inGitDB (creating new commits)
  - Server changes are pulled into local store
  - Conflicts are surfaced and resolved before completing sync

- **Replication Checkpoints:**
  - PouchDB stores replication checkpoints locally
  - On reconnect, sync resumes from the last checkpoint, not from the beginning
  - Minimizes bandwidth on intermittent connections

- **Benefits:**
  - True offline capability—no degraded experience
  - Seamless reconnection—users don't need to manually trigger sync
  - Full data integrity—conflicts are explicit and resolvable

---

## Implementation Architecture

### Component: inGitDB CouchDB Adapter

A new HTTP server that speaks the CouchDB replication protocol:

```
┌─────────────────────┐
│   PouchDB Client    │  (Browser or Node.js)
│  (offline-first)    │
└──────────┬──────────┘
           │
           │ CouchDB protocol
           │ (HTTP REST + changes feed)
           │
    ┌──────▼───────────────┐
    │  inGitDB CouchDB     │
    │  HTTP Adapter        │
    │  (/db, /_changes,    │
    │   /_bulk_docs, etc)  │
    └──────┬───────────────┘
           │
    ┌──────▼────────────┐
    │   inGitDB Core    │
    │  (Collections,    │
    │   Git operations) │
    └───────┬───────────┘
            │
    ┌───────▼──────────┐
    │   Git Repository │
    │  (canonical data)│
    └──────────────────┘
```

### Mapping CouchDB → inGitDB

| CouchDB Concept | inGitDB Mapping |
|---|---|
| Database | Collection (root collection) |
| Document `_id` | Hierarchical path encoded as flat string (see Nested Collections below) |
| Document `_rev` | Computed from Git commit SHA + generation counter |
| `_changes` feed | `git log` of collection directory tree |
| `_bulk_docs` | Batch commit with message `couch: sync from <source>` |
| Pending changes | PouchDB's local database |
| Conflict documents | Git branches or conflict markers |

---

## Handling Nested Subcollections

### The Challenge

inGitDB supports hierarchical nested subcollections (e.g., `root_collection/root_id/sub_collection_1/sub_id_1/sub_sub_collection/...`), but PouchDB/CouchDB have a flat document namespace with a single `_id` field per document.

### Solution: Hierarchical Document IDs

Map nested inGitDB records to flat CouchDB documents by encoding the full path into the document `_id`:

**Naming Convention:**
```
{root_collection}/{root_record_id}/{sub_collection_1}/{sub_record_id_1}/{sub_collection_2}/{sub_record_id_2}/...
```

**Examples:**

| inGitDB Path | CouchDB Document `_id` |
|---|---|
| `users/alice` | `users/alice` |
| `users/alice/projects/proj-1` | `users/alice/projects/proj-1` |
| `users/alice/projects/proj-1/tasks/task-101` | `users/alice/projects/proj-1/tasks/task-101` |
| `organizations/acme/teams/eng/members/bob` | `organizations/acme/teams/eng/members/bob` |

### Implementation Details

#### 1. Document Structure
```javascript
// A nested record from inGitDB
{
  _id: "users/alice/projects/proj-1/tasks/task-101",
  _rev: "4-abc123def456",
  title: "Implement PouchDB sync",
  status: "in-progress",
  assignee: "bob",
  // ... other fields from inGitDB record
}
```

The `_id` is transparent to the client—PouchDB handles it as a regular document ID. The adapter translates it to/from the nested inGitDB path on read/write.

#### 2. CouchDB Adapter Translation

**Outbound (inGitDB → PouchDB):**
- Read nested record from `users/alice/projects/proj-1/tasks/task-101.json` in Git
- Construct document with `_id: "users/alice/projects/proj-1/tasks/task-101"`
- Compute `_rev` from Git history of that file
- Return to PouchDB

**Inbound (PouchDB → inGitDB):**
- Receive document with `_id: "users/alice/projects/proj-1/tasks/task-101"`
- Parse the path to extract: collection structure and intermediate IDs
- Create/update nested record at `users/alice/projects/proj-1/tasks/task-101.json`
- Create intermediate collections as needed (idempotent)
- Commit to Git with message `couch: sync from <source>`

#### 3. Changes Feed Translation

The `GET /{db}/_changes` feed must normalize nested paths:

```
git log --reverse --all -- users/alice/projects/proj-1/tasks/

Outputs:
  commit 1: users/alice/projects/proj-1/tasks/task-101.json (created)
  commit 2: users/alice/projects/proj-1/tasks/task-101.json (modified)
  commit 3: users/alice/projects/proj-1/tasks/task-102.json (created)
```

Adapter converts to:
```javascript
{
  seq: "abc123",
  id: "users/alice/projects/proj-1/tasks/task-101",
  changes: [{ key: "2-xyz789", id: "..." }]
}
{
  seq: "def456",
  id: "users/alice/projects/proj-1/tasks/task-102",
  changes: [{ key: "1-abc789", id: "..." }]
}
```

### Querying Nested Data

#### Selector-Based Queries

PouchDB's `find()` API works naturally:

```javascript
// Query all tasks in a specific project
const tasks = await pouchdb.find({
  selector: {
    _id: { $regex: "^users/alice/projects/proj-1/tasks/" }
  }
});

// Query all projects for a user
const projects = await pouchdb.find({
  selector: {
    _id: { $regex: "^users/alice/projects/[^/]+$" }
  }
});
```

#### Design Documents / Views Limitations

CouchDB MapReduce views cannot directly traverse nested relationships (they see flat documents). Options:

1. **Materialized Views in inGitDB:** Pre-compute aggregations (e.g., "all tasks by project") and expose them as separate flat documents
2. **Client-Side Views:** Use PouchDB's `allDocs()` with filtering logic in JavaScript
3. **Indexed Queries:** Store denormalized references in flat documents (e.g., task document includes `project_id` and `user_id` for indexing)

### Consistency & Integrity

#### Referential Integrity
Since nested collections are part of the path, deletion semantics matter:

- **Deleting a parent record** (e.g., `users/alice`): Should we cascade-delete all nested records?
  - Option A: Adapter deletes all records under `users/alice/*` (dangerous, requires explicit confirmation)
  - Option B: Only delete the parent record; require explicit deletion of nested records (safer)
  - Recommend: **Option B** (explicit). inGitDB schema can enforce this constraint.

- **Orphaned Records:** If a parent is deleted, nested records become unreachable via the path. Options:
  - Store as top-level documents with a `parent_id` field for recovery
  - Use Git's history to reconstruct the relationship

#### Concurrent Writes
Two clients editing nested records under the same parent:

```
User A: Write to users/alice/projects/proj-1/tasks/task-101
User B: Write to users/alice/projects/proj-1/tasks/task-102
```

Both changes go to the same Git commit scope. inGitDB's conflict resolver handles this. No special handling needed.

### Size & Performance Considerations

1. **Document ID Length**
   - Deeply nested paths can produce long `_id` strings (100+ characters)
   - CouchDB has no hard limit on `_id` length; PouchDB inherits this
   - In practice, 5-10 levels of nesting is reasonable

2. **Replication Efficiency**
   - All nested records are treated as independent documents by the replication protocol
   - Changing a deeply nested record still syncs only that record (not the parent or siblings)
   - Efficient for partial replication (sync only relevant nested subtrees)

3. **Storage**
   - Each nested record becomes a separate CouchDB document
   - Minimal overhead—no denormalization needed unless building views
   - Git's compression handles duplicate content naturally

### Example: Multi-Tenant SaaS Data Model

```
organizations/acme
  ├── teams/eng
  │   ├── members/alice
  │   ├── members/bob
  │   └── projects/proj-1
  │       ├── tasks/task-101
  │       │   └── comments/comment-1
  │       └── tasks/task-102
  └── teams/sales
      ├── members/charlie
      └── projects/proj-2
```

**PouchDB Documents:**
```
_id: "organizations/acme"
_id: "organizations/acme/teams/eng"
_id: "organizations/acme/teams/eng/members/alice"
_id: "organizations/acme/teams/eng/projects/proj-1"
_id: "organizations/acme/teams/eng/projects/proj-1/tasks/task-101"
_id: "organizations/acme/teams/eng/projects/proj-1/tasks/task-101/comments/comment-1"
... (and so on)
```

Each document can be independently queried, cached, and synced by PouchDB. The client can build a hierarchical UI by grouping results by path prefix.

---

## Implementation Phases

### Phase 1: Read-Only Compatibility
- Implement: `GET /`, `GET /{db}`, `GET /{db}/_all_docs`, `GET /{db}/{docId}`
- Implement: `GET /{db}/_changes`, `POST /{db}/_revs_diff`, `POST /{db}/_bulk_get`
- Outcome: PouchDB can pull (replicate from) inGitDB. Existing inGitDB repos become data sources for offline-first apps.

### Phase 2: Write Compatibility
- Add: `PUT /{db}/{docId}`, `DELETE /{db}/{docId}`, `POST /{db}/_bulk_docs`
- Implement schema validation and conflict detection
- Outcome: PouchDB can push (replicate to) inGitDB. Browser edits become Git commits.

### Phase 3: Continuous Changes Feed
- Implement: `GET /{db}/_changes?feed=longpoll` and `?feed=continuous`
- Powered by inGitDB Watcher component
- Outcome: Live sync—browser sees inGitDB changes in real time, and vice versa.

### Phase 4: Conflict Resolution UI
- Expose CouchDB conflict documents (`_conflicts` array)
- Integrate with inGitDB Merge Conflict Resolver TUI
- Outcome: Full offline-first conflict semantics resolved through Git tooling.

---

## Example: Offline-First Todo App

### Scenario
A user is building a todo list app that syncs with inGitDB.

1. **Initial Load (Online)**
   - App fetches collection schema and existing todos from inGitDB via PouchDB
   - All data is replicated to local PouchDB (IndexedDB)
   - Background sync starts continuously

2. **Offline Editing**
   - User creates 5 new todos (local writes, no network request)
   - User marks 3 todos as complete
   - All changes stored locally; UI updates instantly
   - User sees a "pending" badge on the todos

3. **Network Restored**
   - PouchDB detects connectivity
   - Automatically pushes 8 local changes as a single Git commit: `couch: sync from browser`
   - Pulls any server-side changes (e.g., another client created todos)
   - Conflict detection runs; if conflicts exist, user is prompted to resolve

4. **Result**
   - All changes are Git commits, visible in the repo history
   - AI agents can analyze todo trends from the versioned data
   - Code review can see how the app's data evolved

---

## Security & Authentication

- **Phase 1 Implementation:** Unauthenticated (localhost only, or internal network)
- **Future Phases:**
  - HTTP Basic Auth or token-based authentication
  - Session cookies compatible with existing inGitDB auth layer
  - Fine-grained permissions (read vs. read-write per collection)

---

## Open Questions & Future Work

1. **Multi-Collection Routing**
   - How should hierarchical inGitDB collections map to flat CouchDB databases?
   - Suggestion: Use URL-safe encoded paths (e.g., `/group__subgroup__collection`)

2. **Design Documents & Views**
   - CouchDB `_design` documents (MapReduce views) are widely used
   - Minimal strategy: accept and ignore unknown design docs to prevent replication breakage
   - Advanced strategy: map PouchDB query plugins to inGitDB materialized views

3. **Attachment Support**
   - CouchDB has a built-in attachment mechanism
   - Consider mapping to inGitDB file blobs or external object storage (S3, etc.)

4. **PouchDB Adapter Alternative**
   - Instead of an HTTP server, publish a custom PouchDB adapter (`pouchdb-adapter-ingitdb`)
   - Direct client-side access to inGitDB (via GitHub API or filesystem)
   - Eliminates HTTP layer for Node.js/browser use cases
   - Could complement (not replace) the HTTP server approach

---

## References

- [CouchDB HTTP API Reference](https://docs.couchdb.org/en/stable/api/index.html)
- [CouchDB Replication Protocol](https://docs.couchdb.org/en/stable/replication/protocol.html)
- [PouchDB Documentation](https://pouchdb.com/guides/)
- [PouchDB Custom Adapters](https://pouchdb.com/guides/adapters.html)
- [Proposal 001: CouchDB/PouchDB Integration](../../ingitdb-specs/proposals/001-couchdb-pouchdb-integration.md)
