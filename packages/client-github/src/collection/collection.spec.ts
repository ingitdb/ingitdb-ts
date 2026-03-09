import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GithubApi } from '../github/github-api'
import type { Cache } from '@ingitdb/client'

// ---------- mocks ---------------------------------------------------------
const mockParseIngr = vi.hoisted(() => vi.fn())
vi.mock('@ingr/codec', () => ({ parseIngr: mockParseIngr }))

// Mock idb so the module-level openDB() in idb-cache.ts doesn't blow up in happy-dom
vi.mock('idb', () => ({
  openDB: () => Promise.resolve({})
}))

const { resolveCollectionPath, resolveDataPath, loadCollectionSchema, loadCollectionRecords } = await import('./collection')
type CollectionDeps = { githubApi: GithubApi; cache: Cache }

/** Creates a minimal mock GithubApi — only the methods used by collection functions. */
function mockGithubApi(overrides: Partial<GithubApi> = {}): GithubApi {
  return {
    getRateLimit: () => ({ limit: null, remaining: null, reset: null }),
    getRepo: vi.fn(),
    getBranches: vi.fn(),
    getContents: vi.fn(),
    getFileText: vi.fn(),
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
    ...overrides
  }
}

/** A no-op in-memory cache for testing. */
function mockCache(): Cache {
  const store = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T) ?? null
    },
    async set<T>(key: string, value: T): Promise<T> {
      store.set(key, value)
      return value
    },
    async delete(key: string) { store.delete(key) },
    async clear() { store.clear() }
  }
}

describe('resolveDataPath', () => {
  it('returns schemaPath unchanged for dedicated layout', () => {
    expect(resolveDataPath('countries')).toBe('countries')
  })

  it('returns base dir for shared layout without dataDir', () => {
    expect(resolveDataPath('data/.collections/countries')).toBe('data')
  })

  it('returns base dir when dataDir is "."', () => {
    expect(resolveDataPath('data/.collections/countries', '.')).toBe('data')
  })

  it('appends dataDir for shared layout', () => {
    expect(resolveDataPath('data/.collections/countries', 'raw')).toBe('data/raw')
  })
})

describe('resolveCollectionPath', () => {
  it('returns collectionId when no root-collections mapping exists', async () => {
    const githubApi = mockGithubApi({
      getFileText: vi.fn().mockRejectedValue({ response: { status: 404 } })
    })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }
    const result = await resolveCollectionPath('owner/repo', 'main', 'countries', deps)
    expect(result).toBe('countries')
  })

  it('resolves from root-collections mapping', async () => {
    const githubApi = mockGithubApi({
      getFileText: vi.fn().mockResolvedValue({
        decodedContent: 'countries: data/countries\ncities: data/cities'
      })
    })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }

    const result = await resolveCollectionPath('owner/repo', 'main', 'countries', deps)
    expect(result).toBe('data/countries')
  })

  it('uses cache on second call', async () => {
    const getFileText = vi.fn().mockResolvedValue({
      decodedContent: 'countries: path/countries'
    })
    const githubApi = mockGithubApi({ getFileText })
    const cache = mockCache()
    const deps: CollectionDeps = { githubApi, cache }

    await resolveCollectionPath('owner/repo', 'main', 'countries', deps)
    await resolveCollectionPath('owner/repo', 'main', 'countries', deps)

    // getFileText should only be called once — second time is served from cache
    expect(getFileText).toHaveBeenCalledTimes(1)
  })

  it('resolves namespaced collection (ns.subId)', async () => {
    const getFileText = vi.fn()
      .mockImplementation((_repo: string, path: string) => {
        if (path === '.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'geo.*: geo' })
        }
        if (path === 'geo/.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'countries: countries\ncities: cities' })
        }
        return Promise.reject({ response: { status: 404 } })
      })
    const githubApi = mockGithubApi({ getFileText })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }

    const result = await resolveCollectionPath('owner/repo', 'main', 'geo.countries', deps)
    expect(result).toBe('geo/countries')
  })

  it('warns when namespace sub-mapping resolution fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const getFileText = vi.fn()
      .mockImplementation((_repo: string, path: string) => {
        if (path === '.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'ns.*: nsdir' })
        }
        return Promise.reject(new Error('network error'))
      })
    const githubApi = mockGithubApi({ getFileText })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }
    const result = await resolveCollectionPath('owner/repo', 'main', 'ns.sub', deps)
    expect(result).toBe('ns.sub') // falls back to collectionId
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('caches namespace sub-mapping and reuses on second call', async () => {
    const getFileText = vi.fn()
      .mockImplementation((_repo: string, path: string) => {
        if (path === '.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'geo.*: geo' })
        }
        if (path === 'geo/.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'countries: countries' })
        }
        return Promise.reject({ response: { status: 404 } })
      })
    const githubApi = mockGithubApi({ getFileText })
    const cache = mockCache()
    const deps: CollectionDeps = { githubApi, cache }
    await resolveCollectionPath('owner/repo', 'main', 'geo.countries', deps)
    await resolveCollectionPath('owner/repo', 'main', 'geo.countries', deps)
    // root-collections loaded once, namespace loaded once (cached)
    expect(getFileText).toHaveBeenCalledTimes(2) // root + sub, both cached on 2nd call
  })

  it('warns when root-collections.yaml fails with non-404 error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const getFileText = vi.fn().mockRejectedValue(new Error('server error'))
    const githubApi = mockGithubApi({ getFileText })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }
    const result = await resolveCollectionPath('owner/repo', 'main', 'things', deps)
    expect(result).toBe('things')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load root-collections'), expect.anything())
    warnSpy.mockRestore()
  })

  it('covers empty root-collections.yaml content (parseYaml || {} branch line 45)', async () => {
    // Empty YAML → parseYaml returns null → || {} → empty mapping → fallback to collectionId
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: '' })
    const githubApi = mockGithubApi({ getFileText })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }
    const result = await resolveCollectionPath('owner/repo', 'main', 'things', deps)
    expect(result).toBe('things')
  })

  it('covers namespace resolution with falsy branch (branch || "default" at line 65)', async () => {
    // Empty branch triggers `branch || 'default'` in the sub-mapping cache key
    const getFileText = vi.fn().mockImplementation((_repo: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') return Promise.resolve({ decodedContent: 'ns.*: ns' })
      if (path === 'ns/.ingitdb/root-collections.yaml') return Promise.resolve({ decodedContent: 'sub: sub' })
      return Promise.reject({ response: { status: 404 } })
    })
    const githubApi = mockGithubApi({ getFileText })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }
    const result = await resolveCollectionPath('owner/repo', '', 'ns.sub', deps)
    expect(result).toBe('ns/sub')
  })

  it('covers empty sub-mapping YAML content (parseYaml || {} branch line 69)', async () => {
    // Sub-mapping YAML is empty → parseYaml returns null → || {} → empty subMapping
    const getFileText = vi.fn().mockImplementation((_repo: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') return Promise.resolve({ decodedContent: 'ns.*: ns' })
      if (path === 'ns/.ingitdb/root-collections.yaml') return Promise.resolve({ decodedContent: '' })
      return Promise.reject({ response: { status: 404 } })
    })
    const githubApi = mockGithubApi({ getFileText })
    const deps: CollectionDeps = { githubApi, cache: mockCache() }
    // Empty subMapping → subMapping[subId] is undefined → falls back to collectionId
    const result = await resolveCollectionPath('owner/repo', 'main', 'ns.sub', deps)
    expect(result).toBe('ns.sub')
  })
})

// ── loadCollectionSchema ──────────────────────────────────────────────────
describe('loadCollectionSchema', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('reads definition.yaml from first candidate path', async () => {
    const getFileText = vi.fn().mockImplementation((_: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') return Promise.reject({ response: { status: 404 } })
      if (path === 'countries/.collection/definition.yaml') {
        return Promise.resolve({ decodedContent: 'columns:\n  - name: id\n    type: string' })
      }
      return Promise.reject({ response: { status: 404 } })
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const result = await loadCollectionSchema('o/r', 'main', 'countries', deps)
    expect(result.schema.columns).toHaveLength(1)
    expect(result.schemaYaml).toContain('columns')
    expect(result.collectionPath).toBe('countries')
  })

  it('falls back to second candidate path when first is 404', async () => {
    let callCount = 0
    const getFileText = vi.fn().mockImplementation((_: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') return Promise.reject({ response: { status: 404 } })
      if (path === 'countries/.collection/definition.yaml') return Promise.reject({ response: { status: 404 } })
      if (path === 'countries/definition.yaml') {
        callCount++
        return Promise.resolve({ decodedContent: 'columns: []' })
      }
      return Promise.reject({ response: { status: 404 } })
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    await loadCollectionSchema('o/r', 'main', 'countries', deps)
    expect(callCount).toBe(1)
  })

  it('returns empty schema when no definition file found (all 404)', async () => {
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const result = await loadCollectionSchema('o/r', 'main', 'countries', deps)
    expect(result.schema.columns).toEqual([])
    expect(result.schemaYaml).toBe('')
  })

  it('throws on non-404 error when reading definition file', async () => {
    const getFileText = vi.fn().mockImplementation((_: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') return Promise.reject({ response: { status: 404 } })
      return Promise.reject({ response: { status: 500 } })
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    await expect(loadCollectionSchema('o/r', 'main', 'countries', deps)).rejects.toEqual({ response: { status: 500 } })
  })

  it('uses cache on second call', async () => {
    const getFileText = vi.fn().mockImplementation((_: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') return Promise.reject({ response: { status: 404 } })
      if (path.endsWith('definition.yaml')) return Promise.resolve({ decodedContent: 'columns: []' })
      return Promise.reject({ response: { status: 404 } })
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    await loadCollectionSchema('o/r', 'main', 'colA', deps)
    const r2 = await loadCollectionSchema('o/r', 'main', 'colA', deps)
    expect(r2.schema).toBeDefined()
    // getFileText called once for root-collections + once for definition; second loadCollectionSchema from cache
  })

  it('skipCache=true bypasses cache', async () => {
    const getFileText = vi.fn().mockImplementation((_: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') return Promise.reject({ response: { status: 404 } })
      if (path.endsWith('definition.yaml')) return Promise.resolve({ decodedContent: 'columns: []' })
      return Promise.reject({ response: { status: 404 } })
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    await loadCollectionSchema('o/r', 'main', 'colB', deps, false)
    await loadCollectionSchema('o/r', 'main', 'colB', deps, true)
    // With skipCache, definition is fetched again
    const defCalls = (getFileText as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: string[]) => c[1]?.endsWith('definition.yaml')
    )
    expect(defCalls.length).toBe(2)
  })

  it('resolves data_dir from schema', async () => {
    const getFileText = vi.fn().mockImplementation((_: string, path: string) => {
      if (path === '.ingitdb/root-collections.yaml') {
        return Promise.resolve({ decodedContent: 'col: data/.collections/col' })
      }
      if (path === 'data/.collections/col/.collection/definition.yaml') {
        return Promise.resolve({ decodedContent: 'data_dir: raw\ncolumns: []' })
      }
      return Promise.reject({ response: { status: 404 } })
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const result = await loadCollectionSchema('o/r', 'main', 'col', deps)
    expect(result.collectionPath).toBe('data/raw')
  })

  it('handles undefined branch', async () => {
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const result = await loadCollectionSchema('o/r', undefined, 'col', deps)
    expect(result.schema.columns).toEqual([])
  })
})

// ── loadCollectionRecords ─────────────────────────────────────────────────
describe('loadCollectionRecords', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const emptySchema = { columns: [], columns_order: [] as string[], columnsMap: {} }

  // ── cache ───────────────────────────────────────────────────────────────
  it('returns cached records on second call', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'FR.yaml', path: 'countries/$records/FR.yaml' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'name: France', sha: 'abc' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    await loadCollectionRecords('o/r', 'main', 'countries', schema, 'countries', deps)
    const r2 = await loadCollectionRecords('o/r', 'main', 'countries', schema, 'countries', deps)
    expect(r2.records).toHaveLength(1)
    expect(getContents).toHaveBeenCalledTimes(1) // second from cache
  })

  it('skipCache bypasses cache', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'FR.yaml', path: 'c/$records/FR.yaml' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'name: France' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    await loadCollectionRecords('o/r', 'main', 'c', schema, 'c', deps)
    await loadCollectionRecords('o/r', 'main', 'c', schema, 'c', deps, true)
    expect(getContents).toHaveBeenCalledTimes(2)
  })

  it('uses "default" when branch is falsy (branch || "default" branch)', async () => {
    // Covers line 146: `branch || 'default'` when branch is empty string
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'FR.yaml', path: 'c/$records/FR.yaml' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'name: France' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    await loadCollectionRecords('o/r', '', 'c', schema, 'c', deps, true)
    expect(getContents).toHaveBeenCalled()
  })

  it('returns cached records with null columnTypes (columnTypes ?? {} branch)', async () => {
    // Covers line 150: `cached.columnTypes ?? {}` when columnTypes is null
    const cache = mockCache()
    // Manually pre-populate the cache with null columnTypes (branch='' → 'default')
    await cache.set('ingitdb:col-records-v2:o/r:default:c', { records: [{ _id: 'X' }], columnTypes: null })
    const deps: CollectionDeps = { githubApi: mockGithubApi(), cache }
    const schema = { ...emptySchema }
    const result = await loadCollectionRecords('o/r', '', 'c', schema, 'c', deps, false)
    expect(result.records).toHaveLength(1)
    expect(result.ingrColumnTypes).toEqual({})
  })

  // ── materialized view (.ingr) ──────────────────────────────────────────
  it('loads materialized .ingr view when default_view is set', async () => {
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'ingr data' })
    mockParseIngr.mockReturnValue({
      recordsetName: 'test',
      columns: ['$ID:s', '$name:s'],
      records: [{ 'ID:s': '1', 'name:s': 'Alice' }]
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, default_view: {} }
    const result = await loadCollectionRecords('o/r', 'main', 'users', schema, 'users', deps)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]._id).toBe('1')
    expect(result.ingrColumnTypes).toEqual({ ID: 's', name: 's' })
  })

  it('uses custom view file name from default_view.file', async () => {
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'ingr data' })
    mockParseIngr.mockReturnValue({ recordsetName: 'x', columns: ['$ID'], records: [{ ID: 'a' }] })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, default_view: { file: 'custom.ingr' } }
    await loadCollectionRecords('o/r', 'main', 'col', schema, 'data/col', deps, true)
    expect(getFileText).toHaveBeenCalledWith('o/r', '$ingitdb/data/col/custom.ingr', 'main')
  })

  it('loads non-.ingr materialized view (JSON array)', async () => {
    const getFileText = vi.fn().mockResolvedValue({
      decodedContent: JSON.stringify([{ name: 'A' }, { name: 'B' }])
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, default_view: { file: 'view.json' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(2)
    expect(result.records[0]._id).toBe('0')
  })

  it('falls back to record files when materialized view is 404', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const getContents = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText, getContents }), cache: mockCache() }
    const schema = { ...emptySchema, default_view: {}, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toEqual([])
    warnSpy.mockRestore()
  })

  it('throws when materialized view returns non-404 error', async () => {
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 500 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, default_view: {} }
    await expect(loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true))
      .rejects.toEqual({ response: { status: 500 } })
  })

  // ── single file (no {key}) ─────────────────────────────────────────────
  it('loads single-file collection (array data)', async () => {
    const getFileText = vi.fn().mockResolvedValue({
      decodedContent: '- name: A\n- name: B', sha: 'sha1'
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: 'data.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(2)
    expect(result.records[0]._id).toBe('0')
    expect(result.records[0]._path).toBe('col/data.yaml')
  })

  it('loads single-file collection (object data)', async () => {
    const getFileText = vi.fn().mockResolvedValue({
      decodedContent: 'FR:\n  name: France\nDE:\n  name: Germany', sha: 's'
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: 'all.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(2)
    expect(result.records[0]._id).toBe('FR')
    expect(result.records[0].name).toBe('France')
  })

  it('loads single-file collection (object with primitive values)', async () => {
    const getFileText = vi.fn().mockResolvedValue({
      decodedContent: 'a: 1\nb: 2', sha: 's'
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: 'all.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(2)
    expect(result.records[0]._id).toBe('a')
  })

  it('returns empty for single-file collection when file is 404', async () => {
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: 'data.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toEqual([])
  })

  it('throws for single-file collection with non-404 error', async () => {
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 500 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: 'data.yaml' } }
    await expect(loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true))
      .rejects.toEqual({ response: { status: 500 } })
  })

  // ── file per record (flat) ─────────────────────────────────────────────
  it('loads file-per-record from $records/ directory', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'FR.yaml', path: 'col/$records/FR.yaml' },
      { type: 'file', name: 'DE.yaml', path: 'col/$records/DE.yaml' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'name: Test', sha: 'abc' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(2)
    expect(result.records[0]._id).toBe('FR')
  })

  it('filters out hidden files and non-yaml/json files', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'FR.yaml', path: 'col/$records/FR.yaml' },
      { type: 'file', name: '.ingitdb-meta', path: 'col/$records/.ingitdb-meta' },
      { type: 'file', name: '.collection-cfg', path: 'col/$records/.collection-cfg' },
      { type: 'file', name: 'readme.md', path: 'col/$records/readme.md' },
      { type: 'dir', name: 'subdir', path: 'col/$records/subdir' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'v: 1' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(1)
  })

  it('returns empty when $records/ is 404', async () => {
    const getContents = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toEqual([])
  })

  it('throws when $records/ returns non-404 error', async () => {
    const getContents = vi.fn().mockRejectedValue({ response: { status: 500 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    await expect(loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true))
      .rejects.toEqual({ response: { status: 500 } })
  })

  it('returns empty when getContents returns non-array', async () => {
    const getContents = vi.fn().mockResolvedValue({ type: 'file' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toEqual([])
  })

  // ── file per record (nested) ───────────────────────────────────────────
  it('loads nested file-per-record from $records/ directory', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'dir', name: 'FR', path: 'col/$records/FR' },
      { type: 'dir', name: '.hidden', path: 'col/$records/.hidden' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'name: France' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}/record.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]._id).toBe('FR')
  })

  // ── error handling in batch fetching ───────────────────────────────────
  it('handles 404 on individual file fetch', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'OK.yaml', path: 'col/$records/OK.yaml' },
      { type: 'file', name: 'GONE.yaml', path: 'col/$records/GONE.yaml' }
    ])
    const getFileText = vi.fn().mockImplementation((_: string, path: string) => {
      if (path.includes('GONE')) return Promise.reject({ response: { status: 404 } })
      return Promise.resolve({ decodedContent: 'v: 1' })
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    const gone = result.records.find(r => r._id === 'GONE')
    expect(gone?._error).toBe('404 Not Found')
  })

  it('handles generic error on individual file fetch', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'ERR.yaml', path: 'col/$records/ERR.yaml' }
    ])
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 503 }, message: 'Unavailable' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records[0]._error).toContain('503')
  })

  it('handles parse error on individual file', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'BAD.json', path: 'col/$records/BAD.json' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: '{bad json' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.json' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records[0]._parseError).toBe('{bad json')
  })

  it('uses collectionId as fallback when schema and collectionPath are empty', async () => {
    const getContents = vi.fn().mockRejectedValue({ response: { status: 404 } })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents }), cache: mockCache() }
    const result = await loadCollectionRecords('o/r', 'main', 'myCol', emptySchema, '', deps, true)
    expect(result.records).toEqual([])
  })

  it('uses default record_file pattern when schema has none', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'FR.yaml', path: 'col/$records/FR.yaml' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'name: France' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const result = await loadCollectionRecords('o/r', 'main', 'col', emptySchema, 'col', deps, true)
    expect(result.records).toHaveLength(1)
  })

  it('handles single-file non-object data (e.g., scalar)', async () => {
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'just a string' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: 'data.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toEqual([])
  })

  it('handles JSON single-file collection', async () => {
    const getFileText = vi.fn().mockResolvedValue({
      decodedContent: JSON.stringify([{ name: 'x' }]), sha: 's'
    })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: 'data.json' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0].name).toBe('x')
  })

  it('handles materialized view non-ingr non-array data', async () => {
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'key: value' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, default_view: { file: 'view.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records).toEqual([])
  })

  it('handles error on individual file with no response status', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'ERR.yaml', path: 'col/$records/ERR.yaml' }
    ])
    const getFileText = vi.fn().mockRejectedValue(new Error('network fail'))
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records[0]._error).toContain('network fail')
  })

  it('handles malformed YAML in individual file (parseFileContent YAML throw path)', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'BAD.yaml', path: 'col/$records/BAD.yaml' }
    ])
    // This YAML is malformed enough for js-yaml to throw a YAMLException
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: '%YAML 1.1\n%invalid' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    // parseFileContent throws "Failed to parse YAML from..." which is caught by loadCollectionRecords
    // and stored as _parseError since file was already loaded
    expect(result.records[0]._parseError).toBeDefined()
  })

  it('covers schema=null fallback (schema || {} branch)', async () => {
    // Passing null schema hits the `schema || {}` branch
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'rec.yaml', path: 'col/$records/rec.yaml' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'name: test' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await loadCollectionRecords('o/r', 'main', 'col', null as any, 'col', deps, true)
    expect(result.records[0].name).toBe('test')
  })

  it('covers empty YAML record file (parseYaml || {} branch line 22)', async () => {
    // Empty .yaml record file → parseYaml returns null → || {} → record is {}
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'rec.yaml', path: 'col/$records/rec.yaml' }
    ])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: '' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records[0]._id).toBe('rec')
  })

  it('covers colPath trailing slash in default_view (pop() || colPath branch)', async () => {
    // colPath ending with '/' → .pop() returns '' (falsy) → uses colPath as fallback segment
    mockParseIngr.mockReturnValue({ columns: ['$ID:string'], records: [] })
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'dummy' })
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, default_view: {} } // default_view.file is falsy → uses lastSegment
    // collectionPath ends with '/' → colPath = 'col/' → split('/').pop() = '' (falsy)
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col/', deps, true)
    expect(result.records).toEqual([])
  })

  it('covers non-404 error status code in individual file error (status || Error branch)', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'rec.yaml', path: 'col/$records/rec.yaml' }
    ])
    // Throw error with status 500 → uses `500 || 'Error'` → `500: message`
    const err500 = Object.assign(new Error('server error'), { response: { status: 500 } })
    const getFileText = vi.fn().mockRejectedValue(err500)
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records[0]._error).toBe('500: server error')
  })

  it('covers error with no message (message || "Unknown error" branch)', async () => {
    const getContents = vi.fn().mockResolvedValue([
      { type: 'file', name: 'rec.yaml', path: 'col/$records/rec.yaml' }
    ])
    // Object with status != 404 and no message → hits `|| 'Unknown error'` branch
    const errNoMsg = { response: { status: 500 } }
    const getFileText = vi.fn().mockRejectedValue(errNoMsg)
    const deps: CollectionDeps = { githubApi: mockGithubApi({ getContents, getFileText }), cache: mockCache() }
    const schema = { ...emptySchema, record_file: { name: '{key}.yaml' } }
    const result = await loadCollectionRecords('o/r', 'main', 'col', schema, 'col', deps, true)
    expect(result.records[0]._error).toBe('500: Unknown error')
  })
})
