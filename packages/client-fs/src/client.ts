import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Cache,
  LayoutReader,
  ResolvedCollection,
  CollectionEntry,
  CollectionSchema,
  DatabaseConfig,
  FKView,
  IngitDbClient,
  IngitDbClientOptions,
  PendingChangesStore,
  RecordData,
  RecordRow,
  RepoMeta,
  RepoSettings
} from '@ingitdb/client'
import {
  assertNoKeyEncoding,
  buildCacheKey,
  createCache,
  createCommittedChangesStore,
  joinPath,
  parseCollectionSchema,
  parseSubcollectionPath,
  parseYaml,
  recordsBasePath,
  resolveDataPath,
  resolveSubcollection
} from '@ingitdb/client'

/**
 * `@ingitdb/client-fs` is a **read-only** Node filesystem-backed reader for a
 * checked-out inGitDB repository. It mirrors `@ingitdb/client-github` but reads
 * collections/records from a local directory via `node:fs` instead of the
 * GitHub API.
 *
 * Write operations (staging/committing changes) are intentionally left
 * unimplemented — this client is a reader only. See `createPendingChangesStore`.
 */
export interface FsIngitDbClientOptions extends IngitDbClientOptions {
  /** Absolute or relative path to the root of a checked-out inGitDB repo. */
  rootDir?: string
  /** Alias for {@link FsIngitDbClientOptions.rootDir}. */
  dir?: string
}

/** The `IngitDbClient` facade returned by {@link createFsIngitDbClient}, plus the resolved root dir. */
export interface FsIngitDbClient extends IngitDbClient {
  /** The filesystem root the client reads from. */
  rootDir: string
}

const SCHEMA_TTL = 5 * 60 * 1000
const RECORDS_TTL = 5 * 60 * 1000
const CONFIG_TTL = 2 * 60 * 1000
export const DEFAULT_MAX_RECORDS = 20

const notImplemented = (name: string) => (): never => {
  throw new Error(`@ingitdb/client-fs: ${name} is not implemented (client-fs is a read-only reader)`)
}

/** True when a readFile/readdir failure means "the path does not exist". */
const isNotFound = (e: unknown): boolean =>
  (e as NodeJS.ErrnoException)?.code === 'ENOENT' ||
  (e as NodeJS.ErrnoException)?.code === 'ENOTDIR'

const parseFileContent = (content: string, filePath: string): unknown => {
  const ext = filePath.toLowerCase().split('.').pop()
  if (ext === 'json') {
    try { return JSON.parse(content) }
    catch (e) { throw new Error(`Failed to parse JSON from ${filePath}: ${(e as Error).message}`) }
  }
  try { return parseYaml(content) || {} }
  catch (e) { throw new Error(`Failed to parse YAML from ${filePath}: ${(e as Error).message}`) }
}

/**
 * Resolves the data directory for a collection given its schema path and optional data_dir.
 * Shared with `@ingitdb/client-github` through `@ingitdb/client`.
 */
export { resolveDataPath }

export function createFsIngitDbClient(options?: FsIngitDbClientOptions): FsIngitDbClient {
  const rootDir = options?.rootDir ?? options?.dir ?? process.cwd()
  const cache: Cache = createCache() // in-memory Map cache (no browser persistence on Node)

  /** Read a repo-relative POSIX path as UTF-8 text. `_sha` is not tracked on fs. */
  const readText = async (relPath: string): Promise<{ decodedContent: string; sha?: string }> => {
    const abs = join(rootDir, ...relPath.split('/'))
    const decodedContent = await readFile(abs, 'utf8')
    return { decodedContent }
  }

  /** List directory entries (files/dirs) for a repo-relative POSIX path. */
  const listDir = async (relPath: string): Promise<{ name: string; isDir: boolean }[]> => {
    const abs = join(rootDir, ...relPath.split('/'))
    const dirents = await readdir(abs, { withFileTypes: true })
    return dirents.map((d) => ({ name: d.name, isDir: d.isDirectory() }))
  }

  /** Reads for the shared layout rules: null when the path does not exist. */
  const reader: LayoutReader = {
    readText: async (relPath) => {
      try { return (await readText(relPath)).decodedContent }
      catch (e) { if (isNotFound(e)) return null; throw e }
    },
    listDir: async (relPath) => {
      try { return (await listDir(relPath)).map((d) => d.name) }
      catch (e) { if (isNotFound(e)) return null; throw e }
    }
  }

  /**
   * The schema path `.ingitdb/root-collections.yaml` maps a collection id to
   * (with `ns.*` namespace expansion), or null when it maps none: a
   * subcollection path such as `spaces/family/contacts`, or an unknown id.
   */
  const lookupCollectionPath = async (collectionId: string): Promise<string | null> => {
    const cacheKey = buildCacheKey('root-collections', rootDir)
    let mapping = await cache.get<Record<string, string>>(cacheKey)
    if (!mapping) {
      try {
        const file = await readText('.ingitdb/root-collections.yaml')
        mapping = (parseYaml(file.decodedContent) as Record<string, string>) || {}
      } catch (e) {
        if (!isNotFound(e)) console.warn('Failed to load root-collections mapping:', e)
        mapping = {}
      }
      await cache.set(cacheKey, mapping, SCHEMA_TTL)
    }
    if (mapping[collectionId]) return mapping[collectionId]

    // Namespace resolution: "ns.subId" -> "ns.*" entry -> nested root-collections.yaml
    const dotIdx = collectionId.indexOf('.')
    if (dotIdx !== -1) {
      const namespace = collectionId.slice(0, dotIdx)
      const subId = collectionId.slice(dotIdx + 1)
      const nsKey = `${namespace}.*`
      if (mapping[nsKey]) {
        const basePath = mapping[nsKey]
        try {
          const subFile = await readText(`${basePath}/.ingitdb/root-collections.yaml`)
          const subMapping = (parseYaml(subFile.decodedContent) as Record<string, string>) || {}
          if (subMapping[subId]) return `${basePath}/${subMapping[subId]}`
        } catch (e) {
          if (!isNotFound(e)) console.warn(`[resolveCollectionPath] failed to resolve namespace ${namespace}:`, e)
        }
      }
    }

    return null
  }

  /**
   * Resolve a collection's definition and data directory.
   *
   * - A collection id `.ingitdb/root-collections.yaml` maps (or an unknown id)
   *   reads `<path>/.collection/definition.yaml` or, in the shared layout,
   *   `<path>/definition.yaml`.
   * - A subcollection path `<root>/<key>/<sub>[/<key>/<sub>...]` resolves where
   *   the definition puts each instance, inside the parent's records directory
   *   (`spaces/family/contacts` -> `spaces/$records/family/contacts`), so the
   *   instances of different parents never collide. Data at the place earlier
   *   writers used is an error (see `resolveSubcollection`).
   * - A collection that declares `record_file.key_encoding` is refused.
   */
  const resolveCollection = async (collectionId: string): Promise<ResolvedCollection> => {
    const mapped = await lookupCollectionPath(collectionId)
    const nested = mapped === null ? parseSubcollectionPath(collectionId) : null
    let resolved: ResolvedCollection
    if (nested) {
      const rootPath = (await lookupCollectionPath(nested.root)) ?? nested.root
      resolved = await resolveSubcollection(collectionId, rootPath, nested.steps, reader)
    } else {
      const path = mapped ?? collectionId
      let text: string | null = null
      for (const candidate of [`${path}/.collection/definition.yaml`, `${path}/definition.yaml`]) {
        text = await reader.readText(candidate)
        if (text !== null) break
      }
      const schema = parseCollectionSchema(text ?? {})
      resolved = { schema, schemaYaml: text ?? '', dataPath: resolveDataPath(path, schema.data_dir as string | null | undefined) }
    }
    assertNoKeyEncoding(resolved.schema, collectionId)
    return resolved
  }

  const loadCollectionSchema = async (
    _repo: string,
    _branch: string | undefined,
    collectionId: string,
    skipCache = false
  ): Promise<{ schema: CollectionSchema; schemaYaml: string; collectionPath: string }> => {
    const cacheKey = buildCacheKey('col-schema', rootDir, collectionId)
    if (!skipCache) {
      const cached = await cache.get<{ schema: CollectionSchema; rawYaml: string; path: string }>(cacheKey)
      if (cached) return { schema: cached.schema, schemaYaml: cached.rawYaml, collectionPath: cached.path }
    }

    const { schema, schemaYaml, dataPath } = await resolveCollection(collectionId)
    await cache.set(cacheKey, { schema, rawYaml: schemaYaml, path: dataPath }, SCHEMA_TTL)
    return { schema, schemaYaml, collectionPath: dataPath }
  }

  const loadCollectionRecords = async (
    _repo: string,
    _branch: string | undefined,
    collectionId: string,
    schema: CollectionSchema,
    collectionPath: string,
    skipCache = false
  ): Promise<{ records: RecordRow[]; ingrColumnTypes: Record<string, string> }> => {
    const cacheKey = buildCacheKey('col-records', rootDir, collectionId)
    if (!skipCache) {
      const cached = await cache.get<{ records: RecordRow[] }>(cacheKey)
      if (cached) return { records: cached.records, ingrColumnTypes: {} }
    }

    const sch = schema || ({} as CollectionSchema)
    const colPath = collectionPath || sch.path || collectionId
    const recordFilePattern = sch.record_file?.name || '{key}.yaml'
    let loaded: RecordRow[] = []

    // Single-file layout: record_file.name has no {key} placeholder.
    if (!recordFilePattern.includes('{key}')) {
      const filePath = joinPath(colPath, recordsBasePath(sch.record_file), recordFilePattern)
      try {
        const file = await readText(filePath)
        const data = parseFileContent(file.decodedContent, filePath)
        if (Array.isArray(data)) {
          loaded = (data as Record<string, unknown>[]).map((item, idx) => ({ _id: String(idx), _path: filePath, ...item }))
        } else if (typeof data === 'object' && data !== null) {
          loaded = Object.entries(data as Record<string, unknown>).map(([key, item]) => ({
            _id: key, _path: filePath,
            ...(typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {})
          }))
        }
      } catch (e) {
        if (!isNotFound(e)) throw e
      }
      await cache.set(cacheKey, { records: loaded }, RECORDS_TTL)
      return { records: loaded, ingrColumnTypes: {} }
    }

    // File-per-record layout: records live in the records directory,
    // `<collectionPath>/$records/` unless record_file.records_dir says otherwise.
    const recordsDir = joinPath(colPath, recordsBasePath(sch.record_file))
    let entries: { name: string; isDir: boolean }[]
    try {
      entries = await listDir(recordsDir)
    } catch (e) {
      if (isNotFound(e)) return { records: [], ingrColumnTypes: {} }
      throw e
    }

    const fileExtRegex = /\.(yaml|yml|json)$/i
    const files = entries
      .filter((e) => !e.isDir && fileExtRegex.test(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, DEFAULT_MAX_RECORDS)

    for (const entry of files) {
      const relPath = `${recordsDir}/${entry.name}`
      try {
        const file = await readText(relPath)
        const parsed = parseFileContent(file.decodedContent, relPath)
        loaded.push({
          _id: entry.name.replace(fileExtRegex, ''),
          _path: relPath,
          ...(parsed as Record<string, unknown>)
        })
      } catch (err) {
        loaded.push({ _id: entry.name.replace(fileExtRegex, ''), _error: (err as Error).message })
      }
    }

    await cache.set(cacheKey, { records: loaded }, RECORDS_TTL)
    return { records: loaded, ingrColumnTypes: {} }
  }

  const loadRecord = async (
    _repo: string,
    recordPath: string,
    _branch?: string
  ): Promise<RecordData> => {
    if (!recordPath) throw new Error('recordPath is required')
    const file = await readText(recordPath)
    const parsed = (parseYaml(file.decodedContent) as Record<string, unknown>) || {}
    return { ...parsed, _path: recordPath, _sha: file.sha }
  }

  const loadDatabaseConfig = async (_repo: string, _branch?: string): Promise<DatabaseConfig> => {
    const cacheKey = buildCacheKey('db-config', rootDir)
    let rawYaml = ''
    let parsed: Record<string, string> = {}
    const cached = await cache.get<{ config: Record<string, string>; rawYaml: string }>(cacheKey)
    if (cached) {
      parsed = cached.config
      rawYaml = cached.rawYaml
    } else {
      try {
        const file = await readText('.ingitdb/root-collections.yaml')
        rawYaml = file.decodedContent
        parsed = (parseYaml(rawYaml) as Record<string, string>) || {}
      } catch (e) {
        if (!isNotFound(e)) throw e
      }
      await cache.set(cacheKey, { config: parsed, rawYaml }, CONFIG_TTL)
    }

    const collections: CollectionEntry[] = []
    for (const [key, basePath] of Object.entries(parsed)) {
      const nsMatch = /^(.+)\.\*$/.exec(key)
      if (nsMatch) {
        const namespace = nsMatch[1]
        try {
          const subFile = await readText(`${basePath}/.ingitdb/root-collections.yaml`)
          const subParsed = (parseYaml(subFile.decodedContent) as Record<string, string>) || {}
          for (const [subId, subPath] of Object.entries(subParsed)) {
            collections.push({ id: `${namespace}.${subId}`, path: `${basePath}/${subPath}` })
          }
        } catch (e) {
          if (!isNotFound(e)) console.warn(`[loadDatabaseConfig] failed to expand namespace ${namespace}:`, e)
        }
      } else {
        collections.push({ id: key, path: basePath })
      }
    }

    return { rawYaml, collections, views: [], triggers: [], subscribers: [] }
  }

  const loadRepoSettings = async (
    _repo: string,
    _branch?: string,
    _skipCache?: boolean
  ): Promise<RepoSettings> => {
    try {
      const file = await readText('.ingitdb/settings.yaml')
      const parsed = parseYaml(file.decodedContent) as { languages?: RepoSettings['languages'] } | null
      return { languages: Array.isArray(parsed?.languages) ? parsed!.languages : [] }
    } catch (e) {
      if (!isNotFound(e)) throw e
      return { languages: [] }
    }
  }

  // Read-only reader: report no push permission so consumers don't surface write
  // affordances that would throw at `createPendingChangesStore`.
  const loadRepoMeta = async (_repo: string): Promise<RepoMeta> => ({
    permissions: { push: false }
  })

  // FK materialized views (`$ingitdb/<path>/$fk/`) are not emitted by the fs
  // reader's fixtures; return the safe empty default, mirroring client-github's
  // behaviour when no `$fk` directory exists.
  const loadFKViews = async (): Promise<FKView[]> => []

  return {
    rootDir,
    cache,
    loadDatabaseConfig,
    loadCollectionSchema,
    loadCollectionRecords,
    loadRecord,
    loadRepoMeta,
    loadRepoSettings,
    loadFKViews,
    // Writing is out of scope for the read-only fs client.
    createPendingChangesStore: notImplemented('createPendingChangesStore') as unknown as () => PendingChangesStore,
    createCommittedChangesStore: () => createCommittedChangesStore()
  }
}
