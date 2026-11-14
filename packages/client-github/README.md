# @ingitdb/client-github

[![npm version](https://img.shields.io/npm/v/@ingitdb/client-github)](https://www.npmjs.com/package/@ingitdb/client-github)
[![CI](https://github.com/ingitdb/ingitdb-client-ts/actions/workflows/publish.yml/badge.svg)](https://github.com/ingitdb/ingitdb-client-ts/actions/workflows/publish.yml)

GitHub API-backed inGitDB client — use GitHub repositories as a structured database.

This package is the **browser implementation** of `@ingitdb/client`. It owns all IndexedDB-specific code:
- `idbCache` — `StorageAdapter` backed by IndexedDB (for persistent HTTP response caching)
- `createIdbCommittedChangesStore` — `CommittedChangesStore` backed by IndexedDB

For Node.js environments or testing, use `createCache()` and `createCommittedChangesStore()` from `@ingitdb/client` (memory-only).

## Installation

```bash
npm install @ingitdb/client-github
```

Peer dependencies (must be installed separately):

```bash
npm install axios idb @ingr/codec
```

## Usage

```ts
import { createIngitDbClient } from '@ingitdb/client-github'

const client = createIngitDbClient({ token: 'ghp_...' })

const config = await client.loadDatabaseConfig('owner/repo')
const schema = await client.loadCollectionSchema('owner/repo', 'main', 'countries')
const { records } = await client.loadCollectionRecords('owner/repo', 'main', 'countries', schema.schema, schema.collectionPath)
```

### Disable persistence (memory-only cache)

```ts
const client = createIngitDbClient({ token: 'ghp_...', cache: false })
```

### Use the IDB adapters directly

```ts
import { createCache } from '@ingitdb/client'
import { idbCache, createIdbCommittedChangesStore } from '@ingitdb/client-github'

const cache = createCache(idbCache)
const committedStore = createIdbCommittedChangesStore()
```

## Features

- Zero framework dependencies (no Vue, React, Angular, or RxJS)
- Optional GitHub token for authenticated access
- IndexedDB + in-memory caching (browser); memory-only (`cache: false`) for SSR/Node
- Full schema support (columns, FK views, materialized views)
- Pending and committed changes tracking with IDB persistence
- Dual ESM + CJS build with full TypeScript declarations

## Where records are read and written

A collection's records live in its records directory: `record_file.records_dir` when declared (`.` is the collection directory), otherwise `$records/` for a one-record-per-file name. A subcollection path `<collection>/<parent key>/<subcollection>` (repeatable) resolves inside the parent's records directory, as the inGitDB definition defines it: `spaces/family/contacts` is `spaces/$records/family/contacts/`. Data found at `spaces/family/contacts/` while the parent keeps a records directory, the place earlier writers used, is an error naming both paths and the fix, not an empty collection.

A collection that declares `record_file.key_encoding` is refused with an error: these clients do not decode or encode record keys yet (ingitdb/ingitdb-ts#107). Use the `ingitdb` CLI or a Go storage driver for it.

## Development

```bash
pnpm build     # compile to dist/
pnpm lint      # tsc --noEmit
pnpm test      # vitest (watch)
pnpm test:run  # vitest (single run)
```

> `@ingitdb/client` must be built before running `lint` or `test:run` in this package.
> From the monorepo root, `pnpm build`, `pnpm lint`, and `pnpm test:run` handle the order automatically via Turborepo.
> To build the dependency manually: `pnpm --filter @ingitdb/client build`
