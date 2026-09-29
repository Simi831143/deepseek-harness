import { describe, expect, it } from 'vitest'
import { credentialKey, type CredentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ACCOUNT_ISSUER, ACCOUNT_KEY, clearAccount, readAccount, writeAccount } from '../src/account-store.ts'

/** Credential store stand-in covering the three calls this package makes. */
function store(initial?: CredentialRecord): { credentials: CredentialProvider; records: Map<CredentialKey, CredentialRecord> } {
  const records = new Map<CredentialKey, CredentialRecord>()
  if (initial !== undefined) records.set(ACCOUNT_KEY, initial)
  const credentials = {
    async readRecord(key: CredentialKey) { return records.get(key) },
    async modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
      const next = await mutate(records.get(key))
      if (next === undefined) return records.get(key)
      records.set(key, next)
      return next
    },
    async deleteRecord(key: CredentialKey) { records.delete(key) },
  } as unknown as CredentialProvider
  return { credentials, records }
}

const GRANT = {
  version: 1 as const,
  token: 'header.payload.signature',
  issuer: ACCOUNT_ISSUER,
  identity: { id: 'someone@example.com', name: 'someone', contact: 'someone@example.com' },
  expiresAt: 1_794_247_580_000,
}

describe('email-code account store', () => {
  it('round-trips one login under its own key', async () => {
    const { credentials, records } = store()

    await writeAccount(credentials, GRANT)

    expect([...records.keys()]).toEqual([ACCOUNT_KEY])
    // The address is this provider's own scope, so a DeepSeek grant in another scope is untouched.
    expect(ACCOUNT_KEY).not.toBe(credentialKey('deepseek-account-platform', 'default'))
    expect(await readAccount(credentials)).toEqual(GRANT)
  })

  it('ignores a grant another provider wrote to the same key', async () => {
    const { credentials } = store({ kind: 'grant', payload: { version: 1, token: 't', issuer: 'someone-else' } })

    expect(await readAccount(credentials)).toBeUndefined()
  })

  it('ignores a payload without a usable token, and a record that is not a grant', async () => {
    const missingToken = store({ kind: 'grant', payload: { version: 1, issuer: ACCOUNT_ISSUER } })
    const apiKey = store({ kind: 'api-key', payload: { version: 1, key: 'sk-test' } } as CredentialRecord)

    expect(await readAccount(missingToken.credentials)).toBeUndefined()
    expect(await readAccount(apiKey.credentials)).toBeUndefined()
  })

  it('clears the login and treats an absent one as cleared', async () => {
    const { credentials, records } = store()
    await writeAccount(credentials, GRANT)

    await clearAccount(credentials)
    await clearAccount(credentials)

    expect(records.size).toBe(0)
    expect(await readAccount(credentials)).toBeUndefined()
  })
})
