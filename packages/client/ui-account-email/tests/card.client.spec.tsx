// @vitest-environment jsdom
/** The email sign-in card: field gating, the resend countdown, generalized failures, and the stored identity. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
// Loads this package's own locale-namespace merge; without it the composed
// props carry no `t` seat.
import type {} from '../src/client/index.ts'
import { EmailLoginCard, type EmailLoginFace, type EmailLoginSession } from '../src/client/EmailLoginCard.tsx'
import { en, zh, type AccountEmailKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

/** Fill one dictionary's `{{name}}` placeholders the way the locale renderer does. */
function translate(dict: typeof en | typeof zh) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = (dict as Record<string, string>)[key] ?? key
    if (params === undefined) return template
    return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name]))
  }
}

interface Mounted {
  face: EmailLoginFace
  publish: (next: EmailLoginSession) => void
}

function mount(
  session: EmailLoginSession = { status: 'signed-out', identity: null, failed: false },
  copy: typeof en | typeof zh = en,
  overrides: Partial<Pick<EmailLoginFace, 'requestCode' | 'verifyCode' | 'signOut'>> = {},
): Mounted {
  let current = session
  const face: EmailLoginFace = {
    hooks: {
      session: {
        getSnapshot: () => current,
        subscribe: () => () => {},
      },
    },
    requestCode: overrides.requestCode ?? vi.fn(() => Promise.resolve()),
    verifyCode: overrides.verifyCode ?? vi.fn(() => Promise.resolve()),
    signOut: overrides.signOut ?? vi.fn(() => Promise.resolve()),
  }
  // The slot supplies the framework hooks in the application; this card consumes none of them.
  const globals = {} as GlobalStandardProps
  render(<EmailLoginCard {...globals} {...face} close={() => {}}
    useSession={<T,>(selector: (value: EmailLoginSession) => T): T => selector(current)}
    t={translate(copy)} />)
  return { face, publish: (next) => { current = next } }
}

it('reports the pending state before the host answers', () => {
  mount({ status: 'loading', identity: null, failed: false })
  expect(screen.getByRole('status').textContent).toBe(en.loading)
  expect(screen.queryByRole('button')).toBeNull()
})

it.each([en, zh])('gates sending on a complete address', async (copy) => {
  const { face } = mount(undefined, copy)
  const send = screen.getByRole('button', { name: copy.sendCode })
  expect(send.hasAttribute('disabled')).toBe(true)

  fireEvent.change(screen.getByLabelText(copy.emailLabel), { target: { value: 'not-an-address' } })
  expect(send.hasAttribute('disabled')).toBe(true)
  // A disabled button states no reason, so the form explains the address it refused.
  expect(screen.getByText(copy.emailInvalid)).toBeTruthy()

  fireEvent.change(screen.getByLabelText(copy.emailLabel), { target: { value: 'you@example.com' } })
  expect(screen.queryByText(copy.emailInvalid)).toBeNull()
  expect(send.hasAttribute('disabled')).toBe(false)
  await act(async () => { fireEvent.click(send) })
  expect(face.requestCode).toHaveBeenCalledOnce()
  expect(face.requestCode).toHaveBeenCalledWith('you@example.com')
})

it('trims the address and keeps the submit disabled until a code is typed', async () => {
  const { face } = mount()
  fireEvent.change(screen.getByLabelText(en.emailLabel), { target: { value: '  you@example.com  ' } })
  const submit = screen.getByRole('button', { name: en.signIn })
  expect(submit.hasAttribute('disabled')).toBe(true)

  fireEvent.change(screen.getByLabelText(en.codeLabel), { target: { value: '   ' } })
  expect(submit.hasAttribute('disabled')).toBe(true)

  fireEvent.change(screen.getByLabelText(en.codeLabel), { target: { value: ' 123456 ' } })
  expect(submit.hasAttribute('disabled')).toBe(false)
  await act(async () => { fireEvent.click(submit) })
  expect(face.verifyCode).toHaveBeenCalledExactlyOnceWith('you@example.com', '123456')
})

it('holds resending for a minute and counts down one second at a time', async () => {
  vi.useFakeTimers()
  const { face } = mount()
  fireEvent.change(screen.getByLabelText(en.emailLabel), { target: { value: 'you@example.com' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.sendCode })) })
  expect(face.requestCode).toHaveBeenCalledOnce()

  const held = (seconds: number): HTMLButtonElement =>
    screen.getByRole('button', { name: translate(en)('resendIn', { seconds }) })
  expect(held(60).hasAttribute('disabled')).toBe(true)
  // One tick per second: the card re-arms its next tick from the state that tick
  // produced, so each awaited advance is one rendered second.
  const tick = async (seconds: number): Promise<void> => {
    for (let elapsed = 0; elapsed < seconds; elapsed++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    }
  }
  await tick(1)
  expect(held(59).hasAttribute('disabled')).toBe(true)
  await tick(58)
  expect(held(1).hasAttribute('disabled')).toBe(true)
  // The whole minute passes, and no resend rides the countdown.
  await tick(1)
  expect(screen.getByRole('button', { name: en.sendCode }).hasAttribute('disabled')).toBe(false)
  expect(face.requestCode).toHaveBeenCalledOnce()
})

it.each([en, zh])('reports one failure message for every cause, never the rejection text', async (copy) => {
  const { face } = mount(undefined, copy, {
    requestCode: vi.fn(() => Promise.reject(new Error('issuer refused: address is unknown'))),
    verifyCode: vi.fn(() => Promise.reject(new Error('code expired'))),
  })
  fireEvent.change(screen.getByLabelText(copy.emailLabel), { target: { value: 'you@example.com' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.sendCode })) })
  expect(screen.getByRole('alert').textContent).toBe(copy.failed)
  expect(document.body.textContent).not.toContain('address is unknown')

  // A second attempt clears the alert before it starts, so a failure never stacks.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.sendCode })) })
  expect(screen.getAllByRole('alert')).toHaveLength(1)

  fireEvent.change(screen.getByLabelText(copy.codeLabel), { target: { value: '123456' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.signIn })) })
  expect(screen.getByRole('alert').textContent).toBe(copy.failed)
  expect(document.body.textContent).not.toContain('code expired')
  expect(face.verifyCode).toHaveBeenCalledOnce()
})

it('reports a failed account read as a failure instead of an empty form', () => {
  mount({ status: 'signed-out', identity: null, failed: true })
  expect(screen.getByRole('alert').textContent).toBe(en.failed)
  // The form stays usable: the credential store, not the stream, is what failed.
  expect(screen.getByRole('button', { name: en.sendCode })).toBeTruthy()
})

it.each([en, zh])('shows the proved identity and signs out without clearing the form first', async (copy) => {
  const { face } = mount({ status: 'signed-in', identity: { name: 'Zhang San', contact: 'you@example.com' }, failed: false }, copy)
  expect(screen.getByText('Zhang San')).toBeTruthy()
  expect(screen.getByText('you@example.com')).toBeTruthy()
  expect(screen.queryByRole('button', { name: copy.sendCode })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.signOut })) })
  expect(face.signOut).toHaveBeenCalledOnce()
})

it('falls back to the signed-in label when the identity read answered nothing', () => {
  mount({ status: 'signed-in', identity: null, failed: false })
  expect(screen.getByText(en.signedIn)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.signOut })).toBeTruthy()
})

it('reports a failed sign-out and keeps the stored identity on screen', async () => {
  const { face } = mount({ status: 'signed-in', identity: { name: 'Zhang San', contact: null }, failed: false }, en, {
    signOut: vi.fn(() => Promise.reject(new Error('account sign-out failed'))),
  })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.signOut })) })
  expect(face.signOut).toHaveBeenCalledOnce()
  expect(screen.getByRole('alert').textContent).toBe(en.failed)
  expect(screen.getByText('Zhang San')).toBeTruthy()
})

it('keeps the typed address across a failed send and reuses it for the next one', async () => {
  const requestCode = vi.fn(() => Promise.reject(new Error('offline')))
  const { face } = mount(undefined, en, { requestCode })
  fireEvent.change(screen.getByLabelText(en.emailLabel), { target: { value: 'you@example.com' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.sendCode })) })
  expect((screen.getByLabelText(en.emailLabel) as HTMLInputElement).value).toBe('you@example.com')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.sendCode })) })
  expect(face.requestCode).toHaveBeenCalledTimes(2)
})

it('names its dictionary namespace so a registration typo cannot compile', () => {
  const keys: AccountEmailKey[] = ['nav', 'title', 'sendCode', 'resendIn', 'signIn', 'signOut', 'failed']
  for (const key of keys) expect(zh[key]).toBeTruthy()
})
