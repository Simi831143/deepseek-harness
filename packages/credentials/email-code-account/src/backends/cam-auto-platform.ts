/**
 * The cam-auto-platform backend: one company's HTTP shape behind {@link EmailCodeBackend}.
 *
 * It calls two Spring endpoints and reads one response envelope. Nothing above this file knows
 * the endpoints, the envelope, or that the credential happens to be a JWT — so replacing this
 * file with another issuer's shape is the whole cost of changing employers.
 */

import { EmailCodeError, type EmailCodeBackend, type EmailCodeGrant, type EmailCodeIdentity } from '../backend.ts'

/** Deployment of one issuer instance. */
export interface CamAutoPlatformOptions {
  /** HTTP origin of the platform, without a trailing slash, e.g. `http://172.24.126.100:8081`. */
  readonly baseUrl: string
  /** Deadline per request; the caller's signal may end it sooner. */
  readonly requestTimeoutMs: number
}

/** Login intent the platform expects; 1 registers, 2 signs in and creates the account when absent. */
const LOGIN_TYPE = 2

/** Shape of the platform's uniform response envelope. */
interface Envelope {
  readonly code?: unknown
  readonly success?: unknown
  readonly data?: unknown
  readonly message?: unknown
}

/** Compose the caller deadline with the per-request timeout. */
function deadline(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

/** POST one JSON body and return the parsed envelope. */
async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<Envelope> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    // A timeout, an abort, a DNS failure and a refused connection are one outcome for the caller.
    throw new EmailCodeError('network', `${url} unreachable: ${String(error)}`)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new EmailCodeError('invalid-response', `${url} did not answer with JSON: ${String(error)}`, response.status)
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new EmailCodeError('invalid-response', `${url} answered with ${typeof payload}`, response.status)
  }
  const envelope = payload as Envelope
  // The platform reports failure inside the envelope, so a 2xx alone is not success.
  if (!response.ok || envelope.success !== true) {
    throw new EmailCodeError('rejected', `${url} refused: ${JSON.stringify(envelope.message ?? envelope.code ?? response.status)}`, response.status)
  }
  return envelope
}

/**
 * Read the claims of a JWT without verifying it.
 *
 * The signature is the issuer's business: this only recovers the display identity and expiry the
 * issuer already put in the token for consumers, and never treats the claims as proof.
 * @param token - encoded token.
 * @returns decoded claims.
 */
function decodeClaims(token: string): Record<string, unknown> {
  const segments = token.split('.')
  if (segments.length !== 3 || segments[1] === undefined) {
    throw new EmailCodeError('invalid-response', 'token is not a three-segment JWT')
  }
  const padded = segments[1].replaceAll('-', '+').replaceAll('_', '/')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='), 'base64').toString('utf8'))
  } catch (error) {
    throw new EmailCodeError('invalid-response', `token payload is not JSON: ${String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new EmailCodeError('invalid-response', 'token payload is not an object')
  }
  return parsed as Record<string, unknown>
}

/** Read one string claim, treating an absent or non-string value as null. */
function stringClaim(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Build the backend for one cam-auto-platform deployment.
 * @param options - origin and per-request deadline.
 * @returns a backend the account provider can drive.
 */
export function createCamAutoPlatformBackend(options: CamAutoPlatformOptions): EmailCodeBackend {
  const base = options.baseUrl.replace(/\/+$/u, '')
  return {
    async requestCode(email, signal) {
      await postJson(`${base}/users/send-verification-code`, { email, type: LOGIN_TYPE }, deadline(signal, options.requestTimeoutMs))
    },
    async verifyCode(email, code, signal) {
      const envelope = await postJson(`${base}/users/verify-code-login`, { email, code }, deadline(signal, options.requestTimeoutMs))
      const token = (envelope.data as { token?: unknown } | null | undefined)?.token
      if (typeof token !== 'string' || token === '') {
        throw new EmailCodeError('invalid-response', 'login response carried no token')
      }
      const claims = decodeClaims(token)
      const identity: EmailCodeIdentity = {
        id: stringClaim(claims, 'sub') ?? email,
        name: stringClaim(claims, 'name'),
        contact: stringClaim(claims, 'email') ?? email,
      }
      const exp = claims.exp
      return {
        token,
        identity,
        expiresAt: typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null,
      } satisfies EmailCodeGrant
    },
  }
}
