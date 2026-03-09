import { parseIngr } from '@ingr/codec'
import type { GithubApi } from '../github/github-api'
import type { Cache, FKView } from '@ingitdb/client'
import { buildCacheKey, parseYaml } from '@ingitdb/client'

// Directory structure of $fk/ is the same for all records in a collection — cache longer.
const FK_STRUCTURE_TTL = 10 * 60 * 1000   // 10 min: which (refColId, fkField) pairs exist
const FK_RECORDS_TTL   =  5 * 60 * 1000   // 5 min: parsed records for a specific recordKey

type ContentEntry = { name: string; type: string; path: string }

interface FKSlot { refColId: string; fkField: string }

export interface FKViewDeps {
  githubApi: GithubApi
  cache: Cache
}

const parseFileContent = (content: string, filePath: string): unknown => {
  const ext = filePath.toLowerCase().split('.').pop()
  if (ext === 'json') {
    try { return JSON.parse(content) }
    catch (e) { throw new Error(`Failed to parse JSON from ${filePath}: ${(e as Error).message}`) }
  }
  try { return parseYaml(content) || {} }
  catch (e) { throw new Error(`Failed to parse YAML from ${filePath}: ${(e as Error).message}`) }
}

const getDirectoryEntries = async (
  githubApi: GithubApi,
  repo: string,
  path: string,
  branch: string | undefined
): Promise<ContentEntry[]> => {
  const raw = await githubApi.getContents(repo, path, branch)
  if (!Array.isArray(raw)) return []
  return raw as ContentEntry[]
}

/**
 * Discover which (refColId, fkField) pairs exist under $ingitdb/{collectionPath}/$fk/.
 * Cached at collection level — the same for every record in the collection.
 */
const discoverFKSlots = async (
  repo: string,
  branch: string | undefined,
  collectionPath: string,
  deps: FKViewDeps
): Promise<FKSlot[]> => {
  const { githubApi, cache } = deps
  const structureCacheKey = buildCacheKey('fk-structure', repo, branch || 'default', collectionPath)
  const cached = await cache.get<FKSlot[]>(structureCacheKey)
  if (cached) return cached

  const fkBasePath = `$ingitdb/${collectionPath}/$fk`
  let refColDirs: ContentEntry[]
  try {
    refColDirs = await getDirectoryEntries(githubApi, repo, fkBasePath, branch)
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) {
      await cache.set(structureCacheKey, [], FK_STRUCTURE_TTL)
      return []
    }
    throw e
  }

  const slots: FKSlot[] = []
  await Promise.all(
    refColDirs.filter(e => e.type === 'dir').map(async (refColEntry) => {
      let fieldDirs: ContentEntry[]
      try {
        fieldDirs = await getDirectoryEntries(githubApi, repo, `${fkBasePath}/${refColEntry.name}`, branch)
      } catch (e) {
        if ((e as { response?: { status?: number } })?.response?.status === 404) return
        throw e
      }
      for (const f of fieldDirs.filter(e => e.type === 'dir')) {
        slots.push({ refColId: refColEntry.name, fkField: f.name })
      }
    })
  )

  await cache.set(structureCacheKey, slots, FK_STRUCTURE_TTL)
  return slots
}

/**
 * Loads FK (foreign key) views for a specific record within a collection.
 */
export const loadFKViews = async (
  repo: string,
  branch: string | undefined,
  collectionPath: string,
  recordKey: string,
  deps: FKViewDeps
): Promise<FKView[]> => {
  if (!repo || !collectionPath || !recordKey) return []

  const { githubApi, cache } = deps

  const recordCacheKey = buildCacheKey('fk-views', repo, branch || 'default', collectionPath, recordKey)
  const cachedViews = await cache.get<FKView[]>(recordCacheKey)
  if (cachedViews) return cachedViews

  // Step 1 (collection-level, cached): discover which FK slots exist
  const slots = await discoverFKSlots(repo, branch, collectionPath, deps)
  if (slots.length === 0) return []

  const fkBasePath = `$ingitdb/${collectionPath}/$fk`
  const views: FKView[] = []

  // Step 2 (record-level): fetch the file for this recordKey in each slot
  await Promise.all(slots.map(async ({ refColId, fkField }) => {
    const fieldPath = `${fkBasePath}/${refColId}/${fkField}`

    let files: ContentEntry[]
    try {
      files = await getDirectoryEntries(githubApi, repo, fieldPath, branch)
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) return
      throw e
    }

    const matchingFile = files.find(
      (f) => f.type === 'file' && f.name.replace(/\.[^.]+$/, '') === recordKey
    )
    if (!matchingFile) return

    let fileContent: string
    try {
      const result = await githubApi.getFileText(repo, matchingFile.path, branch)
      fileContent = result.decodedContent
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) return
      throw e
    }

    const isIngr = matchingFile.name.endsWith('.ingr')
    if (isIngr) {
      const parsed = parseIngr(fileContent)
      const columnTypes: Record<string, string> = {}
      const cleanColumns: string[] = []

      for (const col of parsed.columns) {
        const base = col.replace(/^\$/, '')
        const colonIdx = base.lastIndexOf(':')
        const colName = colonIdx !== -1 ? base.slice(0, colonIdx) : base
        const normalizedName = colName === 'ID' ? '_id' : colName
        cleanColumns.push(normalizedName)
        if (colonIdx !== -1) columnTypes[normalizedName] = base.slice(colonIdx + 1)
      }

      const records = parsed.records.map((rec) => {
        const row: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(rec)) {
          const base = k.replace(/^\$/, '')
          const colonIdx = base.lastIndexOf(':')
          const colName = colonIdx !== -1 ? base.slice(0, colonIdx) : base
          row[colName === 'ID' ? '_id' : colName] = v
        }
        return row
      })

      views.push({ refColId, fkField, columns: cleanColumns, columnTypes, records })
    } else {
      const data = parseFileContent(fileContent, matchingFile.path)
      let records: Record<string, unknown>[] = []
      if (Array.isArray(data)) {
        records = (data as Record<string, unknown>[]).map((item, idx) => ({ _id: String(idx), ...item }))
      }
      const columns = records.length > 0 ? Object.keys(records[0]).filter(k => !k.startsWith('_')) : []
      views.push({ refColId, fkField, columns, columnTypes: {}, records })
    }
  }))

  await cache.set(recordCacheKey, views, FK_RECORDS_TTL)
  return views
}
