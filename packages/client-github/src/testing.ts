import type { GithubApi, RateLimit } from './github/github-api'

/**
 * Creates a minimal no-op `GithubApi` for use in unit tests.
 * All methods return safe defaults. Override only the methods your test needs
 * to assert on or control — e.g. pass `vi.fn()` for specific methods.
 *
 * @example
 * const getBranchSHA = vi.fn().mockResolvedValue('abc123')
 * const api = createMockGithubApi({ getBranchSHA })
 */
export function createMockGithubApi(overrides: Partial<GithubApi> = {}): GithubApi {
  return {
    getRateLimit: (): RateLimit => ({ limit: null, remaining: null, reset: null }),
    getRepo: () => Promise.resolve({}),
    getBranches: () => Promise.resolve([]),
    getContents: () => Promise.resolve({}),
    getFileText: () => Promise.resolve({ decodedContent: '' }),
    putFile: () => Promise.resolve({}),
    deleteFile: () => Promise.resolve({}),
    forkRepo: () => Promise.resolve({}),
    getBranchSHA: () => Promise.resolve('mock-sha'),
    createBranch: () => Promise.resolve(),
    checkExistingFork: () => Promise.resolve(null),
    waitForFork: () => Promise.resolve(),
    syncForkBranch: () => Promise.resolve(),
    getCommit: () => Promise.resolve({ sha: 'mock-sha', tree: { sha: 'mock-tree-sha' } }),
    createTree: () => Promise.resolve('mock-tree-sha'),
    createCommit: () => Promise.resolve('mock-commit-sha'),
    updateBranchRef: () => Promise.resolve(),
    ...overrides,
  }
}
