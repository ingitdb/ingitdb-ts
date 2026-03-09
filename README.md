# ingitdb-ts

TypeScript client library for [inGitDB](https://ingitdb.com) — use git repositories as a structured database.

This is a **pnpm workspace monorepo** containing three packages:

| Package | npm | Description |
|---------|-----|-------------|
| [`@ingitdb/client`](packages/client/) | [![npm](https://img.shields.io/npm/v/@ingitdb/client)](https://www.npmjs.com/package/@ingitdb/client) | Core interface, shared types, and utilities |
| [`@ingitdb/client-github`](packages/client-github/) | [![npm](https://img.shields.io/npm/v/@ingitdb/client-github)](https://www.npmjs.com/package/@ingitdb/client-github) | GitHub REST API implementation |
| [`@ingitdb/client-fs`](packages/client-fs/) | [![npm](https://img.shields.io/npm/v/@ingitdb/client-fs)](https://www.npmjs.com/package/@ingitdb/client-fs) | Local filesystem implementation *(coming soon)* |

## Quick start

```bash
npm install @ingitdb/client-github
```

```ts
import { createIngitDbClient } from '@ingitdb/client-github'

const client = createIngitDbClient({ token: 'ghp_...' })
const schema = await client.loadCollectionSchema('owner/repo', 'main', 'countries')
const records = await client.loadCollectionRecords('owner/repo', 'main', 'countries', schema.schema)
```

## Development

```bash
pnpm install   # install all workspace dependencies
```

### Build

```bash
# All packages (dependency order: @ingitdb/client first)
pnpm build

# Single package
pnpm --filter @ingitdb/client build
pnpm --filter @ingitdb/client-github build
pnpm --filter @ingitdb/client-fs build
```

### Lint

```bash
# All packages
pnpm lint

# Single package
pnpm --filter @ingitdb/client lint
pnpm --filter @ingitdb/client-github lint
pnpm --filter @ingitdb/client-fs lint
```

> **Note:** lint in dependent packages requires `@ingitdb/client` to be built first.
> Running `pnpm lint` via Turborepo handles this automatically.
> For a single package, build the dependency manually if needed: `pnpm --filter @ingitdb/client build`

### Tests

```bash
# All packages (watch mode)
pnpm test

# All packages (single run)
pnpm test:run

# Single package (watch mode)
pnpm --filter @ingitdb/client test
pnpm --filter @ingitdb/client-github test
pnpm --filter @ingitdb/client-fs test

# Single package (single run)
pnpm --filter @ingitdb/client test:run
pnpm --filter @ingitdb/client-github test:run
pnpm --filter @ingitdb/client-fs test:run
```

> **Note:** tests in dependent packages require `@ingitdb/client` to be built first.
> Running `pnpm test:run` via Turborepo handles this automatically.
> For a single package, build the dependency manually if needed: `pnpm --filter @ingitdb/client build`
