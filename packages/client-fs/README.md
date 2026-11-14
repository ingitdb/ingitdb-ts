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

## Where records are read and written

A collection's records live in its records directory: `record_file.records_dir` when declared (`.` is the collection directory), otherwise `$records/` for a one-record-per-file name. A subcollection path `<collection>/<parent key>/<subcollection>` (repeatable) resolves inside the parent's records directory, as the inGitDB definition defines it: `spaces/family/contacts` is `spaces/$records/family/contacts/`. Data found at `spaces/family/contacts/` while the parent keeps a records directory, the place earlier writers used, is an error naming both paths and the fix, even when the defined place holds data too, as in the Go drivers.

A collection that declares `record_file.key_encoding` is refused with an error: these clients do not decode or encode record keys yet (ingitdb/ingitdb-ts#107). Use the `ingitdb` CLI or a Go storage driver for it.

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
