import { describe, it, expect } from 'vitest'
import { parseCacheControl, effectiveCacheControl, isPinnedRef, freshnessTtlMs } from './cache-control'

const SHA = 'a'.repeat(40)
const FIVE_MIN = 300_000
const YEAR = 31_536_000
const DECLARED = `public, max-age=${YEAR}, immutable`

describe('parseCacheControl', () => {
  it('parses directives case-insensitively with quoted arguments', () => {
    const cc = parseCacheControl(' Public, MAX-AGE=60 , x-custom="a,b\\"c", immutable ')
    expect(cc?.maxAgeSeconds).toBe(60)
    expect(cc?.immutable).toBe(true)
    expect(cc?.noStore).toBe(false)
    expect(cc?.directives['x-custom']).toBe('a,b"c')
  })

  it('ignores unknown directives and drops malformed ones', () => {
    const cc = parseCacheControl('max-age=soon, future=1, bad name, =x, no-cache, no-cache, ,')
    expect(cc?.maxAgeSeconds).toBeUndefined()
    expect(cc?.noCache).toBe(true)
    expect(cc?.directives['future']).toBe('1')
  })

  it('returns undefined for empty, non-string or wholly unusable values', () => {
    expect(parseCacheControl(undefined)).toBeUndefined()
    expect(parseCacheControl('   ')).toBeUndefined()
    expect(parseCacheControl(42)).toBeUndefined()
    expect(parseCacheControl('max-age=x')).toBeUndefined()
  })

  it('reads no-store', () => {
    expect(parseCacheControl('no-store')?.noStore).toBe(true)
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

describe('isPinnedRef', () => {
  it('accepts full SHA-1 and SHA-256 commit ids only', () => {
    expect(isPinnedRef(SHA)).toBe(true)
    expect(isPinnedRef('B'.repeat(64))).toBe(true)
    expect(isPinnedRef('main')).toBe(false)
    expect(isPinnedRef('abc1234')).toBe(false)
    expect(isPinnedRef(undefined)).toBe(false)
  })
})

describe('freshnessTtlMs', () => {
  it('uses the default when nothing usable is declared', () => {
    expect(freshnessTtlMs({ defaultTtlMs: FIVE_MIN })).toBe(FIVE_MIN)
    expect(freshnessTtlMs({ declared: 'public', defaultTtlMs: FIVE_MIN })).toBe(FIVE_MIN)
  })
  it('only tightens on an unpinned read', () => {
    expect(freshnessTtlMs({ declared: DECLARED, ref: 'main', defaultTtlMs: FIVE_MIN })).toBe(FIVE_MIN)
    expect(freshnessTtlMs({ declared: DECLARED, defaultTtlMs: FIVE_MIN })).toBe(FIVE_MIN)
    expect(freshnessTtlMs({ declared: 'max-age=60', ref: 'main', defaultTtlMs: FIVE_MIN })).toBe(60_000)
    expect(freshnessTtlMs({ declared: 'max-age=900', ref: 'main', defaultTtlMs: FIVE_MIN, originMaxAgeSeconds: 3600 })).toBe(900_000)
  })
  it('may relax on a read pinned to a commit SHA', () => {
    expect(freshnessTtlMs({ declared: DECLARED, ref: SHA, defaultTtlMs: FIVE_MIN })).toBe(YEAR * 1000)
  })
  it('lets no-store and no-cache win in both cases', () => {
    expect(freshnessTtlMs({ declared: 'no-store', ref: SHA, defaultTtlMs: FIVE_MIN })).toBe(0)
    expect(freshnessTtlMs({ declared: 'max-age=9, no-cache', ref: 'main', defaultTtlMs: FIVE_MIN })).toBe(0)
  })
})
