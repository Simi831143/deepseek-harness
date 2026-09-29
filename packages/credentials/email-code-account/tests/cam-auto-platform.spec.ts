import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailCodeError } from '../src/backend.ts'
import { createCamAutoPlatformBackend } from '../src/backends/cam-auto-platform.ts'

const BASE = 'http://platform.test:8081'

/** Build an unsigned token with the given claims; the backend only reads the payload. */
function tokenWithClaims(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`
}

/** Answer every fetch with one JSON envelope and record what was requested. */
function stubFetch(body: unknown, init: { status?: number } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cam-auto-platform backend', () => {
  it('asks for a login code with the address and the platform login type', async () => {
    const fetchMock = stubFetch({ code: 200, success: true, data: true })
    const backend = createCamAutoPlatformBackend({ baseUrl: `${BASE}/`, requestTimeoutMs: 1_000 })

    await backend.requestCode('someone@example.com', new AbortController().signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // A trailing slash in the configured origin must not double up in the path.
    expect(url).toBe(`${BASE}/users/send-verification-code`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'someone@example.com', type: 2 })
  })

  it('unwraps the envelope token and reports the identity it carries', async () => {
    stubFetch({
      code: 200,
      success: true,
      data: { token: tokenWithClaims({ sub: 'someone@example.com', name: 'someone', email: 'someone@example.com', exp: 1_794_247_580 }) },
    })
    const backend = createCamAutoPlatformBackend({ baseUrl: BASE, requestTimeoutMs: 1_000 })

    const grant = await backend.verifyCode('someone@example.com', '131325', new AbortController().signal)

    expect(grant.token).toContain('.')
    expect(grant.identity).toEqual({ id: 'someone@example.com', name: 'someone', contact: 'someone@example.com' })
    expect(grant.expiresAt).toBe(1_794_247_580_000)
  })

  it('falls back to the requested address when the token omits identity claims', async () => {
    stubFetch({ code: 200, success: true, data: { token: tokenWithClaims({ sub: 'id-1' }) } })
    const backend = createCamAutoPlatformBackend({ baseUrl: BASE, requestTimeoutMs: 1_000 })

    const grant = await backend.verifyCode('someone@example.com', '131325', new AbortController().signal)

    expect(grant.identity).toEqual({ id: 'id-1', name: null, contact: 'someone@example.com' })
    expect(grant.expiresAt).toBeNull()
  })

  it('reports a refusal as rejected, including one the platform puts inside a 200 response', async () => {
    stubFetch({ code: 400, success: false, message: '登录失败' })
    const backend = createCamAutoPlatformBackend({ baseUrl: BASE, requestTimeoutMs: 1_000 })

    const failure = await backend.verifyCode('someone@example.com', '000000', new AbortController().signal)
      .then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(EmailCodeError)
    expect((failure as EmailCodeError).kind).toBe('rejected')
  })

  it('reports an unreachable issuer as network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const backend = createCamAutoPlatformBackend({ baseUrl: BASE, requestTimeoutMs: 1_000 })

    const failure = await backend.requestCode('someone@example.com', new AbortController().signal)
      .then(() => undefined, (error: unknown) => error)

    expect((failure as EmailCodeError).kind).toBe('network')
  })

  it('reports a success envelope without a usable token as invalid-response', async () => {
    stubFetch({ code: 200, success: true, data: { token: 'not-a-jwt' } })
    const backend = createCamAutoPlatformBackend({ baseUrl: BASE, requestTimeoutMs: 1_000 })

    const failure = await backend.verifyCode('someone@example.com', '131325', new AbortController().signal)
      .then(() => undefined, (error: unknown) => error)

    expect((failure as EmailCodeError).kind).toBe('invalid-response')
  })
})
