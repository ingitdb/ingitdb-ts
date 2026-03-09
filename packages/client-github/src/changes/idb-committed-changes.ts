import { openDB, type IDBPDatabase } from 'idb'
import type { PendingChange, CommittedChangesStore } from '@ingitdb/client'

const DB_NAME = 'ingitdb-committed'
const STORE_NAME = 'changes'

/**
 * Factory that creates a CommittedChangesStore backed by IndexedDB.
 * Maintains an in-memory array for quick `isCommittedDeletion` checks.
 */
export function createIdbCommittedChangesStore(): CommittedChangesStore {
  let committedChanges: PendingChange[] = []

  const dbPromise: Promise<IDBPDatabase> = openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: ['userId', 'repo', 'branch', 'collectionId', 'recordId']
        })
        store.createIndex('by-context', ['userId', 'repo', 'branch', 'collectionId'], { unique: false })
        store.createIndex('by-repo-branch', ['userId', 'repo', 'branch'], { unique: false })
      }
    }
  })

  const add = async (changes: PendingChange[]): Promise<void> => {
    const db = await dbPromise
    for (const change of changes) {
      const plain = JSON.parse(JSON.stringify(change)) as PendingChange
      await db.put(STORE_NAME, plain)
      // Update in-memory array immediately
      if (!committedChanges.some(c =>
        c.userId === plain.userId && c.repo === plain.repo &&
        c.branch === plain.branch && c.collectionId === plain.collectionId &&
        c.recordId === plain.recordId
      )) {
        committedChanges = [...committedChanges, plain]
      }
    }
  }

  const loadForCollection = async (
    userId: string, repo: string, branch: string, collectionId: string
  ): Promise<PendingChange[]> => {
    const db = await dbPromise
    const results = await db.getAllFromIndex(STORE_NAME, 'by-context', [userId, repo, branch, collectionId])
    committedChanges = results as PendingChange[]
    return committedChanges
  }

  const removeSettled = async (
    userId: string, repo: string, branch: string, collectionId: string, settledIds: string[]
  ): Promise<void> => {
    const db = await dbPromise
    for (const recordId of settledIds) {
      await db.delete(STORE_NAME, [userId, repo, branch, collectionId, recordId])
    }
    committedChanges = committedChanges.filter(c =>
      !(c.userId === userId && c.repo === repo && c.branch === branch &&
        c.collectionId === collectionId && settledIds.includes(c.recordId))
    )
  }

  const isCommittedDeletion = (recordId: string): boolean =>
    committedChanges.some(c => c.recordId === recordId && c.changeType === 'delete')

  return { add, loadForCollection, removeSettled, isCommittedDeletion }
}
