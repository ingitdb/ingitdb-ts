import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GithubApi } from '../github/github-api'
import type { Cache, RepoSettings } from '@ingitdb/client'

// repo-settings.ts only type-imports from @ingitdb/client (no idb side effect)
import {
  loadRepoSettings,
  getRequiredLanguages,
  getOptionalLanguages,
  getAllSupportedLanguages,
  type RepoSettingsDeps
} from './repo-settings'

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

function mockCache(): Cache {
  const store = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> { return (store.get(key) as T) ?? null },
    async set<T>(key: string, value: T): Promise<T> { store.set(key, value); return value },
    async delete(key: string) { store.delete(key) },
    async clear() { store.clear() }
  }
}

describe('loadRepoSettings', () => {
  let githubApi: GithubApi
  let cache: Cache
  let deps: RepoSettingsDeps

  beforeEach(() => {
    vi.clearAllMocks()
    githubApi = mockGithubApi()
    cache = mockCache()
    deps = { githubApi, cache }
  })

  it('returns empty when repo is empty string', async () => {
    const result = await loadRepoSettings('', 'main', false, deps)
    expect(result).toEqual({ languages: [] })
  })

  it('returns empty when deps is undefined', async () => {
    const result = await loadRepoSettings('owner/repo')
    expect(result).toEqual({ languages: [] })
  })

  it('parses settings from settings.yaml', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'languages:\n  - required: en\n  - optional: fr'
    })
    const result = await loadRepoSettings('owner/repo', 'main', false, deps)
    expect(result.languages).toEqual([{ required: 'en' }, { optional: 'fr' }])
  })

  it('uses default branch "main" when not specified', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'languages: []'
    })
    const result = await loadRepoSettings('owner/repo', undefined, false, deps)
    expect(result).toEqual({ languages: [] })
  })

  it('caches result on second call', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'languages:\n  - required: en'
    })
    await loadRepoSettings('owner/repo', 'main', false, deps)
    await loadRepoSettings('owner/repo', 'main', false, deps)
    expect(githubApi.getFileText).toHaveBeenCalledTimes(1)
  })

  it('skipCache=true bypasses cache', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'languages: []'
    })
    await loadRepoSettings('owner/repo', 'main', false, deps)
    await loadRepoSettings('owner/repo', 'main', true, deps)
    expect(githubApi.getFileText).toHaveBeenCalledTimes(2)
  })

  it('returns empty settings on 404 error', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { status: 404 }
    })
    const result = await loadRepoSettings('owner/repo', 'main', false, deps)
    expect(result).toEqual({ languages: [] })
  })

  it('rethrows non-404 errors', async () => {
    const error = { response: { status: 500 }, message: 'Server Error' }
    ;(githubApi.getFileText as ReturnType<typeof vi.fn>).mockRejectedValue(error)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(loadRepoSettings('owner/repo', 'main', true, deps)).rejects.toBe(error)
    consoleSpy.mockRestore()
  })

  it('handles null parsed result', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: ''
    })
    const result = await loadRepoSettings('owner/repo', 'dev', true, deps)
    expect(result).toEqual({ languages: [] })
  })

  it('handles non-array languages value', async () => {
    (githubApi.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue({
      decodedContent: 'languages: not-an-array'
    })
    const result = await loadRepoSettings('owner/repo', 'main', true, deps)
    expect(result).toEqual({ languages: [] })
  })
})

describe('getRequiredLanguages', () => {
  it('filters required languages', () => {
    const settings: RepoSettings = {
      languages: [{ required: 'en' }, { optional: 'fr' }, { required: 'de' }]
    }
    expect(getRequiredLanguages(settings)).toEqual(['en', 'de'])
  })

  it('returns empty for default (no arg)', () => {
    expect(getRequiredLanguages()).toEqual([])
  })

  it('returns empty for empty languages', () => {
    expect(getRequiredLanguages({ languages: [] })).toEqual([])
  })
})

describe('getOptionalLanguages', () => {
  it('filters optional languages', () => {
    const settings: RepoSettings = {
      languages: [{ required: 'en' }, { optional: 'fr' }, { optional: 'es' }]
    }
    expect(getOptionalLanguages(settings)).toEqual(['fr', 'es'])
  })

  it('returns empty for default (no arg)', () => {
    expect(getOptionalLanguages()).toEqual([])
  })
})

describe('getAllSupportedLanguages', () => {
  it('returns combined required and optional', () => {
    const settings: RepoSettings = {
      languages: [{ required: 'en' }, { optional: 'fr' }]
    }
    expect(getAllSupportedLanguages(settings)).toEqual(['en', 'fr'])
  })

  it('returns empty for default (no arg)', () => {
    expect(getAllSupportedLanguages()).toEqual([])
  })
})
