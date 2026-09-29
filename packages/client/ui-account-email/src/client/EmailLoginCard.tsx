/** The email sign-in settings card: address, one-time code, resend countdown, and the stored identity. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { codeReady, looksLikeEmail, RESEND_COOLDOWN_SECONDS } from './email-login-form.ts'
import css from './EmailLoginCard.module.css'

/**
 * Display identity of the stored login.
 *
 * Deliberately not the credential payload: the card renders what the Host
 * already proved, and the token never reaches the page.
 */
export interface EmailLoginIdentity {
  /** Preferred name reported by the issuer, absent when it reports none. */
  readonly name: string | null
  /** Contact address of the account, normally the address the code was sent to. */
  readonly contact: string | null
}

/** Sign-in state the card renders. */
export interface EmailLoginSession {
  /** Where the sign-in interaction stands; `loading` until the account state answers. */
  readonly status: 'loading' | 'signed-out' | 'signed-in'
  /** Identity of the stored login, absent while signed out or before the profile read answers. */
  readonly identity: EmailLoginIdentity | null
  /** Whether the account state could not be read at all. */
  readonly failed: boolean
}

/** Host operations injected into the Cordis-free card component. */
export interface EmailLoginFace {
  /** Live sign-in state, observed through the framework's selector hook. */
  hooks: {
    session: HostObservable<EmailLoginSession>
  }
  /**
   * Ask the issuer to mail a one-time code.
   * @param email - address to send to.
   * @returns after the issuer accepted the request; the card starts its resend countdown here.
   */
  requestCode: (email: string) => Promise<void>
  /**
   * Exchange a one-time code for the stored login.
   * @param email - the address the code was sent to.
   * @param code - the code read from the mail.
   * @returns after the Host stored the login.
   */
  verifyCode: (email: string, code: string) => Promise<void>
  /** @returns after the stored login is removed. */
  signOut: () => Promise<void>
}

/** Composed card props. */
export type EmailLoginCardProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.accountEmail'> & InjectFace<EmailLoginFace>

/**
 * @param props - localized copy, the live session source, and the three Host actions.
 * @returns the email sign-in card.
 */
export function EmailLoginCard({ t, useSession, requestCode, verifyCode, signOut }: EmailLoginCardProps) {
  const session = useSession(value => value)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // One timeout per remaining second, re-armed by the state change it causes:
  // unmounting mid-countdown cancels the pending tick.
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => { setCooldown(cooldown - 1) }, 1000)
    return () => { clearTimeout(timer) }
  }, [cooldown])
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try { await action() } catch { setFailed(true) } finally { setBusy(false) }
  }
  const address = email.trim()
  const sendable = looksLikeEmail(address)
  if (session.status === 'loading') return (
    <section className={css.section} aria-label={t('nav')}>
      <span className={css.status} role="status">{t('loading')}</span>
    </section>
  )
  if (session.status === 'signed-in') return (
    <section className={css.section} aria-label={t('nav')}>
      <div className={css.identity}>
        <span className={css.name}>{session.identity?.name ?? t('signedIn')}</span>
        {session.identity?.contact != null && <span className={css.contact}>{session.identity.contact}</span>}
      </div>
      <Button variant="outline" disabled={busy} onClick={() => {
        void run(async () => { await signOut(); setCode(''); setCooldown(0) })
      }}>{t('signOut')}</Button>
      {failed && <span className={css.error} role="alert">{t('failed')}</span>}
    </section>
  )
  return (
    <section className={css.section} aria-label={t('nav')}>
      <div className={css.heading}>
        <span className={css.title}>{t('title')}</span>
        <span className={css.description}>{t('description')}</span>
      </div>
      <label className={css.field}>
        <span>{t('emailLabel')}</span>
        <Input type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={email}
          onChange={(event) => { setEmail(event.currentTarget.value) }} />
      </label>
      {/* A disabled send button states no reason, so an incomplete address is called out. */}
      {email.length > 0 && !sendable && <span className={css.error}>{t('emailInvalid')}</span>}
      <Button variant="outline" disabled={busy || cooldown > 0 || !sendable} onClick={() => {
        void run(async () => { await requestCode(address); setCooldown(RESEND_COOLDOWN_SECONDS) })
      }}>{cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('sendCode')}</Button>
      <label className={css.field}>
        <span>{t('codeLabel')}</span>
        <Input inputMode="numeric" autoComplete="one-time-code" placeholder={t('codePlaceholder')} value={code}
          onChange={(event) => { setCode(event.currentTarget.value) }} />
      </label>
      <Button variant="primary" disabled={busy || !sendable || !codeReady(code)} onClick={() => {
        void run(async () => { await verifyCode(address, code.trim()); setCode('') })
      }}>{t('signIn')}</Button>
      {(failed || session.failed) && <span className={css.error} role="alert">{t('failed')}</span>}
    </section>
  )
}
