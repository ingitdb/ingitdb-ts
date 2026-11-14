import { describe, it, expect } from 'vitest'
import {
  assertNoKeyEncoding, joinPath, parseSubcollectionPath, recordsBasePath, resolveDataPath, resolveSubcollection,
  type LayoutReader
} from './layout'
import { parseCollectionSchema } from './schema'

/** A LayoutReader over an in-memory tree of files (path -> text). */
const memReader = (files: Record<string, string>): LayoutReader => ({
  async readText(path) { return path in files ? files[path] : null },
  async listDir(path) {
    const prefix = `${path}/`
    const names = new Set<string>()
    for (const p of Object.keys(files)) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0])
    return names.size > 0 ? [...names] : null
  }
})

const perFile = "record_file:\n  name: '{key}.yaml'\n  format: yaml\n  type: map[string]any\n"

describe('recordsBasePath', () => {
  it('follows ingitdb-go RecordsBasePath', () => {
    expect(recordsBasePath(undefined)).toBe('$records')
    expect(recordsBasePath({ name: '{key}.json' })).toBe('$records')
    expect(recordsBasePath({ name: 'all.yaml' })).toBe('')
    expect(recordsBasePath({ name: '{key}.yaml', records_dir: '.' })).toBe('')
    expect(recordsBasePath({ name: '{key}.yaml', records_dir: 'data' })).toBe('data')
    expect(recordsBasePath({ name: 'all.yaml', records_dir: null })).toBe('')
  })
})

describe('joinPath', () => {
  it('skips empty parts', () => {
    expect(joinPath('spaces', '', 'family', 'contacts')).toBe('spaces/family/contacts')
  })
})

describe('resolveDataPath', () => {
  it('maps the shared layout to the parent of .collections/', () => {
    expect(resolveDataPath('db/.collections/tags')).toBe('db')
    expect(resolveDataPath('db/.collections/tags', '.')).toBe('db')
    expect(resolveDataPath('db/.collections/tags', 'tags')).toBe('db/tags')
    expect(resolveDataPath('spaces', 'ignored')).toBe('spaces')
  })
})

describe('assertNoKeyEncoding', () => {
  it('refuses a collection that declares key_encoding, naming it and the issue', () => {
    const schema = parseCollectionSchema("record_file:\n  name: '{key}.yaml'\n  key_encoding: tilde-v1\n")
    expect(() => assertNoKeyEncoding(schema, 'spaces')).toThrow(/collection "spaces" declares record_file.key_encoding "tilde-v1".*ingitdb-ts#107/)
  })
  it('accepts a collection without one', () => {
    expect(() => assertNoKeyEncoding(parseCollectionSchema(perFile), 'spaces')).not.toThrow()
    expect(() => assertNoKeyEncoding(parseCollectionSchema({}), 'spaces')).not.toThrow()
    expect(() => assertNoKeyEncoding(parseCollectionSchema({ record_file: { key_encoding: null } }), 'spaces')).not.toThrow()
  })
})

describe('parseSubcollectionPath', () => {
  it('splits <root>/<key>/<sub> paths at every depth', () => {
    expect(parseSubcollectionPath('spaces/family/contacts')).toEqual({ root: 'spaces', steps: [{ parentKey: 'family', sub: 'contacts' }] })
    expect(parseSubcollectionPath('a/k1/b/k2/c')?.steps).toEqual([{ parentKey: 'k1', sub: 'b' }, { parentKey: 'k2', sub: 'c' }])
  })
  it('returns null for anything that is not a subcollection path', () => {
    expect(parseSubcollectionPath('spaces')).toBeNull()
    expect(parseSubcollectionPath('spaces/family')).toBeNull()
  })
  it('refuses a segment that names nothing', () => {
    for (const id of ['spaces/../contacts', 'spaces/./contacts', 'spaces//contacts']) {
      expect(() => parseSubcollectionPath(id)).toThrow(/names no record or collection/)
    }
  })
})

describe('resolveSubcollection', () => {
  const steps = (id: string) => parseSubcollectionPath(id)!.steps

  it('puts an instance inside the parent records directory at every level', async () => {
    const reader = memReader({
      'spaces/.collection/definition.yaml': perFile,
      'spaces/.collection/subcollections/contacts/definition.yaml': perFile + 'columns:\n  name: { type: string }\n',
      'spaces/.collection/subcollections/contacts/subcollections/notes/definition.yaml': perFile,
    })
    const one = await resolveSubcollection('spaces/family/contacts', 'spaces', steps('spaces/family/contacts'), reader)
    expect(one.dataPath).toBe('spaces/$records/family/contacts')
    expect(one.schema.columnsMap['name']).toBeDefined()
    expect(one.schemaYaml).toContain('name')
    const two = await resolveSubcollection('spaces/family/contacts/c1/notes', 'spaces', steps('spaces/family/contacts/c1/notes'), reader)
    expect(two.dataPath).toBe('spaces/$records/family/contacts/$records/c1/notes')
  })

  it('follows records_dir "." and a custom records_dir', async () => {
    const dot = memReader({ 'spaces/.collection/definition.yaml': perFile + '  records_dir: "."\n' })
    expect((await resolveSubcollection('spaces/family/contacts', 'spaces', steps('spaces/family/contacts'), dot)).dataPath)
      .toBe('spaces/family/contacts')
    const custom = memReader({ 'spaces/.collection/definition.yaml': perFile + '  records_dir: data\n' })
    expect((await resolveSubcollection('spaces/family/contacts', 'spaces', steps('spaces/family/contacts'), custom)).dataPath)
      .toBe('spaces/data/family/contacts')
  })

  it('reads the shared .collections/ layout', async () => {
    const reader = memReader({
      'db/.collections/spaces/definition.yaml': perFile + 'data_dir: spaces\n',
      'db/.collections/spaces/contacts/definition.yaml': perFile,
    })
    const r = await resolveSubcollection('spaces/family/contacts', 'db/.collections/spaces', steps('spaces/family/contacts'), reader)
    expect(r.dataPath).toBe('db/spaces/$records/family/contacts')
    expect(r.schemaYaml).toBe(perFile)
  })

  it('gives an empty schema when a level has no definition', async () => {
    const r = await resolveSubcollection('spaces/family/contacts', 'spaces', steps('spaces/family/contacts'), memReader({}))
    expect(r.dataPath).toBe('spaces/$records/family/contacts')
    expect(r.schemaYaml).toBe('')
  })

  it('fails on data where the definition does not put it, naming both paths and the fix', async () => {
    const reader = memReader({
      'spaces/.collection/definition.yaml': perFile,
      'spaces/family/contacts/$records/c1.yaml': 'name: Alice\n',
    })
    await expect(resolveSubcollection('spaces/family/contacts', 'spaces', steps('spaces/family/contacts'), reader))
      .rejects.toThrow(/contacts of spaces record "family" is at spaces\/family\/contacts\/, but the definition puts it at spaces\/\$records\/family\/contacts\/.*records_dir: "\."/)
  })

  it('reports a mislaid ancestor of a deeper instance', async () => {
    const reader = memReader({
      'spaces/.collection/definition.yaml': perFile,
      'spaces/family/contacts/$records/c1/notes/$records/n1.yaml': 'x: 1\n',
    })
    await expect(resolveSubcollection('spaces/family/contacts/c1/notes', 'spaces', steps('spaces/family/contacts/c1/notes'), reader))
      .rejects.toThrow(/is at spaces\/family\/contacts\//)
  })

  it('fails when both places hold data, as Go does, at every level', async () => {
    const reader = memReader({
      'spaces/.collection/definition.yaml': perFile,
      'spaces/.collection/subcollections/contacts/definition.yaml': perFile,
      'spaces/$records/family/contacts/$records/c1.yaml': 'name: Alice\n',
      'spaces/family/contacts/$records/c1.yaml': 'name: Old\n',
      'spaces/$records/work/contacts/$records/c1/notes/$records/n1.yaml': 'x: 1\n',
      'spaces/$records/work/contacts/c1/notes/$records/n0.yaml': 'x: 0\n',
    })
    await expect(resolveSubcollection('spaces/family/contacts', 'spaces', steps('spaces/family/contacts'), reader))
      .rejects.toThrow(/is at spaces\/family\/contacts\/, but the definition puts it at spaces\/\$records\/family\/contacts\//)
    await expect(resolveSubcollection('spaces/work/contacts/c1/notes', 'spaces', steps('spaces/work/contacts/c1/notes'), reader))
      .rejects.toThrow(/is at spaces\/\$records\/work\/contacts\/c1\/notes\/, but the definition puts it at spaces\/\$records\/work\/contacts\/\$records\/c1\/notes\//)
  })

  it('never flags the records directory itself', async () => {
    const reader = memReader({
      'spaces/.collection/definition.yaml': perFile,
      'spaces/$records/$records/contacts/x.yaml': 'x: 1\n',
    })
    expect((await resolveSubcollection('spaces/$records/contacts', 'spaces', steps('spaces/$records/contacts'), reader)).dataPath)
      .toBe('spaces/$records/$records/contacts')
  })

  it('refuses a parent collection that declares key_encoding', async () => {
    const reader = memReader({ 'spaces/.collection/definition.yaml': perFile + '  key_encoding: tilde-v1\n' })
    await expect(resolveSubcollection('spaces/a~2Fb/contacts', 'spaces', steps('spaces/a~2Fb/contacts'), reader))
      .rejects.toThrow(/collection "spaces" declares record_file.key_encoding/)
  })
})
