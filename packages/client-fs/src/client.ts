import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Cache,
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
  buildCacheKey,
  createCache,
  createCommittedChangesStore,
  parseCollectionSchema,
  parseYaml
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
const SHARED_LAYOUT_SEGMENT = '/.collections/'
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
 * Ported verbatim from `@ingitdb/client-github`.
 */
export const resolveDataPath = (schemaPath: string, dataDir?: string | null): string => {
  const collectionsIdx = schemaPath.indexOf(SHARED_LAYOUT_SEGMENT)
  if (collectionsIdx !== -1) {
    const baseDir = schemaPath.slice(0, collectionsIdx)
    if (!dataDir || dataDir === '.') return baseDir
    return `${baseDir}/${dataDir}`
  }
  return schemaPath
}

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

  /**
   * Resolve the physical collection path from a collectionId.
   *
   * - Top-level collections resolve through `.ingitdb/root-collections.yaml`.
   * - Nested subcollection paths (a parent chain, e.g. `spaces/family/contacts`)
   *   have no direct mapping entry, so they fall through and the collectionId is
   *   returned unchanged — which IS the on-disk directory. This is what makes
   *   parent-scoped nesting work: `spaces/family/contacts` and
   *   `spaces/work/contacts` map to distinct directories and never collide.
   */
  const resolveCollectionPath = async (collectionId: string): Promise<string> => {
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

    // Nested parent-scoped path (or unknown id): the id IS the directory path.
    return collectionId
  }

  /**
   * Build candidate `definition.yaml` paths for a resolved collection path.
   * Handles the dedicated layout, the shared `/.collections/` layout, and
   * parent-scoped subcollections whose schema lives under the TOP collection at
   * `<top>/.collection/subcollections/<sub>/definition.yaml`.
   */
  const schemaCandidates = (resolvedPath: string): string[] => {
    const candidates = [
      `${resolvedPath}/.collection/definition.yaml`,
      `${resolvedPath}/definition.yaml`
    ]
    // Parent-scoped nesting: segments interleave collection/record/subcollection.
    // e.g. "spaces/family/contacts" -> top "spaces", sub "contacts".
    const segments = resolvedPath.split('/').filter(Boolean)
    if (segments.length >= 3) {
      const top = segments[0]
      const sub = segments[segments.length - 1]
      candidates.push(`${top}/.collection/subcollections/${sub}/definition.yaml`)
    }
    return candidates
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

    const resolvedPath = await resolveCollectionPath(collectionId)

    let file: { decodedContent: string } | null = null
    for (const path of schemaCandidates(resolvedPath)) {
      try { file = await readText(path); break }
      catch (e) { if (!isNotFound(e)) throw e }
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
      const filePath = `${colPath}/${recordFilePattern}`
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

    // File-per-record layout: records live under `<collectionPath>/$records/`.
    const recordsBasePath = `${colPath}/$records`
    let entries: { name: string; isDir: boolean }[]
    try {
      entries = await listDir(recordsBasePath)
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
      const relPath = `${recordsBasePath}/${entry.name}`
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
