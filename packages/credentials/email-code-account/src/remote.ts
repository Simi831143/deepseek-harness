/**
 * The sign-in actions the settings card calls.
 *
 * The account contract has no method for handing a code to the Host — it is shaped for a browser
 * round trip — so the two steps of an email sign-in live here instead, on their own Remote
 * namespace. This controller owns the issuer backend; the account provider only reads the grant
 * this controller commits, which is why the two never import each other.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-credentials'
import { writeAccount } from './account-store.ts'
import { createCamAutoPlatformBackend } from './backends/cam-auto-platform.ts'
import type { EmailCodeBackend } from './backend.ts'
import type { EmailLoginResult } from './types.ts'
import { Config, type EmailCodeAccountConfig } from './config.ts'
import { ACCOUNT_ISSUER } from './account-store.ts'

/** Remote controller for the two steps of an email one-time-code sign-in. */
export default class EmailLoginController extends TypertRemoteService {
  static inject = ['credentials']

  private readonly backend: EmailCodeBackend

  /**
   * @param ctx - Host with a credential store mounted.
   * @param config - deployment choices; see {@link Config}.
   */
  constructor(ctx: Context, config: EmailCodeAccountConfig = Config({})) {
    super(ctx, 'emailLoginController', { namespace: 'emailLogin' })
    const resolved = Config(config)
    if (resolved.backend !== 'cam-auto-platform') throw new Error(`email login: unknown backend ${String(resolved.backend)}`)
    this.backend = createCamAutoPlatformBackend({ baseUrl: resolved.baseUrl, requestTimeoutMs: resolved.requestTimeoutMs })
  }

  /**
   * Ask the issuer to mail a one-time code.
   * @param email - address to send to.
   * @returns after the issuer accepted the request; the caller starts its resend countdown here.
   */
  @Remote
  async requestCode(email: string): Promise<void> {
    const deadline = new AbortController()
    try {
      await this.backend.requestCode(email, deadline.signal)
    } finally {
      deadline.abort()
    }
  }

  /**
   * Exchange a one-time code for the stored login.
   *
   * The commit is what makes the account provider report a signed-in state, and the issuer token
   * stays in the credential store rather than travelling back to the page.
   * @param email - the address the code was sent to.
   * @param code - the code the user read from the mail.
   * @returns the identity that was proved.
   */
  @Remote
  async verifyCode(email: string, code: string): Promise<EmailLoginResult> {
    const deadline = new AbortController()
    try {
      const grant = await this.backend.verifyCode(email, code, deadline.signal)
      await writeAccount(this.ctx.credentials, {
        version: 1,
        token: grant.token,
        issuer: ACCOUNT_ISSUER,
        identity: grant.identity,
        expiresAt: grant.expiresAt,
      })
      return { identity: grant.identity }
    } finally {
      deadline.abort()
    }
  }
}
