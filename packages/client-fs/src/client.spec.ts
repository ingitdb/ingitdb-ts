import { describe, it, expect } from 'vitest'
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
    expect(family.records[0]._path).toBe('spaces/family/contacts/$records/c1.yaml')
  })

  it('resolves the subcollection schema from <top>/.collection/subcollections/<sub>/definition.yaml', async () => {
    const { schema } = await client().loadCollectionSchema(REPO, undefined, 'spaces/family/contacts')
    expect(schema.columnsMap['name']).toBeDefined()
  })

  it('loadRecord reads a single record file with _path metadata', async () => {
    const rec = await client().loadRecord(REPO, 'spaces/work/contacts/$records/c1.yaml')
    expect(rec.name).toBe('Bob')
    expect(rec._path).toBe('spaces/work/contacts/$records/c1.yaml')
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
