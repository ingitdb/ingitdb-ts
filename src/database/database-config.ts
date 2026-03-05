import type { GithubApi } from '../github/github-api'
import type { Cache } from '../cache/cache'
import { buildCacheKey } from '../cache/cache'
import { parseYaml } from '../utils/yaml'

const CONFIG_TTL = 2 * 60 * 1000

export interface CollectionEntry { id: string; path: string }

export interface DatabaseConfig {
  rawYaml: string
  collections: CollectionEntry[]
  views: unknown[]
  triggers: unknown[]
  subscribers: unknown[]
}

export interface DatabaseConfigDeps {
  githubApi: GithubApi
  cache: Cache
}

/**
 * Expands namespace entries ("ns.*") by loading the namespace's own root-collections.yaml.
 */
const expandNamespaces = async (
  repo: string,
  branch: string | undefined,
  parsed: Record<string, string>,
  deps: DatabaseConfigDeps
): Promise<CollectionEntry[]> => {
  const { githubApi } = deps
  const entries: CollectionEntry[] = []
  for (const [key, basePath] of Object.entries(parsed)) {
    const nsMatch = /^(.+)\.\*$/.exec(key)
    if (nsMatch) {
      const namespace = nsMatch[1]
      try {
        const subFile = await githubApi.getFileText(repo, `${basePath}/.ingitdb/root-collections.yaml`, branch)
        const subParsed = (parseYaml(subFile.decodedContent) as Record<string, string>) || {}
        for (const [subId, subPath] of Object.entries(subParsed)) {
          entries.push({ id: `${namespace}.${subId}`, path: `${basePath}/${subPath}` })
        }
      } catch (err) {
        console.warn(`[loadDatabaseConfig] failed to expand namespace ${namespace}:`, err)
      }
    } else {
      entries.push({ id: key, path: basePath })
    }
  }
  return entries
}

/**
 * Loads the database config from `.ingitdb/root-collections.yaml`,
 * expanding namespaces, and returning a fully resolved `DatabaseConfig`.
 */
export const loadDatabaseConfig = async (
  repo: string,
  branch: string | undefined,
  deps: DatabaseConfigDeps
): Promise<DatabaseConfig> => {
  if (!repo) return { rawYaml: '', collections: [], views: [], triggers: [], subscribers: [] }

  const { githubApi, cache } = deps
  const cacheKey = buildCacheKey('db-config', repo, branch || 'default')

  const cached = await cache.get<{ config: Record<string, string>; rawYaml: string }>(cacheKey)
  let parsed: Record<string, string>
  let rawYaml: string

  if (cached) {
    parsed = cached.config
    rawYaml = cached.rawYaml
  } else {
    const file = await githubApi.getFileText(repo, '.ingitdb/root-collections.yaml', branch)
    rawYaml = file.decodedContent
    parsed = (parseYaml(rawYaml) as Record<string, string>) || {}
    await cache.set(cacheKey, { config: parsed, rawYaml }, CONFIG_TTL)
  }

  const collections = await expandNamespaces(repo, branch, parsed, deps)

  return {
    rawYaml,
    collections,
    views: [],
    triggers: [],
    subscribers: []
  }
}
