/** In-app account authorization window with a fresh in-memory browser session for every attempt. */
import { randomUUID } from 'node:crypto'
import { BrowserWindow, session, type Session } from 'electron'

/**
 * Registrable domains whose authorization pages open inside the app. A fresh
 * session per attempt makes the issuer show its QR login instead of reusing the
 * system browser's signed-in web session, which is what lets a user switch
 * accounts. Every other issuer keeps the system-browser handoff.
 */
const IN_APP_SIGN_IN_DOMAINS = ['feishu.cn', 'larksuite.com'] as const

/** Packaged placeholder shown until the first remote document commits; it needs no network. */
const LOADING_PAGE = 'renderer/policy-login-loading.html'

/** Loopback hosts an OAuth redirect may name for the Host callback listener. */
const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]']

function parse(value: string): URL | undefined {
  try { return new URL(value) } catch (_invalid) { return undefined } // Malformed input is simply not allowed.
}

function inAppHost(hostname: string): boolean {
  return IN_APP_SIGN_IN_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

/**
 * Decide whether an authorization URL opens in the in-app window.
 * @param authorizeUrl - authorization URL published by the Host account attempt.
 * @returns true for HTTPS pages of the in-app issuers without URL credentials.
 */
export function opensInApp(authorizeUrl: string): boolean {
  const url = parse(authorizeUrl)
  return url !== undefined && url.protocol === 'https:' && url.username === '' && url.password === '' && inAppHost(url.hostname)
}

/** The loopback callback origin named by the authorization request's `redirect_uri`, if any. */
function callbackOrigin(authorize: URL): string | undefined {
  const redirect = parse(authorize.searchParams.get('redirect_uri') ?? '')
  return redirect !== undefined && redirect.protocol === 'http:' && LOOPBACK_HOSTS.includes(redirect.hostname)
    ? redirect.origin : undefined
}

/** Erase one attempt's cookies and caches; failures are logged because nothing can retry them. */
async function clearSession(browserSession: Session): Promise<void> {
  try {
    await browserSession.closeAllConnections()
    await browserSession.clearStorageData()
    await browserSession.clearAuthCache()
  } catch (error) { console.warn('desktop sign-in: session cleanup failed', error) }
}

/** Shell collaborators of the sign-in window. */
export interface DesktopSignInWindowOptions {
  /** @returns current localized window title and placeholder label. */
  readonly copy: () => { readonly title: string; readonly loading: string }
  /** @param attemptId - attempt whose window the user closed before it finished; the shell cancels it. */
  readonly closedByUser: (attemptId: string) => void
}

interface OpenAttempt {
  readonly id: string
  readonly window: BrowserWindow
  /** Set when the shell closes the window, so the close is not reported as the user's cancellation. */
  closedByShell: boolean
}

/**
 * Owns at most one authorization window. The window has no preload and its main
 * frame may only navigate within the issuer domains and the attempt's loopback
 * callback origin; popups, downloads, permissions, and webviews are refused.
 */
export class DesktopSignInWindow {
  private current: OpenAttempt | undefined
  private disposed = false
  private readonly cleanups = new Set<Promise<void>>()

  /** @param options - localized copy and the user-cancellation callback. */
  constructor(private readonly options: DesktopSignInWindowOptions) {}

  /**
   * Show the authorization page for one attempt; repeating the current attempt only focuses its window.
   * @param attemptId - Host attempt identity.
   * @param authorizeUrl - authorization URL accepted by {@link opensInApp}.
   */
  open(attemptId: string, authorizeUrl: string): void {
    if (this.disposed) return
    if (this.current?.id === attemptId && !this.current.window.isDestroyed()) { this.focus(); return }
    this.close()
    const authorize = new URL(authorizeUrl)
    const callback = callbackOrigin(authorize)
    const allowed = (value: string): boolean => {
      const url = parse(value)
      if (url === undefined || url.username !== '' || url.password !== '') return false
      if (url.origin === callback) return true
      return url.protocol === 'https:' && (url.origin === authorize.origin || inAppHost(url.hostname))
    }
    // A non-`persist:` partition lives in memory, so no attempt inherits another's sign-in.
    const browserSession = session.fromPartition(`dsh-sign-in-${randomUUID()}`, { cache: false })
    browserSession.setPermissionRequestHandler((_contents, _permission, decide) => { decide(false) })
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.on('will-download', (event) => { event.preventDefault() })
    const copy = this.options.copy()
    const window = new BrowserWindow({ width: 480, height: 640, minWidth: 400, minHeight: 520, title: copy.title,
      autoHideMenuBar: true, webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false } })
    const attempt: OpenAttempt = { id: attemptId, window, closedByShell: false }
    this.current = attempt
    window.setMenu(null)
    window.on('page-title-updated', (event) => { event.preventDefault() })
    window.on('closed', () => {
      if (this.current === attempt) this.current = undefined
      const cleanup = clearSession(browserSession)
      this.cleanups.add(cleanup)
      void cleanup.finally(() => { this.cleanups.delete(cleanup) })
      if (!attempt.closedByShell) this.options.closedByUser(attemptId)
    })
    const contents = window.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
    contents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
    contents.on('will-attach-webview', (event) => { event.preventDefault() })
    contents.on('login', (event, _details, _authInfo, answer) => { event.preventDefault(); answer() })
    const load = (): void => {
      if (window.isDestroyed()) return
      // A superseded navigation rejects with ERR_ABORTED; any other failure leaves the error page for the user to close.
      void window.loadURL(authorize.href).catch((_superseded: unknown) => undefined)
    }
    void window.loadFile(LOADING_PAGE, { query: { label: copy.loading } }).then(load, load)
  }

  /** Close the current window as the shell's decision; the attempt itself is not cancelled. */
  close(): void {
    const attempt = this.current
    if (attempt === undefined) return
    this.current = undefined
    attempt.closedByShell = true
    if (!attempt.window.isDestroyed()) attempt.window.destroy()
  }

  /** Bring the current window to the front. */
  focus(): void {
    const window = this.current?.window
    if (window === undefined || window.isDestroyed()) return
    window.show()
    window.focus()
  }

  /** @returns after the open window is closed and every attempt's session data is erased. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.close()
    await Promise.all(this.cleanups)
  }
}
