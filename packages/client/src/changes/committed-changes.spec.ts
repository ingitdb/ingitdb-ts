import { describe, it, expect } from 'vitest'
import { createCommittedChangesStore } from './committed-changes'
import type { PendingChange } from '../types'

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

describe('createCommittedChangesStore (memory)', () => {
  it('add stores changes and isCommittedDeletion reflects them', async () => {
    const store = createCommittedChangesStore()
    await store.add([makeChange({ recordId: 'FR' }), makeChange({ recordId: 'DE' })])
    expect(store.isCommittedDeletion('FR')).toBe(true)
    expect(store.isCommittedDeletion('DE')).toBe(true)
  })

  it('add does not duplicate entries', async () => {
    const store = createCommittedChangesStore()
    const c = makeChange({ recordId: 'FR' })
    await store.add([c])
    await store.add([c])
    const loaded = await store.loadForCollection('user1', 'owner/repo', 'main', 'countries')
    expect(loaded).toHaveLength(1)
  })

  it('loadForCollection filters by context', async () => {
    const store = createCommittedChangesStore()
    await store.add([
      makeChange({ recordId: 'FR', collectionId: 'countries' }),
      makeChange({ recordId: 'X', collectionId: 'cities' })
    ])
    const loaded = await store.loadForCollection('user1', 'owner/repo', 'main', 'countries')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].recordId).toBe('FR')
  })

  it('removeSettled removes specific IDs and leaves others', async () => {
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

  it('isCommittedDeletion returns true only for delete changeType', async () => {
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
