// @vitest-environment jsdom
/** Sidebar account menu and Settings account page over one Feishu session. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountProfile, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { FeishuSession } from '../src/client/account-store.ts'
import { FeishuAccountMenu, type FeishuAccountMenuProps } from '../src/client/FeishuAccountMenu.tsx'
import { FeishuAccountSection, type FeishuAccountSectionProps } from '../src/client/FeishuAccountSection.tsx'
import { zh } from '../src/client/locales.ts'

const links = { usageUrl: '', topUpUrl: '' }
const ada: AccountProfile = { id: null, name: 'Ada', contact: 'ada@example.test', avatarUrl: 'https://example.test/ada.png' }
const t = (key: keyof typeof zh): string => zh[key]
function unused(): never { throw new Error('unused hook') }

function operations(session: FeishuSession) {
  return {
    t, useSession: <T,>(select: (value: FeishuSession) => T): T => select(session),
    signIn: vi.fn(async () => {}), cancel: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
    usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
    useSessionRetainInfo: unused, useResource: unused, useWorkspaces: unused,
  }
}

function section(session: FeishuSession) {
  const props = { ...operations(session), close: vi.fn() }
  render(<FeishuAccountSection {...(props as FeishuAccountSectionProps)} />)
  return props
}

function menu(session: FeishuSession) {
  const props = { ...operations(session), wide: true, settingsOpen: false, openSettings: vi.fn(), openOnboarding: vi.fn() }
  render(<FeishuAccountMenu {...(props as FeishuAccountMenuProps)} />)
  return props
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('offers QR sign-in on the signed-out Settings page and keeps models separate', async () => {
  const props = section({ view: { status: 'signed-out', links, attempt: null }, profile: undefined, failed: false })
  expect(screen.getByText(zh.signedOutTitle)).toBeTruthy()
  expect(screen.getByText(zh.signedOutDescription)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.signIn })) })
  expect(props.signIn).toHaveBeenCalledOnce()
})

it('shows the stored identity with switch and confirmed sign-out actions', async () => {
  const props = section({ view: { status: 'credential-stored', links, attempt: null }, profile: ada, failed: false })
  expect(screen.getByText('Ada')).toBeTruthy()
  expect(screen.getByText('ada@example.test')).toBeTruthy()
  expect(document.querySelector('img')?.getAttribute('src')).toBe(ada.avatarUrl)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.switchAccount })) })
  expect(props.signIn).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.signOut }))
  const dialog = screen.getByRole('dialog')
  await act(async () => { fireEvent.click(dialog.querySelectorAll('button')[1]!) })
  expect(props.signOut).toHaveBeenCalledOnce()
})

it('guides a waiting attempt with link fallbacks and cancellation', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const authorizeUrl = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=x'
  const props = section({ view: { status: 'signed-out', links,
    attempt: { id: 'a' as SignInAttemptId, phase: 'waiting-browser', authorizeUrl } }, profile: undefined, failed: false })
  expect(screen.getByText(zh.waiting)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.signIn }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.open }))
  expect(open).toHaveBeenCalledWith(authorizeUrl, '_blank', 'noopener,noreferrer')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.copy })) })
  expect(writeText).toHaveBeenCalledWith(authorizeUrl)
  expect(screen.getByRole('button', { name: zh.copied })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.cancel })) })
  expect(props.cancel).toHaveBeenCalledOnce()
})

it.each([
  [{ id: 'f' as SignInAttemptId, phase: 'failed', errorCode: 'protocol' }, zh.unavailable],
  [{ id: 'f' as SignInAttemptId, phase: 'failed', errorCode: 'network', authorizeUrl: 'https://accounts.feishu.cn/x' }, zh.failed],
  [{ id: 'f' as SignInAttemptId, phase: 'expired' }, zh.expired],
] as const)('explains a terminal attempt %#', (attempt, message) => {
  section({ view: { status: 'signed-out', links, attempt }, profile: undefined, failed: false })
  expect(screen.getByRole('alert').textContent).toBe(message)
  expect(screen.getByRole('button', { name: zh.retry })).toBeTruthy()
})

it('shows the avatar and name in the sidebar and switches accounts from its menu', async () => {
  const props = menu({ view: { status: 'credential-stored', links, attempt: null }, profile: ada, failed: false })
  expect(screen.getByText('Ada')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.menu }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: zh.switchAccount })) })
  expect(props.signIn).toHaveBeenCalledOnce()
  expect(props.openSettings).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.menu }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.signOut }))
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('offers sign-in and settings from the signed-out sidebar menu', async () => {
  const props = menu({ view: { status: 'signed-out', links, attempt: null }, profile: undefined, failed: false })
  expect(screen.getByText(zh.more)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.menu }))
  expect(screen.queryByRole('menuitem', { name: zh.signOut })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: zh.settings }))
  expect(props.openSettings).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.menu }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: zh.signIn })) })
  expect(props.signIn).toHaveBeenCalledOnce()
})
