/**
 * Boundary types of the email sign-in Remote.
 *
 * The typert generator requires every type that crosses a Remote boundary to be reachable from a
 * public non-root subpath, which is why these declarations live here and are re-exported through
 * `./types` rather than only from the package root.
 */

/** Identity a backend reports for the account that just proved a code. */
export interface EmailCodeIdentity {
  /** Stable account identifier the issuer assigned; used as the account key. */
  readonly id: string
  /** Display name, when the issuer reports one. */
  readonly name: string | null
  /** Contact address of the account, normally the email the code was sent to. */
  readonly contact: string | null
}

/** Display-safe result of a completed sign-in; the token itself never leaves the Host. */
export interface EmailLoginResult {
  /** Identity the issuer proved for this address. */
  readonly identity: EmailCodeIdentity
}

/** Login intent the platform expects; 1 registers, 2 signs in and creates the account when absent. */
export const LOGIN_TYPE = 2
