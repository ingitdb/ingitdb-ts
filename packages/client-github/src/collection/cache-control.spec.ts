import { describe, it, expect, vi } from 'vitest'
import type { GithubApi } from '../github/github-api'
import type { Cache } from '@ingitdb/client'

vi.mock('@ingr/codec', () => ({ parseIngr: vi.fn() }))
vi.mock('idb', () => ({ openDB: () => Promise.resolve({}) }))

const { loadCollectionRecords, loadCollectionCacheControl, resolveCacheControl } = await import('./collection')

const SHA = 'c'.repeat(40)
const notFound = () => Object.assign(new Error('nf'), { response: { status: 404 } })

/** Serves files from a path -> text map; anything else is a 404. */
const apiWith = (files: Record<string, string>): GithubApi =>
  ({
    getFileText: vi.fn(async (_repo: string, path: string) => {
      if (path in files) return { decodedContent: files[path] }
      throw notFound()
    }),
    getContents: vi.fn(async () => { throw notFound() })
  }) as unknown as GithubApi

/** Records the TTL each cache.set was called with. */
const spyCache = () => {
  const ttls: Record<string, number | undefined> = {}
  const store = new Map<string, unknown>()
  const cache: Cache = {
    async get<T>(key: string) { return (store.get(key) as T) ?? null },
    async set<T>(key: string, value: T, ttl?: number) { store.set(key, value); ttls[key] = ttl; return value },
    async delete(key: string) { store.delete(key) },
    async clear() { store.clear() }
  }
  return { cache, ttls }
}

const DB = 'cache_control: "public, max-age=31536000, immutable"\n'
const SINGLE_FILE_SCHEMA = { columns: [], columns_order: [], columnsMap: {}, record_file: { name: 'all.yaml' } }
const recordsTtl = (ttls: Record<string, number | undefined>) =>
  ttls[Object.keys(ttls).find((k) => k.includes('col-records'))!]

describe('collection cache_control', () => {
  it('resolves collection over database, and database alone', async () => {
    const { cache } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': DB })
    const deps = { githubApi, cache }
    expect(await resolveCacheControl('o/r', 'main', undefined, deps)).toBe('public, max-age=31536000, immutable')
    expect(await resolveCacheControl('o/r', 'main', { ...SINGLE_FILE_SCHEMA, cache_control: 'no-store' }, deps)).toBe('no-store')
  })

  it('treats an unreadable settings file as undeclared', async () => {
    const githubApi = { getFileText: vi.fn(async () => { throw new Error('boom') }) } as unknown as GithubApi
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { cache } = spyCache()
    expect(await resolveCacheControl('o/r', 'main', undefined, { githubApi, cache })).toBeUndefined()
  })

  it('exposes the effective value for a collection id', async () => {
    const { cache } = spyCache()
    const githubApi = apiWith({
      '.ingitdb/settings.yaml': DB,
      'countries/.collection/definition.yaml': 'cache_control: "max-age=60"\ncolumns:\n  name:\n    type: string\n'
    })
    expect(await loadCollectionCacheControl('o/r', 'main', 'countries', { githubApi, cache })).toBe('max-age=60')
  })

  it('only tightens the record cache TTL on a branch', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': DB, 'c/all.yaml': 'a: {x: 1}\n' })
    await loadCollectionRecords('o/r', 'main', 'c', SINGLE_FILE_SCHEMA, 'c', { githubApi, cache })
    expect(recordsTtl(ttls)).toBe(5 * 60 * 1000)
  })

  it('relaxes the record cache TTL when pinned to a commit SHA', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': DB, 'c/all.yaml': 'a: {x: 1}\n' })
    await loadCollectionRecords('o/r', SHA, 'c', SINGLE_FILE_SCHEMA, 'c', { githubApi, cache })
    expect(recordsTtl(ttls)).toBe(31536000 * 1000)
  })

  it('does not reuse records for no-store', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': DB, 'c/all.yaml': 'a: {x: 1}\n' })
    await loadCollectionRecords('o/r', SHA, 'c', { ...SINGLE_FILE_SCHEMA, cache_control: 'no-store' }, 'c', { githubApi, cache })
    expect(recordsTtl(ttls)).toBe(0)
  })
})
