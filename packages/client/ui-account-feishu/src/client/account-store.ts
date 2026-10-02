/**
 * One Feishu account session per client: the Host state stream, the profile
 * read that follows a stored grant, and the sign-in operations. The sidebar
 * menu and the Settings page both read this store, so they cannot disagree.
 */
import type { AccountClientMetadata, AccountDetails, AccountProfile, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Display state of the Feishu account. */
export interface FeishuSession {
  /** Latest Host state; absent until the stream answers. */
  readonly view: AccountView | undefined
  /** Display identity of the stored account; absent while loading or signed out. */
  readonly profile: AccountProfile | undefined
  /** Whether the state stream ended unexpectedly. */
  readonly failed: boolean
}

/** Result of one account Remote call. */
export type AccountResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }

/** The account Remote calls this store needs. */
export interface FeishuAccountRemote {
  /** @returns the reconnecting state stream; each item must be accepted after it is read. */
  watch(): AsyncIterable<{ readonly value: AccountView; accept(): void }>
  getProfile(client: AccountClientMetadata): Promise<AccountResult<AccountDetails['profile'] | null>>
  startSignIn(client: AccountClientMetadata, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountResult<AccountView>>
  cancelSignIn(id: SignInAttemptId): Promise<AccountResult<AccountView>>
  signOut(client: AccountClientMetadata): Promise<AccountResult<AccountView>>
}

/** Store operations injected into the account components. */
export interface FeishuAccountActions {
  /** @returns after the Host has an attempt; a stored account stays until the new sign-in commits. */
  signIn(): Promise<void>
  /** @returns after the current attempt settles. */
  cancel(): Promise<void>
  /** @returns after the stored Feishu grant is removed. */
  signOut(): Promise<void>
}

/** The store's lifetime handle and its observable. */
export interface FeishuAccountStore extends FeishuAccountActions {
  readonly session: HostObservable<FeishuSession>
  /** Stop publishing and drop pending reads; the stream owner closes the stream. */
  dispose(): void
}

/** Where Feishu returns the browser, and which surface asked. */
export interface SignInTarget { readonly origin: string; readonly source: 'web' | 'desktop' }

/**
 * Resolve the OAuth callback origin. Desktop serves this page from its own
 * scheme and publishes the Host's loopback origin as the shell transport's
 * stream base; the served Web app is the Host origin itself.
 * @returns callback origin and login source for this page.
 */
export function signInTarget(): SignInTarget {
  const transport = (globalThis as typeof globalThis & { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__
  return transport?.streamBaseUrl === undefined
    ? { origin: window.location.origin, source: 'web' }
    : { origin: new URL(transport.streamBaseUrl).origin, source: 'desktop' }
}

/** @param value - Remote outcome. @returns its value. @throws the Remote error when the call was refused. */
function unwrap<T>(value: AccountResult<T>): T {
  if (!value.ok) throw value.error instanceof Error ? value.error : new Error('feishu account: request refused')
  return value.value
}

/**
 * Follow the account stream and keep the profile in step with the stored grant.
 * @param remote - account Remote calls.
 * @param client - identity of the requesting UI, sampled per call.
 * @param target - callback origin resolver, sampled per sign-in.
 * @returns the store; the caller disposes it with the plugin.
 */
export function createFeishuAccountStore(
  remote: FeishuAccountRemote, client: () => AccountClientMetadata, target: () => SignInTarget = signInTarget,
): FeishuAccountStore {
  let session: FeishuSession = { view: undefined, profile: undefined, failed: false }
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = (next: FeishuSession): void => {
    if (disposed) return
    session = next
    for (const listener of listeners) listener()
  }
  let generation = 0
  const readProfile = async (): Promise<void> => {
    const revision = ++generation
    let profile: AccountProfile | undefined
    try {
      const result = unwrap(await remote.getProfile(client()))
      profile = result?.status === 'ready' ? result.value : undefined
    } catch (_failed) { profile = undefined } // An unreadable profile still shows the signed-in state.
    if (revision === generation) publish({ ...session, profile })
  }
  void (async () => {
    let storedGrant = false
    for await (const frame of remote.watch()) {
      frame.accept()
      const stored = frame.value.status === 'credential-stored'
      // A finished sign-in may have replaced the account, so its profile is read again.
      const replaced = stored && frame.value.attempt?.phase === 'succeeded' && session.view?.attempt?.phase !== 'succeeded'
      if (!stored) generation++
      publish({ view: frame.value, profile: stored ? session.profile : undefined, failed: false })
      if (stored && (!storedGrant || replaced)) void readProfile()
      storedGrant = stored
    }
  })().catch(() => { publish({ ...session, failed: true }) })
  return {
    session: {
      getSnapshot: () => session,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    async signIn() {
      const { origin, source } = target()
      unwrap(await remote.startSignIn(client(), origin, source))
    },
    async cancel() {
      const attempt = session.view?.attempt
      if (attempt === null || attempt === undefined) return
      unwrap(await remote.cancelSignIn(attempt.id))
    },
    async signOut() { unwrap(await remote.signOut(client())) },
    dispose() { disposed = true; generation++ },
  }
}
