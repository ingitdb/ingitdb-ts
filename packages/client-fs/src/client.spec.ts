import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createFsIngitDbClient } from './client'

// ---------------------------------------------------------------------------
// FILESYSTEM READER + CROSS-LANGUAGE FORMAT CONTRACT
//
// These fixtures (src/__fixtures__/format-fixtures/) are a byte-identical copy of
// the golden repo tree produced by the Go writer (github.com/ingitdb/dalgo2ingitdb),
// documented in that repo's FORMAT.md and mirrored in @ingitdb/client-github. This
// test drives the real @ingitdb/client-fs reader against that tree via node:fs, so
// if the Go writer's on-disk format and this TS reader ever drift, one side's CI
// goes red instead of a user's repo silently failing to load.
// ---------------------------------------------------------------------------

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'format-fixtures')

// The IngitDbClient signatures still carry (repo, branch); the fs reader ignores
// them and reads from rootDir. Pass a placeholder repo for readability.
const REPO = 'local/fixtures'

describe('createFsIngitDbClient (read-only filesystem reader)', () => {
  const client = () => createFsIngitDbClient({ rootDir: fixturesRoot })

  it('resolves a top-level collection path & parses its schema from .collection/definition.yaml', async () => {
    const { schema, collectionPath } = await client().loadCollectionSchema(REPO, undefined, 'spaces')
    expect(collectionPath).toBe('spaces')
    // The schema declares a required "name" string column (see FORMAT.md).
    expect(schema.columnsMap['name']).toBeDefined()
    expect(schema.columns_order).toContain('name')
  })

  it('loads the database config (collections) from .ingitdb/root-collections.yaml', async () => {
    const config = await client().loadDatabaseConfig(REPO)
    expect(config.collections).toEqual([{ id: 'spaces', path: 'spaces' }])
  })

  it('reads nested subcollection records scoped by parent (no cross-space collision)', async () => {
    const c = client()
    // Both nested collections address the same leaf collection + record id but live
    // under different parent spaces — parent-scoped nesting must keep them distinct.
    const familySchema = await c.loadCollectionSchema(REPO, undefined, 'spaces/family/contacts')
    const workSchema = await c.loadCollectionSchema(REPO, undefined, 'spaces/work/contacts')

    const family = await c.loadCollectionRecords(
      REPO, undefined, 'spaces/family/contacts', familySchema.schema, familySchema.collectionPath
    )
    const work = await c.loadCollectionRecords(
      REPO, undefined, 'spaces/work/contacts', workSchema.schema, workSchema.collectionPath
    )

    expect(family.records).toHaveLength(1)
    expect(work.records).toHaveLength(1)
    expect(family.records[0]).toMatchObject({ _id: 'c1', name: 'Alice' })
    expect(work.records[0]).toMatchObject({ _id: 'c1', name: 'Bob' })
    expect(family.records[0]._path).toBe('spaces/$records/family/contacts/$records/c1.yaml')
    expect(familySchema.collectionPath).toBe('spaces/$records/family/contacts')
  })

  it('resolves the subcollection schema from <top>/.collection/subcollections/<sub>/definition.yaml', async () => {
    const { schema } = await client().loadCollectionSchema(REPO, undefined, 'spaces/family/contacts')
    expect(schema.columnsMap['name']).toBeDefined()
  })

  it('loadRecord reads a single record file with _path metadata', async () => {
    const rec = await client().loadRecord(REPO, 'spaces/$records/work/contacts/$records/c1.yaml')
    expect(rec.name).toBe('Bob')
    expect(rec._path).toBe('spaces/$records/work/contacts/$records/c1.yaml')
  })

  it('returns an empty record list for a non-existent collection', async () => {
    const c = client()
    const { schema, collectionPath } = await c.loadCollectionSchema(REPO, undefined, 'does/not/exist')
    const { records } = await c.loadCollectionRecords(REPO, undefined, 'does/not/exist', schema, collectionPath)
    expect(records).toEqual([])
  })

  it('reports read-only repo meta (no push permission)', async () => {
    const meta = await client().loadRepoMeta(REPO)
    expect(meta.permissions?.push).toBe(false)
  })

  it('loadFKViews returns the safe empty default', async () => {
    const views = await client().loadFKViews(REPO, undefined, 'spaces', 'c1')
    expect(views).toEqual([])
  })

  it('exposes an in-memory cache (get/set/delete/clear)', async () => {
    const { cache } = client()
    await cache.set('k', 42)
    expect(await cache.get<number>('k')).toBe(42)
    await cache.delete('k')
    expect(await cache.get('k')).toBeNull()
    await cache.set('k2', 'v')
    await cache.clear()
    expect(await cache.get('k2')).toBeNull()
  })

  it('createCommittedChangesStore is wired from @ingitdb/client', () => {
    const store = client().createCommittedChangesStore()
    expect(typeof store.add).toBe('function')
  })

  it('write path (createPendingChangesStore) is intentionally not implemented', () => {
    expect(() => client().createPendingChangesStore()).toThrow(/not implemented/)
  })
})

// ---------------------------------------------------------------------------
// Defined subcollection layout (ingitdb/ingitdb-ts#106) and key_encoding refusal (#107)
// ---------------------------------------------------------------------------

describe('createFsIngitDbClient layout rules', () => {
  const perFile = "record_file:\n  name: '{key}.yaml'\n  format: yaml\n  type: map[string]any\n"
  const dirs: string[] = []
  afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

  /** A throw-away database with the given files (repo-relative path -> text). */
  const db = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'ingitdb-fs-'))
    dirs.push(root)
    for (const [rel, text] of Object.entries({ '.ingitdb/root-collections.yaml': 'spaces: spaces\n', ...files })) {
      const abs = join(root, ...rel.split('/'))
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, text)
    }
    return root
  }

  it('fails on subcollection data where the definition does not put it', async () => {
    const c = createFsIngitDbClient({ rootDir: db({
      'spaces/.collection/definition.yaml': perFile,
      'spaces/family/contacts/$records/c1.yaml': 'name: Alice\n',
    }) })
    await expect(c.loadCollectionSchema(REPO, undefined, 'spaces/family/contacts'))
      .rejects.toThrow(/is at spaces\/family\/contacts\/, but the definition puts it at spaces\/\$records\/family\/contacts\//)
  })

  it('reads a parent with records_dir "." at <parent dir>/<key>/<sub>/', async () => {
    const c = createFsIngitDbClient({ rootDir: db({
      'spaces/.collection/definition.yaml': perFile + '  records_dir: "."\n',
      'spaces/family/contacts/$records/c1.yaml': 'name: Alice\n',
    }) })
    const { schema, collectionPath } = await c.loadCollectionSchema(REPO, undefined, 'spaces/family/contacts')
    expect(collectionPath).toBe('spaces/family/contacts')
    const { records } = await c.loadCollectionRecords(REPO, undefined, 'spaces/family/contacts', schema, collectionPath)
    expect(records).toMatchObject([{ _id: 'c1', name: 'Alice' }])
  })

  it('reads the records of a collection with a custom records_dir from that directory', async () => {
    const c = createFsIngitDbClient({ rootDir: db({
      'spaces/.collection/definition.yaml': perFile + '  records_dir: data\n',
      'spaces/data/family.yaml': 'name: Family\n',
    }) })
    const { schema, collectionPath } = await c.loadCollectionSchema(REPO, undefined, 'spaces')
    const { records } = await c.loadCollectionRecords(REPO, undefined, 'spaces', schema, collectionPath)
    expect(records).toMatchObject([{ _id: 'family', _path: 'spaces/data/family.yaml' }])
  })

  it('refuses a collection that declares key_encoding, root or subcollection', async () => {
    const c = createFsIngitDbClient({ rootDir: db({
      'spaces/.collection/definition.yaml': perFile + '  key_encoding: tilde-v1\n',
    }) })
    await expect(c.loadCollectionSchema(REPO, undefined, 'spaces')).rejects.toThrow(/declares record_file.key_encoding "tilde-v1".*#107/)
    await expect(c.loadCollectionSchema(REPO, undefined, 'spaces/a~2Fb/contacts')).rejects.toThrow(/key_encoding/)
    const sub = createFsIngitDbClient({ rootDir: db({
      'spaces/.collection/definition.yaml': perFile,
      'spaces/.collection/subcollections/contacts/definition.yaml': perFile + '  key_encoding: tilde-v1\n',
    }) })
    await expect(sub.loadCollectionSchema(REPO, undefined, 'spaces/family/contacts')).rejects.toThrow(/collection "spaces\/family\/contacts" declares/)
  })

  it('gives an unmapped root collection without a definition an empty schema at its id', async () => {
    const { schema, schemaYaml, collectionPath } = await createFsIngitDbClient({ rootDir: db({}) })
      .loadCollectionSchema(REPO, undefined, 'unmapped')
    expect(collectionPath).toBe('unmapped')
    expect(schemaYaml).toBe('')
    expect(schema.columns).toEqual([])
  })

  it('rethrows a directory read error other than not-found while checking the layout', async () => {
    const root = db({ 'spaces/.collection/definition.yaml': perFile })
    mkdirSync(join(root, 'spaces', 'family'), { recursive: true })
    symlinkSync('contacts', join(root, 'spaces', 'family', 'contacts')) // a link to itself: ELOOP
    await expect(createFsIngitDbClient({ rootDir: root }).loadCollectionSchema(REPO, undefined, 'spaces/family/contacts'))
      .rejects.toThrow(/ELOOP/)
  })

  it('still rethrows a definition read error other than not-found', async () => {
    const root = db({})
    mkdirSync(join(root, 'spaces', '.collection', 'definition.yaml'), { recursive: true })
    await expect(createFsIngitDbClient({ rootDir: root }).loadCollectionSchema(REPO, undefined, 'spaces/family/contacts'))
      .rejects.toThrow(/EISDIR/)
  })
})
