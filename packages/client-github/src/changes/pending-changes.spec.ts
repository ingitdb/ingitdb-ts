import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GithubApi } from '../github/github-api'
import type { Cache, CommittedChangesStore } from '@ingitdb/client'

// IDBKeyRange is a native browser global not provided by happy-dom — stub it so
// the cursor-based clearAll can call IDBKeyRange.only(...) without a ReferenceError.
// The stub simply returns the key array as-is; the mock's openCursor handles it.
vi.stubGlobal('IDBKeyRange', { only: (key: unknown) => key })

// ---------------------------------------------------------------------------
// Shared IDB state — `vi.hoisted` ensures the value is available inside the
// `vi.mock` factory (which is hoisted before module-level code runs) AND also
// in ordinary test bodies, so tests can pre-seed non-delete rows to exercise
// the `change.changeType !== 'delete'` and `changeByPath.size === 0` branches.
// ---------------------------------------------------------------------------
const idbState = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>()
}))

function idbKey(v: Record<string, unknown>): string {
  return JSON.stringify([v['userId'], v['repo'], v['branch'], v['collectionId'], v['recordId']])
}

// Mock idb — each `openDB` call shares `idbState.rows`; calling the upgrade
// callback covers the schema-setup block (lines 47-54 of pending-changes.ts).
vi.mock('idb', () => ({
  openDB: (_name: string, _ver: number, opts?: { upgrade?: (db: unknown) => void }) => {
    const rows = idbState.rows
    const store = {
      put(_: string, value: Record<string, unknown>) {
        rows.set(idbKey(value), { ...value })
        return Promise.resolve()
      },
      delete(_: string, k: unknown[]) {
        rows.delete(JSON.stringify(k))
        return Promise.resolve()
      },
      getAllFromIndex(_: string, indexName: string, k: unknown[]) {
        const fields = indexName === 'by-context'
          ? ['userId', 'repo', 'branch', 'collectionId']
          : ['userId', 'repo', 'branch']
        return Promise.resolve(
          [...rows.values()].filter(r => fields.every((f, i) => r[f] === k[i]))
        )
      },
      transaction(_storeName: string, _mode: string) {
        const matching = [...rows.entries()]
        let idx = 0
        const nextCursor = (): Promise<{ delete: () => Promise<void>; continue: () => Promise<unknown> } | null> => {
          if (idx >= matching.length) return Promise.resolve(null)
          const [key] = matching[idx++]
          return Promise.resolve({
            delete() { rows.delete(key); return Promise.resolve() },
            continue() { return nextCursor() }
          })
        }
        return {
          store: {
            index(_indexName: string) {
              return {
                openCursor(range: unknown) {
                  // Our IDBKeyRange.only stub returns the key array directly
                  const bound = range as unknown[]
                  const filtered = [...rows.entries()].filter(([, r]) =>
                    r['userId'] === bound[0] && r['repo'] === bound[1] && r['branch'] === bound[2]
                  )
                  let i = 0
                  const next = (): Promise<{ delete: () => Promise<void>; continue: () => Promise<unknown> } | null> => {
                    if (i >= filtered.length) return Promise.resolve(null)
                    const [key] = filtered[i++]
                    return Promise.resolve({
                      delete() { rows.delete(key); return Promise.resolve() },
                      continue() { return next() }
                    })
                  }
                  return next()
                }
              }
            }
          },
          done: Promise.resolve()
        }
      }
    }
    const createIndex = vi.fn()
    const createObjectStore = vi.fn(() => ({ createIndex }))
    const db = { ...store, objectStoreNames: { contains: vi.fn(() => false) }, createObjectStore }
    opts?.upgrade?.(db)
    return Promise.resolve(db)
  }
}))

// Mock resolveCollectionPath for commitAll tests
vi.mock('../collection/collection', () => ({
  resolveCollectionPath: vi.fn().mockResolvedValue('countries')
}))

// Import AFTER the mock is set up
const { createPendingChangesStore } = await import('./pending-changes')

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

function mockCache(): Cache {
  const store = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> { return (store.get(key) as T) ?? null },
    async set<T>(key: string, value: T): Promise<T> { store.set(key, value); return value },
    async delete(key: string) { store.delete(key) },
    async clear() { store.clear() }
  }
}

describe('PendingChangesStore', () => {
  let store: ReturnType<typeof createPendingChangesStore>

  beforeEach(() => {
    idbState.rows.clear()  // reset shared IDB between tests
    store = createPendingChangesStore(mockGithubApi(), mockCache())
  })

  const baseParams = {
    userId: 'user1',
    repo: 'owner/repo',
    branch: 'main',
    collectionId: 'countries',
    recordId: 'FR'
  }

  it('stageDelete adds a pending change', async () => {
    await store.stageDelete(baseParams)
    const changes = await store.loadForCollection('user1', 'owner/repo', 'main', 'countries')
    expect(changes).toHaveLength(1)
    expect(changes[0].changeType).toBe('delete')
    expect(changes[0].recordId).toBe('FR')
  })

  it('unstage removes a staged change', async () => {
    await store.stageDelete(baseParams)
    await store.unstage(baseParams)
    const changes = await store.loadForCollection('user1', 'owner/repo', 'main', 'countries')
    expect(changes).toHaveLength(0)
  })

  it('loadForRepoBranch returns all changes across collections', async () => {
    await store.stageDelete(baseParams)
    await store.stageDelete({ ...baseParams, collectionId: 'cities', recordId: 'Berlin' })
    const all = await store.loadForRepoBranch('user1', 'owner/repo', 'main')
    expect(all).toHaveLength(2)
  })

  it('clearAll removes all changes for a repo+branch', async () => {
    await store.stageDelete(baseParams)
    await store.stageDelete({ ...baseParams, recordId: 'DE' })
    await store.clearAll('user1', 'owner/repo', 'main')
    const remaining = await store.loadForRepoBranch('user1', 'owner/repo', 'main')
    expect(remaining).toHaveLength(0)
  })

  // ── commitAll ─────────────────────────────────────────────────────────
  describe('commitAll', () => {
    const commitParams = { userId: 'user1', repo: 'owner/repo', branch: 'main', message: 'delete records' }

    it('commits deletions via Git Tree API and clears IDB', async () => {
      const githubApi = mockGithubApi({
        getFileText: vi.fn().mockRejectedValue({ response: { status: 404 } }),
        getContents: vi.fn().mockResolvedValue({ type: 'file' }),
        getBranchSHA: vi.fn().mockResolvedValue('headSha'),
        getCommit: vi.fn().mockResolvedValue({ sha: 'headSha', tree: { sha: 'treeSha' } }),
        createTree: vi.fn().mockResolvedValue('newTreeSha'),
        createCommit: vi.fn().mockResolvedValue('newCommitSha'),
        updateBranchRef: vi.fn().mockResolvedValue(undefined)
      })
      store = createPendingChangesStore(githubApi, mockCache())
      await store.stageDelete(baseParams)
      await store.commitAll(commitParams)
      // IDB should be cleared
      const remaining = await store.loadForRepoBranch('user1', 'owner/repo', 'main')
      expect(remaining).toHaveLength(0)
      expect(githubApi.updateBranchRef).toHaveBeenCalledWith('owner/repo', 'main', 'newCommitSha')
    })

    it('handles stale files (404 on getContents) gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const githubApi = mockGithubApi({
        getFileText: vi.fn().mockRejectedValue({ response: { status: 404 } }),
        getContents: vi.fn().mockRejectedValue({ response: { status: 404 } })
      })
      store = createPendingChangesStore(githubApi, mockCache())
      await store.stageDelete(baseParams)
      await store.commitAll(commitParams)
      // No tree API calls since all files were stale
      expect(githubApi.getBranchSHA).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('throws on non-404 error during file verification', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const githubApi = mockGithubApi({
        getFileText: vi.fn().mockRejectedValue({ response: { status: 404 } }),
        getContents: vi.fn().mockRejectedValue({ response: { status: 500 } })
      })
      store = createPendingChangesStore(githubApi, mockCache())
      await store.stageDelete(baseParams)
      await expect(store.commitAll(commitParams)).rejects.toEqual({ response: { status: 500 } })
      consoleSpy.mockRestore()
    })

    it('throws for shared-file collections (no {key} in pattern)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const githubApi = mockGithubApi({
        getFileText: vi.fn().mockResolvedValue({
          decodedContent: 'record_file:\n  name: all.yaml'
        })
      })
      store = createPendingChangesStore(githubApi, mockCache())
      await store.stageDelete(baseParams)
      await expect(store.commitAll(commitParams)).rejects.toThrow('shared-file collections')
      consoleSpy.mockRestore()
    })

    it('passes committed changes to committedChangesStore', async () => {
      const githubApi = mockGithubApi({
        getFileText: vi.fn().mockRejectedValue({ response: { status: 404 } }),
        getContents: vi.fn().mockResolvedValue({ type: 'file' }),
        getBranchSHA: vi.fn().mockResolvedValue('h'),
        getCommit: vi.fn().mockResolvedValue({ sha: 'h', tree: { sha: 't' } }),
        createTree: vi.fn().mockResolvedValue('nt'),
        createCommit: vi.fn().mockResolvedValue('nc'),
        updateBranchRef: vi.fn().mockResolvedValue(undefined)
      })
      const committedChangesStore: CommittedChangesStore = {
        add: vi.fn(), loadForCollection: vi.fn(), removeSettled: vi.fn(), isCommittedDeletion: vi.fn()
      }
      store = createPendingChangesStore(githubApi, mockCache())
      await store.stageDelete(baseParams)
      await store.commitAll(commitParams, committedChangesStore)
      expect(committedChangesStore.add).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ recordId: 'FR', changeType: 'delete' })
      ]))
    })

    it('throws on unsupported change types (create/update are not yet supported)', async () => {
      // The public API only has stageDelete, so we seed a non-delete row directly
      // into the shared IDB rows Map to verify the error is thrown.
      const now = new Date().toISOString()
      idbState.rows.set(
        JSON.stringify(['user1', 'owner/repo', 'main', 'countries', 'NODEL']),
        { userId: 'user1', repo: 'owner/repo', branch: 'main', collectionId: 'countries',
          recordId: 'NODEL', changeType: 'update', originalData: null, pendingData: null,
          changedFields: [], createdAt: now, updatedAt: now }
      )
      const githubApi = mockGithubApi()
      store = createPendingChangesStore(githubApi, mockCache())
      await expect(store.commitAll(commitParams)).rejects.toThrow('Unsupported change type "update"')
    })

    it('uses custom record_file pattern from definition.yaml', async () => {
      const githubApi = mockGithubApi({
        getFileText: vi.fn().mockImplementation((_: string, path: string) => {
          if (path.endsWith('definition.yaml')) {
            return Promise.resolve({ decodedContent: 'record_file:\n  name: "{key}/record.yaml"' })
          }
          return Promise.reject({ response: { status: 404 } })
        }),
        getContents: vi.fn().mockResolvedValue({ type: 'file' }),
        getBranchSHA: vi.fn().mockResolvedValue('h'),
        getCommit: vi.fn().mockResolvedValue({ sha: 'h', tree: { sha: 't' } }),
        createTree: vi.fn().mockResolvedValue('nt'),
        createCommit: vi.fn().mockResolvedValue('nc'),
        updateBranchRef: vi.fn()
      })
      store = createPendingChangesStore(githubApi, mockCache())
      await store.stageDelete(baseParams)
      await store.commitAll(commitParams)
      // The path should use the custom pattern
      expect(githubApi.getContents).toHaveBeenCalledWith(
        'owner/repo',
        'countries/$records/FR/record.yaml',
        'main'
      )
    })
  })
})
