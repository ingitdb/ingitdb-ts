# @ingitdb/client-fs

inGitDB client for local git repositories — reads inGitDB data directly from the local filesystem.

> **Status: coming soon.** The package currently exports a stub that throws `NotImplementedError` for all methods. The filesystem implementation is planned for a future release.

## Installation

```bash
npm install @ingitdb/client-fs
```

## Usage

```ts
import { createFsIngitDbClient } from '@ingitdb/client-fs'

const client = createFsIngitDbClient()
// Methods will throw until implemented
```

## Development

Run from this package directory or from the monorepo root with `--filter`.

```bash
pnpm build     # compile to dist/
pnpm lint      # tsc --noEmit
pnpm test:run  # vitest (single run, no tests yet)
```

> `@ingitdb/client` must be built before running `lint` in this package.
> From the monorepo root, `pnpm build` and `pnpm lint` handle the order automatically via Turborepo.
> To build the dependency manually: `pnpm --filter @ingitdb/client build`
