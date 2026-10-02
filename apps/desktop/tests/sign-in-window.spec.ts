/** In-app Feishu authorization window: isolation, navigation fence, and attempt ownership. */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions } from 'electron'

const native = vi.hoisted(() => ({ create: vi.fn<(options: BrowserWindowConstructorOptions) => object>(), partition: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: function (options: BrowserWindowConstructorOptions) { return native.create(options) },
  session: { fromPartition: native.partition } }))

const { DesktopSignInWindow, opensInApp } = await import('../src/sign-in-window.ts')

type Listener = (...args: unknown[]) => void
function makeSession() {
  return Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: vi.fn<(handler: Listener) => void>(), setPermissionCheckHandler: vi.fn<(handler: () => boolean) => void>(),
    closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearAuthCache: vi.fn(async () => {}),
  })
}
function makeWindow() {
  let destroyed = false
  const instance = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn<(handler: () => { action: string }) => void>() }),
    setMenu: vi.fn(), show: vi.fn(), focus: vi.fn(), loadFile: vi.fn(async () => {}), loadURL: vi.fn(async () => {}),
    isDestroyed: () => destroyed,
    destroy: () => { if (!destroyed) { destroyed = true; instance.emit('closed') } },
  })
  return instance
}

const AUTHORIZE = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=cli&redirect_uri='
  + encodeURIComponent('http://127.0.0.1:19387/feishu/callback') + '&state=s'
let sessions: ReturnType<typeof makeSession>[]
let windows: ReturnType<typeof makeWindow>[]
const closedByUser = vi.fn()
let signIn: InstanceType<typeof DesktopSignInWindow>

beforeEach(() => {
  vi.clearAllMocks()
  sessions = []; windows = []
  native.partition.mockImplementation(() => { const value = makeSession(); sessions.push(value); return value })
  native.create.mockImplementation(() => { const value = makeWindow(); windows.push(value); return value })
  signIn = new DesktopSignInWindow({ copy: () => ({ title: '飞书扫码登录', loading: '正在加载登录页面…' }), closedByUser })
})
afterEach(async () => { await signIn.dispose() })

function navigation(window: ReturnType<typeof makeWindow>, event: 'will-navigate' | 'will-redirect', url: string): boolean {
  const preventDefault = vi.fn()
  window.webContents.emit(event, { preventDefault }, url)
  return preventDefault.mock.calls.length === 0
}

it('opens only HTTPS Feishu and Lark authorization pages in the app', () => {
  expect(opensInApp(AUTHORIZE)).toBe(true)
  expect(opensInApp('https://passport.larksuite.com/authorize')).toBe(true)
  expect(opensInApp('https://platform.deepseek.com/dsh/authorize')).toBe(false)
  expect(opensInApp('http://accounts.feishu.cn/authorize')).toBe(false)
  expect(opensInApp('https://user:secret@accounts.feishu.cn/authorize')).toBe(false)
  expect(opensInApp('https://feishu.cn.example.com/authorize')).toBe(false)
  expect(opensInApp('not a url')).toBe(false)
})

it('loads the authorization page in a fresh memory session behind a sandbox and the placeholder', async () => {
  signIn.open('a1', AUTHORIZE)
  expect(native.partition.mock.calls[0]![0]).toMatch(/^dsh-sign-in-/u)
  expect(native.partition.mock.calls[0]![0]).not.toMatch(/^persist:/u)
  expect(native.partition.mock.calls[0]![1]).toEqual({ cache: false })
  const options = native.create.mock.calls[0]![0]
  expect(options).toMatchObject({ title: '飞书扫码登录', webPreferences: { session: sessions[0], nodeIntegration: false,
    contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false } })
  expect(options.webPreferences?.preload).toBeUndefined()
  expect(windows[0]!.loadFile).toHaveBeenCalledWith('renderer/policy-login-loading.html', { query: { label: '正在加载登录页面…' } })
  await vi.waitFor(() => { expect(windows[0]!.loadURL).toHaveBeenCalledWith(AUTHORIZE) })
  // A second attempt gets its own session, so it cannot reuse the first account's sign-in.
  signIn.open('a2', AUTHORIZE)
  expect(native.partition.mock.calls[1]![0]).not.toBe(native.partition.mock.calls[0]![0])
})

it('fences navigation to the issuer domains and the attempt callback origin and refuses side channels', () => {
  signIn.open('a1', AUTHORIZE)
  const window = windows[0]!
  expect(navigation(window, 'will-navigate', 'https://accounts.feishu.cn/accounts/page/login')).toBe(true)
  expect(navigation(window, 'will-redirect', 'https://passport.feishu.cn/suite/passport/page/login')).toBe(true)
  expect(navigation(window, 'will-redirect', 'http://127.0.0.1:19387/feishu/callback?code=c&state=s')).toBe(true)
  expect(navigation(window, 'will-navigate', 'http://127.0.0.1:9999/feishu/callback')).toBe(false)
  expect(navigation(window, 'will-navigate', 'https://example.com/')).toBe(false)
  expect(navigation(window, 'will-navigate', 'https://u:p@accounts.feishu.cn/')).toBe(false)
  expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
  const permission = vi.fn()
  sessions[0]!.setPermissionRequestHandler.mock.calls[0]![0](undefined, 'media', permission)
  expect(permission).toHaveBeenCalledWith(false)
  const download = vi.fn()
  sessions[0]!.emit('will-download', { preventDefault: download })
  expect(download).toHaveBeenCalledOnce()
})

it('reports a user close as cancellation, but not a shell close, and erases each session', async () => {
  signIn.open('a1', AUTHORIZE)
  windows[0]!.destroy()
  expect(closedByUser).toHaveBeenCalledExactlyOnceWith('a1')
  signIn.open('a2', AUTHORIZE)
  signIn.close()
  expect(closedByUser).toHaveBeenCalledTimes(1)
  await signIn.dispose()
  for (const value of sessions) expect(value.clearStorageData).toHaveBeenCalledOnce()
})

it('focuses the open window for the same attempt and replaces it for a new one', () => {
  signIn.open('a1', AUTHORIZE)
  signIn.open('a1', AUTHORIZE)
  expect(native.create).toHaveBeenCalledOnce()
  expect(windows[0]!.focus).toHaveBeenCalledOnce()
  signIn.open('a2', AUTHORIZE)
  expect(windows[0]!.isDestroyed()).toBe(true)
  expect(closedByUser).not.toHaveBeenCalled()
  expect(native.create).toHaveBeenCalledTimes(2)
})

it('opens nothing after disposal', async () => {
  await signIn.dispose()
  signIn.open('a1', AUTHORIZE)
  expect(native.create).not.toHaveBeenCalled()
})
