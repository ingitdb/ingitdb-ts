import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- mock all dependencies ----------------------------------------
const mocks = vi.hoisted(() => {
  const fakeGithubApi = {
    getRateLimit: vi.fn(), getRepo: vi.fn(), getBranches: vi.fn(), getContents: vi.fn(),
    getFileText: vi.fn(), putFile: vi.fn(), deleteFile: vi.fn(), forkRepo: vi.fn(),
    getBranchSHA: vi.fn(), createBranch: vi.fn(), checkExistingFork: vi.fn(),
    waitForFork: vi.fn(), syncForkBranch: vi.fn(), getCommit: vi.fn(),
    createTree: vi.fn(), createCommit: vi.fn(), updateBranchRef: vi.fn()
  }
  const fakeCache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockImplementation((_: string, v: unknown) => Promise.resolve(v)),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
  }
  return {
    createGithubApi: vi.fn(() => fakeGithubApi),
    fakeGithubApi,
    fakeCache,
    loadDatabaseConfig: vi.fn().mockResolvedValue({ rawYaml: '', collections: [], views: [], triggers: [], subscribers: [] }),
    loadCollectionSchema: vi.fn().mockResolvedValue({ schema: { columns: [], columns_order: [], columnsMap: {} }, schemaYaml: '', collectionPath: '' }),
    loadCollectionRecords: vi.fn().mockResolvedValue({ records: [], ingrColumnTypes: {} }),
    loadRecord: vi.fn().mockResolvedValue({ _path: 'p' }),
    loadRepoMeta: vi.fn().mockResolvedValue({}),
    loadRepoSettings: vi.fn().mockResolvedValue({ languages: [] }),
    loadFKViews: vi.fn().mockResolvedValue([]),
    createPendingChangesStore: vi.fn(() => ({ stageDelete: vi.fn(), unstage: vi.fn(), loadForCollection: vi.fn(), loadForRepoBranch: vi.fn(), commitAll: vi.fn(), clearAll: vi.fn() })),
    createCommittedChangesStore: vi.fn(() => ({ add: vi.fn(), loadForCollection: vi.fn(), removeSettled: vi.fn(), isCommittedDeletion: vi.fn() }))
  }
})

vi.mock('./github/github-api', () => ({ createGithubApi: mocks.createGithubApi }))
vi.mock('./cache/cache', () => ({ cache: mocks.fakeCache, buildCacheKey: vi.fn((...parts: string[]) => parts.join(':')) }))
vi.mock('./database/database-config', () => ({ loadDatabaseConfig: mocks.loadDatabaseConfig }))
vi.mock('./collection/collection', () => ({
  loadCollectionSchema: mocks.loadCollectionSchema,
  loadCollectionRecords: mocks.loadCollectionRecords
}))
vi.mock('./collection/record', () => ({ loadRecord: mocks.loadRecord }))
vi.mock('./repo/repo', () => ({ loadRepoMeta: mocks.loadRepoMeta }))
vi.mock('./repo/repo-settings', () => ({ loadRepoSettings: mocks.loadRepoSettings }))
vi.mock('./collection/fk-views', () => ({ loadFKViews: mocks.loadFKViews }))
vi.mock('./changes/pending-changes', () => ({ createPendingChangesStore: mocks.createPendingChangesStore }))
vi.mock('./changes/committed-changes', () => ({ createCommittedChangesStore: mocks.createCommittedChangesStore }))

const { createIngitDbClient } = await import('./client')

// ---------- tests ---------------------------------------------------------
describe('createIngitDbClient', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates client without options', () => {
    const client = createIngitDbClient()
    expect(mocks.createGithubApi).toHaveBeenCalledWith(undefined)
    expect(client.githubApi).toBe(mocks.fakeGithubApi)
    expect(client.cache).toBe(mocks.fakeCache)
  })

  it('creates client with token', () => {
    createIngitDbClient({ token: 'ghp_abc' })
    expect(mocks.createGithubApi).toHaveBeenCalledWith('ghp_abc')
  })

  it('has all expected methods', () => {
    const client = createIngitDbClient()
    expect(typeof client.loadDatabaseConfig).toBe('function')
    expect(typeof client.loadCollectionSchema).toBe('function')
    expect(typeof client.loadCollectionRecords).toBe('function')
    expect(typeof client.loadRecord).toBe('function')
    expect(typeof client.loadRepoMeta).toBe('function')
    expect(typeof client.loadRepoSettings).toBe('function')
    expect(typeof client.loadFKViews).toBe('function')
    expect(typeof client.createPendingChangesStore).toBe('function')
    expect(typeof client.createCommittedChangesStore).toBe('function')
  })

  it('loadDatabaseConfig delegates correctly', async () => {
    const client = createIngitDbClient()
    await client.loadDatabaseConfig('o/r', 'main')
    expect(mocks.loadDatabaseConfig).toHaveBeenCalledWith('o/r', 'main', expect.any(Object))
  })

  it('loadCollectionSchema delegates correctly', async () => {
    const client = createIngitDbClient()
    await client.loadCollectionSchema('o/r', 'main', 'col1', true)
    expect(mocks.loadCollectionSchema).toHaveBeenCalledWith('o/r', 'main', 'col1', expect.any(Object), true)
  })

  it('loadCollectionRecords delegates correctly', async () => {
    const client = createIngitDbClient()
    const schema = { columns: [], columns_order: [], columnsMap: {} }
    await client.loadCollectionRecords('o/r', 'main', 'col1', schema, 'path', true)
    expect(mocks.loadCollectionRecords).toHaveBeenCalledWith('o/r', 'main', 'col1', schema, 'path', expect.any(Object), true)
  })

  it('loadRecord delegates correctly', async () => {
    const client = createIngitDbClient()
    await client.loadRecord('o/r', 'path/f.yaml', 'dev')
    expect(mocks.loadRecord).toHaveBeenCalledWith('o/r', 'path/f.yaml', 'dev', expect.any(Object))
  })

  it('loadRepoMeta delegates correctly', async () => {
    const client = createIngitDbClient()
    await client.loadRepoMeta('o/r')
    expect(mocks.loadRepoMeta).toHaveBeenCalledWith('o/r', expect.any(Object))
  })

  it('loadRepoSettings delegates correctly', async () => {
    const client = createIngitDbClient()
    await client.loadRepoSettings('o/r', 'main', true)
    expect(mocks.loadRepoSettings).toHaveBeenCalledWith('o/r', 'main', true, expect.any(Object))
  })

  it('loadFKViews delegates correctly', async () => {
    const client = createIngitDbClient()
    await client.loadFKViews('o/r', 'main', 'countries', 'FR')
    expect(mocks.loadFKViews).toHaveBeenCalledWith('o/r', 'main', 'countries', 'FR', expect.any(Object))
  })

  it('createPendingChangesStore delegates correctly', () => {
    const client = createIngitDbClient()
    const store = client.createPendingChangesStore()
    expect(store).toBeDefined()
    expect(mocks.createPendingChangesStore).toHaveBeenCalledWith(mocks.fakeGithubApi, mocks.fakeCache)
  })

  it('createCommittedChangesStore delegates correctly', () => {
    const client = createIngitDbClient()
    const store = client.createCommittedChangesStore()
    expect(store).toBeDefined()
    expect(mocks.createCommittedChangesStore).toHaveBeenCalled()
  })
})
