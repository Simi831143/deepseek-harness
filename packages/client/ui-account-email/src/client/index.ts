/**
 * The email sign-in card, browser half: one page in the Settings panel over the
 * `emailLogin` Remote namespace the email-code account package serves, plus the
 * stored login's identity read from the shared `account` namespace.
 *
 * The card owns the whole interaction. The account contract's attempt state
 * machine models a browser round trip, which an email code never performs, so
 * this plugin drives the two steps itself and lets the Host's credential write
 * be the only thing the account provider sees.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the Settings SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the renderer plugin's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the generated namespace faces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { AccountClientMetadata, AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { EmailLoginCard, type EmailLoginFace, type EmailLoginSession } from './EmailLoginCard.tsx'
import { en, zh, type AccountEmailKey } from './locales.ts'

export type { EmailLoginCardProps, EmailLoginFace, EmailLoginIdentity, EmailLoginSession } from './EmailLoginCard.tsx'
export type { AccountEmailKey } from './locales.ts'

/** Dictionary namespace owned by this card. */
export const NS = 'settings.accountEmail'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Email sign-in card copy. */
    'settings.accountEmail': AccountEmailKey
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.account', 'remote.emailLogin']

/**
 * Mount the email sign-in card into the Settings panel.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-account-email: dictionaries')
  const t = ctx.locale.bind(NS)
  let session: EmailLoginSession = { status: 'loading', identity: null, failed: false }
  const listeners = new Set<() => void>()
  const publish = (next: EmailLoginSession): void => {
    session = next
    for (const listener of listeners) listener()
  }
  /**
   * Identity of the requesting UI. The email provider ignores it — no Platform
   * request is made — so a build without a version still reports its login
   * rather than failing the read.
   * @returns the metadata the shared account namespace requires.
   */
  const client = (): AccountClientMetadata => ({
    version: process.env.DSH_CLIENT_VERSION ?? '',
    locale: ctx.locale.getSnapshot().active,
    // Date.getTimezoneOffset reports minutes west of UTC; Platform wants seconds east.
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })
  // Reads race: a sign-out during a profile read must not resurrect the name.
  let generation = 0
  const readIdentity = async (): Promise<void> => {
    const revision = ++generation
    try {
      const result = await ctx.remote.account.getProfile(client())
      if (revision !== generation) return
      const profile = result.ok && result.value !== null && result.value.status === 'ready' ? result.value.value : undefined
      publish({
        status: 'signed-in', failed: false,
        identity: profile === undefined ? null : { name: profile.name, contact: profile.contact },
      })
    } catch {
      // A failed identity read is not a failed sign-in: the credential is stored,
      // so the card keeps reporting the login and only drops the name.
      if (revision === generation) publish({ status: 'signed-in', identity: null, failed: false })
    }
  }
  let disposed = false
  const stream = ctx.remote.$stream<AccountView>({
    name: 'account',
    open: signal => ctx.remote.account.watch(signal),
    ended: () => new Error('account stream ended'),
  })
  ctx.effect(() => () => { disposed = true; return stream.dispose() }, 'ui-account-email: account state stream')
  void (async () => {
    for await (const frame of stream) {
      frame.accept()
      if (frame.value.status !== 'credential-stored') {
        generation++
        publish({ status: 'signed-out', identity: null, failed: false })
        continue
      }
      publish({ status: 'signed-in', identity: session.identity, failed: false })
      void readIdentity()
    }
  })().catch(() => { if (!disposed) publish({ status: 'signed-out', identity: null, failed: true }) })
  const face: EmailLoginFace = {
    hooks: {
      session: {
        getSnapshot: () => session,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
    },
    async requestCode(email) {
      const result = await ctx.remote.emailLogin.requestCode(email)
      if (!result.ok) throw result.error
    },
    async verifyCode(email, code) {
      const result = await ctx.remote.emailLogin.verifyCode(email, code)
      if (!result.ok) throw result.error
    },
    async signOut() {
      const result = await ctx.remote.account.signOut(client())
      if (!result.ok) throw result.error
    },
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'email-login', order: -9, label: () => t('nav'), locale: NS, inject: () => face,
  }, EmailLoginCard))
}
