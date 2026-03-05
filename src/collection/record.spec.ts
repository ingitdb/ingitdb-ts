import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GithubApi } from '../github/github-api'

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

// record.ts has no transitive idb dependency
import { loadRecord } from './record'

describe('loadRecord', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws when repo is empty', async () => {
    const githubApi = mockGithubApi()
    await expect(loadRecord('', 'path', undefined, { githubApi })).rejects.toThrow('repo and recordPath are required')
  })

  it('throws when recordPath is empty', async () => {
    const githubApi = mockGithubApi()
    await expect(loadRecord('owner/repo', '', undefined, { githubApi })).rejects.toThrow('repo and recordPath are required')
  })

  it('returns parsed YAML with _path and _sha', async () => {
    const githubApi = mockGithubApi({
      getFileText: vi.fn().mockResolvedValue({ decodedContent: 'name: France\ncode: FR', sha: 'abc123' })
    })
    const result = await loadRecord('owner/repo', 'countries/FR.yaml', undefined, { githubApi })
    expect(result).toEqual({ name: 'France', code: 'FR', _path: 'countries/FR.yaml', _sha: 'abc123' })
  })

  it('handles undefined sha from getFileText', async () => {
    const githubApi = mockGithubApi({
      getFileText: vi.fn().mockResolvedValue({ decodedContent: 'name: test' })
    })
    const result = await loadRecord('owner/repo', 'items/t.yaml', 'dev', { githubApi })
    expect(result._sha).toBeUndefined()
    expect(result.name).toBe('test')
    expect(result._path).toBe('items/t.yaml')
  })

  it('returns empty data when content is empty (parseYaml returns null)', async () => {
    const githubApi = mockGithubApi({
      getFileText: vi.fn().mockResolvedValue({ decodedContent: '' })
    })
    const result = await loadRecord('owner/repo', 'items/x.yaml', undefined, { githubApi })
    expect(result).toEqual({ _path: 'items/x.yaml', _sha: undefined })
  })
})
