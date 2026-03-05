import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GithubApi } from '../github/github-api'
import type { Cache } from '../cache/cache'

// idb is needed because database-config.ts imports buildCacheKey from cache.ts → idb-cache.ts → idb
vi.mock('idb', () => ({
  openDB: () => Promise.resolve({ get: vi.fn(), put: vi.fn(), delete: vi.fn(), clear: vi.fn(), getAllKeys: vi.fn() })
}))

const { loadDatabaseConfig } = await import('./database-config')
type DatabaseConfigDeps = { githubApi: GithubApi; cache: Cache }

function mockGithubApi(overrides: Partial<GithubApi> = {}): GithubApi {
  return {
    getRateLimit: () => ({ limit: null, remaining: null, reset: null }),
    getRepo: vi.fn(), getBranches: vi.fn(), getContents: vi.fn(), getFileText: vi.fn(),
    putFile: vi.fn(), deleteFile: vi.fn(), forkRepo: vi.fn(), getBranchSHA: vi.fn(),
    createBranch: vi.fn(), checkExistingFork: vi.fn(), waitForFork: vi.fn(),
    syncForkBranch: vi.fn(), getCommit: vi.fn(), createTree: vi.fn(),
    createCommit: vi.fn(), updateBranchRef: vi.fn(),
    ...overrides
  }
}

function mockCache(): Cache {
  const store = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> { return (store.get(key) as T) ?? null },
    async set<T>(key: string, value: T): Promise<T> { store.set(key, value); return value },
    async delete(key: string) { store.delete(key) },
    async clear() { store.clear() }
  }
}

describe('loadDatabaseConfig', () => {
  let githubApi: GithubApi
  let cache: Cache
  let deps: DatabaseConfigDeps

  beforeEach(() => {
    vi.clearAllMocks()
    githubApi = mockGithubApi()
    cache = mockCache()
    deps = { githubApi, cache }
  })

  it('returns empty config when repo is empty', async () => {
    const result = await loadDatabaseConfig('', undefined, deps)
    expect(result).toEqual({ rawYaml: '', collections: [], views: [], triggers: [], subscribers: [] })
  })

  it('loads collections from root-collections.yaml', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'countries: data/countries\ncities: data/cities'
    })
    const result = await loadDatabaseConfig('owner/repo', 'main', deps)
    expect(result.collections).toEqual([
      { id: 'countries', path: 'data/countries' },
      { id: 'cities', path: 'data/cities' }
    ])
    expect(result.rawYaml).toBe('countries: data/countries\ncities: data/cities')
  })

  it('uses cache on second call (githubApi not called again)', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'c: path/c'
    })
    await loadDatabaseConfig('owner/repo', 'main', deps)
    await loadDatabaseConfig('owner/repo', 'main', deps)
    expect(githubApi.getFileText).toHaveBeenCalledTimes(1)
  })

  it('expands namespace entries (ns.* pattern)', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockImplementation(
      (_repo: string, path: string) => {
        if (path === '.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'geo.*: geo' })
        }
        if (path === 'geo/.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'countries: countries\ncities: cities' })
        }
        return Promise.reject({ response: { status: 404 } })
      }
    )
    const result = await loadDatabaseConfig('owner/repo', 'main', deps)
    expect(result.collections).toEqual([
      { id: 'geo.countries', path: 'geo/countries' },
      { id: 'geo.cities', path: 'geo/cities' }
    ])
  })

  it('warns and skips namespace entries that fail to load', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(githubApi.getFileText as ReturnType<typeof vi.fn>).mockImplementation(
      (_repo: string, path: string) => {
        if (path === '.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'ns.*: ns-dir' })
        }
        return Promise.reject(new Error('network error'))
      }
    )
    const result = await loadDatabaseConfig('owner/repo', 'main', deps)
    expect(result.collections).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('handles undefined branch (uses "default" in cache key)', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'a: path/a'
    })
    const result = await loadDatabaseConfig('owner/repo', undefined, deps)
    expect(result.collections).toEqual([{ id: 'a', path: 'path/a' }])
  })

  it('handles empty parsed YAML (returns null from parseYaml)', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: ''
    })
    const result = await loadDatabaseConfig('owner/repo', 'main', deps)
    expect(result.collections).toEqual([])
  })

  it('handles empty sub-namespace YAML (parseYaml returns null — covers || {} branch)', async () => {
    // Line 40 in database-config.ts: `(parseYaml(subFile.decodedContent) as ...) || {}`
    // This is the fallback when the nested root-collections.yaml is empty/null.
    ;(githubApi.getFileText as ReturnType<typeof vi.fn>).mockImplementation(
      (_repo: string, path: string) => {
        if (path === '.ingitdb/root-collections.yaml') {
          return Promise.resolve({ decodedContent: 'geo.*: geo' })
        }
        // Nested namespace file returns empty content → parseYaml → null → `|| {}`
        return Promise.resolve({ decodedContent: '' })
      }
    )
    const result = await loadDatabaseConfig('owner/repo', 'main', deps)
    expect(result.collections).toEqual([])
  })
})
