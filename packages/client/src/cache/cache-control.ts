/**
 * HTTP Cache-Control (RFC 9111) support for the optional `cache_control`
 * setting, declared at database level (`.ingitdb/settings.yaml`) and
 * collection level (`<collection>/.collection/definition.yaml`).
 *
 * This module only interprets the value. It is not a cache: callers pass the
 * resulting TTL to whatever cache they already have.
 */

export interface ParsedCacheControl {
  /** Lower-cased directive names mapped to their (unquoted) argument; '' when none. */
  directives: Record<string, string>
  maxAgeSeconds?: number
  noStore: boolean
  noCache: boolean
  immutable: boolean
}

const DELTA_SECONDS = new Set(['max-age', 's-maxage', 'stale-while-revalidate', 'stale-if-error'])
/** RFC 9111 section 1.2.2: anything larger is treated as 2^31. */
export const MAX_DELTA_SECONDS = 2 ** 31
/** Freshness a pinned read gets from `immutable` when no max-age is declared: one year. */
export const IMMUTABLE_TTL_SECONDS = 31_536_000

/** Splits on commas that are outside quoted strings. */
const splitDirectives = (value: string): string[] => {
  const parts: string[] = []
  let cur = ''
  let inQuote = false
  let escaped = false
  for (const ch of value) {
    if (escaped) { escaped = false }
    else if (inQuote && ch === '\\') { escaped = true }
    else if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  return parts
}

const unquote = (arg: string): string =>
  arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1).replace(/\\(.)/g, '$1') : arg

/**
 * Parses a Cache-Control value the way a reader must: leniently, and never
 * failing. A malformed directive (for example `max-age=soon`) is dropped, the
 * first of a repeated directive wins, a flag given an argument still counts,
 * the quoted form `max-age="60"` is accepted, a delta-seconds value above 2^31
 * is clamped, and unknown directives are kept but never acted on.
 * `ingitdb validate` rejects such values at authoring time. Returns undefined
 * when nothing usable was declared. The shared conformance vectors fix these
 * outcomes.
 */
export const parseCacheControl = (value: unknown): ParsedCacheControl | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const directives: Record<string, string> = {}
  for (const part of splitDirectives(value)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const eq = trimmed.indexOf('=')
    const name = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase()
    let arg = eq === -1 ? '' : unquote(trimmed.slice(eq + 1).trim())
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue
    if (name in directives) continue
    if (DELTA_SECONDS.has(name)) {
      if (!/^\d+$/.test(arg)) continue
      arg = String(Math.min(Number(arg), MAX_DELTA_SECONDS))
    }
    directives[name] = arg
  }
  if (Object.keys(directives).length === 0) return undefined
  const maxAge = directives['max-age']
  return {
    directives,
    maxAgeSeconds: maxAge === undefined ? undefined : Number(maxAge),
    noStore: 'no-store' in directives,
    noCache: 'no-cache' in directives,
    immutable: 'immutable' in directives
  }
}

/**
 * The value that applies to a collection: its own `cache_control` when
 * declared, otherwise the database one. The collection value replaces the
 * database value as a whole; directives are never merged.
 */
export const effectiveCacheControl = (database?: unknown, collection?: unknown): string | undefined => {
  for (const v of [collection, database]) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return undefined
}

/**
 * True only when the caller has said, via `pinnedRefs`, that this ref is an
 * immutable commit SHA. A ref that merely looks like a SHA is NOT pinned: a
 * branch or tag can be named with 40 hex characters. Unsure means unpinned.
 */
export const isPinned = (ref: string | undefined, pinnedRefs?: readonly string[]): boolean =>
  ref !== undefined && pinnedRefs !== undefined && pinnedRefs.includes(ref)

export interface FreshnessInput {
  /** The effective declared `cache_control`, if any. */
  declared?: string
  /** True only when the read is of a ref the caller knows is an immutable commit. */
  pinned?: boolean
  /** The origin's own Cache-Control response header, if it sent one. */
  origin?: string
  /** Freshness assumed when the origin says nothing; the reader's default TTL. */
  defaultTtlMs: number
}

/**
 * How long a fetched file may be reused, in milliseconds; 0 means do not store
 * or reuse it. Mirrors ingitdb-go FreshnessSeconds and the shared vectors.
 *
 * Unpinned: the declared value may only tighten the origin's. Pinned: it may
 * also relax it, and `immutable` alone gives a year. `no-store` and `no-cache`
 * on either side always win. `must-revalidate` needs no handling because this
 * reader never serves a stale entry.
 */
export const freshnessTtlMs = ({ declared, pinned = false, origin, defaultTtlMs }: FreshnessInput): number => {
  const d = parseCacheControl(declared)
  const o = parseCacheControl(origin)
  if (d?.noStore || d?.noCache || o?.noStore || o?.noCache) return 0
  const originMs = o?.maxAgeSeconds === undefined ? defaultTtlMs : o.maxAgeSeconds * 1000
  const declaredMs = d?.maxAgeSeconds === undefined ? undefined : d.maxAgeSeconds * 1000
  if (pinned && declaredMs !== undefined) return declaredMs
  if (pinned && d?.immutable) return IMMUTABLE_TTL_SECONDS * 1000
  if (declaredMs !== undefined && declaredMs < originMs) return declaredMs
  return originMs
}
