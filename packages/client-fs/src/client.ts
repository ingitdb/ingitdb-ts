import type { IngitDbClient, IngitDbClientOptions } from '@ingitdb/client'
import { createCommittedChangesStore } from '@ingitdb/client'

const notImplemented = (name: string) => (): never => {
  throw new Error(`@ingitdb/client-fs: ${name} is not yet implemented`)
}

export function createFsIngitDbClient(_options?: IngitDbClientOptions): IngitDbClient {
  return {
    cache: {
      get: notImplemented('cache.get'),
      set: notImplemented('cache.set'),
      delete: notImplemented('cache.delete'),
      clear: notImplemented('cache.clear')
    },
    loadDatabaseConfig: notImplemented('loadDatabaseConfig'),
    loadCollectionSchema: notImplemented('loadCollectionSchema'),
    loadCollectionRecords: notImplemented('loadCollectionRecords'),
    loadRecord: notImplemented('loadRecord'),
    loadRepoMeta: notImplemented('loadRepoMeta'),
    loadRepoSettings: notImplemented('loadRepoSettings'),
    loadFKViews: notImplemented('loadFKViews'),
    createPendingChangesStore: notImplemented('createPendingChangesStore'),
    createCommittedChangesStore: () => createCommittedChangesStore()
  }
}
