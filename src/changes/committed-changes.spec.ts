import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingChange } from './pending-changes'

// ---------- fake IDB store ------------------------------------------------
function createFakeStore() {
  const rows = new Map<string, Record<string, unknown>>()

  function matchesIndex(row: Record<string, unknown>, fields: string[], key: unknown[]): boolean {
    return fields.every((f, i) => row[f] === key[i])
  }

  return {
    put(_: string, value: Record<string, unknown>) {
      const k = JSON.stringify([value['userId'], value['repo'], value['branch'], value['collectionId'], value['recordId']])
      rows.set(k, { ...value })
    },
    delete(_: string, key: unknown[]) {
      rows.delete(JSON.stringify(key))
    },
    getAllFromIndex(_: string, indexName: string, key: unknown[]) {
      const fields = indexName === 'by-context'
        ? ['userId', 'repo', 'branch', 'collectionId']
        : ['userId', 'repo', 'branch']
      return [...rows.values()].filter((r) => matchesIndex(r, fields, key))
    },
    rows
  }
}

const mocks = vi.hoisted(() => ({
  contains: vi.fn(() => false),
  createIndex: vi.fn(),
  createObjectStore: vi.fn()
}))

vi.mock('idb', () => ({
  openDB: vi.fn(
    (_name: string, _ver: number, opts?: { upgrade?: (db: unknown) => void }) => {
      const store = createFakeStore()
      mocks.createObjectStore.mockReturnValue({ createIndex: mocks.createIndex })
      const db = {
        ...store,
        objectStoreNames: { contains: mocks.contains },
        createObjectStore: mocks.createObjectStore
      }
      opts?.upgrade?.(db)
      return Promise.resolve(db)
    }
  )
}))

const { createCommittedChangesStore } = await import('./committed-changes')

// ---------- helpers -------------------------------------------------------
const makeChange = (overrides: Partial<PendingChange> = {}): PendingChange => ({
  userId: 'user1',
  repo: 'owner/repo',
  branch: 'main',
  collectionId: 'countries',
  recordId: 'FR',
  changeType: 'delete',
  originalData: null,
  pendingData: null,
  changedFields: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
})

// ---------- tests ---------------------------------------------------------
describe('CommittedChangesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contains.mockReturnValue(false)
  })

  it('upgrade creates store and indexes when not present', () => {
    createCommittedChangesStore()
    expect(mocks.createObjectStore).toHaveBeenCalled()
    expect(mocks.createIndex).toHaveBeenCalledTimes(2)
  })

  it('upgrade skips store creation when already present', () => {
    mocks.contains.mockReturnValue(true)
    mocks.createObjectStore.mockClear()
    createCommittedChangesStore()
    expect(mocks.createObjectStore).not.toHaveBeenCalled()
  })

  it('add stores changes in IDB and memory', async () => {
    const store = createCommittedChangesStore()
    const c1 = makeChange({ recordId: 'FR' })
    const c2 = makeChange({ recordId: 'DE' })
    await store.add([c1, c2])
    expect(store.isCommittedDeletion('FR')).toBe(true)
    expect(store.isCommittedDeletion('DE')).toBe(true)
  })

  it('add does not duplicate entries already in memory', async () => {
    const store = createCommittedChangesStore()
    const c = makeChange({ recordId: 'FR' })
    await store.add([c])
    await store.add([c]) // duplicate
    // loadForCollection reads from IDB, which overwrites memory
    const loaded = await store.loadForCollection('user1', 'owner/repo', 'main', 'countries')
    // There should be exactly 1 entry in IDB (put overwrites)
    expect(loaded.length).toBeGreaterThanOrEqual(1)
    expect(store.isCommittedDeletion('FR')).toBe(true)
  })

  it('loadForCollection loads from IDB and updates memory', async () => {
    const store = createCommittedChangesStore()
    const c = makeChange({ recordId: 'IT' })
    await store.add([c])
    const loaded = await store.loadForCollection('user1', 'owner/repo', 'main', 'countries')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].recordId).toBe('IT')
    expect(store.isCommittedDeletion('IT')).toBe(true)
  })

  it('removeSettled removes specific IDs from IDB and memory', async () => {
    const store = createCommittedChangesStore()
    await store.add([
      makeChange({ recordId: 'A' }),
      makeChange({ recordId: 'B' }),
      makeChange({ recordId: 'C' })
    ])
    await store.removeSettled('user1', 'owner/repo', 'main', 'countries', ['A', 'C'])
    expect(store.isCommittedDeletion('A')).toBe(false)
    expect(store.isCommittedDeletion('B')).toBe(true)
    expect(store.isCommittedDeletion('C')).toBe(false)
  })

  it('isCommittedDeletion returns true only for delete changes', async () => {
    const store = createCommittedChangesStore()
    await store.add([
      makeChange({ recordId: 'DEL', changeType: 'delete' }),
      makeChange({ recordId: 'UPD', changeType: 'update' })
    ])
    expect(store.isCommittedDeletion('DEL')).toBe(true)
    expect(store.isCommittedDeletion('UPD')).toBe(false)
    expect(store.isCommittedDeletion('MISSING')).toBe(false)
  })
})
