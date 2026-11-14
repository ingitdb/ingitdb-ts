import { describe, it, expect, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { GithubApi } from './github/github-api'
import type { Cache } from '@ingitdb/client'

// Mock idb so the module-level openDB() in idb-cache.ts doesn't blow up.
vi.mock('idb', () => ({ openDB: () => Promise.resolve({}) }))
const mockParseIngr = vi.hoisted(() => vi.fn())
vi.mock('@ingr/codec', () => ({ parseIngr: mockParseIngr }))

const { resolveCollectionPath, loadCollectionSchema, loadCollectionRecords } = await import('./collection/collection')
const { loadRecord } = await import('./collection/record')

// ---------------------------------------------------------------------------
// CROSS-LANGUAGE FORMAT CONTRACT
//
// These fixtures (src/__fixtures__/format-fixtures/) are a byte-identical copy of
// the golden repo tree produced by the Go writer (github.com/ingitdb/dalgo2ingitdb,
// testdata/format-fixtures/), documented in that repo's FORMAT.md. This test drives
// the real @ingitdb/client-github reader against that tree via a fixture-backed
// GithubApi.getFileText, so if the Go writer's on-disk format and this TS reader
// ever drift, one side's CI goes red instead of a user's repo silently failing to
// load. If you intentionally change the format, update BOTH copies + FORMAT.md.
// ---------------------------------------------------------------------------

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'format-fixtures')

/** GithubApi whose getFileText serves files from the on-disk fixture tree. */
function fixtureGithubApi(): GithubApi {
  return {
    getRateLimit: () => ({ limit: null, remaining: null, reset: null }),
    getRepo: vi.fn(),
    getBranches: vi.fn(),
    getContents: vi.fn(async (_repo: string, path: string) => {
      const abs = join(fixturesRoot, path)
      if (!existsSync(abs)) throw { response: { status: 404 } }
      return readdirSync(abs, { withFileTypes: true }).map((d) => ({
        type: d.isDirectory() ? 'dir' : 'file', name: d.name, path: `${path}/${d.name}`,
      }))
    }),
    getFileText: vi.fn(async (_repo: string, path: string) => {
      const abs = join(fixturesRoot, path)
      if (!existsSync(abs)) throw { response: { status: 404 } }
      const decodedContent = readFileSync(abs, 'utf8')
      return { decodedContent, sha: 'fixture-sha' }
    }),
    putFile: vi.fn(),
    deleteFile: vi.fn(),
    forkRepo: vi.fn(),
    getBranchSHA: vi.fn(),
    createBranch: vi.fn(),
    checkExistingFork: vi.fn(),
    waitForFork: vi.fn(),
    syncForkBranch: vi.fn(),
    getCommit: vi.fn(),
    createTree: vi.fn(),
    createCommit: vi.fn(),
    updateBranchRef: vi.fn(),
  } as GithubApi
}

function mockCache(): Cache {
  const store = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> { return (store.get(key) as T) ?? null },
    async set<T>(key: string, value: T): Promise<T> { store.set(key, value); return value },
    async delete(key: string) { store.delete(key) },
    async clear() { store.clear() },
  }
}

describe('on-disk format contract (Go writer <-> TS reader)', () => {
  const repo = 'owner/repo'
  const deps = () => ({ githubApi: fixtureGithubApi(), cache: mockCache() })

  it('resolves a top-level collection path from .ingitdb/root-collections.yaml', async () => {
    const path = await resolveCollectionPath(repo, undefined, 'spaces', deps())
    expect(path).toBe('spaces')
  })

  it('parses a collection schema from .collection/definition.yaml', async () => {
    const { schema, collectionPath } = await loadCollectionSchema(repo, undefined, 'spaces', deps())
    expect(collectionPath).toBe('spaces')
    // The schema declares a required "name" string column (see FORMAT.md).
    expect(JSON.stringify(schema)).toContain('name')
  })

  it('reads nested subcollection records scoped by parent (no cross-space collision)', async () => {
    // Two contacts share the leaf collection + record id but live under different
    // parent spaces — the Option A nesting the Go writer produces.
    const family = await loadRecord(
      repo, 'spaces/$records/family/contacts/$records/c1.yaml', undefined, { githubApi: fixtureGithubApi() },
    )
    const work = await loadRecord(
      repo, 'spaces/$records/work/contacts/$records/c1.yaml', undefined, { githubApi: fixtureGithubApi() },
    )
    expect(family.name).toBe('Alice')
    expect(work.name).toBe('Bob')
    expect(family._path).toBe('spaces/$records/family/contacts/$records/c1.yaml')
  })

  it('resolves a subcollection instance inside the parent records directory and reads it', async () => {
    const d = deps()
    const { schema, collectionPath } = await loadCollectionSchema(repo, undefined, 'spaces/family/contacts', d)
    expect(collectionPath).toBe('spaces/$records/family/contacts')
    expect(schema.columnsMap['name']).toBeDefined()
    const { records } = await loadCollectionRecords(repo, undefined, 'spaces/family/contacts', schema, collectionPath, d)
    expect(records).toMatchObject([{ _id: 'c1', name: 'Alice', _path: 'spaces/$records/family/contacts/$records/c1.yaml' }])
  })
})
