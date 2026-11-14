import { openDB, type IDBPDatabase } from 'idb'
import type { GithubApi } from '../github/github-api'
import type { Cache, PendingChange, PendingChangesStore, CommittedChangesStore } from '@ingitdb/client'
import { joinPath, recordsBasePath, stringifyYaml } from '@ingitdb/client'
import { loadCollectionSchema } from '../collection/collection'

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

  const stageCreate = async (params: {
    userId: string; repo: string; branch: string; collectionId: string
    recordId: string; data: Record<string, unknown>
  }): Promise<void> => {
    const db = await dbPromise
    const existing = await db.get(STORE_NAME, [
      params.userId, params.repo, params.branch, params.collectionId, params.recordId
    ]) as PendingChange | undefined

    const now = new Date().toISOString()
    if (existing?.changeType === 'create') {
      await db.put(STORE_NAME, JSON.parse(JSON.stringify({
        ...existing,
        pendingData: { ...existing.pendingData, ...params.data },
        changedFields: Object.keys({ ...existing.pendingData, ...params.data }),
        updatedAt: now
      })))
    } else {
      const change: PendingChange = {
        userId: params.userId, repo: params.repo, branch: params.branch,
        collectionId: params.collectionId, recordId: params.recordId,
        changeType: 'create',
        originalData: null,
        pendingData: { ...params.data },
        changedFields: Object.keys(params.data),
        createdAt: now,
        updatedAt: now
      }
      await db.put(STORE_NAME, JSON.parse(JSON.stringify(change)))
    }
  }

  const stageUpdate = async (params: {
    userId: string; repo: string; branch: string; collectionId: string
    recordId: string; originalData: Record<string, unknown>; pendingData: Record<string, unknown>
  }): Promise<void> => {
    const db = await dbPromise
    const existing = await db.get(STORE_NAME, [
      params.userId, params.repo, params.branch, params.collectionId, params.recordId
    ]) as PendingChange | undefined

    const now = new Date().toISOString()
    const changedFields = Object.keys(params.pendingData).filter(
      k => JSON.stringify(params.pendingData[k]) !== JSON.stringify(params.originalData[k])
    )

    if (existing?.changeType === 'create') {
      // Record is pending creation — update its data, keep as 'create'
      await db.put(STORE_NAME, JSON.parse(JSON.stringify({
        ...existing,
        pendingData: { ...params.pendingData },
        changedFields,
        updatedAt: now
      })))
      return
    }

    if (changedFields.length === 0) {
      // All fields reverted to original — remove pending change
      await db.delete(STORE_NAME, [
        params.userId, params.repo, params.branch, params.collectionId, params.recordId
      ])
      return
    }

    const change: PendingChange = {
      userId: params.userId, repo: params.repo, branch: params.branch,
      collectionId: params.collectionId, recordId: params.recordId,
      changeType: 'update',
      originalData: { ...params.originalData },
      pendingData: { ...params.pendingData },
      changedFields,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
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

    // Resolve the record file of a pending change where the definition puts it:
    // the collection's data directory (a subcollection instance lives inside its
    // parent's records directory), then its records directory. The definition is
    // read the way readers read it, so a collection with key_encoding is refused.
    const recordFileLocation = async (change: PendingChange, repo: string, branch: string): Promise<{ path: string; pattern: string }> => {
      const { schema, collectionPath } = await loadCollectionSchema(repo, branch, change.collectionId, { githubApi, cache })
      const pattern = schema.record_file?.name || '{key}.yaml'
      return { path: joinPath(collectionPath, recordsBasePath(schema.record_file), pattern.replace(/\{key}/g, change.recordId)), pattern }
    }
    const resolveFilePath = async (change: PendingChange, repo: string, branch: string): Promise<string> => {
      const { path, pattern } = await recordFileLocation(change, repo, branch)
      if (!pattern.includes('{key}')) {
        throw new Error(
          `Shared-file collections not supported for create/update (collection: ${change.collectionId}, file: ${pattern})`
        )
      }
      return path
    }

    try {
      for (const groupChanges of groups.values()) {
        const { repo, branch } = groupChanges[0]

        // Pass 1: creates
        for (const change of groupChanges.filter(c => c.changeType === 'create')) {
          const filePath = await resolveFilePath(change, repo, branch)
          const yamlContent = stringifyYaml(change.pendingData!)
          await githubApi.putFile({ repo, path: filePath, content: yamlContent, message: params.message, branch })
          actuallyCommitted.push(change)
        }

        // Pass 2: updates
        for (const change of groupChanges.filter(c => c.changeType === 'update')) {
          const filePath = await resolveFilePath(change, repo, branch)
          const existing = await githubApi.getFileText(repo, filePath, branch)
          const yamlContent = stringifyYaml(change.pendingData!)
          await githubApi.putFile({ repo, path: filePath, content: yamlContent, message: params.message, sha: existing.sha, branch })
          actuallyCommitted.push(change)
        }

        // Pass 3: deletes — batch via Git Tree API (unchanged)
        const changeByPath = new Map<string, PendingChange>()
        for (const change of groupChanges.filter(c => c.changeType === 'delete')) {
          const { path, pattern } = await recordFileLocation(change, repo, branch)
          if (!pattern.includes('{key}')) {
            throw new Error(
              `Deleting records from shared-file collections is not yet supported (collection: ${change.collectionId}, file: ${pattern})`
            )
          }
          changeByPath.set(path, change)
        }

        if (changeByPath.size > 0) {
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

          if (verifiedPaths.length > 0) {
            const headSha = await githubApi.getBranchSHA(repo, branch)
            const { tree: { sha: treeSha } } = await githubApi.getCommit(repo, headSha)
            const newTreeSha = await githubApi.createTree(repo, treeSha, verifiedPaths)
            const newCommitSha = await githubApi.createCommit(repo, params.message, newTreeSha, headSha)
            await githubApi.updateBranchRef(repo, branch, newCommitSha)
          }
        }
      }
    } catch (err) {
      console.error('[PendingChangesStore] commitAll', err)
      throw err
    }

    // Move committed changes to the committed-changes store
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

  return { stageDelete, stageCreate, stageUpdate, unstage, loadForCollection, loadForRepoBranch, commitAll, clearAll }
}
