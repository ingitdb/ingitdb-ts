import type { GithubApi } from '../github/github-api'

export interface RepoMeta {
  permissions?: { push?: boolean }
  [key: string]: unknown
}

export interface RepoDeps {
  githubApi: GithubApi
}

interface RepoCacheEntry { repoMeta: RepoMeta; canWrite: boolean | null }

/** In-memory perf cache for repo metadata. Shared across calls for the lifetime of the process. */
const permissionCache = new Map<string, RepoCacheEntry>()

/**
 * Loads repository metadata (including permissions) from the GitHub API.
 * Caches results in an in-memory Map for subsequent calls.
 */
export const loadRepoMeta = async (
  repo: string,
  deps: RepoDeps
): Promise<RepoMeta> => {
  if (!repo) throw new Error('Repository is required')
  const { githubApi } = deps

  if (permissionCache.has(repo)) {
    return permissionCache.get(repo)!.repoMeta
  }

  const data = await githubApi.getRepo(repo) as RepoMeta
  const writeAccess = typeof data?.permissions?.push === 'boolean' ? data.permissions.push : null
  permissionCache.set(repo, { repoMeta: data, canWrite: writeAccess })
  return data
}
