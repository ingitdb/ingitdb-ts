# @ingitdb/client-github

[![npm version](https://img.shields.io/npm/v/@ingitdb/client-github)](https://www.npmjs.com/package/@ingitdb/client-github)
[![Coverage Status](https://coveralls.io/repos/github/ingitdb/ingitdb-client-ts/badge.svg?branch=main)](https://coveralls.io/github/ingitdb/ingitdb-client-ts?branch=main)
[![CI](https://github.com/ingitdb/ingitdb-client-ts/actions/workflows/publish.yml/badge.svg)](https://github.com/ingitdb/ingitdb-client-ts/actions/workflows/publish.yml)

GitHub API-backed inGitDB client — use GitHub repositories as a structured database.

## Installation

```bash
npm install @ingitdb/client-github
```

## Usage

```ts
import { createIngitDbClient } from '@ingitdb/client-github'

const client = createIngitDbClient({ token: 'ghp_...' })

const schema = await client.loadCollectionSchema('owner/repo', 'main', 'countries')
const records = await client.loadCollectionRecords('owner/repo', 'main', 'countries', schema.schema)
```

## Features

- Zero framework dependencies (no Vue, React, Angular, or RxJS)
- Optional GitHub token for authenticated access
- IndexedDB + in-memory caching
- Full schema support (columns, FK views, materialized views)
- Pending and committed changes tracking
- Dual ESM + CJS build with full TypeScript declarations
- 100% test coverage

## Test Coverage

We target and maintain **100% test coverage** (statements, branches, functions, lines).

## Development

Run from this package directory or from the monorepo root with `--filter`.

```bash
pnpm build     # compile to dist/
pnpm lint      # tsc --noEmit
pnpm test      # vitest (watch)
pnpm test:run  # vitest (single run)
```

> `@ingitdb/client` must be built before running `lint` or `test:run` in this package.
> From the monorepo root, `pnpm build`, `pnpm lint`, and `pnpm test:run` handle the order automatically via Turborepo.
> To build the dependency manually: `pnpm --filter @ingitdb/client build`
