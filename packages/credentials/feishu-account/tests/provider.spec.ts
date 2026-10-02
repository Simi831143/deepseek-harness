import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo } from '@deepseek-ai/dsh-credentials'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { AccountClientMetadata, AccountView } from '@deepseek-ai/dsh-deepseek-account'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { FeishuAccount } from '../src/index.ts'

const KEY = 'feishu-account/default' as CredentialKey
const APP_ID = 'cli_test_app'
const SCOPE = 'offline_access contact:user.email:readonly'
const client: AccountClientMetadata = { version: 'test', locale: 'en_US', timezoneOffsetSeconds: 0 }
const cleanups: Array<() => Promise<void>> = []

class MemoryCredentials extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  override resolve(): Promise<undefined> { return Promise.resolve(undefined) }
  override describe(): Promise<{ configured: false; writable: true }> { return Promise.resolve({ configured: false, writable: true }) }
  override set(): Promise<void> { return Promise.resolve() }
  override unset(): Promise<void> { return Promise.resolve() }
  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return Promise.resolve(this.records.get(key)) }
  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = this.records.get(key)
    return Promise.resolve(record === undefined
      ? { configured: false, writable: true } : { configured: true, writable: true, kind: record.kind })
  }
  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }
  override async modifyRecord(
    key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const current = this.records.get(key)
    const next = await mutate(current)
    if (next !== undefined) this.records.set(key, next)
    if (next !== undefined) this.ctx.emit('credentials/record-updated', key)
    return next ?? current
  }
  override deleteRecord(key: CredentialKey): Promise<void> {
    this.records.delete(key)
    this.ctx.emit('credentials/record-updated', key)
    return Promise.resolve()
  }
  seed(record: CredentialRecord): void { this.records.set(KEY, record) }
}

type TokenRequest = Record<string, string>
interface Fixture {
  account: FeishuAccount
  credentials: MemoryCredentials
  callbackOrigin: string
  apiOrigin: string
  tokenRequests: TokenRequest[]
  refreshStarted: Promise<undefined>
  releaseRefresh: () => void
  dispose: () => Promise<void>
}

async function readBody(request: IncomingMessage): Promise<Record<string, string>> {
  let text = ''
  for await (const chunk of request) text += String(chunk)
  return JSON.parse(text) as Record<string, string>
}

function json(response: ServerResponse, value: unknown): void {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

async function fixture(seed?: CredentialRecord): Promise<Fixture> {
  const tokenRequests: TokenRequest[] = []
  const refreshStarted = Promise.withResolvers<undefined>()
  const refreshRelease = Promise.withResolvers<undefined>()
  let holdRefresh = false
  const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.url === '/open-apis/authen/v2/oauth/token') {
      const body = await readBody(request)
      tokenRequests.push(body)
      if (body.grant_type === 'refresh_token') {
        refreshStarted.resolve(undefined)
        if (holdRefresh) await refreshRelease.promise
      }
      json(response, {
        code: 0, access_token: body.grant_type === 'refresh_token' ? 'refreshed-access' : 'access-token',
        refresh_token: 'rotated-refresh', expires_in: 7200, refresh_token_expires_in: 604800, scope: SCOPE,
      })
      return
    }
    if (request.url === '/open-apis/authen/v1/user_info') {
      json(response, { code: 0, data: { union_id: 'union-1', open_id: 'open-1', name: 'Test User', email: 'user@example.test' } })
      return
    }
    response.writeHead(404).end()
  }
  const server = createServer((request, response) => { void respond(request, response) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing mock server address')
  const apiOrigin = `http://127.0.0.1:${String(address.port)}`
  const ctx = new Context()
  const credentialsFiber = ctx.plugin(MemoryCredentials)
  await credentialsFiber
  const credentials = ctx.credentials as MemoryCredentials
  if (seed !== undefined) credentials.seed(seed)
  const authorizationFiber = ctx.plugin(AuthorizationService)
  await authorizationFiber
  const webFiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await webFiber
  const accountFiber = ctx.plugin(FeishuAccount, {
    appId: APP_ID, apiOrigin, authorizeEndpoint: `${apiOrigin}/authorize`, scope: SCOPE, requestTimeoutMs: 2_000, attemptTimeoutMs: 20_000,
  })
  await accountFiber
  const account = ctx.deepseekAccount as FeishuAccount
  if (seed === undefined) holdRefresh = false
  const dispose = async (): Promise<void> => {
    await accountFiber.dispose()
    await webFiber.dispose()
    await authorizationFiber.dispose()
    await credentialsFiber.dispose()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
  }
  const result: Fixture = { account, credentials, callbackOrigin: `http://127.0.0.1:${String(ctx.webServer.port)}`, apiOrigin,
    tokenRequests, refreshStarted: refreshStarted.promise, releaseRefresh: () => { refreshRelease.resolve(undefined) }, dispose }
  cleanups.push(dispose)
  return result
}

async function waitForPhase(account: FeishuAccount, phase: AccountView['attempt'] extends infer Attempt ? Attempt extends { phase: infer Phase } ? Phase : never : never): Promise<AccountView> {
  const controller = new AbortController()
  try {
    for await (const view of account.watch(controller.signal)) if (view.attempt?.phase === phase) return view
  } finally {
    controller.abort()
  }
  throw new Error(`missing phase ${phase}`)
}

function grant(appId = APP_ID, accessTokenExpiresAt = Date.now() - 1): CredentialRecord {
  return { kind: 'grant', payload: { version: 1, appId, issuer: 'https://accounts.feishu.cn', accessToken: 'old-access', accessTokenExpiresAt,
    refreshToken: 'old-refresh', refreshTokenExpiresAt: Date.now() + 604_800_000, scope: SCOPE,
    identity: { id: 'union-1', openId: 'open-1', name: 'Test User', contact: 'user@example.test' } } }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

it('completes authorization with the deployment secret and requested scope', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture()
  const initial = await fixtureValue.account.startSignIn(client, fixtureValue.callbackOrigin, 'desktop')
  expect(initial.status).toBe('signed-out')
  const waiting = await waitForPhase(fixtureValue.account, 'waiting-browser')
  const authorization = new URL(waiting.attempt!.authorizeUrl!)
  expect(authorization.searchParams.get('scope')).toBe(SCOPE)
  expect(authorization.searchParams.get('client_id')).toBe(APP_ID)
  const callback = `${fixtureValue.callbackOrigin}/feishu/callback?code=auth-code&state=${encodeURIComponent(authorization.searchParams.get('state')!)}`
  expect((await fetch(callback)).status).toBe(200)
  await waitForPhase(fixtureValue.account, 'succeeded')
  expect(fixtureValue.tokenRequests).toHaveLength(1)
  expect(fixtureValue.tokenRequests[0]).toMatchObject({ grant_type: 'authorization_code', client_id: APP_ID, client_secret: 'test-secret',
    code: 'auth-code', redirect_uri: `${fixtureValue.callbackOrigin}/feishu/callback`, scope: SCOPE })
  expect(fixtureValue.tokenRequests[0]!.code_verifier).toMatch(/^[\w-]{43}$/u)
  expect((await fixtureValue.account.getState()).status).toBe('credential-stored')
})

it('reports a missing deployment secret before publishing an authorization page', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', '')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const fixtureValue = await fixture()
  await fixtureValue.account.startSignIn(client, fixtureValue.callbackOrigin, 'desktop')
  const failed = await waitForPhase(fixtureValue.account, 'failed')
  expect(failed.attempt?.errorCode).toBe('protocol')
  expect(failed.attempt?.authorizeUrl).toBeUndefined()
  expect(fixtureValue.tokenRequests).toHaveLength(0)
})

it('replaces the stored account when another Feishu user completes a new sign-in', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture(grant('cli_test_app', Date.now() + 3_600_000))
  expect((await fixtureValue.account.getState()).status).toBe('credential-stored')
  await fixtureValue.account.startSignIn(client, fixtureValue.callbackOrigin, 'desktop')
  const waiting = await waitForPhase(fixtureValue.account, 'waiting-browser')
  const state = new URL(waiting.attempt!.authorizeUrl!).searchParams.get('state')!
  expect((await fetch(`${fixtureValue.callbackOrigin}/feishu/callback?code=auth-code&state=${encodeURIComponent(state)}`)).status).toBe(200)
  await waitForPhase(fixtureValue.account, 'succeeded')
  expect(await fixtureValue.credentials.readRecord(KEY)).toMatchObject({ kind: 'grant',
    payload: { accessToken: 'access-token', identity: { id: 'union-1', name: 'Test User' } } })
})

it('keeps the stored account when a switch attempt is cancelled', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture(grant('cli_test_app', Date.now() + 3_600_000))
  await fixtureValue.account.startSignIn(client, fixtureValue.callbackOrigin, 'desktop')
  const waiting = await waitForPhase(fixtureValue.account, 'waiting-browser')
  const cancelled = await fixtureValue.account.cancelSignIn(waiting.attempt!.id)
  expect(cancelled).toMatchObject({ status: 'credential-stored', attempt: { phase: 'cancelled' } })
  expect(await fixtureValue.credentials.readRecord(KEY)).toMatchObject({ kind: 'grant', payload: { accessToken: 'old-access' } })
})

it('rejects a callback with a mismatched state without consuming the attempt', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture()
  await fixtureValue.account.startSignIn(client, fixtureValue.callbackOrigin, 'desktop')
  const waiting = await waitForPhase(fixtureValue.account, 'waiting-browser')
  const response = await fetch(`${fixtureValue.callbackOrigin}/feishu/callback?code=auth-code&state=wrong`)
  expect(response.status).toBe(400)
  expect((await fixtureValue.account.getState()).attempt?.phase).toBe('waiting-browser')
  await fixtureValue.account.cancelSignIn(waiting.attempt!.id)
})

it('projects Feishu authorization denial as cancellation', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture()
  await fixtureValue.account.startSignIn(client, fixtureValue.callbackOrigin, 'desktop')
  const waiting = await waitForPhase(fixtureValue.account, 'waiting-browser')
  const authorization = new URL(waiting.attempt!.authorizeUrl!)
  const callback = fetch(`${fixtureValue.callbackOrigin}/feishu/callback?error=access_denied&state=${encodeURIComponent(authorization.searchParams.get('state')!)}`)
  const cancelled = await waitForPhase(fixtureValue.account, 'cancelled')
  expect((await callback).status).toBe(204)
  expect(cancelled.attempt?.errorCode).toBeUndefined()
})

it('refreshes one expiring grant once and sends the configured scope', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture(grant())
  const profile = await fixtureValue.account.getProfile(client)
  expect(profile).toMatchObject({ status: 'ready', value: { id: 'union-1' } })
  expect(fixtureValue.tokenRequests[0]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-refresh', scope: SCOPE })
})

it('shares one in-flight refresh between concurrent profile reads', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture(grant())
  const first = fixtureValue.account.getProfile(client)
  await fixtureValue.refreshStarted
  const second = fixtureValue.account.getProfile(client)
  fixtureValue.releaseRefresh()
  await Promise.all([first, second])
  expect(fixtureValue.tokenRequests.filter(request => request.grant_type === 'refresh_token')).toHaveLength(1)
})

it('deletes a stored grant from another Feishu application during initialization', async () => {
  vi.stubEnv('FEISHU_APP_SECRET', 'test-secret')
  const fixtureValue = await fixture(grant('another-app'))
  expect(await fixtureValue.credentials.readRecord(KEY)).toBeUndefined()
  expect((await fixtureValue.account.getState()).status).toBe('signed-out')
})
