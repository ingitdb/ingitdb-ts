# @ingitdb/client

[![npm version](https://img.shields.io/npm/v/@ingitdb/client)](https://www.npmjs.com/package/@ingitdb/client)

Core types, interfaces, and shared utilities for inGitDB clients. This package defines the `IngitDbClient` interface implemented by all transport-specific clients, along with shared data types and utilities.

## Packages

| Package | Description |
|---------|-------------|
| `@ingitdb/client` | Core interface and shared utilities (this package) |
| [`@ingitdb/client-github`](../client-github/README.md) | Client backed by the GitHub REST API |
| [`@ingitdb/client-fs`](../client-fs/README.md) | Client for local git repositories *(coming soon)* |

## Installation

```bash
npm install @ingitdb/client
```

## Contents

- **`IngitDbClient`** — transport-agnostic client interface
- **`Cache`** — caching interface + default IndexedDB + in-memory implementation
- **`CollectionSchema`** — schema parsing utilities
- **`parseYaml` / `stringifyYaml`** — YAML helpers
- **Shared types** — `DatabaseConfig`, `RecordRow`, `RecordData`, `FKView`, `RepoMeta`, `RepoSettings`, `PendingChange`, `CommittedChangesStore`, `PendingChangesStore`
- **`createCommittedChangesStore`** — IndexedDB-backed committed changes store

## Development

Run from this package directory or from the monorepo root with `--filter`.

```bash
pnpm build     # compile to dist/
pnpm lint      # tsc --noEmit
pnpm test      # vitest (watch)
pnpm test:run  # vitest (single run)
```
