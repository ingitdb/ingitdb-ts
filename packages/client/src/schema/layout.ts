import { parseCollectionSchema, type CollectionSchema } from './schema'

// The on-disk layout of subcollections, as the inGitDB definition defines it
// (ingitdb-go `subcollection-record-validation#req:subcollection-storage-convention`).
// An instance of subcollection <sub> under parent record <key> lives inside the
// parent's records directory: `<parent dir>/<parent records base>/<key>/<sub>/`.

/** The `record_file` fields the layout depends on. */
export interface RecordFileLayout {
  name?: string
  records_dir?: string | null
  key_encoding?: unknown
}

/**
 * The directory, relative to a collection's data directory, that holds its
 * record files and its records' subcollection instances: `records_dir` when
 * declared (`.` is the data directory itself, the empty string), otherwise
 * `$records` for a one-record-per-file name (`{key}` in it), otherwise empty.
 * A missing `record_file` reads as `{key}.yaml`, as everywhere in this client.
 */
export const recordsBasePath = (recordFile?: RecordFileLayout | null): string => {
  const dir = recordFile?.records_dir
  if (dir !== undefined && dir !== null) return dir === '.' ? '' : dir
  return (recordFile?.name || '{key}.yaml').includes('{key}') ? '$records' : ''
}

/** Joins repo-relative path parts, skipping empty ones. */
export const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/')

/**
 * Fails for a collection that declares `record_file.key_encoding`. This client
 * does not implement any key encoding yet (ingitdb/ingitdb-ts#107): it would
 * show encoded file names (`a~2Fb`) as record keys and write keys unencoded,
 * under names the encoding never writes.
 */
export const assertNoKeyEncoding = (schema: CollectionSchema, collectionId: string): void => {
  const encoding = (schema.record_file as RecordFileLayout | undefined)?.key_encoding
  if (encoding === undefined || encoding === null) return
  throw new Error(
    `@ingitdb/client: collection "${collectionId}" declares record_file.key_encoding ${JSON.stringify(encoding)}, ` +
    'which this client does not support yet (ingitdb/ingitdb-ts#107): it would show file names as record keys ' +
    'and write keys unencoded. Read and write this collection with the ingitdb CLI or a Go storage driver.'
  )
}

/** One parent-record step of a subcollection path: `<parentKey>/<sub>`. */
export interface SubcollectionStep {
  parentKey: string
  sub: string
}

/**
 * Splits a subcollection path `<root>/<key>/<sub>[/<key>/<sub>...]` into its
 * root collection id and its steps. Anything else (a root collection id, or an
 * even number of segments) returns null. A segment that is empty, `.` or `..`
 * is an error: it cannot name a record or a collection.
 */
export const parseSubcollectionPath = (
  collectionId: string
): { root: string; steps: SubcollectionStep[] } | null => {
  const segments = collectionId.split('/')
  if (segments.length < 3 || segments.length % 2 === 0) return null
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`@ingitdb/client: collection path "${collectionId}" has the segment "${segment}", which names no record or collection`)
    }
  }
  const steps: SubcollectionStep[] = []
  for (let i = 1; i < segments.length; i += 2) {
    steps.push({ parentKey: segments[i], sub: segments[i + 1] })
  }
  return { root: segments[0], steps }
}

/** Repository reads the layout needs; both return null for a path that does not exist. */
export interface LayoutReader {
  /** The text of a repo-relative file. */
  readText(path: string): Promise<string | null>
  /** The entry names of a repo-relative directory. */
  listDir(path: string): Promise<string[] | null>
}

const SHARED_LAYOUT_SEGMENT = '/.collections/'

/**
 * Resolves the data directory for a collection given its schema path and
 * optional data_dir. For the shared layout (`/.collections/` in the schema
 * path) the data path is the parent of `.collections/` plus data_dir; for the
 * dedicated layout the schema path IS the data root.
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

/** A collection's definition and the directory that holds its data. */
export interface ResolvedCollection {
  schema: CollectionSchema
  schemaYaml: string
  /** The collection's data directory (its records live in `recordsBasePath` below it). */
  dataPath: string
}

const loadDefinition = async (reader: LayoutReader, candidates: string[]): Promise<{ schema: CollectionSchema; schemaYaml: string }> => {
  for (const path of candidates) {
    const text = await reader.readText(path)
    if (text !== null) return { schema: parseCollectionSchema(text), schemaYaml: text }
  }
  return { schema: parseCollectionSchema({}), schemaYaml: '' }
}

/**
 * Resolves a subcollection instance where the definition puts it. rootPath is
 * the root collection's schema path (from `.ingitdb/root-collections.yaml`).
 * Each level's definition is the parent's `subcollections/<sub>/definition.yaml`
 * (`<sub>/definition.yaml` in the shared `.collections/` layout), and each
 * instance directory is `<parent data dir>/<parent records base>/<key>/<sub>`.
 *
 * Data at `<parent data dir>/<key>/<sub>/`, the layout earlier writers used,
 * is an error naming both paths and the fix, whether or not the defined
 * directory holds data too, as ingitdb-go's storage drivers and `validate`
 * report it, so every reader of a database agrees. A parent that declares a key encoding is
 * refused, since its keys are not its directory names.
 */
export const resolveSubcollection = async (
  collectionId: string,
  rootPath: string,
  steps: SubcollectionStep[],
  reader: LayoutReader
): Promise<ResolvedCollection> => {
  const shared = rootPath.includes(SHARED_LAYOUT_SEGMENT)
  let schemaDir = shared ? rootPath : `${rootPath}/.collection`
  let current = await loadDefinition(reader, [`${schemaDir}/definition.yaml`, `${rootPath}/definition.yaml`])
  let dataPath = resolveDataPath(rootPath, current.schema.data_dir as string | null | undefined)
  let currentId = collectionId.split('/')[0]

  for (const { parentKey, sub } of steps) {
    assertNoKeyEncoding(current.schema, currentId)
    const base = recordsBasePath(current.schema.record_file as RecordFileLayout | undefined)
    const expected = joinPath(dataPath, base, parentKey, sub)
    if (base !== '' && parentKey !== base.split('/')[0]) {
      const found = joinPath(dataPath, parentKey, sub)
      const foundEntries = await reader.listDir(found)
      if (foundEntries && foundEntries.length > 0) {
        throw new Error(
          `@ingitdb/client: subcollection data outside the location the definition defines: ` +
          `subcollection ${sub} of ${currentId} record "${parentKey}" is at ${found}/, but the definition puts it at ${expected}/ ` +
          `(${currentId} keeps its records in record_file.records_dir "${base}"). Move it there, ` +
          `or set record_file.records_dir: "." on ${currentId} and move its own records out of ${base}/.`
        )
      }
    }
    schemaDir = shared ? `${schemaDir}/${sub}` : `${schemaDir}/subcollections/${sub}`
    current = await loadDefinition(reader, [`${schemaDir}/definition.yaml`])
    dataPath = expected
    currentId = `${currentId}/${parentKey}/${sub}`
  }
  return { schema: current.schema, schemaYaml: current.schemaYaml, dataPath }
}
