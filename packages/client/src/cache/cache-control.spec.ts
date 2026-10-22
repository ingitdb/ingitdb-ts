import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseYaml } from '../utils/yaml'
import { parseCacheControl, effectiveCacheControl, isPinned, freshnessTtlMs } from './cache-control'

interface Vectors {
  parse: { input: string; valid: boolean; maxAge: number | null; noStore: boolean; noCache: boolean; immutable: boolean }[]
  freshness: { name: string; declared: string | null; ref: string; origin: string | null; default: number; expect: number }[]
}
// Vendored byte-for-byte from ingitdb/ingitdb conformance/cache-control/vectors.yaml.
const vectors = parseYaml(
  readFileSync(join(__dirname, '__fixtures__', 'cache-control-vectors.yaml'), 'utf8')
) as Vectors

describe('shared conformance vectors', () => {
  it.each(vectors.parse.map((r) => [r.input, r] as const))('parse %j', (_input, row) => {
    const cc = parseCacheControl(row.input)
    expect(cc?.maxAgeSeconds ?? null).toBe(row.maxAge)
    expect(cc?.noStore ?? false).toBe(row.noStore)
    expect(cc?.noCache ?? false).toBe(row.noCache)
    expect(cc?.immutable ?? false).toBe(row.immutable)
  })

  it.each(vectors.freshness.map((r) => [r.name, r] as const))('freshness %s', (_name, row) => {
    const ttl = freshnessTtlMs({
      declared: row.declared ?? undefined,
      pinned: row.ref === 'pinned',
      origin: row.origin ?? undefined,
      defaultTtlMs: row.default * 1000
    })
    expect(ttl).toBe(row.expect * 1000)
  })
})

describe('parseCacheControl', () => {
  it('keeps unknown directives and unquotes arguments', () => {
    const cc = parseCacheControl('x-custom="a,b\\"c", future=1')
    expect(cc?.directives['x-custom']).toBe('a,b"c')
    expect(cc?.directives['future']).toBe('1')
  })
  it('returns undefined for non-strings and blanks', () => {
    expect(parseCacheControl(undefined)).toBeUndefined()
    expect(parseCacheControl(42)).toBeUndefined()
    expect(parseCacheControl('  ')).toBeUndefined()
  })
})

describe('effectiveCacheControl', () => {
  it('lets the collection value replace the database value as a whole', () => {
    expect(effectiveCacheControl('public, max-age=60', ' no-store ')).toBe('no-store')
  })
  it('falls back to the database value, then to undefined', () => {
    expect(effectiveCacheControl(' max-age=60 ', '')).toBe('max-age=60')
    expect(effectiveCacheControl(undefined, undefined)).toBeUndefined()
    expect(effectiveCacheControl(5, null)).toBeUndefined()
  })
})

describe('isPinned', () => {
  const SHA = 'a'.repeat(40)
  it('is true only for a ref the caller listed', () => {
    expect(isPinned(SHA, [SHA])).toBe(true)
    expect(isPinned('main', [SHA])).toBe(false)
  })
  it('does not trust a SHA-shaped ref the caller did not list', () => {
    expect(isPinned(SHA, [])).toBe(false)
    expect(isPinned(SHA, undefined)).toBe(false)
    expect(isPinned(undefined, [SHA])).toBe(false)
  })
})

describe('freshnessTtlMs defaults', () => {
  it('uses the default TTL when nothing is declared and the origin is silent', () => {
    expect(freshnessTtlMs({ defaultTtlMs: 300_000 })).toBe(300_000)
  })
})
