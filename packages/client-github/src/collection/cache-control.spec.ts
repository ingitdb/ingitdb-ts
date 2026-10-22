import { describe, it, expect, vi } from 'vitest'
import type { GithubApi } from '../github/github-api'
import type { Cache } from '@ingitdb/client'

const parseIngr = vi.hoisted(() => vi.fn())
vi.mock('@ingr/codec', () => ({ parseIngr }))
vi.mock('idb', () => ({ openDB: () => Promise.resolve({}) }))

const { loadCollectionRecords, loadCollectionCacheControl, resolveCacheControl } = await import('./collection')

const SHA = 'c'.repeat(40)
const notFound = () => Object.assign(new Error('nf'), { response: { status: 404 } })

/** Serves files from a path -> text map; anything else is a 404. */
const apiWith = (files: Record<string, string>, origin?: string): GithubApi =>
  ({
    getFileText: vi.fn(async (_repo: string, path: string) => {
      if (path in files) return { decodedContent: files[path], cacheControl: path.startsWith('.ingitdb') ? undefined : origin }
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
const wrote = (ttls: Record<string, number | undefined>) => Object.keys(ttls).some((k) => k.includes('col-records'))

describe('collection cache_control', () => {
  it('resolves collection over database, and database alone', async () => {
    const { cache } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': DB })
    const deps = { githubApi, cache }
    expect(await resolveCacheControl('o/r', 'main', undefined, deps)).toBe('public, max-age=31536000, immutable')
    expect(await resolveCacheControl('o/r', 'main', { ...SINGLE_FILE_SCHEMA, cache_control: 'no-store' }, deps)).toBe('no-store')
  })

  it('fails closed to no-cache when the settings file cannot be read', async () => {
    const githubApi = { getFileText: vi.fn(async () => { throw new Error('boom') }) } as unknown as GithubApi
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { cache } = spyCache()
    expect(await resolveCacheControl('o/r', 'main', undefined, { githubApi, cache })).toBe('no-cache')
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
    await loadCollectionRecords('o/r', SHA, 'c', SINGLE_FILE_SCHEMA, 'c', { githubApi, cache, pinnedRefs: [SHA] })
    expect(recordsTtl(ttls)).toBe(31536000 * 1000)
  })

  it('does not trust a SHA-shaped ref the caller did not mark as a commit', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': DB, 'c/all.yaml': 'a: {x: 1}\n' })
    await loadCollectionRecords('o/r', SHA, 'c', SINGLE_FILE_SCHEMA, 'c', { githubApi, cache })
    expect(recordsTtl(ttls)).toBe(5 * 60 * 1000)
  })

  it('relaxes to a year for immutable alone on a pinned ref', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': 'cache_control: "public, immutable"\n', 'c/all.yaml': 'a: {x: 1}\n' })
    await loadCollectionRecords('o/r', SHA, 'c', SINGLE_FILE_SCHEMA, 'c', { githubApi, cache, pinnedRefs: [SHA] })
    expect(recordsTtl(ttls)).toBe(31536000 * 1000)
  })

  it('reads the origin Cache-Control header and obeys its no-store', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ 'c/all.yaml': 'a: {x: 1}\n' }, 'no-store')
    await loadCollectionRecords('o/r', 'main', 'c', SINGLE_FILE_SCHEMA, 'c', { githubApi, cache })
    expect(wrote(ttls)).toBe(false)
  })

  it('tightens to the origin max-age when the origin is shorter than the default', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ 'c/all.yaml': 'a: {x: 1}\n' }, 'private, max-age=60')
    await loadCollectionRecords('o/r', 'main', 'c', SINGLE_FILE_SCHEMA, 'c', { githubApi, cache })
    expect(recordsTtl(ttls)).toBe(60_000)
  })

  it('applies the TTL to a materialized .ingr view and to file-per-record loads', async () => {
    parseIngr.mockReturnValue({ columns: ['$ID:string'], records: [{ '$ID:string': 'a' }] })
    const view = spyCache()
    const viewApi = apiWith({ '.ingitdb/settings.yaml': DB, '$ingitdb/c/c.ingr': 'x' })
    await loadCollectionRecords('o/r', SHA, 'c', { ...SINGLE_FILE_SCHEMA, default_view: {} }, 'c', { githubApi: viewApi, cache: view.cache, pinnedRefs: [SHA] })
    expect(recordsTtl(view.ttls)).toBe(31536000 * 1000)

    const per = spyCache()
    const perApi = {
      getFileText: vi.fn(async (_r: string, path: string) => {
        if (path === '.ingitdb/settings.yaml') return { decodedContent: DB }
        return { decodedContent: 'x: 1\n', cacheControl: 'max-age=120' }
      }),
      getContents: vi.fn(async () => [{ type: 'file', name: 'a.yaml', path: 'c/$records/a.yaml' }])
    } as unknown as GithubApi
    await loadCollectionRecords('o/r', 'main', 'c', { ...SINGLE_FILE_SCHEMA, record_file: { name: '{key}.yaml' } }, 'c', { githubApi: perApi, cache: per.cache })
    expect(recordsTtl(per.ttls)).toBe(120_000)
  })

  it('writes nothing to the cache for no-store', async () => {
    const { cache, ttls } = spyCache()
    const githubApi = apiWith({ '.ingitdb/settings.yaml': DB, 'c/all.yaml': 'a: {x: 1}\n' })
    await loadCollectionRecords('o/r', SHA, 'c', { ...SINGLE_FILE_SCHEMA, cache_control: 'no-store' }, 'c', { githubApi, cache, pinnedRefs: [SHA] })
    expect(wrote(ttls)).toBe(false)
  })
})
