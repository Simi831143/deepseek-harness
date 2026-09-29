/**
 * The one seam between the email-code sign-in and whatever issues the credential.
 *
 * Everything above this module (the account provider, the credential store, the sign-in form)
 * is backend-agnostic; everything below it is one company's HTTP shape. Replacing the issuer —
 * another company, or a self-hosted mailbox — means writing one more implementation of
 * {@link EmailCodeBackend} and pointing `backend` at it.
 */

import type { EmailCodeIdentity } from './types.ts'

/** Identity of the account a credential belongs to; declared in `./types` for the Remote boundary. */
export type { EmailCodeIdentity } from './types.ts'

/** Credential one verified code yields. */
export interface EmailCodeGrant {
  /** Token the issuer minted; stored verbatim and never interpreted here. */
  readonly token: string
  /** Identity of the account the token belongs to. */
  readonly identity: EmailCodeIdentity
  /** Expiry the token declares, in epoch milliseconds, or null when it declares none. */
  readonly expiresAt: number | null
}

/** Failure kinds a caller can act on; every other rejection is reported as `rejected`. */
export type EmailCodeErrorKind =
  /** The issuer could not be reached, or the request exceeded its deadline. */
  | 'network'
  /** The issuer answered and refused: a wrong or expired code, an unknown account. */
  | 'rejected'
  /** The issuer answered with something this backend cannot use. */
  | 'invalid-response'

/** Failure raised by a backend, carrying the kind its caller maps onto a sign-in error. */
export class EmailCodeError extends Error {
  /** Failure kind; see {@link EmailCodeErrorKind}. */
  readonly kind: EmailCodeErrorKind
  /** HTTP status when the issuer answered, otherwise undefined. */
  readonly status: number | undefined

  /**
   * @param kind - failure kind.
   * @param message - operator-facing detail; the UI never shows issuer text verbatim.
   * @param status - HTTP status when the issuer answered.
   */
  constructor(kind: EmailCodeErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'EmailCodeError'
    this.kind = kind
    this.status = status
  }
}

/**
 * Issue an email code and exchange it for a credential.
 *
 * Both calls are one-shot and take the caller's deadline: the provider owns retry policy by
 * deciding whether to call again, and never leaves an unowned timer behind.
 */
export interface EmailCodeBackend {
  /**
   * Ask the issuer to mail a one-time code to this address.
   * @param email - account address the code is mailed to.
   * @param signal - caller deadline; aborting rejects with an {@link EmailCodeError} of kind `network`.
   * @returns after the issuer accepted the request, not after the mail arrived.
   */
  requestCode(email: string, signal: AbortSignal): Promise<void>
  /**
   * Exchange a one-time code for a credential.
   * @param email - the same address the code was mailed to.
   * @param code - the one-time code the user read from the mail.
   * @param signal - caller deadline; aborting rejects with an {@link EmailCodeError} of kind `network`.
   * @returns the credential and the identity it belongs to.
   */
  verifyCode(email: string, code: string, signal: AbortSignal): Promise<EmailCodeGrant>
}
