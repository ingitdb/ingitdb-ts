import { describe, it, expect } from 'vitest'
import { parseCollectionSchema, normalizeCollectionSchema } from './schema'

describe('parseCollectionSchema', () => {
  it('parses a YAML string with array columns', () => {
    const yaml = `
columns:
  - name: id
    type: string
  - name: title
    type: string
    required: true
`
    const schema = parseCollectionSchema(yaml)
    expect(schema.columns).toHaveLength(2)
    expect(schema.columns[0].name).toBe('id')
    expect(schema.columns[1].required).toBe(true)
    expect(schema.columns_order).toEqual(['id', 'title'])
    expect(schema.columnsMap['title']).toEqual({ name: 'title', type: 'string', required: true })
  })

  it('parses an object with object-style columns', () => {
    const raw = {
      columns: {
        country: { type: 'string' },
        population: { type: 'number' }
      }
    }
    const schema = parseCollectionSchema(raw)
    expect(schema.columns).toHaveLength(2)
    expect(schema.columns[0].name).toBe('country')
    expect(schema.columns[1].name).toBe('population')
    expect(schema.columns_order).toEqual(['country', 'population'])
  })

  it('handles empty input', () => {
    const schema = parseCollectionSchema({})
    expect(schema.columns).toEqual([])
    expect(schema.columns_order).toEqual([])
    expect(schema.columnsMap).toEqual({})
  })

  it('respects explicit columns_order', () => {
    const raw = {
      columns: [
        { name: 'a', type: 'string' },
        { name: 'b', type: 'string' },
        { name: 'c', type: 'string' }
      ],
      columns_order: ['c', 'a', 'b']
    }
    const schema = parseCollectionSchema(raw)
    expect(schema.columns_order).toEqual(['c', 'a', 'b'])
  })

  it('preserves extra schema properties', () => {
    const raw = {
      record_file: { name: '{key}/record.yaml' },
      data_dir: 'data',
      columns: []
    }
    const schema = parseCollectionSchema(raw)
    expect(schema.record_file).toEqual({ name: '{key}/record.yaml' })
    expect(schema.data_dir).toBe('data')
  })
})

describe('normalizeCollectionSchema', () => {
  it('filters out columns without names from columnsMap', () => {
    const schema = normalizeCollectionSchema({
      columns: [{ type: 'string' }, { name: 'valid', type: 'number' }]
    })
    expect(Object.keys(schema.columnsMap)).toEqual(['valid'])
  })

  it('handles object-style columns with non-object def values (line 32 branch)', () => {
    const schema = normalizeCollectionSchema({
      columns: { col1: 'string', col2: 42 }
    })
    expect(schema.columns).toHaveLength(2)
    expect(schema.columns[0]).toEqual({ name: 'col1' })
    expect(schema.columns[1]).toEqual({ name: 'col2' })
  })
})

describe('parseCollectionSchema edge cases', () => {
  it('handles empty-string source (parseYaml returns null → raw || {} fallback)', () => {
    const schema = parseCollectionSchema('')
    expect(schema.columns).toEqual([])
    expect(schema.columns_order).toEqual([])
    expect(schema.columnsMap).toEqual({})
  })
})
