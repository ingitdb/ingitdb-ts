import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GithubApi } from '../github/github-api'
import type { Cache } from '@ingitdb/client'

// ---------- mocks ---------------------------------------------------------
const mockParseIngr = vi.hoisted(() => vi.fn())

vi.mock('@ingr/codec', () => ({ parseIngr: mockParseIngr }))

vi.mock('idb', () => ({
  openDB: () => Promise.resolve({ get: vi.fn(), put: vi.fn(), delete: vi.fn(), clear: vi.fn(), getAllKeys: vi.fn() })
}))

const { loadFKViews } = await import('./fk-views')

type FKViewDeps = { githubApi: GithubApi; cache: Cache }

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

describe('loadFKViews', () => {
  let githubApi: GithubApi
  let cache: Cache
  let deps: FKViewDeps

  beforeEach(() => {
    vi.clearAllMocks()
    githubApi = mockGithubApi()
    cache = mockCache()
    deps = { githubApi, cache }
  })

  // ── empty-param guards ──────────────────────────────────────────────────
  it('returns [] when repo is empty', async () => {
    expect(await loadFKViews('', 'main', 'countries', 'FR', deps)).toEqual([])
  })

  it('returns [] when collectionPath is empty', async () => {
    expect(await loadFKViews('o/r', 'main', '', 'FR', deps)).toEqual([])
  })

  it('returns [] when recordKey is empty', async () => {
    expect(await loadFKViews('o/r', 'main', 'countries', '', deps)).toEqual([])
  })

  // ── caching ─────────────────────────────────────────────────────────────
  it('returns cached result on second call', async () => {
    (githubApi.getContents as ReturnType<typeof vi.fn>).mockRejectedValue({ response: { status: 404 } })
    // First call: discoverFKSlots returns [] (404 on $fk/ dir)
    await loadFKViews('o/r', 'main', 'countries', 'FR', deps)
    // Second call: should come from cache (record-level)
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', deps)
    expect(result).toEqual([])
  })

  // ── 404 on $fk/ directory ───────────────────────────────────────────────
  it('returns [] when $fk/ directory is 404', async () => {
    (githubApi.getContents as ReturnType<typeof vi.fn>).mockRejectedValue({ response: { status: 404 } })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', deps)
    expect(result).toEqual([])
  })

  it('throws when $fk/ directory returns non-404 error', async () => {
    (githubApi.getContents as ReturnType<typeof vi.fn>).mockRejectedValue({ response: { status: 500 } })
    await expect(loadFKViews('o/r', undefined, 'countries', 'FR', deps)).rejects.toEqual({ response: { status: 500 } })
  })

  it('returns [] when getContents returns non-array', async () => {
    (githubApi.getContents as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'file' })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', deps)
    expect(result).toEqual([])
  })

  // ── no matching file for recordKey ──────────────────────────────────────
  it('returns [] when no file matches the recordKey', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'orders', type: 'dir', path: '$fk/orders' }])   // $fk/ dir
      .mockResolvedValueOnce([{ name: 'customer_id', type: 'dir', path: '$fk/orders/customer_id' }])   // refCol dirs
      .mockResolvedValueOnce([{ name: 'OTHER.yaml', type: 'file', path: '$fk/orders/customer_id/OTHER.yaml' }])   // files in slot
    const api = mockGithubApi({ getContents })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result).toEqual([])
  })

  // ── .ingr file parsing ─────────────────────────────────────────────────
  it('parses .ingr files and returns FKView with columns, columnTypes, records', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'orders', type: 'dir', path: '$fk/orders' }])
      .mockResolvedValueOnce([{ name: 'customer_id', type: 'dir', path: '$fk/orders/customer_id' }])
      .mockResolvedValueOnce([{ name: 'FR.ingr', type: 'file', path: '$fk/orders/customer_id/FR.ingr' }])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'ingr content' })
    mockParseIngr.mockReturnValue({
      recordsetName: 'test',
      columns: ['$ID:s', '$name:s', '$amount:n'],
      records: [
        { 'ID:s': '1', 'name:s': 'Order A', 'amount:n': 100 },
        { 'ID:s': '2', 'name:s': 'Order B', 'amount:n': 200 }
      ]
    })

    const api = mockGithubApi({ getContents, getFileText })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result).toHaveLength(1)
    expect(result[0].refColId).toBe('orders')
    expect(result[0].fkField).toBe('customer_id')
    expect(result[0].columns).toEqual(['_id', 'name', 'amount'])
    expect(result[0].columnTypes).toEqual({ _id: 's', name: 's', amount: 'n' })
    expect(result[0].records).toHaveLength(2)
    expect(result[0].records[0]._id).toBe('1')
  })

  it('handles .ingr columns without type suffix', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockResolvedValueOnce([{ name: 'fk', type: 'dir', path: '$fk/ref/fk' }])
      .mockResolvedValueOnce([{ name: 'FR.ingr', type: 'file', path: '$fk/ref/fk/FR.ingr' }])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'data' })
    mockParseIngr.mockReturnValue({
      recordsetName: 'x',
      columns: ['$plain'],
      records: [{ plain: 'v1' }]
    })

    const api = mockGithubApi({ getContents, getFileText })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result[0].columns).toEqual(['plain'])
    expect(result[0].columnTypes).toEqual({})
    expect(result[0].records[0].plain).toBe('v1')
  })

  // ── non-.ingr file (JSON) ──────────────────────────────────────────────
  it('parses JSON/YAML file and returns FKView with records', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'items', type: 'dir', path: '$fk/items' }])
      .mockResolvedValueOnce([{ name: 'ref_id', type: 'dir', path: '$fk/items/ref_id' }])
      .mockResolvedValueOnce([{ name: 'FR.json', type: 'file', path: '$fk/items/ref_id/FR.json' }])
    const getFileText = vi.fn().mockResolvedValue({
      decodedContent: JSON.stringify([{ name: 'Item A' }, { name: 'Item B' }])
    })

    const api = mockGithubApi({ getContents, getFileText })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result).toHaveLength(1)
    expect(result[0].records).toHaveLength(2)
    expect(result[0].records[0]._id).toBe('0')
    expect(result[0].records[0].name).toBe('Item A')
    expect(result[0].columns).toEqual(['name'])
  })

  it('returns empty records for non-array data', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'x', type: 'dir', path: '$fk/x' }])
      .mockResolvedValueOnce([{ name: 'f', type: 'dir', path: '$fk/x/f' }])
      .mockResolvedValueOnce([{ name: 'FR.yaml', type: 'file', path: '$fk/x/f/FR.yaml' }])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'key: value' })

    const api = mockGithubApi({ getContents, getFileText })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result[0].records).toEqual([])
    expect(result[0].columns).toEqual([])
  })

  // ── 404 on slot sub-directory ──────────────────────────────────────────
  it('handles 404 on refCol sub-directory', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockRejectedValueOnce({ response: { status: 404 } })
    const api = mockGithubApi({ getContents })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result).toEqual([])
  })

  it('throws on non-404 error in refCol sub-directory', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockRejectedValueOnce({ response: { status: 500 } })
    const api = mockGithubApi({ getContents })
    await expect(loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache }))
      .rejects.toEqual({ response: { status: 500 } })
  })

  // ── 404 on file listing in slot ────────────────────────────────────────
  it('handles 404 on slot file listing', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockResolvedValueOnce([{ name: 'fk', type: 'dir', path: '$fk/ref/fk' }])
      .mockRejectedValueOnce({ response: { status: 404 } })  // file listing
    const api = mockGithubApi({ getContents })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result).toEqual([])
  })

  it('throws on non-404 error on slot file listing', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockResolvedValueOnce([{ name: 'fk', type: 'dir', path: '$fk/ref/fk' }])
      .mockRejectedValueOnce({ response: { status: 500 } })
    const api = mockGithubApi({ getContents })
    await expect(loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache }))
      .rejects.toEqual({ response: { status: 500 } })
  })

  // ── 404 on file text fetch ─────────────────────────────────────────────
  it('handles 404 when fetching file text', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockResolvedValueOnce([{ name: 'fk', type: 'dir', path: '$fk/ref/fk' }])
      .mockResolvedValueOnce([{ name: 'FR.yaml', type: 'file', path: '$fk/ref/fk/FR.yaml' }])
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 404 } })

    const api = mockGithubApi({ getContents, getFileText })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result).toEqual([])
  })

  it('throws on non-404 error when fetching file text', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockResolvedValueOnce([{ name: 'fk', type: 'dir', path: '$fk/ref/fk' }])
      .mockResolvedValueOnce([{ name: 'FR.yaml', type: 'file', path: '$fk/ref/fk/FR.yaml' }])
    const getFileText = vi.fn().mockRejectedValue({ response: { status: 500 } })

    const api = mockGithubApi({ getContents, getFileText })
    await expect(loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache }))
      .rejects.toEqual({ response: { status: 500 } })
  })

  // ── JSON parse error ───────────────────────────────────────────────────
  it('throws on invalid JSON content', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockResolvedValueOnce([{ name: 'fk', type: 'dir', path: '$fk/ref/fk' }])
      .mockResolvedValueOnce([{ name: 'FR.json', type: 'file', path: '$fk/ref/fk/FR.json' }])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: '{invalid json' })

    const api = mockGithubApi({ getContents, getFileText })
    await expect(loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache }))
      .rejects.toThrow('Failed to parse JSON')
  })

  // ── YAML parse error ───────────────────────────────────────────────────
  it('throws on invalid YAML content', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'ref', type: 'dir', path: '$fk/ref' }])
      .mockResolvedValueOnce([{ name: 'fk', type: 'dir', path: '$fk/ref/fk' }])
      .mockResolvedValueOnce([{ name: 'FR.yaml', type: 'file', path: '$fk/ref/fk/FR.yaml' }])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: '%invalid\nyaml: :::' })

    const api = mockGithubApi({ getContents, getFileText })
    await expect(loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache }))
      .rejects.toThrow('Failed to parse YAML')
  })

  // ── empty YAML file (parseFileContent || {} branch) ────────────────────
  it('handles empty YAML content (returns empty columns/records)', async () => {
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'x', type: 'dir', path: '$fk/x' }])
      .mockResolvedValueOnce([{ name: 'f', type: 'dir', path: '$fk/x/f' }])
      .mockResolvedValueOnce([{ name: 'FR.yaml', type: 'file', path: '$fk/x/f/FR.yaml' }])
    // Empty content → parseYaml returns null → || {} → not an array → empty records
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: '' })
    const api = mockGithubApi({ getContents, getFileText })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache })
    expect(result[0].records).toEqual([])
  })

  // ── record-level cache hit (line 112 true branch) ─────────────────────
  it('returns record-level cached result after a full successful load', async () => {
    // First call: full flow — finds slot, reads .ingr file, caches result
    mockParseIngr.mockReturnValue({
      columns: ['$ID:string', 'name:string'],
      records: [{ '$ID:string': 'FR', 'name:string': 'France' }]
    })
    const getContents = vi.fn()
      .mockResolvedValueOnce([{ name: 'col2', type: 'dir', path: '$fk/col2' }])
      .mockResolvedValueOnce([{ name: 'field', type: 'dir', path: '$fk/col2/field' }])
      .mockResolvedValueOnce([{ name: 'FR.ingr', type: 'file', path: '$fk/col2/field/FR.ingr' }])
    const getFileText = vi.fn().mockResolvedValue({ decodedContent: 'dummy' })
    const api = mockGithubApi({ getContents, getFileText })
    const freshCache = mockCache()
    await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api, cache: freshCache })

    // Second call with same cache — should hit line 112 early return
    const getContents2 = vi.fn() // should NOT be called
    const api2 = mockGithubApi({ getContents: getContents2, getFileText: vi.fn() })
    const result = await loadFKViews('o/r', 'main', 'countries', 'FR', { githubApi: api2, cache: freshCache })
    expect(getContents2).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
  })
})
