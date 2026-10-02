/** Feishu OAuth account provider for the shared browser sign-in contract. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { AuthorizationDeclinedError, type AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { AccountClientMetadata, AccountDetails, AccountProfile, AccountUserId, AccountView, SignInAttemptId, SignInAttemptView } from '@deepseek-ai/dsh-deepseek-account'
import { DeepSeekAccount, installAccountTaskCancellation } from '@deepseek-ai/dsh-deepseek-account'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { FeishuAuthError, authorizeUrl, exchangeCode, loginOrigin, readUser, refreshToken } from './protocol.ts'
import type { FeishuAccountConfig } from './types.ts'

const KEY = credentialKey('feishu-account', 'default')
const ISSUER = 'https://accounts.feishu.cn'
const DEFAULT_SCOPE = 'offline_access contact:user.email:readonly'
const REFRESH_THRESHOLD_MS = 5 * 60_000
const grant = z.object({
  version: z.literal(1), appId: z.string(), issuer: z.string(), accessToken: z.string(),
  accessTokenExpiresAt: z.number(), refreshToken: z.string().optional(),
  refreshTokenExpiresAt: z.number().optional(), scope: z.string(),
  identity: z.object({ id: z.string(), openId: z.string(), name: z.string(),
    enName: z.string().optional(), contact: z.string().nullable().optional(), avatarUrl: z.string().nullable().optional() }),
})

interface Attempt {
  origin: string
  locale: 'en_US' | 'zh_CN'
  view: SignInAttemptView
  controller: AbortController
  done: Promise<void>
  running: Promise<void>
  callback?: ServerResponse
  declined?: boolean
}

/** Validated Feishu deployment configuration. */
export const Config = Schema.object({
  appId: Schema.string().default(''),
  appSecretRef: Schema.string().default('FEISHU_APP_SECRET'),
  scope: Schema.string().default(DEFAULT_SCOPE),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(10_000),
  attemptTimeoutMs: Schema.number().min(1).max(3_600_000).default(600_000),
  authorizeEndpoint: Schema.string().default(`${ISSUER}/open-apis/authen/v1/authorize`),
  apiOrigin: Schema.string().default('https://open.feishu.cn'),
})

type ResolvedConfig = ReturnType<typeof Config>
type Grant = z.infer<typeof grant>

/** Host-only Feishu account implementation. */
export class FeishuAccount extends DeepSeekAccount {
  static inject = ['credentials', 'authorization']

  private readonly config: ResolvedConfig
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private attempt: Attempt | undefined
  private closed = false
  private removing: Promise<AccountView> | undefined
  private refreshPromise: Promise<Grant | null> | undefined

  /** @param ctx - Host context with credentials and authorization services. @param config - provider configuration. */
  constructor(ctx: Context, config: FeishuAccountConfig = {}) {
    super(ctx)
    installAccountTaskCancellation(ctx)
    this.config = Config(config)
    if (!this.config.appId) throw new Error('feishu-account: appId is required')
    ctx.authorization.registerFlow({
      key: KEY, label: 'Feishu', methods: [{ id: 'browser', label: 'Feishu' }],
      run: (session) => {
        const attempt = this.attempt
        if (attempt === undefined) return Promise.reject(new FeishuAuthError('protocol'))
        attempt.running = this.run(session, attempt)
        return attempt.running
      },
    })
    ctx.on('credentials/record-updated', (key) => { if (key === KEY) this.changed() })
    ctx.effect(() => {
      const timer = setInterval(() => { void this.refreshStoredGrant() }, 60 * 60_000)
      void this.refreshStoredGrant()
      return async () => {
        clearInterval(timer)
        this.closed = true
        this.lifetime.abort()
        const attempt = this.attempt
        if (attempt !== undefined && !['succeeded', 'cancelled', 'expired', 'failed'].includes(attempt.view.phase)) {
          attempt.controller.abort()
          this.ctx.authorization.cancel(KEY)
          await attempt.done.catch(() => undefined)
        }
      }
    }, 'feishu-account: refresh lifetime')
  }

  async [Service.init](): Promise<void> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return
    const parsed = this.parseGrant(record)
    if (parsed.appId !== this.config.appId || parsed.issuer !== ISSUER) {
      await this.ctx.credentials.deleteRecord(KEY)
      console.info('[feishu-account] stored grant discarded', { reason: 'application-mismatch' })
    }
  }

  override async getState(): Promise<AccountView> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record !== undefined) this.parseGrant(record)
    return { status: record === undefined ? 'signed-out' : 'credential-stored', links: { usageUrl: '', topUpUrl: '' }, attempt: this.attempt?.view ?? null }
  }

  override async getProfile(_client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    const stored = await this.refreshStoredGrant()
    if (stored === null) return null
    try {
      const user = await readUser(this.config.apiOrigin, stored.accessToken, AbortSignal.timeout(this.config.requestTimeoutMs))
      const identity = toProfile(user)
      await this.writeIdentity(stored, toStoredIdentity(user))
      return { status: 'ready', value: identity }
    } catch (error) {
      if (error instanceof FeishuAuthError && error.code === 'expired') {
        const refreshed = await this.refreshStoredGrant(true)
        if (refreshed === null) return null
        try {
          const user = await readUser(this.config.apiOrigin, refreshed.accessToken, AbortSignal.timeout(this.config.requestTimeoutMs))
          const identity = toProfile(user)
          await this.writeIdentity(refreshed, toStoredIdentity(user))
          return { status: 'ready', value: identity }
        } catch (retryError) {
          if (retryError instanceof FeishuAuthError && retryError.code === 'expired') await this.expireCredential()
        }
      }
      return { status: 'ready', value: storedProfile(stored.identity) }
    }
  }

  // Feishu supplies identity only: no wallet, bonus, model token, or Platform session exists for this account.
  override getBalance(_client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> { return Promise.resolve(null) }
  override getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<null> { return Promise.resolve(null) }
  override ackBonusNotified(): Promise<boolean> { return Promise.resolve(false) }
  override resolveToken(): Promise<string | undefined> { return Promise.resolve(undefined) }
  override rejectToken(): Promise<void> { return Promise.resolve() }
  override getPlatformSession(): Promise<null> { return Promise.resolve(null) }

  override async getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return { osVersion: process.platform }
    const parsed = this.parseGrant(record)
    return { userId: parsed.identity.id as AccountUserId, osVersion: process.platform }
  }

  override async startSignIn(client: AccountClientMetadata, callbackOrigin: string, _loginSource: 'web' | 'desktop'): Promise<AccountView> {
    if (this.removing !== undefined) await this.removing
    const origin = loginOrigin(callbackOrigin)
    if (this.closed) throw new FeishuAuthError('protocol')
    if (this.attempt !== undefined && !['succeeded', 'cancelled', 'expired', 'failed'].includes(this.attempt.view.phase)) return this.getState()
    const previous = this.attempt
    if (previous !== undefined) {
      await previous.done
      // Disposal can land during the wait; the lifetime signal aborts together with `closed`.
      if (this.lifetime.signal.aborted) throw new FeishuAuthError('protocol')
      if (this.attempt !== previous) return this.getState()
    }
    const attempt: Attempt = { origin, locale: client.locale.startsWith('zh') ? 'zh_CN' : 'en_US',
      view: { id: randomUUID() as SignInAttemptId, phase: 'initializing' }, controller: new AbortController(),
      done: Promise.resolve(), running: Promise.resolve() }
    this.attempt = attempt
    attempt.done = this.ctx.authorization.begin({ key: KEY, signal: attempt.controller.signal,
      interaction: { notify: () => undefined, prompt: () => Promise.reject(new FeishuAuthError('protocol')) },
    }).then((outcome) => {
      this.update(attempt, { phase: outcome.status === 'authorized' ? 'succeeded' : 'cancelled' })
      this.finishCallback(attempt, outcome.status === 'authorized')
    }).catch((error: unknown) => {
      const code = error instanceof FeishuAuthError ? error.code : 'protocol'
      this.update(attempt, { phase: code === 'expired' ? 'expired' : 'failed', errorCode: code })
      this.finishCallback(attempt, false)
    }).then(async () => {
      await attempt.running.catch(() => undefined)
    })
    return this.getState()
  }

  override async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt?.view.id === id && !['succeeded', 'cancelled', 'expired', 'failed'].includes(attempt.view.phase)) {
      attempt.controller.abort(); this.ctx.authorization.cancel(KEY); await attempt.done
    }
    return this.getState()
  }

  override signOut(): Promise<AccountView> {
    this.removing ??= (async () => {
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      await this.ctx.credentials.deleteRecord(KEY)
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    return this.removing
  }

  override async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed); signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally { this.listeners.delete(changed); signal.removeEventListener('abort', changed) }
  }

  private async run(session: AuthorizationSession, attempt: Attempt): Promise<void> {
    const webServer = this.ctx.get('webServer')
    if (webServer === undefined) throw new FeishuAuthError('protocol')
    // Checked before the authorization page opens: a user must not scan a code the exchange can never redeem.
    const secret = process.env[this.config.appSecretRef]
    if (!secret) {
      console.warn('[feishu-account] sign-in unavailable', { reason: 'missing-app-secret', ref: this.config.appSecretRef })
      throw new FeishuAuthError('protocol')
    }
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const redirectUri = `${attempt.origin}/feishu/callback`
    const code = Promise.withResolvers<string>()
    const signal = AbortSignal.any([session.signal, AbortSignal.timeout(this.config.attemptTimeoutMs)])
    const dispose = webServer.register({ kind: 'exact', path: '/feishu/callback', handler: (req, res) => {
      let url: URL
      try { url = new URL(req.url ?? '/', 'http://127.0.0.1') } catch { res.writeHead(400).end(); return }
      const received = url.searchParams.get('state') ?? ''
      const valid = Buffer.byteLength(received) === Buffer.byteLength(state) && timingSafeEqual(Buffer.from(received), Buffer.from(state))
      if (req.method !== 'GET' || !valid || url.searchParams.getAll('state').length !== 1) { res.writeHead(400, { 'cache-control': 'no-store' }).end(); return }
      if (url.searchParams.get('error') === 'access_denied') {
        attempt.callback = res
        attempt.declined = true
        code.reject(new DOMException('authorization declined', 'AbortError'))
        return
      }
      const receivedCode = url.searchParams.get('code')
      if (receivedCode === null) { res.writeHead(400, { 'cache-control': 'no-store' }).end(); return }
      attempt.callback = res; code.resolve(receivedCode)
    } })
    try {
      signal.throwIfAborted()
      this.update(attempt, { phase: 'waiting-browser', authorizeUrl: authorizeUrl(this.config.authorizeEndpoint, this.config.appId, redirectUri, state, challenge, this.config.scope) })
      let receivedCode: string
      try {
        receivedCode = await Promise.race([code.promise, new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => { reject(new FeishuAuthError('expired')) }, { once: true })
        })])
      }
      catch (error) {
        if (attempt.declined) throw new AuthorizationDeclinedError()
        throw error
      }
      signal.throwIfAborted(); this.update(attempt, { phase: 'exchanging' })
      const request = (): AbortSignal => AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
      const token = await exchangeCode(this.config.apiOrigin, this.config.appId, secret, receivedCode, verifier, redirectUri,
        this.config.scope, request())
      const user = await readUser(this.config.apiOrigin, token.access_token, request())
      this.update(attempt, { phase: 'committing' })
      await session.commit({ kind: 'grant', payload: { version: 1, appId: this.config.appId, issuer: ISSUER,
        accessToken: token.access_token,
        accessTokenExpiresAt: Date.now() + token.expires_in * 1000, refreshToken: token.refresh_token,
        refreshTokenExpiresAt: token.refresh_token_expires_in === undefined
          ? undefined : Date.now() + token.refresh_token_expires_in * 1000,
        scope: token.scope ?? this.config.scope, identity: toStoredIdentity(user) } })
    } catch (error) {
      if (signal.aborted) throw new FeishuAuthError('expired')
      throw error
    } finally { dispose() }
  }

  private async refreshStoredGrant(force = false): Promise<Grant | null> {
    const current = await this.ctx.credentials.readRecord(KEY)
    if (current === undefined) return null
    const parsed = this.parseGrant(current)
    if (!force && parsed.accessTokenExpiresAt - Date.now() >= REFRESH_THRESHOLD_MS) return parsed
    if (!parsed.refreshToken) { await this.expireCredential(); return null }
    const secret = process.env[this.config.appSecretRef]
    if (!secret) return parsed
    const expectedAccessToken = parsed.accessToken
    if (this.refreshPromise !== undefined) {
      try { return await this.refreshPromise }
      catch (error) {
        if (error instanceof FeishuAuthError && error.code === 'expired') {
          await this.expireCredential(expectedAccessToken)
          return null
        }
        return parsed
      }
    }
    const operation = this.refreshGrantExclusive(force, expectedAccessToken, secret)
    this.refreshPromise = operation
    try {
      return await operation
    } catch (error) {
      if (error instanceof FeishuAuthError && error.code === 'expired') { await this.expireCredential(expectedAccessToken); return null }
      return parsed
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = undefined
    }
  }

  private async refreshGrantExclusive(force: boolean, expectedAccessToken: string, secret: string): Promise<Grant | null> {
    const result = await this.ctx.credentials.modifyRecord(KEY, async (latest) => {
      if (latest === undefined) return undefined
      const fresh = this.parseGrant(latest)
      if (force ? fresh.accessToken !== expectedAccessToken : fresh.accessTokenExpiresAt - Date.now() >= REFRESH_THRESHOLD_MS) return latest
      if (!fresh.refreshToken) return undefined
      const token = await refreshToken(this.config.apiOrigin, this.config.appId, secret, fresh.refreshToken, this.config.scope,
        AbortSignal.timeout(this.config.requestTimeoutMs))
      return { kind: 'grant', payload: { ...fresh, accessToken: token.access_token, accessTokenExpiresAt: Date.now() + token.expires_in * 1000,
        refreshToken: token.refresh_token ?? fresh.refreshToken,
        refreshTokenExpiresAt: token.refresh_token_expires_in === undefined
          ? fresh.refreshTokenExpiresAt : Date.now() + token.refresh_token_expires_in * 1000,
        scope: token.scope ?? this.config.scope } }
    })
    return result === undefined ? null : this.parseGrant(result)
  }

  private async writeIdentity(stored: Grant, identity: Grant['identity']): Promise<void> {
    await this.ctx.credentials.modifyRecord(KEY, (current) => {
      if (current === undefined) return Promise.resolve(undefined)
      const latest = this.parseGrant(current)
      if (latest.accessToken !== stored.accessToken) return Promise.resolve(undefined)
      return Promise.resolve({ kind: 'grant', payload: { ...latest, identity } })
    })
  }

  private async expireCredential(expectedAccessToken?: string): Promise<void> {
    if (expectedAccessToken !== undefined) {
      const current = await this.ctx.credentials.readRecord(KEY)
      if (current === undefined) return
      const latest = this.parseGrant(current)
      if (latest.accessToken !== expectedAccessToken) return
    }
    await this.ctx.credentials.deleteRecord(KEY)
    this.changed()
  }
  private parseGrant(record: { kind: string; payload?: unknown }): Grant {
    if (record.kind !== 'grant' || record.payload === undefined) throw new FeishuAuthError('storage')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new FeishuAuthError('storage')
    return parsed.data
  }
  private update(attempt: Attempt, value: Partial<SignInAttemptView>): void { attempt.view = { ...attempt.view, ...value }; this.changed() }
  private changed(): void { for (const listener of this.listeners) listener() }
  private finishCallback(attempt: Attempt, succeeded: boolean): void {
    if (!succeeded) { attempt.callback?.writeHead(204, { 'cache-control': 'no-store' }).end(); return }
    const message = attempt.locale === 'zh_CN' ? '登录完成，可以回到应用。' : 'Sign-in complete. You can return to the app.'
    attempt.callback?.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(`<!doctype html><meta charset="utf-8"><title>Feishu sign-in</title><p>${message}</p>`)
  }
}

interface FeishuUser {
  union_id: string
  open_id: string
  name: string
  en_name?: string | undefined
  email?: string | undefined
  avatar_url?: string | undefined
}

function toProfile(value: FeishuUser): AccountProfile {
  return { id: value.union_id as AccountUserId, name: value.name, contact: value.email ?? null, avatarUrl: value.avatar_url ?? null }
}

function toStoredIdentity(value: FeishuUser): Grant['identity'] {
  return { id: value.union_id, openId: value.open_id, name: value.name,
    ...(value.en_name === undefined ? {} : { enName: value.en_name }),
    ...(value.email === undefined ? {} : { contact: value.email }),
    ...(value.avatar_url === undefined ? {} : { avatarUrl: value.avatar_url }) }
}

function storedProfile(value: Grant['identity']): AccountProfile {
  return { id: value.id === '' ? null : value.id as AccountUserId, name: value.name, contact: value.contact ?? null, avatarUrl: value.avatarUrl ?? null }
}

export default FeishuAccount
