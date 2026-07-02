import { describe, it, expect } from 'vitest'
import { createGithubApi } from './github-api'

// ---------------------------------------------------------------------------
// Live regression test for the private-repo file-body-read bug.
//
// Before the fix, `getFileText` always hit unauthenticated
// raw.githubusercontent.com, which 404s on private repos even when a valid
// token is configured — silently breaking reads for private vaults (the
// entire point of OpenVaultDB). This test hits a real private GitHub repo
// (trakhimenok/ovdb-test-vault, branch `poc/live-contact`) to prove the
// authenticated Contents API path actually works end-to-end.
//
// Skipped automatically when no token is available, so it never fails CI /
// other contributors' local runs. To run it locally:
//   INGITDB_TEST_GITHUB_TOKEN=$(gh auth token) pnpm -C packages/client-github test:run
// ---------------------------------------------------------------------------

const token = process.env.INGITDB_TEST_GITHUB_TOKEN

describe.skipIf(!token)('createGithubApi (live, private repo)', () => {
  it('reads a file body from a private repo via the authenticated Contents API', async () => {
    const api = createGithubApi(token)
    const result = await api.getFileText(
      'trakhimenok/ovdb-test-vault',
      'contacts/$records/contact-jane-doe.json',
      'poc/live-contact'
    )
    const record = JSON.parse(result.decodedContent) as { email?: string; firstName?: string; lastName?: string }
    expect(record.firstName).toBe('Jane')
    expect(record.lastName).toBe('Doe')
    expect(record.email).toBe('jane@example.com')
    expect(result.sha).toBeTruthy()
  })
})
