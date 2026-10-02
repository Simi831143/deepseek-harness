import { z } from 'zod'

/** Stable failure classes exposed by the account contract. */
export type FeishuErrorCode = 'network' | 'protocol' | 'expired' | 'storage'

/** An error that is safe to project to the account UI. */
export class FeishuAuthError extends Error {
  /** @param code - stable account failure classification. @param feishuCode - optional Feishu business code. */
  constructor(readonly code: FeishuErrorCode, readonly feishuCode?: number) {
    super(`feishu account: ${code}`)
    this.name = 'FeishuAuthError'
  }
}

const response = z.looseObject({ code: z.number().int(), msg: z.string().optional(), data: z.unknown().optional() })
const token = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(), refresh_token_expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
})
const user = z.object({
  union_id: z.string().min(1), open_id: z.string().min(1), name: z.string().min(1),
  en_name: z.string().optional(), email: z.string().optional(), avatar_url: z.string().optional(),
})

/**
 * Validate and canonicalize a loopback callback origin.
 * @param value - Client callback origin.
 * @returns Canonical loopback origin.
 */
export function loginOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new FeishuAuthError('protocol') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!loopback || url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || url.port === '') throw new FeishuAuthError('protocol')
  return `http://127.0.0.1:${url.port}`
}

/**
 * Build the Feishu authorization URL.
 * @param endpoint - Feishu authorization endpoint.
 * @param appId - Feishu application identifier.
 * @param redirectUri - Registered callback URL.
 * @param state - CSRF state value.
 * @param challenge - PKCE S256 challenge.
 * @param scope - Requested user token scope.
 * @returns Authorization URL.
 */
export function authorizeUrl(endpoint: string, appId: string, redirectUri: string,
  state: string, challenge: string, scope: string): string {
  const url = new URL(endpoint)
  url.search = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: 'code', state,
    code_challenge: challenge, code_challenge_method: 'S256', scope }).toString()
  return url.href
}

/**
 * Exchange an authorization code.
 * @param endpoint - Feishu API origin.
 * @param appId - Feishu application identifier.
 * @param secret - Feishu application secret.
 * @param code - Authorization code.
 * @param verifier - PKCE verifier.
 * @param redirectUri - Registered callback URL.
 * @param scope - Requested user token scope.
 * @param signal - Cancellation signal for the request.
 * @returns Validated token response.
 */
export async function exchangeCode(endpoint: string, appId: string, secret: string, code: string,
  verifier: string, redirectUri: string, scope: string, signal: AbortSignal): Promise<z.infer<typeof token>> {
  return requestToken(endpoint, { grant_type: 'authorization_code', client_id: appId, client_secret: secret,
    code, code_verifier: verifier, redirect_uri: redirectUri, scope }, signal)
}

/**
 * Rotate a refresh token while preserving its least-privilege scope.
 * @param endpoint - Feishu API origin.
 * @param appId - Feishu application identifier.
 * @param secret - Feishu application secret.
 * @param refresh - Refresh token to rotate.
 * @param scope - Requested user token scope.
 * @param signal - Cancellation signal for the request.
 * @returns Validated token response.
 */
export async function refreshToken(endpoint: string, appId: string, secret: string, refresh: string,
  scope: string, signal: AbortSignal): Promise<z.infer<typeof token>> {
  return requestToken(endpoint, { grant_type: 'refresh_token', client_id: appId, client_secret: secret,
    refresh_token: refresh, scope }, signal)
}

/**
 * Read the current Feishu user.
 * @param endpoint - Feishu API origin.
 * @param accessToken - User access token.
 * @param signal - Cancellation signal for the request.
 * @returns Validated user response.
 */
export async function readUser(endpoint: string, accessToken: string, signal: AbortSignal): Promise<z.infer<typeof user>> {
  const body = await requestJson(`${endpoint}/open-apis/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${accessToken}` }, signal,
  })
  if (body.code !== 0) throw mappedError(body.code)
  const parsed = user.safeParse(body.data)
  if (!parsed.success) throw new FeishuAuthError('protocol', body.code)
  return parsed.data
}

async function requestToken(endpoint: string, body: Record<string, string>, signal: AbortSignal): Promise<z.infer<typeof token>> {
  const responseBody = await requestJson(`${endpoint}/open-apis/authen/v2/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal,
  })
  if (responseBody.code !== 0) throw mappedError(responseBody.code)
  const parsed = token.safeParse(responseBody)
  if (!parsed.success) throw new FeishuAuthError('protocol', responseBody.code)
  return parsed.data
}

async function requestJson(url: string, init: RequestInit): Promise<z.infer<typeof response>> {
  let result: Response
  try { result = await fetch(url, { ...init, redirect: 'error' }) }
  catch { throw new FeishuAuthError('network') }
  if (!result.ok) { await result.body?.cancel(); throw new FeishuAuthError('network') }
  try {
    const parsed = response.safeParse(await result.json())
    if (!parsed.success) throw new FeishuAuthError('protocol')
    return parsed.data
  } catch (error) {
    if (error instanceof FeishuAuthError) throw error
    throw new FeishuAuthError('protocol')
  }
}

/**
 * Map Feishu's documented authorization and transient failures to the account contract.
 * @param code - Feishu business error code.
 * @returns Stable account error.
 */
export function mappedError(code: number): FeishuAuthError {
  if (code === 20005) return new FeishuAuthError('expired', code)
  if ([20003, 20004, 20065].includes(code)) return new FeishuAuthError('expired', code)
  if ([20050, 20072].includes(code)) return new FeishuAuthError('network', code)
  if ([20026, 20037, 20064, 20073, 20024, 20010, 20008, 20021, 20022, 20023].includes(code)) return new FeishuAuthError('expired', code)
  return new FeishuAuthError('protocol', code)
}
