import { describe, it, expect } from 'vitest'
import { parseYaml, stringifyYaml } from './yaml'

describe('parseYaml', () => {
  it('returns null for empty string', () => {
    expect(parseYaml('')).toBeNull()
  })

  it('parses a simple YAML object', () => {
    const result = parseYaml('name: Alice\nage: 30')
    expect(result).toEqual({ name: 'Alice', age: 30 })
  })

  it('parses a YAML array', () => {
    const result = parseYaml('- one\n- two\n- three')
    expect(result).toEqual(['one', 'two', 'three'])
  })

  it('parses nested YAML', () => {
    const yaml = `
person:
  name: Bob
  address:
    city: Berlin
`
    const result = parseYaml(yaml) as Record<string, unknown>
    expect(result).toEqual({
      person: {
        name: 'Bob',
        address: { city: 'Berlin' }
      }
    })
  })
})

describe('stringifyYaml', () => {
  it('serialises an object to YAML string', () => {
    const yaml = stringifyYaml({ name: 'Test', value: 42 })
    expect(yaml).toContain('name: Test')
    expect(yaml).toContain('value: 42')
  })

  it('round-trips correctly', () => {
    const original = { items: ['a', 'b'], count: 2 }
    const yaml = stringifyYaml(original)
    const parsed = parseYaml(yaml)
    expect(parsed).toEqual(original)
  })
})
