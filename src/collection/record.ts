import type { GithubApi } from '../github/github-api'
import { parseYaml } from '../utils/yaml'

export interface RecordData {
  _path: string
  _sha?: string
  [key: string]: unknown
}

export interface RecordDeps {
  githubApi: GithubApi
}

/**
 * Loads a single record file from the repository.
 * Returns the parsed record data with `_path` and optional `_sha` metadata.
 */
export const loadRecord = async (
  repo: string,
  recordPath: string,
  branch: string | undefined,
  deps: RecordDeps
): Promise<RecordData> => {
  if (!repo || !recordPath) throw new Error('repo and recordPath are required')
  const { githubApi } = deps
  const file = await githubApi.getFileText(repo, recordPath, branch)
  const text = file.decodedContent
  const parsed = (parseYaml(text) as Record<string, unknown>) || {}
  return { ...parsed, _path: recordPath, _sha: file.sha }
}
