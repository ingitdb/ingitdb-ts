# Decoupling `ingitdb-ws` → `@ingitdb/client`

## 1. Background & Motivation

`ingitdb-ws` (the Vue SPA at `ingitdb-web-app`) is the only client that currently knows how to:

- Talk to the GitHub REST API
- Parse collection schemas (`.collection/definition.yaml`)
- Load database config (`.ingitdb/root-collections.yaml`)
- Load/save YAML records from a repo
- Stage and commit pending deletions via the Git Tree API
- Cache responses in memory + IndexedDB

All of this logic is **embedded in Vue composables**, tightly coupled to Vue's `ref()` / reactivity. Any other application (CLI, another UI framework, server-side tooling, tests) must re-implement it from scratch.

**Goal:** Extract the framework-agnostic core into `ingitdb-client-ts/` as a standalone TypeScript library published to NPM as `@ingitdb/client`. `ingitdb-ws` is then refactored to consume it through thin Vue wrapper composables.

---

## 2. Package Name

**Chosen:** `@ingitdb/client`

The `@ingitdb/client` package inside `ingitdb-ts` (the older Angular/NX monorepo) is essentially a collection of unimplemented stubs using Angular/RxJS. It should be deprecated in favour of this proper implementation. The new library:

- Uses plain `async/await` (no RxJS)
- Has zero framework dependencies
- Works in browser and Node.js

---

## 3. Scope: What Gets Extracted

### 3.1 From `ingitdb-ws/app/api/github.ts`

Create `src/github/github-api.ts`.

**Changes vs original:**
- Remove Vue `ref` for `rateLimit` — expose rate-limit info via a callback or return value.
- Accept GitHub token as a constructor/factory parameter instead of reading from Vue state.
- Keep all method signatures identical.

**Public exports:** `GithubApi`, `createGithubApi(token?: string): GithubApi`, all param/result interfaces.

---

### 3.2 From `ingitdb-ws/app/cache/`

Create `src/cache/idb-cache.ts` and `src/cache/cache.ts`.

**Changes vs original:**
- Zero changes to logic — both files are already framework-agnostic.
- `idb` remains a peer/bundled dependency.
- Cache is optional: consumers can disable it or inject a custom implementation.

**Public exports:** `Cache`, `CacheOptions`, `buildCacheKey`, `createCache(options?): Cache`.

---

### 3.3 From `ingitdb-ws/app/utils/schema.ts`

Create `src/schema/schema.ts`.

**Changes vs original:** None — already pure TypeScript, no framework dependencies.

**Public exports:** `CollectionSchema`, `ColumnDef`, `parseCollectionSchema`, `normalizeCollectionSchema`.

---

### 3.4 From `ingitdb-ws/app/utils/yaml.ts`

Create `src/utils/yaml.ts`.

**Changes vs original:** None — already pure TypeScript.

**Public exports:** `parseYaml`, `stringifyYaml`.

---

### 3.5 From `ingitdb-ws/app/composables/useDatabaseConfig.ts`

Create `src/database/database-config.ts`.

**Changes vs original:**
- Remove Vue `ref` state — function returns data directly.
- Accept `GithubApi` and `Cache` as parameters (dependency injection).
- `loadConfig(repo, branch?, options?)` returns `Promise<DatabaseConfig>`.

**Types:**
```ts
interface CollectionEntry { id: string; path: string }
interface DatabaseConfig {
  rawYaml: string
  collections: CollectionEntry[]
  views: unknown[]
  triggers: unknown[]
  subscribers: unknown[]
}
```

---

### 3.6 From `ingitdb-ws/app/composables/useCollection.ts`

Create `src/collection/collection.ts`.

**Changes vs original:**
- Remove Vue `ref` state — functions return data directly.
- Accept `GithubApi` and `Cache` as parameters.
- `resolveCollectionPath`, `loadSchema`, `loadRecords` become standalone async functions.
- `resolveDataPath` stays as a pure utility.

**Public exports:** `loadCollectionSchema`, `loadCollectionRecords`, `resolveCollectionPath`, `resolveDataPath`, `CollectionSchema`, `RecordRow`.

---

### 3.7 From `ingitdb-ws/app/composables/useRecord.ts`

Create `src/collection/record.ts`.

**Changes vs original:**
- Remove Vue `ref` state — `loadRecord` returns `RecordData` directly.
- Accept `GithubApi` as parameter.

---

### 3.8 From `ingitdb-ws/app/composables/useRepo.ts`

Create `src/repo/repo.ts`.

**Changes vs original:**
- Remove Vue `ref` state.
- Accept `GithubApi` as parameter.
- In-memory permission cache stays as a module-level `Map` or injected via options.

**Public exports:** `loadRepoMeta`, `RepoMeta`.

---

### 3.9 From `ingitdb-ws/app/composables/useRepoSettings.ts`

Create `src/repo/repo-settings.ts`.

**Changes vs original:**
- Accept `GithubApi` and `Cache` as parameters.
- All helper functions (`getRequiredLanguages`, etc.) stay as pure utilities — no changes needed.

**Public exports:** `loadRepoSettings`, `getRequiredLanguages`, `getOptionalLanguages`, `getAllSupportedLanguages`, `RepoSettings`.

---

### 3.10 From `ingitdb-ws/app/composables/usePendingChanges.ts`

Create `src/changes/pending-changes.ts`.

**Changes vs original:**
- Remove Vue `ref`/`computed` — functions return data directly.
- Remove module-level mutable state; return a `PendingChangesStore` instance from a factory.
- Accept `GithubApi` as a parameter to `commitAll`.
- Keep `idb` dependency for IndexedDB persistence.

**Public exports:** `createPendingChangesStore`, `PendingChangesStore`, `PendingChange`.

---

### 3.11 From `ingitdb-ws/app/composables/useCommittedChanges.ts`

Create `src/changes/committed-changes.ts`.

**Changes vs original:**
- Remove Vue `ref`/`computed`.
- Return a `CommittedChangesStore` instance from a factory.

**Public exports:** `createCommittedChangesStore`, `CommittedChangesStore`.

---

### 3.12 From `ingitdb-ws/app/composables/useFKViews.ts`

Create `src/collection/fk-views.ts`.

**Changes vs original:**
- Remove Vue `ref` state — `loadFKViews` returns data directly.
- Accept `GithubApi` and `Cache` as parameters.

**Public exports:** `loadFKViews`, `FKView`.

---

## 4. Library Design Principles

### 4.1 No Framework Dependencies
Zero runtime dependencies on Vue, Angular, React, or RxJS. Pure TypeScript.

### 4.2 Dependency Injection via Factory
```ts
import { createIngitDbClient } from '@ingitdb/client'

const client = createIngitDbClient({ token: 'ghp_...' })
const schema = await client.loadCollectionSchema('owner/repo', 'main', 'countries')
const records = await client.loadCollectionRecords('owner/repo', 'main', 'countries', schema)
```

### 4.3 Optional Caching
```ts
const client = createIngitDbClient({ token, cache: false })   // no cache
const client = createIngitDbClient({ token, cache: { ttl: 60_000 } })  // custom TTL
const client = createIngitDbClient({ token, cache: myCustomCache })     // BYO cache
```

### 4.4 Platform Targets
- **Browser** — primary target; full IndexedDB cache support
- **Node.js** — supported without IDB cache (memory-only cache fallback)

### 4.5 Dual ESM + CJS Output
Published with both `module` (ESM) and `main` (CJS) entry points so it works in Vite, Webpack, Node, and Jest without config.

### 4.6 Full TypeScript Types
All public APIs have documented TypeScript types exported from the package root.

---

## 5. Proposed File Structure

```
ingitdb-client-ts/
├── src/
│   ├── github/
│   │   └── github-api.ts        # GithubApi + createGithubApi factory
│   ├── cache/
│   │   ├── cache.ts             # Cache interface + in-memory+IDB implementation
│   │   └── idb-cache.ts         # IndexedDB driver (idb library)
│   ├── schema/
│   │   └── schema.ts            # CollectionSchema types + parseCollectionSchema
│   ├── database/
│   │   └── database-config.ts   # loadConfig, CollectionEntry, DatabaseConfig
│   ├── collection/
│   │   ├── collection.ts        # loadCollectionSchema, loadCollectionRecords
│   │   ├── record.ts            # loadRecord, RecordData
│   │   └── fk-views.ts          # loadFKViews, FKView
│   ├── repo/
│   │   ├── repo.ts              # loadRepoMeta, RepoMeta
│   │   └── repo-settings.ts     # loadRepoSettings, helpers
│   ├── changes/
│   │   ├── pending-changes.ts   # PendingChangesStore, createPendingChangesStore
│   │   └── committed-changes.ts # CommittedChangesStore, createCommittedChangesStore
│   ├── utils/
│   │   └── yaml.ts              # parseYaml, stringifyYaml
│   ├── client.ts                # createIngitDbClient top-level facade
│   └── index.ts                 # Public API barrel export
├── docs/
│   └── decoupling-from-ws.md    # This document
├── package.json
├── tsconfig.json
├── vite.config.ts               # Library build (lib mode)
└── README.md
```

---

## 6. package.json

```json
{
  "name": "@ingitdb/client",
  "version": "0.1.0",
  "description": "Framework-agnostic TypeScript client for inGitDB repositories",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "keywords": ["ingitdb", "github", "git", "database", "client"],
  "dependencies": {
    "@ingr/codec": "^0.0.1",
    "axios": "^1.8.4",
    "idb": "^8.0.2",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^7.x",
    "vitest": "^3.x"
  },
  "peerDependencies": {}
}
```

---

## 7. Updating `ingitdb-ws` After Extraction

For each extracted module, the corresponding Vue composable in `ingitdb-ws` becomes a **thin wrapper** that:
1. Imports the pure function from `@ingitdb/client`
2. Wraps it with Vue `ref`/`computed` state + `loading`/`error` pattern
3. Passes the shared `githubToken` state to `createIngitDbClient`

### Example — `useRecord.ts` after refactor

**Before (current):**
```ts
// app/composables/useRecord.ts
import { ref } from 'vue'
import { githubApi } from '@/api/github'
import { parseYaml } from '@/utils/yaml'

export const useRecord = () => {
  const record = ref(null)
  const loading = ref(false)
  // ... loads record directly using githubApi
}
```

**After:**
```ts
// app/composables/useRecord.ts
import { ref } from 'vue'
import { loadRecord } from '@ingitdb/client'
import { githubToken } from '@/state/github-token'

export const useRecord = () => {
  const record = ref(null)
  const loading = ref(false)
  const error = ref(null)

  const load = async (repo: string, branch: string | undefined, path: string) => {
    loading.value = true
    error.value = null
    try {
      record.value = await loadRecord(repo, path, branch, { token: githubToken.value })
      return record.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  return { record, loading, error, load }
}
```

The same pattern applies to all other composables.

---

## 8. Migration Steps

### Phase 1 — Bootstrap library project
1. Add `package.json`, `tsconfig.json`, `vite.config.ts` (lib mode), `vitest.config.ts` to `ingitdb-client-ts/`
2. Set up build scripts: `build`, `test`, `lint`

### Phase 2 — Extract pure utilities (no framework coupling)
3. Copy and adapt `utils/yaml.ts` → `src/utils/yaml.ts`
4. Copy and adapt `utils/schema.ts` → `src/schema/schema.ts`
5. Copy and adapt `cache/idb.ts` → `src/cache/idb-cache.ts`
6. Copy and adapt `cache/index.ts` → `src/cache/cache.ts`

### Phase 3 — Extract GitHub API layer
7. Adapt `api/github.ts` → `src/github/github-api.ts` (remove Vue `ref`, add factory)

### Phase 4 — Extract data-fetching logic
8. Adapt `composables/useCollection.ts` → `src/collection/collection.ts`
9. Adapt `composables/useRecord.ts` → `src/collection/record.ts`
10. Adapt `composables/useDatabaseConfig.ts` → `src/database/database-config.ts`
11. Adapt `composables/useRepo.ts` → `src/repo/repo.ts`
12. Adapt `composables/useRepoSettings.ts` → `src/repo/repo-settings.ts`
13. Adapt `composables/useFKViews.ts` → `src/collection/fk-views.ts`

### Phase 5 — Extract change management
14. Adapt `composables/usePendingChanges.ts` → `src/changes/pending-changes.ts`
15. Adapt `composables/useCommittedChanges.ts` → `src/changes/committed-changes.ts`

### Phase 6 — Assemble public API
16. Create `src/client.ts` facade (`createIngitDbClient`)
17. Create `src/index.ts` barrel exports
18. Write unit tests for all extracted modules

### Phase 7 — Consume library in `ingitdb-ws`
19. Add `@ingitdb/client` as a dependency in `ingitdb-ws/package.json` (local path or npm)
20. Refactor each composable in `ingitdb-ws` into a thin Vue wrapper
21. Delete the extracted inline implementations from `ingitdb-ws`
22. Run `pnpm lint && pnpm test:run && pnpm build` in `ingitdb-ws` to verify

### Phase 8 — Publish
23. Set up CI (GitHub Actions) for `ingitdb-client-ts`
24. Publish to NPM as `@ingitdb/client`

---

## 9. Testing Strategy

Each module in `@ingitdb/client` gets a unit test file next to it (e.g. `collection.spec.ts`).

Tests mock the `GithubApi` interface so no real HTTP calls are made. The existing Vitest tests in `ingitdb-ws/__tests__/` are the reference for expected behaviour.

`ingitdb-ws` keeps its Vitest + Playwright suites; after refactoring, they serve as integration tests for the library consumer.

---

## 10. Notes on the Existing `@ingitdb/client` in `ingitdb-ts`

The `libs/client` package in the `ingitdb-ts` Angular monorepo:
- Uses Angular `@Injectable`, `HttpClient`, and RxJS `Observable`
- All CRUD methods (`deleteRows`, `addRows`, `getRecord`) throw `'Method not implemented.'`
- `getViewData` only loads pre-built JSON view files, not live YAML records

It should be marked as **deprecated** in its own `package.json` once the new library is published, pointing consumers to `@ingitdb/client` (this library).
