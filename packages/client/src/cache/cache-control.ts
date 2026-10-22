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
 * Parses a Cache-Control value leniently, the way RFC 9111 asks every cache
 * to: unknown directives are kept but never acted on, and a malformed
 * directive (for example `max-age=soon`) is dropped. `ingitdb validate`
 * rejects such values at authoring time; a reader must never fail on them.
 * Returns undefined when nothing usable was declared.
 */
export const parseCacheControl = (value: unknown): ParsedCacheControl | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const directives: Record<string, string> = {}
  for (const part of splitDirectives(value)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const eq = trimmed.indexOf('=')
    const name = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase()
    const arg = eq === -1 ? '' : unquote(trimmed.slice(eq + 1).trim())
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue
    if (DELTA_SECONDS.has(name) && !/^\d+$/.test(arg)) continue
    if (!(name in directives)) directives[name] = arg
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

/** True when a ref is a full commit SHA (40 hex for SHA-1, 64 for SHA-256), so the content cannot change. */
export const isPinnedRef = (ref: string | undefined): boolean =>
  typeof ref === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref)

export interface FreshnessInput {
  /** The effective declared `cache_control`, if any. */
  declared?: string
  /** The git ref the file is read at: a branch, a tag, or a commit SHA. */
  ref?: string
  /** The TTL used when nothing is declared; this is also taken as the origin's own max-age. */
  defaultTtlMs: number
  /** The origin's own max-age when it differs from defaultTtlMs. */
  originMaxAgeSeconds?: number
}

/**
 * How long a fetched file may be reused, in milliseconds; 0 means do not reuse.
 *
 * Unpinned reads: the declared value may only tighten the origin's. Pinned
 * reads (ref is a commit SHA): the content is immutable, so the declared
 * `max-age` may also relax it. `no-store` and `no-cache` always win.
 */
export const freshnessTtlMs = ({ declared, ref, defaultTtlMs, originMaxAgeSeconds }: FreshnessInput): number => {
  const cc = parseCacheControl(declared)
  if (!cc) return defaultTtlMs
  if (cc.noStore || cc.noCache) return 0
  if (cc.maxAgeSeconds === undefined) return defaultTtlMs
  const declaredMs = cc.maxAgeSeconds * 1000
  if (isPinnedRef(ref)) return declaredMs
  const originMs = (originMaxAgeSeconds ?? defaultTtlMs / 1000) * 1000
  return Math.min(declaredMs, originMs)
}
