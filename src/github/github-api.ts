import axios, { type AxiosResponseHeaders, type RawAxiosResponseHeaders } from 'axios'

const DEFAULT_ACCEPT = 'application/vnd.github+json'

export interface RateLimit {
  limit: number | null
  remaining: number | null
  reset: number | null
}

export interface FileTextResult {
  decodedContent: string
  sha?: string
}

export interface PutFileParams {
  repo: string; path: string; content: string; message: string; sha?: string; branch?: string
}

export interface DeleteFileParams {
  repo: string; path: string; message: string; sha: string; branch?: string
}

const parseRepo = (repo: string): { owner: string; name: string } => {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error('Repository must be in "owner/repo" format')
  return { owner, name }
}

function updateRateLimit(headers: AxiosResponseHeaders | RawAxiosResponseHeaders, rl: RateLimit): void {
  rl.limit = Number(headers['x-ratelimit-limit'] || NaN) || null
  rl.remaining = Number(headers['x-ratelimit-remaining'] || NaN) || null
  rl.reset = Number(headers['x-ratelimit-reset'] || NaN) || null
}

/** The shape of the GitHub API client returned by `createGithubApi`. */
export interface GithubApi {
  getRateLimit(): RateLimit
  getRepo(repo: string): Promise<Record<string, unknown>>
  getBranches(repo: string, page?: number): Promise<Record<string, unknown>[]>
  getContents(repo: string, path: string, branch?: string): Promise<unknown>
  getFileText(repo: string, path: string, branch?: string): Promise<FileTextResult>
  putFile(params: PutFileParams): Promise<Record<string, unknown>>
  deleteFile(params: DeleteFileParams): Promise<Record<string, unknown>>
  forkRepo(repo: string, organization?: string): Promise<Record<string, unknown>>
  getBranchSHA(repo: string, branch: string): Promise<string>
  createBranch(repo: string, newBranch: string, fromSHA: string): Promise<void>
  checkExistingFork(repo: string, username: string): Promise<string | null>
  waitForFork(username: string, repoName: string, maxWaitMs?: number): Promise<void>
  syncForkBranch(forkRepo: string, branch: string): Promise<void>
  getCommit(repo: string, sha: string): Promise<{ sha: string; tree: { sha: string } }>
  createTree(repo: string, baseTreeSha: string, deletions: string[]): Promise<string>
  createCommit(repo: string, message: string, treeSha: string, parentSha: string): Promise<string>
  updateBranchRef(repo: string, branch: string, sha: string): Promise<void>
}

/**
 * Factory that creates a framework-agnostic GitHub API client.
 * The optional `token` is set once at creation time on the axios interceptor.
 */
export function createGithubApi(token?: string): GithubApi {
  const rateLimit: RateLimit = { limit: null, remaining: null, reset: null }

  const http = axios.create({
    baseURL: 'https://api.github.com',
    headers: { Accept: DEFAULT_ACCEPT, 'X-GitHub-Api-Version': '2022-11-28' }
  })

  const rawHttp = axios.create({
    baseURL: 'https://raw.githubusercontent.com',
    responseType: 'text'
  })

  http.interceptors.request.use((config) => {
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  http.interceptors.response.use((response) => {
    updateRateLimit(response.headers, rateLimit)
    return response
  })

  const api: GithubApi = {
    getRateLimit: () => ({ ...rateLimit }),

    async getRepo(repo: string): Promise<Record<string, unknown>> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.get<Record<string, unknown>>(`/repos/${owner}/${name}`)
      return data
    },

    async getBranches(repo: string, page = 1): Promise<Record<string, unknown>[]> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.get<Record<string, unknown>[]>(`/repos/${owner}/${name}/branches`, {
        params: { per_page: 100, page }
      })
      return data
    },

    async getContents(repo: string, path: string, branch?: string): Promise<unknown> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.get(`/repos/${owner}/${name}/contents/${path}`, {
        params: branch ? { ref: branch } : undefined
      })
      return data
    },

    async getFileText(repo: string, path: string, branch?: string): Promise<FileTextResult> {
      const { owner, name } = parseRepo(repo)
      const branchRef = branch || 'main'
      const downloadUrl = `https://raw.githubusercontent.com/${owner}/${name}/${branchRef}/${path}`
      const { data } = await rawHttp.get<string>(downloadUrl)
      return { decodedContent: data }
    },

    async putFile({ repo, path, content, message, sha, branch }: PutFileParams): Promise<Record<string, unknown>> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.put<Record<string, unknown>>(`/repos/${owner}/${name}/contents/${path}`, {
        message, content: btoa(unescape(encodeURIComponent(content))), sha, branch
      })
      return data
    },

    async deleteFile({ repo, path, message, sha, branch }: DeleteFileParams): Promise<Record<string, unknown>> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.delete<Record<string, unknown>>(`/repos/${owner}/${name}/contents/${path}`, {
        data: { message, sha, branch }
      })
      return data
    },

    async forkRepo(repo: string, organization?: string): Promise<Record<string, unknown>> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.post<Record<string, unknown>>(`/repos/${owner}/${name}/forks`, { organization })
      return data
    },

    async getBranchSHA(repo: string, branch: string): Promise<string> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.get<{ object: { sha: string } }>(`/repos/${owner}/${name}/git/ref/heads/${branch}`)
      return data.object.sha
    },

    async createBranch(repo: string, newBranch: string, fromSHA: string): Promise<void> {
      const { owner, name } = parseRepo(repo)
      await http.post(`/repos/${owner}/${name}/git/refs`, {
        ref: `refs/heads/${newBranch}`,
        sha: fromSHA
      })
    },

    async checkExistingFork(repo: string, username: string): Promise<string | null> {
      const { name } = parseRepo(repo)
      try {
        const data = await api.getRepo(`${username}/${name}`) as { fork?: boolean; parent?: { full_name?: string } }
        if (data.fork && data.parent?.full_name === repo) return `${username}/${name}`
        return null
      } catch {
        return null
      }
    },

    async waitForFork(username: string, repoName: string, maxWaitMs = 30000): Promise<void> {
      const start = Date.now()
      while (Date.now() - start < maxWaitMs) {
        try {
          await api.getRepo(`${username}/${repoName}`)
          return
        } catch {
          await new Promise(r => setTimeout(r, 2000))
        }
      }
      throw new Error('Timed out waiting for fork to be ready')
    },

    async syncForkBranch(forkRepo: string, branch: string): Promise<void> {
      try {
        await http.post(`/repos/${forkRepo}/merge-upstream`, { branch })
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } }
        if (e.response?.status === 409) return // already up to date
        throw err
      }
    },

    async getCommit(repo: string, sha: string): Promise<{ sha: string; tree: { sha: string } }> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.get<{ sha: string; tree: { sha: string } }>(`/repos/${owner}/${name}/git/commits/${sha}`)
      return data
    },

    async createTree(repo: string, baseTreeSha: string, deletions: string[]): Promise<string> {
      const { owner, name } = parseRepo(repo)
      const tree = deletions.map(path => ({ path, mode: '100644' as const, type: 'blob' as const, sha: null }))
      const { data } = await http.post<{ sha: string }>(`/repos/${owner}/${name}/git/trees`, { base_tree: baseTreeSha, tree })
      return data.sha
    },

    async createCommit(repo: string, message: string, treeSha: string, parentSha: string): Promise<string> {
      const { owner, name } = parseRepo(repo)
      const { data } = await http.post<{ sha: string }>(`/repos/${owner}/${name}/git/commits`, { message, tree: treeSha, parents: [parentSha] })
      return data.sha
    },

    async updateBranchRef(repo: string, branch: string, sha: string): Promise<void> {
      const { owner, name } = parseRepo(repo)
      await http.patch(`/repos/${owner}/${name}/git/refs/heads/${branch}`, { sha })
    }
  }

  return api
}

export const buildCommitMessage = (action: string, resourcePath: string): string =>
  `inGitDB: ${action} ${resourcePath}\n\nVia inGitDB Web App`
