import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account/types'
import { createFeishuAccountStore, type FeishuAccountActions, type FeishuSession } from './account-store.ts'
import { FeishuAccountMenu } from './FeishuAccountMenu.tsx'
import { FeishuAccountSection } from './FeishuAccountSection.tsx'
import { en, zh, type FeishuAccountKey } from './locales.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Locale namespace owned by the Feishu account UI. */
export const NS = 'settings.accountFeishu'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Feishu account copy. */ 'settings.accountFeishu': FeishuAccountKey }
}

/** Services required by the Feishu account UI. */
export const inject = ['slots', 'locale', 'remote', 'remote.account']

/** Operations and state shared by the sidebar menu and the Settings section. */
export interface FeishuAccountFace extends FeishuAccountActions {
  hooks: { session: HostObservable<FeishuSession> }
}

/**
 * Mount the Feishu account menu in the sidebar launcher seat and the account page in Settings.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-account-feishu: dictionaries')
  const client = (): AccountClientMetadata => ({
    version: process.env.DSH_CLIENT_VERSION ?? '', locale: ctx.locale.getSnapshot().active,
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })
  const stream = ctx.remote.$stream({
    name: 'feishu-account', open: signal => ctx.remote.account.watch(signal), ended: () => new Error('account stream ended'),
  })
  const store = createFeishuAccountStore({
    watch: () => stream,
    getProfile: value => ctx.remote.account.getProfile(value),
    startSignIn: (value, origin, source) => ctx.remote.account.startSignIn(value, origin, source),
    cancelSignIn: id => ctx.remote.account.cancelSignIn(id),
    signOut: value => ctx.remote.account.signOut(value),
  }, client)
  ctx.effect(() => () => { store.dispose(); return stream.dispose() }, 'ui-account-feishu: account state stream')
  const face: FeishuAccountFace = {
    hooks: { session: store.session },
    signIn: () => store.signIn(), cancel: () => store.cancel(), signOut: () => store.signOut(),
  }
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher', locale: NS, inject: () => face,
  }, FeishuAccountMenu))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'account', order: -10, label: () => ctx.locale.bind(NS)('nav'), locale: NS, inject: () => face,
  }, FeishuAccountSection))
}
