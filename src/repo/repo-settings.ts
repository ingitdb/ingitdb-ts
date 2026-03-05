import type { GithubApi } from '../github/github-api'
import type { Cache } from '../cache/cache'
import { parseYaml } from '../utils/yaml'

const SETTINGS_TTL = 5 * 60 * 1000

interface LanguageEntry { required?: string; optional?: string }

export interface RepoSettings { languages: LanguageEntry[] }

export interface RepoSettingsDeps {
  githubApi: GithubApi
  cache: Cache
}

export async function loadRepoSettings(
  repo: string,
  branch = 'main',
  skipCache = false,
  deps?: RepoSettingsDeps
): Promise<RepoSettings> {
  if (!repo || !deps) return { languages: [] }
  const { githubApi, cache } = deps

  const cacheKey = `settings:${repo}:${branch}`
  if (!skipCache) {
    const cached = await cache.get<RepoSettings>(cacheKey)
    if (cached) return cached
  }
  try {
    const file = await githubApi.getFileText(repo, '.ingitdb/settings.yaml', branch)
    const parsed = parseYaml(file.decodedContent) as { languages?: LanguageEntry[] } | null
    const settings: RepoSettings = { languages: [] }
    if (parsed?.languages && Array.isArray(parsed.languages)) settings.languages = parsed.languages
    await cache.set(cacheKey, settings, SETTINGS_TTL)
    return settings
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) {
      const defaults: RepoSettings = { languages: [] }
      await cache.set(cacheKey, defaults, SETTINGS_TTL)
      return defaults
    }
    console.error('[loadRepoSettings]', err)
    throw err
  }
}

export function getRequiredLanguages(settings: RepoSettings = { languages: [] }): string[] {
  return settings.languages
    .filter((l): l is LanguageEntry & { required: string } => Boolean(l?.required))
    .map((l) => l.required)
}

export function getOptionalLanguages(settings: RepoSettings = { languages: [] }): string[] {
  return settings.languages
    .filter((l): l is LanguageEntry & { optional: string } => Boolean(l?.optional))
    .map((l) => l.optional)
}

export function getAllSupportedLanguages(settings: RepoSettings = { languages: [] }): string[] {
  return [...getRequiredLanguages(settings), ...getOptionalLanguages(settings)]
}
