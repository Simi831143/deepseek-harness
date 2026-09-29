/** Field rules of the email sign-in form. */
import { expect, it } from 'vitest'
import { codeReady, looksLikeEmail, RESEND_COOLDOWN_SECONDS } from '../src/client/email-login-form.ts'

it('accepts the addresses the issuer could mail a code to and refuses the rest', () => {
  for (const value of ['you@example.com', '  you@example.com  ', 'a.b+tag@sub.example.co.uk']) {
    expect(looksLikeEmail(value)).toBe(true)
  }
  for (const value of ['', '   ', 'you', 'you@', '@example.com', 'you@example', 'you example@x.com']) {
    expect(looksLikeEmail(value)).toBe(false)
  }
})

it('refuses only an empty code, because the issuer owns the code shape', () => {
  expect(codeReady('123456')).toBe(true)
  expect(codeReady(' 123456 ')).toBe(true)
  // The issuer's code length is not this form's business.
  expect(codeReady('1234')).toBe(true)
  expect(codeReady('')).toBe(false)
  expect(codeReady('   ')).toBe(false)
})

it('holds the resend control for one minute', () => {
  expect(RESEND_COOLDOWN_SECONDS).toBe(60)
})
