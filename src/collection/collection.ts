import { parseIngr } from '@ingr/codec'
import type { GithubApi } from '../github/github-api'
import type { Cache } from '../cache/cache'
import { buildCacheKey } from '../cache/cache'
import { parseCollectionSchema, type CollectionSchema } from '../schema/schema'
import { parseYaml } from '../utils/yaml'

export type RecordRow = Record<string, unknown>

/** Dependencies required by collection functions. */
export interface CollectionDeps {
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

const SCHEMA_TTL = 5 * 60 * 1000
const RECORDS_TTL = 5 * 60 * 1000

/**
 * Resolves the physical collection path from a collectionId by consulting
 * `.ingitdb/root-collections.yaml` and handling namespace expansion.
 */
export const resolveCollectionPath = async (
  repo: string,
  branch: string | undefined,
  collectionId: string,
  deps: CollectionDeps
): Promise<string> => {
  const { githubApi, cache } = deps
  const cacheKey = buildCacheKey('root-collections', repo, branch || 'default')
  let mapping = await cache.get<Record<string, string>>(cacheKey)
  if (!mapping) {
    try {
      const mappingFile = await githubApi.getFileText(repo, '.ingitdb/root-collections.yaml', branch)
      mapping = (parseYaml(mappingFile.decodedContent) as Record<string, string>) || {}
      await cache.set(cacheKey, mapping, SCHEMA_TTL)
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status !== 404) {
        console.warn('Failed to load root-collections mapping:', e)
      }
      mapping = {}
    }
  }
  if (mapping[collectionId]) return mapping[collectionId]

  // Namespace resolution: "ns.subId" -> check for "ns.*" entry in root config
  const dotIdx = collectionId.indexOf('.')
  if (dotIdx !== -1) {
    const namespace = collectionId.slice(0, dotIdx)
    const subId = collectionId.slice(dotIdx + 1)
    const nsKey = `${namespace}.*`
    if (mapping[nsKey]) {
      const basePath = mapping[nsKey]
      try {
        const subCacheKey = buildCacheKey('root-collections-ns', repo, branch || 'default', namespace)
        let subMapping = await cache.get<Record<string, string>>(subCacheKey)
        if (!subMapping) {
          const subFile = await githubApi.getFileText(repo, `${basePath}/.ingitdb/root-collections.yaml`, branch)
          subMapping = (parseYaml(subFile.decodedContent) as Record<string, string>) || {}
          await cache.set(subCacheKey, subMapping, SCHEMA_TTL)
        }
        if (subMapping[subId]) return `${basePath}/${subMapping[subId]}`
      } catch (e) {
        console.warn(`[resolveCollectionPath] failed to resolve namespace ${namespace}:`, e)
      }
    }
  }

  return collectionId
}

/**
 * Loads the collection schema (definition.yaml) for a given collectionId.
 * Returns the parsed schema, raw YAML, and resolved data path.
 */
export const loadCollectionSchema = async (
  repo: string,
  branch: string | undefined,
  collectionId: string,
  deps: CollectionDeps,
  skipCache = false
): Promise<{ schema: CollectionSchema; schemaYaml: string; collectionPath: string }> => {
  const { githubApi, cache } = deps

  const cacheKey = buildCacheKey('col-schema', repo, branch || 'default', collectionId)
  if (!skipCache) {
    const cached = await cache.get<{ schema: CollectionSchema; rawYaml: string; path: string }>(cacheKey)
    if (cached) {
      return { schema: cached.schema, schemaYaml: cached.rawYaml, collectionPath: cached.path }
    }
  }

  const resolvedPath = await resolveCollectionPath(repo, branch, collectionId, deps)

  let file: { decodedContent: string } | null = null
  const paths = [
    `${resolvedPath}/.collection/definition.yaml`,
    `${resolvedPath}/definition.yaml`,            // .collections/ shared layout
    `${collectionId}/.collection/definition.yaml`,
  ]
  for (const path of paths) {
    try { file = await githubApi.getFileText(repo, path, branch); break }
    catch (e) { if ((e as { response?: { status?: number } })?.response?.status !== 404) throw e }
  }

  if (!file) {
    const dataPath = resolveDataPath(resolvedPath)
    const schema = parseCollectionSchema({})
    await cache.set(cacheKey, { schema, rawYaml: '', path: dataPath }, SCHEMA_TTL)
    return { schema, schemaYaml: '', collectionPath: dataPath }
  }

  const rawYaml = file.decodedContent
  const parsed = parseCollectionSchema(rawYaml)
  const dataPath = resolveDataPath(resolvedPath, parsed.data_dir as string | null | undefined)
  await cache.set(cacheKey, { schema: parsed, rawYaml, path: dataPath }, SCHEMA_TTL)
  return { schema: parsed, schemaYaml: rawYaml, collectionPath: dataPath }
}

/**
 * Loads collection records.
 * Supports materialized views (.ingr), single-file, and file-per-record layouts.
 */
export const loadCollectionRecords = async (
  repo: string,
  branch: string | undefined,
  collectionId: string,
  schema: CollectionSchema,
  collectionPath: string,
  deps: CollectionDeps,
  skipCache = false
): Promise<{ records: RecordRow[]; ingrColumnTypes: Record<string, string> }> => {
  const { githubApi, cache } = deps
  let ingrColumnTypes: Record<string, string> = {}

  const cacheKey = buildCacheKey('col-records-v2', repo, branch || 'default', collectionId)
  if (!skipCache) {
    const cached = await cache.get<{ records: RecordRow[]; columnTypes: Record<string, string> }>(cacheKey)
    if (cached) {
      return { records: cached.records, ingrColumnTypes: cached.columnTypes ?? {} }
    }
  }

  const sch = schema || {}
  const colPath = collectionPath || (sch as CollectionSchema).path || collectionId
  const recordFilePattern = (sch as CollectionSchema).record_file?.name || '{key}.yaml'
  let loaded: RecordRow[] = []

  // Materialized view: if default_view is set, load pre-built view file instead of individual records
  const defaultView = (sch as CollectionSchema).default_view
  if (defaultView !== undefined && defaultView !== null) {
    const lastSegment = colPath.split('/').pop() || colPath
    const viewFileName = (typeof defaultView.file === 'string' && defaultView.file)
      ? defaultView.file
      : `${lastSegment}.ingr`
    const viewFilePath = `$ingitdb/${colPath}/${viewFileName}`
    try {
      const file = await githubApi.getFileText(repo, viewFilePath, branch)
      if (viewFileName.endsWith('.ingr')) {
        const parsed = parseIngr(file.decodedContent)
        // Build column type map from header
        const types: Record<string, string> = {}
        for (const col of parsed.columns) {
          const base = col.replace(/^\$/, '')
          const colonIdx = base.lastIndexOf(':')
          if (colonIdx !== -1) {
            types[base.slice(0, colonIdx)] = base.slice(colonIdx + 1)
          }
        }
        ingrColumnTypes = types
        loaded = parsed.records.map((rec) => {
          const row: RecordRow = {}
          for (const [k, v] of Object.entries(rec)) {
            const base = k.replace(/^\$/, '')
            const colonIdx = base.lastIndexOf(':')
            const colName = colonIdx !== -1 ? base.slice(0, colonIdx) : base
            row[colName === 'ID' ? '_id' : colName] = v
          }
          return row
        })
      } else {
        const data = parseFileContent(file.decodedContent, viewFilePath)
        if (Array.isArray(data)) {
          loaded = (data as RecordRow[]).map((item, idx) => ({ _id: String(idx), ...item }))
        }
      }
      await cache.set(cacheKey, { records: loaded, columnTypes: { ...ingrColumnTypes } }, RECORDS_TTL)
      return { records: loaded, ingrColumnTypes }
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) {
        console.warn(`[loadCollectionRecords] Materialized view not found: ${viewFilePath}, falling back to record files`)
      } else {
        throw e
      }
    }
  }

  // Single file
  if (!recordFilePattern.includes('{key}')) {
    try {
      const filePath = `${colPath}/${recordFilePattern}`
      const file = await githubApi.getFileText(repo, filePath, branch)
      const data = parseFileContent(file.decodedContent, filePath)
      if (typeof data === 'object' && data !== null) {
        if (Array.isArray(data)) {
          loaded = (data as Record<string, unknown>[]).map((item, idx) => ({
            _id: String(idx), _path: filePath, _sha: file.sha, ...item
          }))
        } else {
          loaded = Object.entries(data as Record<string, unknown>).map(([key, item]) => ({
            _id: key, _path: filePath, _sha: file.sha,
            ...(typeof item === 'object' ? (item as Record<string, unknown>) : {})
          }))
        }
      }
      await cache.set(cacheKey, { records: loaded, columnTypes: {} }, RECORDS_TTL)
      return { records: loaded, ingrColumnTypes: {} }
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) {
        return { records: [], ingrColumnTypes: {} }
      }
      throw e
    }
  }

  // File per record: when {key} is present, records live under $records/ subdir
  type ContentEntry = { type: string; name: string; path: string }
  const recordsBasePath = `${colPath}/$records`
  let entries: ContentEntry[] = []
  try {
    entries = await githubApi.getContents(repo, recordsBasePath, branch) as ContentEntry[]
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) {
      return { records: [], ingrColumnTypes: {} }
    }
    throw e
  }

  if (!Array.isArray(entries)) return { records: [], ingrColumnTypes: {} }

  const isNested = recordFilePattern.includes('/')
  const MAX_RECORDS = 20
  type FileToFetch = { id: string; path: string }
  let filesToFetch: FileToFetch[] = []

  if (isNested) {
    const dirs = entries.filter((f) => f.type === 'dir' && !f.name.startsWith('.')).slice(0, MAX_RECORDS)
    filesToFetch = dirs.map((dir) => ({
      id: dir.name,
      path: `${recordsBasePath}/${recordFilePattern.replace(/\{key\}/g, dir.name)}`
    }))
  } else {
    const fileExtRegex = /\.(yaml|yml|json)$/
    filesToFetch = entries
      .filter((f) => f.type === 'file' && fileExtRegex.test(f.name) && !f.name.startsWith('.ingitdb') && !f.name.startsWith('.collection'))
      .slice(0, MAX_RECORDS)
      .map((f) => ({ id: f.name.replace(fileExtRegex, ''), path: f.path }))
  }

  const BATCH = 10
  for (let i = 0; i < filesToFetch.length; i += BATCH) {
    const batch = filesToFetch.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        let file: { decodedContent: string; sha?: string } | null = null
        try {
          file = await githubApi.getFileText(repo, item.path, branch)
          const parsed = parseFileContent(file.decodedContent, item.path)
          return { _id: item.id, _path: item.path, _sha: file.sha, ...(parsed as Record<string, unknown>) }
        } catch (err) {
          if (file && (err as Error).message.includes('Failed to parse')) {
            return { _id: item.id, _parseError: file.decodedContent }
          }
          const e = err as { response?: { status?: number }; message?: string }
          const errorMsg = e?.response?.status === 404 ? '404 Not Found' : `${e?.response?.status || 'Error'}: ${e?.message || 'Unknown error'}`
          return { _id: item.id, _error: errorMsg }
        }
      })
    )
    results.forEach((r) => {
      if (r.status === 'fulfilled') loaded.push(r.value)
    })
  }

  await cache.set(cacheKey, { records: loaded, columnTypes: {} }, RECORDS_TTL)
  return { records: loaded, ingrColumnTypes: {} }
}

/**
 * Resolves the data directory for a collection given its schema path and optional data_dir.
 *
 * For the shared layout (`/.collections/` in the schema path):
 *   - base dir = parent of `.collections/`
 *   - data path = base dir + data_dir (or base dir when omitted / '.')
 *
 * For the dedicated layout the schema path IS the data root — returned unchanged.
 */
export const resolveDataPath = (schemaPath: string, dataDir?: string | null): string => {
  const collectionsIdx = schemaPath.indexOf('/.collections/')
  if (collectionsIdx !== -1) {
    const baseDir = schemaPath.slice(0, collectionsIdx)
    if (!dataDir || dataDir === '.') return baseDir
    return `${baseDir}/${dataDir}`
  }
  return schemaPath
}
