import type { PendingChange, CommittedChangesStore } from '../types'

/**
 * Creates an in-memory CommittedChangesStore.
 * Suitable for Node.js and testing environments.
 * For browser use with IndexedDB persistence, use createIdbCommittedChangesStore from @ingitdb/client-github.
 */
export function createCommittedChangesStore(): CommittedChangesStore {
  let committedChanges: PendingChange[] = []

  return {
    async add(changes: PendingChange[]): Promise<void> {
      for (const change of changes) {
        if (!committedChanges.some(c =>
          c.userId === change.userId && c.repo === change.repo &&
          c.branch === change.branch && c.collectionId === change.collectionId &&
          c.recordId === change.recordId
        )) {
          committedChanges = [...committedChanges, change]
        }
      }
    },

    async loadForCollection(userId, repo, branch, collectionId): Promise<PendingChange[]> {
      return committedChanges.filter(c =>
        c.userId === userId && c.repo === repo &&
        c.branch === branch && c.collectionId === collectionId
      )
    },

    async removeSettled(userId, repo, branch, collectionId, settledIds): Promise<void> {
      committedChanges = committedChanges.filter(c =>
        !(c.userId === userId && c.repo === repo && c.branch === branch &&
          c.collectionId === collectionId && settledIds.includes(c.recordId))
      )
    },

    isCommittedDeletion(recordId: string): boolean {
      return committedChanges.some(c => c.recordId === recordId && c.changeType === 'delete')
    }
  }
}
