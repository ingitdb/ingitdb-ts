# @ingitdb/client

[![npm version](https://img.shields.io/npm/v/@ingitdb/client)](https://www.npmjs.com/package/@ingitdb/client)

Core types, interfaces, and shared utilities for inGitDB clients. This package is a **pure abstraction layer** — it has no dependency on IndexedDB, browser APIs, or Node.js-specific modules and works in any JavaScript environment.

## Packages

| Package | Description |
|---------|-------------|
| `@ingitdb/client` | Core interfaces and shared utilities (this package) |
| [`@ingitdb/client-github`](../client-github/README.md) | Browser client backed by the GitHub REST API (owns IndexedDB) |
| [`@ingitdb/client-fs`](../client-fs/README.md) | Client for local git repositories *(coming soon)* |

## Installation

```bash
npm install @ingitdb/client
```

## What's in this package

- **`IngitDbClient`** — transport-agnostic client interface
- **`Cache` / `StorageAdapter`** — caching interfaces + `createCache(adapter?)` factory
  - No adapter → memory-only (works in Node.js, browsers, tests)
  - Pass a `StorageAdapter` (e.g. `idbCache` from `@ingitdb/client-github`) for persistence
- **`CollectionSchema`** — schema parsing utilities (`parseCollectionSchema`, `normalizeCollectionSchema`)
- **`parseYaml` / `stringifyYaml`** — YAML helpers
- **`createCommittedChangesStore`** — in-memory `CommittedChangesStore` (Node.js / testing)
- **Shared types** — `DatabaseConfig`, `RecordRow`, `RecordData`, `FKView`, `RepoMeta`, `RepoSettings`, `PendingChange`, `CommittedChangesStore`, `PendingChangesStore`

## What's NOT in this package

IndexedDB and any other browser/platform-specific storage is intentionally absent. The `StorageAdapter` interface lets you plug in your own:

```ts
import { createCache } from '@ingitdb/client'
import { idbCache } from '@ingitdb/client-github' // browser IDB adapter

const cache = createCache(idbCache) // IDB-backed
const memCache = createCache()      // memory-only
```

## Development

```bash
pnpm build     # compile to dist/
pnpm lint      # tsc --noEmit
pnpm test      # vitest (watch)
pnpm test:run  # vitest (single run)
```
