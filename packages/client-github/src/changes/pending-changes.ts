import { openDB, type IDBPDatabase } from 'idb'
import type { GithubApi } from '../github/github-api'
import type { Cache, PendingChange, PendingChangesStore, CommittedChangesStore } from '@ingitdb/client'
import { parseYaml } from '@ingitdb/client'
import { resolveCollectionPath } from '../collection/collection'

const DB_NAME = 'ingitdb-pending'
const STORE_NAME = 'changes'

/**
 * Factory that creates a PendingChangesStore backed by IndexedDB.
 * Accepts a `GithubApi` for committing changes and a `Cache` for collection-path resolution.
 */
export function createPendingChangesStore(githubApi: GithubApi, cache: Cache): PendingChangesStore {
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

  const loadForCollection = async (
    userId: string, repo: string, branch: string, collectionId: string
  ): Promise<PendingChange[]> => {
    const db = await dbPromise
    const results = await db.getAllFromIndex(STORE_NAME, 'by-context', [userId, repo, branch, collectionId])
    return results as PendingChange[]
  }

  const loadForRepoBranch = async (
    userId: string, repo: string, branch: string
  ): Promise<PendingChange[]> => {
    const db = await dbPromise
    const results = await db.getAllFromIndex(STORE_NAME, 'by-repo-branch', [userId, repo, branch])
    return results as PendingChange[]
  }

  const stageDelete = async (params: {
    userId: string; repo: string; branch: string; collectionId: string; recordId: string
  }): Promise<void> => {
    const now = new Date().toISOString()
    const change: PendingChange = {
      ...params,
      changeType: 'delete',
      originalData: null,
      pendingData: null,
      changedFields: [],
      createdAt: now,
      updatedAt: now
    }
    const db = await dbPromise
    await db.put(STORE_NAME, JSON.parse(JSON.stringify(change)))
  }

  const unstage = async (params: {
    userId: string; repo: string; branch: string; collectionId: string; recordId: string
  }): Promise<void> => {
    const db = await dbPromise
    await db.delete(STORE_NAME, [
      params.userId, params.repo, params.branch, params.collectionId, params.recordId
    ])
  }

  const commitAll = async (
    params: { userId: string; repo: string; branch: string; message: string },
    committedChangesStore?: CommittedChangesStore
  ): Promise<void> => {
    const allChanges = await loadForRepoBranch(params.userId, params.repo, params.branch)
    const changes = [...allChanges]

    // Group changes by repo+branch so each group becomes one commit
    const groups = new Map<string, PendingChange[]>()
    for (const change of changes) {
      const key = `${change.repo}::${change.branch}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(change)
    }

    const actuallyCommitted: PendingChange[] = []

    try {
      for (const groupChanges of groups.values()) {
        const { repo, branch } = groupChanges[0]

        // Resolve file paths for all deletes in this group
        const changeByPath = new Map<string, PendingChange>()
        for (const change of groupChanges) {
          if (change.changeType !== 'delete') {
            throw new Error(
              `[PendingChangesStore] Unsupported change type "${change.changeType}" for record "${change.recordId}" ` +
              `in collection "${change.collectionId}". Only "delete" is currently supported.`
            )
          }

          const colPath = await resolveCollectionPath(repo, branch, change.collectionId, { githubApi, cache })

          let recordFilePattern = '{key}.yaml'
          try {
            const defFile = await githubApi.getFileText(repo, `${colPath}/.collection/definition.yaml`, branch)
            const schema = parseYaml(defFile.decodedContent) as { record_file?: { name?: string } }
            if (schema?.record_file?.name) recordFilePattern = schema.record_file.name
          } catch { /* use default pattern */ }

          if (!recordFilePattern.includes('{key}')) {
            throw new Error(
              `Deleting records from shared-file collections is not yet supported (collection: ${change.collectionId}, file: ${recordFilePattern})`
            )
          }

          changeByPath.set(`${colPath}/$records/${recordFilePattern.replace(/\{key}/g, change.recordId)}`, change)
        }

        if (changeByPath.size === 0) continue

        // Verify each file exists — tree API rejects paths that don't exist in base tree
        const verifiedPaths: string[] = []
        for (const [fp, change] of changeByPath) {
          try {
            await githubApi.getContents(repo, fp, branch)
            verifiedPaths.push(fp)
            actuallyCommitted.push(change)
          } catch (e) {
            const status = (e as { response?: { status?: number } }).response?.status
            if (status === 404) {
              console.warn(`[PendingChangesStore] File not found (already gone?), removing stale change: ${fp}`)
            } else {
              throw e
            }
          }
        }

        if (verifiedPaths.length === 0) continue

        // Single commit for all deletions via Git Tree API
        const headSha = await githubApi.getBranchSHA(repo, branch)
        const { tree: { sha: treeSha } } = await githubApi.getCommit(repo, headSha)
        const newTreeSha = await githubApi.createTree(repo, treeSha, verifiedPaths)
        const newCommitSha = await githubApi.createCommit(repo, params.message, newTreeSha, headSha)
        await githubApi.updateBranchRef(repo, branch, newCommitSha)
      }
    } catch (err) {
      console.error('[PendingChangesStore] commitAll', err)
      throw err
    }

    // Move actually-committed deletions to the committed-changes store
    if (actuallyCommitted.length > 0 && committedChangesStore) {
      await committedChangesStore.add(actuallyCommitted)
    }

    const db = await dbPromise
    for (const change of changes) {
      await db.delete(STORE_NAME, [
        change.userId, change.repo, change.branch, change.collectionId, change.recordId
      ])
    }
  }

  const clearAll = async (userId: string, repo: string, branch: string): Promise<void> => {
    const db = await dbPromise
    const tx = db.transaction(STORE_NAME, 'readwrite')
    let cursor = await tx.store.index('by-repo-branch').openCursor(IDBKeyRange.only([userId, repo, branch]))
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  }

  return { stageDelete, unstage, loadForCollection, loadForRepoBranch, commitAll, clearAll }
}
