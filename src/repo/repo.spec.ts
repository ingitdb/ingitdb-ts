import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GithubApi } from '../github/github-api'

// repo.ts has no transitive idb dependency
import { loadRepoMeta } from './repo'

function mockGithubApi(overrides: Partial<GithubApi> = {}): GithubApi {
  return {
    getRateLimit: () => ({ limit: null, remaining: null, reset: null }),
    getRepo: vi.fn(), getBranches: vi.fn(), getContents: vi.fn(), getFileText: vi.fn(),
    putFile: vi.fn(), deleteFile: vi.fn(), forkRepo: vi.fn(), getBranchSHA: vi.fn(),
    createBranch: vi.fn(), checkExistingFork: vi.fn(), waitForFork: vi.fn(),
    syncForkBranch: vi.fn(), getCommit: vi.fn(), createTree: vi.fn(),
    createCommit: vi.fn(), updateBranchRef: vi.fn(),
    ...overrides
  }
}

describe('loadRepoMeta', () => {
  let githubApi: GithubApi

  beforeEach(() => {
    vi.clearAllMocks()
    githubApi = mockGithubApi()
  })

  it('throws when repo is empty', async () => {
    await expect(loadRepoMeta('', { githubApi })).rejects.toThrow('Repository is required')
  })

  it('returns repo metadata from API', async () => {
    (githubApi.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ permissions: { push: true }, full_name: 'o/r1' })
    const result = await loadRepoMeta('o/r1', { githubApi })
    expect(result).toEqual({ permissions: { push: true }, full_name: 'o/r1' })
  })

  it('caches result for same repo (API called once)', async () => {
    (githubApi.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ permissions: { push: false } })
    await loadRepoMeta('owner/cached-repo', { githubApi })
    await loadRepoMeta('owner/cached-repo', { githubApi })
    expect(githubApi.getRepo).toHaveBeenCalledTimes(1)
  })

  it('sets canWrite correctly when permissions.push is boolean true', async () => {
    (githubApi.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ permissions: { push: true } })
    const result = await loadRepoMeta('owner/write-yes', { githubApi })
    expect(result.permissions?.push).toBe(true)
  })

  it('sets canWrite correctly when permissions.push is boolean false', async () => {
    (githubApi.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ permissions: { push: false } })
    const result = await loadRepoMeta('owner/write-no', { githubApi })
    expect(result.permissions?.push).toBe(false)
  })

  it('handles missing permissions (canWrite = null)', async () => {
    (githubApi.getRepo as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'test' })
    const result = await loadRepoMeta('owner/no-perms', { githubApi })
    expect(result.permissions).toBeUndefined()
  })
})
