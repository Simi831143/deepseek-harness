/** The stored credential: one grant record holding the issuer token and the identity it proved. */

import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { EmailCodeIdentity } from './backend.ts'

/** Storage address of this provider's login. Its own scope keeps a DeepSeek grant untouched. */
export const ACCOUNT_KEY = credentialKey('email-code-account', 'default')

/** Marker stored with the payload so another writer's grant is never read as ours. */
export const ACCOUNT_ISSUER = 'email-code-account'

/** Payload of one stored login. */
export interface EmailCodeAccountGrant {
  /** Payload generation; a future shape bumps this and is ignored by this reader. */
  readonly version: 1
  /** Token the issuer minted, presented verbatim on later platform calls. */
  readonly token: string
  /** Writer identity, so a record from another provider is not mistaken for this one. */
  readonly issuer: string
  /** Identity proved at sign-in; read for display without contacting the issuer. */
  readonly identity: EmailCodeIdentity
  /** Expiry the token declared, in epoch milliseconds, or null when it declared none. */
  readonly expiresAt: number | null
}

/** Read one grant payload, ignoring anything this provider did not write. */
function asGrant(payload: unknown): EmailCodeAccountGrant | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const candidate = payload as Partial<EmailCodeAccountGrant>
  if (candidate.version !== 1 || candidate.issuer !== ACCOUNT_ISSUER) return undefined
  if (typeof candidate.token !== 'string' || candidate.token === '') return undefined
  const identity = candidate.identity
  if (typeof identity !== 'object' || identity === null || typeof identity.id !== 'string') return undefined
  return {
    version: 1,
    token: candidate.token,
    issuer: ACCOUNT_ISSUER,
    identity: {
      id: identity.id,
      name: typeof identity.name === 'string' ? identity.name : null,
      contact: typeof identity.contact === 'string' ? identity.contact : null,
    },
    expiresAt: typeof candidate.expiresAt === 'number' ? candidate.expiresAt : null,
  }
}

/**
 * Read the stored login.
 * @param credentials - credential store holding every provider's records.
 * @returns the stored grant, or undefined while signed out.
 */
export async function readAccount(credentials: CredentialProvider): Promise<EmailCodeAccountGrant | undefined> {
  const record = await credentials.readRecord(ACCOUNT_KEY)
  if (record === undefined || record.kind !== 'grant') return undefined
  return asGrant(record.payload)
}

/**
 * Store one login, replacing whatever this provider held before.
 * @param credentials - credential store; its serialized read-modify-write is the only write path.
 * @param grant - the login to store.
 */
export async function writeAccount(credentials: CredentialProvider, grant: EmailCodeAccountGrant): Promise<void> {
  await credentials.modifyRecord(ACCOUNT_KEY, async () => ({ kind: 'grant', payload: { ...grant, issuer: ACCOUNT_ISSUER } }))
}

/**
 * Remove the stored login; removing an absent one is a no-op.
 * @param credentials - credential store.
 */
export async function clearAccount(credentials: CredentialProvider): Promise<void> {
  await credentials.deleteRecord(ACCOUNT_KEY)
}
