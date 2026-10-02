// @vitest-environment jsdom
/** Feishu account store: stream projection, profile reads, sign-in targets, and switch semantics. */
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountDetails, AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import { createFeishuAccountStore, signInTarget, type FeishuAccountRemote } from '../src/client/account-store.ts'

const links = { usageUrl: '', topUpUrl: '' }
const signedOut: AccountView = { status: 'signed-out', links, attempt: null }
const stored: AccountView = { status: 'credential-stored', links, attempt: null }
const profile = (name: string): AccountDetails['profile'] => ({ status: 'ready', value: { id: null, name, contact: `${name}@example.test`, avatarUrl: null } })
const client = () => ({ version: 'test', locale: 'zh', timezoneOffsetSeconds: 28_800 })

/** A manually driven account stream with spyable Remote calls. */
function remote() {
  const frames: Array<(value: AccountView) => void> = []
  const queue: AccountView[] = []
  let wake: (() => void) | undefined
  const push = (value: AccountView): void => { queue.push(value); wake?.() }
  const api = {
    watch: () => ({
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (queue.length > 0) yield { value: queue.shift()!, accept: vi.fn() }
          await new Promise<void>((resolve) => { wake = resolve })
        }
      },
    }),
    getProfile: vi.fn<FeishuAccountRemote['getProfile']>(async () => ({ ok: true, value: profile('Ada') })),
    startSignIn: vi.fn<FeishuAccountRemote['startSignIn']>(async () => ({ ok: true, value: signedOut })),
    cancelSignIn: vi.fn<FeishuAccountRemote['cancelSignIn']>(async () => ({ ok: true, value: signedOut })),
    signOut: vi.fn<FeishuAccountRemote['signOut']>(async () => ({ ok: true, value: signedOut })),
  } satisfies FeishuAccountRemote
  return { api, push, frames }
}

afterEach(() => { vi.unstubAllGlobals() })

it('reads the profile once per stored grant and drops it on sign-out', async () => {
  const fake = remote()
  const store = createFeishuAccountStore(fake.api, client)
  fake.push(stored)
  await vi.waitFor(() => { expect(store.session.getSnapshot().profile?.name).toBe('Ada') })
  fake.push({ ...stored, attempt: null })
  await vi.waitFor(() => { expect(store.session.getSnapshot().view).toEqual(stored) })
  expect(fake.api.getProfile).toHaveBeenCalledOnce()
  fake.push(signedOut)
  await vi.waitFor(() => { expect(store.session.getSnapshot().view?.status).toBe('signed-out') })
  expect(store.session.getSnapshot().profile).toBeUndefined()
  store.dispose()
})

it('keeps the current identity while a switch runs and reads the replacement after it commits', async () => {
  const fake = remote()
  const store = createFeishuAccountStore(fake.api, client)
  fake.push(stored)
  await vi.waitFor(() => { expect(store.session.getSnapshot().profile?.name).toBe('Ada') })
  const id = 'switch' as SignInAttemptId
  fake.push({ ...stored, attempt: { id, phase: 'waiting-browser', authorizeUrl: 'https://accounts.feishu.cn/authorize' } })
  await vi.waitFor(() => { expect(store.session.getSnapshot().view?.attempt?.phase).toBe('waiting-browser') })
  expect(store.session.getSnapshot().profile?.name).toBe('Ada')
  fake.api.getProfile.mockResolvedValueOnce({ ok: true, value: profile('Grace') })
  fake.push({ ...stored, attempt: { id, phase: 'succeeded' } })
  await vi.waitFor(() => { expect(store.session.getSnapshot().profile?.name).toBe('Grace') })
  expect(fake.api.getProfile).toHaveBeenCalledTimes(2)
  store.dispose()
})

it('cancels only a present attempt and reports refused operations', async () => {
  const fake = remote()
  const store = createFeishuAccountStore(fake.api, client)
  await store.cancel()
  expect(fake.api.cancelSignIn).not.toHaveBeenCalled()
  const id = 'pending' as SignInAttemptId
  fake.push({ ...signedOut, attempt: { id, phase: 'waiting-browser' } })
  await vi.waitFor(() => { expect(store.session.getSnapshot().view?.attempt?.id).toBe(id) })
  await store.cancel()
  expect(fake.api.cancelSignIn).toHaveBeenCalledWith(id)
  fake.api.signOut.mockResolvedValueOnce({ ok: false, error: new Error('offline') })
  await expect(store.signOut()).rejects.toThrow('offline')
  store.dispose()
})

it('returns the Web app to its page origin and the Desktop shell to the Host loopback origin', async () => {
  const fake = remote()
  const store = createFeishuAccountStore(fake.api, client)
  await store.signIn()
  expect(fake.api.startSignIn).toHaveBeenLastCalledWith(client(), window.location.origin, 'web')
  // Desktop serves the page from its own scheme, which the Host cannot use as an OAuth redirect.
  vi.stubGlobal('__DSH_TRANSPORT__', { streamBaseUrl: 'http://127.0.0.1:19387/stream' })
  expect(signInTarget()).toEqual({ origin: 'http://127.0.0.1:19387', source: 'desktop' })
  await store.signIn()
  expect(fake.api.startSignIn).toHaveBeenLastCalledWith(client(), 'http://127.0.0.1:19387', 'desktop')
  store.dispose()
})

it('publishes a stream failure and stops publishing after disposal', async () => {
  const failing: FeishuAccountRemote = {
    ...remote().api,
    watch: () => ({ async *[Symbol.asyncIterator]() { yield* []; throw new Error('stream ended') } }),
  }
  const store = createFeishuAccountStore(failing, client)
  await vi.waitFor(() => { expect(store.session.getSnapshot().failed).toBe(true) })
  const listener = vi.fn()
  store.session.subscribe(listener)
  store.dispose()
  expect(listener).not.toHaveBeenCalled()
})
