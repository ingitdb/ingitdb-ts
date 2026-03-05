import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- axios mock via vi.hoisted ------------------------------------
const mocks = vi.hoisted(() => {
  let createCount = 0

  const interceptors = {
    requestFn: null as ((config: Record<string, unknown>) => Record<string, unknown>) | null,
    responseFn: null as ((response: Record<string, unknown>) => Record<string, unknown>) | null
  }

  const httpMock = {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: {
        use: vi.fn((fn: (c: Record<string, unknown>) => Record<string, unknown>) => {
          interceptors.requestFn = fn
        })
      },
      response: {
        use: vi.fn((fn: (r: Record<string, unknown>) => Record<string, unknown>) => {
          interceptors.responseFn = fn
        })
      }
    }
  }

  const rawHttpMock = {
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() }
    }
  }

  return {
    httpMock,
    rawHttpMock,
    interceptors,
    resetCreateCount: () => { createCount = 0 },
    getNextInstance: () => createCount++ === 0 ? httpMock : rawHttpMock
  }
})

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mocks.getNextInstance())
  }
}))

const { createGithubApi, buildCommitMessage } = await import('./github-api')

// ---------- tests ---------------------------------------------------------
describe('buildCommitMessage', () => {
  it('formats action and path', () => {
    expect(buildCommitMessage('delete', 'countries/FR.yaml'))
      .toBe('inGitDB: delete countries/FR.yaml\n\nVia inGitDB Web App')
  })
})

describe('createGithubApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetCreateCount()
    mocks.interceptors.requestFn = null
    mocks.interceptors.responseFn = null
  })

  // ── factory / interceptors ──────────────────────────────────────────────
  it('getRateLimit returns nulls initially', () => {
    const api = createGithubApi()
    expect(api.getRateLimit()).toEqual({ limit: null, remaining: null, reset: null })
  })

  it('request interceptor adds Authorization when token is provided', () => {
    createGithubApi('ghp_test')
    const config = { headers: {} as Record<string, string> }
    const result = mocks.interceptors.requestFn!(config as Record<string, unknown>) as { headers: Record<string, string> }
    expect(result.headers.Authorization).toBe('Bearer ghp_test')
  })

  it('request interceptor does not add Authorization when no token', () => {
    createGithubApi()
    const config = { headers: {} as Record<string, string> }
    const result = mocks.interceptors.requestFn!(config as Record<string, unknown>) as { headers: Record<string, string> }
    expect(result.headers.Authorization).toBeUndefined()
  })

  it('response interceptor updates rate limit from headers', () => {
    const api = createGithubApi()
    const response = {
      headers: {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4999',
        'x-ratelimit-reset': '1700000000'
      },
      data: {}
    }
    mocks.interceptors.responseFn!(response)
    expect(api.getRateLimit()).toEqual({ limit: 5000, remaining: 4999, reset: 1700000000 })
  })

  it('response interceptor sets null when headers are missing', () => {
    const api = createGithubApi()
    mocks.interceptors.responseFn!({ headers: {}, data: {} })
    expect(api.getRateLimit()).toEqual({ limit: null, remaining: null, reset: null })
  })

  // ── parseRepo ───────────────────────────────────────────────────────────
  it('throws on invalid repo format (no slash)', async () => {
    const api = createGithubApi()
    await expect(api.getRepo('noslash')).rejects.toThrow('Repository must be in "owner/repo" format')
  })

  it('throws on invalid repo format (empty name)', async () => {
    const api = createGithubApi()
    await expect(api.getRepo('owner/')).rejects.toThrow('Repository must be in "owner/repo" format')
  })

  // ── getRepo ─────────────────────────────────────────────────────────────
  it('getRepo calls correct endpoint and returns data', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({ data: { full_name: 'o/r' } })
    const api = createGithubApi()
    const result = await api.getRepo('o/r')
    expect(mocks.httpMock.get).toHaveBeenCalledWith('/repos/o/r')
    expect(result).toEqual({ full_name: 'o/r' })
  })

  // ── getBranches ─────────────────────────────────────────────────────────
  it('getBranches calls with pagination', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({ data: [{ name: 'main' }] })
    const api = createGithubApi()
    const result = await api.getBranches('o/r', 2)
    expect(mocks.httpMock.get).toHaveBeenCalledWith('/repos/o/r/branches', {
      params: { per_page: 100, page: 2 }
    })
    expect(result).toEqual([{ name: 'main' }])
  })

  it('getBranches uses default page 1', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({ data: [] })
    const api = createGithubApi()
    await api.getBranches('o/r')
    expect(mocks.httpMock.get).toHaveBeenCalledWith('/repos/o/r/branches', {
      params: { per_page: 100, page: 1 }
    })
  })

  // ── getContents ─────────────────────────────────────────────────────────
  it('getContents passes ref when branch is provided', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({ data: [{ name: 'a.yaml' }] })
    const api = createGithubApi()
    await api.getContents('o/r', 'path/to', 'dev')
    expect(mocks.httpMock.get).toHaveBeenCalledWith('/repos/o/r/contents/path/to', {
      params: { ref: 'dev' }
    })
  })

  it('getContents passes undefined params when no branch', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    await api.getContents('o/r', 'path/to')
    expect(mocks.httpMock.get).toHaveBeenCalledWith('/repos/o/r/contents/path/to', {
      params: undefined
    })
  })

  // ── getFileText ─────────────────────────────────────────────────────────
  it('getFileText uses rawHttp and default branch "main"', async () => {
    mocks.rawHttpMock.get.mockResolvedValueOnce({ data: 'yaml: content' })
    const api = createGithubApi()
    const result = await api.getFileText('o/r', 'path/file.yaml')
    expect(mocks.rawHttpMock.get).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/o/r/main/path/file.yaml'
    )
    expect(result).toEqual({ decodedContent: 'yaml: content' })
  })

  it('getFileText uses specified branch', async () => {
    mocks.rawHttpMock.get.mockResolvedValueOnce({ data: 'data' })
    const api = createGithubApi()
    await api.getFileText('o/r', 'f.yaml', 'dev')
    expect(mocks.rawHttpMock.get).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/o/r/dev/f.yaml'
    )
  })

  // ── putFile ─────────────────────────────────────────────────────────────
  it('putFile sends PUT with base64 content', async () => {
    mocks.httpMock.put.mockResolvedValueOnce({ data: { content: { sha: 'abc' } } })
    const api = createGithubApi()
    const result = await api.putFile({
      repo: 'o/r', path: 'f.yaml', content: 'hello', message: 'msg', sha: 'old', branch: 'main'
    })
    expect(mocks.httpMock.put).toHaveBeenCalledWith('/repos/o/r/contents/f.yaml', {
      message: 'msg', content: btoa(unescape(encodeURIComponent('hello'))), sha: 'old', branch: 'main'
    })
    expect(result).toEqual({ content: { sha: 'abc' } })
  })

  // ── deleteFile ──────────────────────────────────────────────────────────
  it('deleteFile sends DELETE with data', async () => {
    mocks.httpMock.delete.mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    await api.deleteFile({ repo: 'o/r', path: 'f.yaml', message: 'del', sha: 'sha1', branch: 'main' })
    expect(mocks.httpMock.delete).toHaveBeenCalledWith('/repos/o/r/contents/f.yaml', {
      data: { message: 'del', sha: 'sha1', branch: 'main' }
    })
  })

  // ── forkRepo ────────────────────────────────────────────────────────────
  it('forkRepo sends POST with organization', async () => {
    mocks.httpMock.post.mockResolvedValueOnce({ data: { full_name: 'user/r' } })
    const api = createGithubApi()
    const result = await api.forkRepo('o/r', 'myorg')
    expect(mocks.httpMock.post).toHaveBeenCalledWith('/repos/o/r/forks', { organization: 'myorg' })
    expect(result).toEqual({ full_name: 'user/r' })
  })

  it('forkRepo works without organization', async () => {
    mocks.httpMock.post.mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    await api.forkRepo('o/r')
    expect(mocks.httpMock.post).toHaveBeenCalledWith('/repos/o/r/forks', { organization: undefined })
  })

  // ── getBranchSHA ────────────────────────────────────────────────────────
  it('getBranchSHA returns the sha from nested response', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({ data: { object: { sha: 'abc123' } } })
    const api = createGithubApi()
    const sha = await api.getBranchSHA('o/r', 'main')
    expect(sha).toBe('abc123')
    expect(mocks.httpMock.get).toHaveBeenCalledWith('/repos/o/r/git/ref/heads/main')
  })

  // ── createBranch ────────────────────────────────────────────────────────
  it('createBranch sends POST with ref and sha', async () => {
    mocks.httpMock.post.mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    await api.createBranch('o/r', 'feature', 'sha1')
    expect(mocks.httpMock.post).toHaveBeenCalledWith('/repos/o/r/git/refs', {
      ref: 'refs/heads/feature', sha: 'sha1'
    })
  })

  // ── checkExistingFork ───────────────────────────────────────────────────
  it('checkExistingFork returns fork name when matching', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({
      data: { fork: true, parent: { full_name: 'owner/repo' } }
    })
    const api = createGithubApi()
    const result = await api.checkExistingFork('owner/repo', 'myuser')
    expect(result).toBe('myuser/repo')
  })

  it('checkExistingFork returns null for non-fork', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({
      data: { fork: false }
    })
    const api = createGithubApi()
    const result = await api.checkExistingFork('owner/repo', 'myuser')
    expect(result).toBeNull()
  })

  it('checkExistingFork returns null when parent does not match', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({
      data: { fork: true, parent: { full_name: 'other/repo' } }
    })
    const api = createGithubApi()
    const result = await api.checkExistingFork('owner/repo', 'myuser')
    expect(result).toBeNull()
  })

  it('checkExistingFork returns null on error (404)', async () => {
    mocks.httpMock.get.mockRejectedValueOnce({ response: { status: 404 } })
    const api = createGithubApi()
    const result = await api.checkExistingFork('owner/repo', 'myuser')
    expect(result).toBeNull()
  })

  // ── waitForFork ─────────────────────────────────────────────────────────
  it('waitForFork resolves immediately when getRepo succeeds', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    await api.waitForFork('user', 'repo')
  })

  it('waitForFork retries on failure then succeeds', async () => {
    vi.useFakeTimers()
    mocks.httpMock.get
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    const promise = api.waitForFork('user', 'repo', 30000)
    await vi.advanceTimersByTimeAsync(2100)
    await promise
    vi.useRealTimers()
  })

  it('waitForFork throws on timeout', async () => {
    const api = createGithubApi()
    // maxWaitMs=0: while condition is false immediately, throws without entering loop
    await expect(api.waitForFork('user', 'repo', 0)).rejects.toThrow('Timed out waiting for fork to be ready')
  })

  // ── syncForkBranch ──────────────────────────────────────────────────────
  it('syncForkBranch succeeds on normal merge', async () => {
    mocks.httpMock.post.mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    await api.syncForkBranch('user/repo', 'main')
    expect(mocks.httpMock.post).toHaveBeenCalledWith('/repos/user/repo/merge-upstream', { branch: 'main' })
  })

  it('syncForkBranch silently handles 409 (already up to date)', async () => {
    mocks.httpMock.post.mockRejectedValueOnce({ response: { status: 409 } })
    const api = createGithubApi()
    await api.syncForkBranch('user/repo', 'main') // should not throw
  })

  it('syncForkBranch rethrows non-409 errors', async () => {
    const error = { response: { status: 500 }, message: 'Internal Server Error' }
    mocks.httpMock.post.mockRejectedValueOnce(error)
    const api = createGithubApi()
    await expect(api.syncForkBranch('user/repo', 'main')).rejects.toBe(error)
  })

  it('syncForkBranch rethrows when error has no response', async () => {
    const error = new Error('Network error')
    mocks.httpMock.post.mockRejectedValueOnce(error)
    const api = createGithubApi()
    await expect(api.syncForkBranch('user/repo', 'main')).rejects.toBe(error)
  })

  // ── getCommit ───────────────────────────────────────────────────────────
  it('getCommit returns commit data with tree sha', async () => {
    mocks.httpMock.get.mockResolvedValueOnce({
      data: { sha: 'c1', tree: { sha: 't1' } }
    })
    const api = createGithubApi()
    const result = await api.getCommit('o/r', 'c1')
    expect(result).toEqual({ sha: 'c1', tree: { sha: 't1' } })
    expect(mocks.httpMock.get).toHaveBeenCalledWith('/repos/o/r/git/commits/c1')
  })

  // ── createTree ──────────────────────────────────────────────────────────
  it('createTree posts tree deletions and returns sha', async () => {
    mocks.httpMock.post.mockResolvedValueOnce({ data: { sha: 'newTree' } })
    const api = createGithubApi()
    const sha = await api.createTree('o/r', 'baseTree', ['file1.yaml', 'file2.yaml'])
    expect(sha).toBe('newTree')
    expect(mocks.httpMock.post).toHaveBeenCalledWith('/repos/o/r/git/trees', {
      base_tree: 'baseTree',
      tree: [
        { path: 'file1.yaml', mode: '100644', type: 'blob', sha: null },
        { path: 'file2.yaml', mode: '100644', type: 'blob', sha: null }
      ]
    })
  })

  // ── createCommit ────────────────────────────────────────────────────────
  it('createCommit posts and returns commit sha', async () => {
    mocks.httpMock.post.mockResolvedValueOnce({ data: { sha: 'newCommit' } })
    const api = createGithubApi()
    const sha = await api.createCommit('o/r', 'msg', 'treeSha', 'parentSha')
    expect(sha).toBe('newCommit')
    expect(mocks.httpMock.post).toHaveBeenCalledWith('/repos/o/r/git/commits', {
      message: 'msg', tree: 'treeSha', parents: ['parentSha']
    })
  })

  // ── updateBranchRef ─────────────────────────────────────────────────────
  it('updateBranchRef sends PATCH', async () => {
    mocks.httpMock.patch.mockResolvedValueOnce({ data: {} })
    const api = createGithubApi()
    await api.updateBranchRef('o/r', 'main', 'sha1')
    expect(mocks.httpMock.patch).toHaveBeenCalledWith('/repos/o/r/git/refs/heads/main', { sha: 'sha1' })
  })
})
