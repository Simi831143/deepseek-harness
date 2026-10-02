import { afterEach, expect, it, vi } from 'vitest'
import { authorizeUrl, FeishuAuthError, loginOrigin, mappedError } from '../src/protocol.ts'

afterEach(() => { vi.restoreAllMocks() })

it('canonicalizes loopback callback origins and rejects non-loopback values', () => {
  expect(loginOrigin('http://localhost:3080/')).toBe('http://127.0.0.1:3080')
  expect(loginOrigin('http://[::1]:3080/')).toBe('http://127.0.0.1:3080')
  for (const value of ['https://localhost:3080/', 'http://example.test:3080/', 'http://localhost:3080/path', 'http://localhost:3080/']) {
    if (value === 'http://localhost:3080/') continue
    expect(() => loginOrigin(value)).toThrow(FeishuAuthError)
  }
})

it('builds an authorization URL with state, PKCE and scope parameters', () => {
  const value = authorizeUrl('https://accounts.example/authorize', 'app', 'http://127.0.0.1:3080/callback', 'state', 'challenge', 'offline_access')
  const url = new URL(value)
  expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'app', redirect_uri: 'http://127.0.0.1:3080/callback', response_type: 'code', state: 'state', code_challenge: 'challenge', code_challenge_method: 'S256', scope: 'offline_access' })
})

it.each([20005, 20037, 20064])('maps expired Feishu code %s', (code) => {
  expect(mappedError(code)).toMatchObject({ code: 'expired', feishuCode: code })
})
