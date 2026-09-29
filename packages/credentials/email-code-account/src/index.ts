/**
 * Email one-time-code account provider.
 *
 * It answers the shared account contract from one stored grant: identity and expiry come from the
 * claims the issuer minted at sign-in, so reporting state and profile never contacts the issuer.
 * The sign-in interaction itself belongs to the sign-in card and its Remote controller — this
 * provider deliberately implements no attempt state machine, because the account contract's one is
 * shaped for a browser round trip the email flow does not perform.
 */

import { platform, release } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import DeepSeekAccount, {
  type AccountClientMetadata,
  type AccountDetails,
  type AccountUserId,
  type AccountView,
  type PlatformSession,
  type SignInAttemptId,
} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-credentials'
import { ACCOUNT_KEY, clearAccount, readAccount, type EmailCodeAccountGrant } from './account-store.ts'

/** Deployments the composition may select; each value names one backend module. */
export type AccountBackendChoice = 'cam-auto-platform'

/** Account view with no marketing links: this provider has no wallet or usage page to offer. */
function viewOf(grant: EmailCodeAccountGrant | undefined): AccountView {
  return {
    status: grant === undefined ? 'signed-out' : 'credential-stored',
    links: { usageUrl: '', topUpUrl: '' },
    attempt: null,
  }
}

/** Provider serving {@link DeepSeekAccount} from an email one-time-code login. */
export default class EmailCodeAccount extends DeepSeekAccount {
  static inject = ['credentials']

  private readonly listeners = new Set<() => void>()
  private cached: EmailCodeAccountGrant | undefined
  private loaded = false

  /** @param ctx - Host with a credential store mounted. */
  constructor(ctx: Context) {
    super(ctx)
    // Any writer of our record — this provider's own sign-out, or the sign-in controller — makes
    // the next read miss the cache and wakes every watcher.
    ctx.on('credentials/record-updated', (key) => {
      if (key !== ACCOUNT_KEY) return
      this.loaded = false
      this.changed()
    })
  }

  /** Wake every open {@link watch} subscriber. */
  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  /** Read the stored grant, re-reading the store after any write to it. */
  private async grant(): Promise<EmailCodeAccountGrant | undefined> {
    if (this.loaded) return this.cached
    this.cached = await readAccount(this.ctx.credentials)
    this.loaded = true
    return this.cached
  }

  /**
   * Read stored-login presence.
   * @returns the snapshot; the attempt is always null because sign-in is driven by the card.
   */
  async getState(): Promise<AccountView> {
    return viewOf(await this.grant())
  }

  /**
   * Report the identity proved at sign-in, without contacting the issuer.
   * @param client - requesting UI; unused, as no per-client request is made.
   * @returns the profile, or null while signed out.
   */
  async getProfile(client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    void client
    const grant = await this.grant()
    if (grant === undefined) return null
    return {
      status: 'ready',
      value: {
        // The issuer's subject claim is the account key; the brand marks it as that kind of string.
        id: grant.identity.id as AccountUserId,
        name: grant.identity.name,
        contact: grant.identity.contact,
        avatarUrl: null,
      },
    }
  }

  /**
   * Report no wallet: email-code sign-in grants identity without a recharge balance.
   * @param client - requesting UI; unused.
   * @returns null, always.
   */
  async getBalance(client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    void client
    return null
  }

  /**
   * Report no bonus batches, for the same reason as {@link getBalance}.
   * @param client - requesting UI; unused.
   * @returns null, always.
   */
  async getUnnotifiedBonuses(client: AccountClientMetadata) { void client; return null }

  /**
   * Decline to acknowledge a bonus: none is ever offered.
   * @returns false, always.
   */
  async ackBonusNotified(): Promise<boolean> {
    return false
  }

  /**
   * Start signing in.
   *
   * The interaction is a form in the settings card, which collects the address and the code and
   * commits the grant itself; there is no browser round trip for this method to begin.
   * @param client - requesting UI; unused.
   * @param callbackOrigin - loopback origin the browser flow would return to; unused.
   * @param loginSource - initiating UI; unused.
   * @returns the unchanged snapshot.
   */
  async startSignIn(client: AccountClientMetadata, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView> {
    void client; void callbackOrigin; void loginSource
    return this.getState()
  }

  /**
   * Cancel a sign-in attempt; there is none to cancel.
   * @param id - attempt identity; unused.
   * @returns the unchanged snapshot.
   */
  async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    void id
    return this.getState()
  }

  /**
   * Remove the stored login.
   *
   * The issuer exposes no revocation endpoint, so local removal is the whole sign-out.
   * @param client - requesting UI; unused.
   * @returns the signed-out snapshot.
   */
  async signOut(client: AccountClientMetadata): Promise<AccountView> {
    void client
    await clearAccount(this.ctx.credentials)
    this.ctx.emit('deepseek-account/signed-out')
    this.loaded = false
    this.changed()
    return this.getState()
  }

  /**
   * Stream snapshots as the stored login changes.
   * @param signal - subscription lifetime; ending it never cancels a sign-in.
   * @returns complete snapshots, starting with the current one.
   */
  async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let wake: (() => void) | undefined
    const listener = (): void => { wake?.() }
    this.listeners.add(listener)
    try {
      yield await this.getState()
      while (!signal.aborted) {
        await new Promise<void>((resolve) => {
          wake = resolve
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        wake = undefined
        if (signal.aborted) return
        yield await this.getState()
      }
    } finally {
      this.listeners.delete(listener)
    }
  }

  /**
   * Resolve no inference credential: email sign-in identifies a person and nothing else, so the
   * model path keeps using its own configured key.
   * @returns undefined, always.
   */
  async resolveToken(): Promise<string | undefined> {
    return undefined
  }

  /**
   * Remove the stored login when the rejected token is the stored one.
   * @param token - token a consumer rejected.
   */
  async rejectToken(token: string): Promise<void> {
    const grant = await this.grant()
    if (grant === undefined || grant.token !== token) return
    await clearAccount(this.ctx.credentials)
    this.loaded = false
    this.changed()
  }

  /**
   * Report no embedded platform session: this provider embeds no issuer document.
   * @returns null, always.
   */
  async getPlatformSession(): Promise<PlatformSession | null> {
    return null
  }

  /**
   * Read the identity already stored, without creating anything.
   * @returns the account id when signed in, and the host OS identification.
   */
  async getDeviceIdentity(): Promise<{ userId?: AccountUserId; osVersion: string }> {
    const grant = await this.grant()
    return {
      ...grant === undefined ? {} : { userId: grant.identity.id as AccountUserId },
      osVersion: `${platform()} ${release()}`,
    }
  }
}

export {
  EmailCodeError,
  type EmailCodeBackend,
  type EmailCodeErrorKind,
  type EmailCodeGrant,
  type EmailCodeIdentity,
} from './backend.ts'
export { createCamAutoPlatformBackend, type CamAutoPlatformOptions } from './backends/cam-auto-platform.ts'
export { ACCOUNT_ISSUER, ACCOUNT_KEY, clearAccount, readAccount, writeAccount, type EmailCodeAccountGrant } from './account-store.ts'
export { Config, type EmailCodeAccountConfig } from './config.ts'
// The sign-in controller is part of this package's surface: the typert generator starts at the
// root export and follows imports, so a controller it cannot reach gets no wire artifacts.
export { default as EmailLoginController } from './remote.ts'
export type { EmailLoginResult } from './types.ts'
