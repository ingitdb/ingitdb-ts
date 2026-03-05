# @ingitdb/client

[![npm version](https://img.shields.io/npm/v/@ingitdb/client)](https://www.npmjs.com/package/@ingitdb/client)
[![Coverage Status](https://coveralls.io/repos/github/ingitdb/ingitdb-client-ts/badge.svg?branch=main)](https://coveralls.io/github/ingitdb/ingitdb-client-ts?branch=main)
[![CI](https://github.com/ingitdb/ingitdb-client-ts/actions/workflows/publish.yml/badge.svg)](https://github.com/ingitdb/ingitdb-client-ts/actions/workflows/publish.yml)

TypeScript client library for [inGitDB](https://ingitdb.com) — use GitHub repositories as a structured database.

## Features

- 📦 Zero framework dependencies (no Vue, React, Angular, or RxJS)
- 🔑 Optional GitHub token for authenticated access
- 🗄️ IndexedDB + in-memory caching
- 📐 Full schema support (columns, FK views, materialized views)
- 🔄 Pending and committed changes tracking
- 📝 Dual ESM + CJS build with full TypeScript declarations

## Test Coverage

We target and maintain **100% test coverage** (statements, branches, functions, lines).

## Installation

```bash
npm install @ingitdb/client
```

## Usage

```ts
import { createIngitDbClient } from '@ingitdb/client'

const client = createIngitDbClient({ token: 'ghp_...' })

const schema = await client.loadCollectionSchema('owner/repo', 'main', 'countries')
const records = await client.loadCollectionRecords('owner/repo', 'main', 'countries', schema.schema)
```
