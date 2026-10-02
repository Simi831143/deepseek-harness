/** Sign-in attempt progress shared by the sidebar menu and the Settings page. */
import { useEffect, useState } from 'react'
import type { SignInAttemptView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { FeishuAccountKey } from './locales.ts'
import css from './FeishuAccount.module.css'

/** Phases during which a sign-in attempt is still running. */
const ACTIVE = new Set<SignInAttemptView['phase']>(['initializing', 'waiting-browser', 'exchanging', 'committing'])

/** @param attempt - latest attempt. @returns whether it is still running. */
export function attemptActive(attempt: SignInAttemptView | null | undefined): attempt is SignInAttemptView {
  return attempt !== null && attempt !== undefined && ACTIVE.has(attempt.phase)
}

/**
 * @param attempt - latest attempt.
 * @returns the localized message key for a terminal failure, or undefined.
 */
export function attemptFailure(attempt: SignInAttemptView | null | undefined): FeishuAccountKey | undefined {
  if (attempt?.phase === 'expired') return 'expired'
  if (attempt?.phase !== 'failed') return undefined
  // A protocol failure before any authorization page means this build cannot sign in at all.
  return attempt.errorCode === 'protocol' && attempt.authorizeUrl === undefined ? 'unavailable' : 'failed'
}

/**
 * Show the running attempt's guidance with the link fallbacks, or its failure.
 * @param props.attempt - latest attempt.
 * @param props.cancel - cancels the running attempt.
 * @param props.t - localized copy.
 * @returns status rows, or nothing when no attempt needs attention.
 */
export function AttemptStatus({ attempt, cancel, t }: {
  attempt: SignInAttemptView | null | undefined
  cancel: () => Promise<void>
  t: (key: FeishuAccountKey) => string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, 1500)
    return () => { clearTimeout(timer) }
  }, [copied])
  const failure = attemptFailure(attempt)
  if (failure !== undefined) return <p className={css.alert} role="alert">{t(failure)}</p>
  if (!attemptActive(attempt)) return null
  const url = attempt.authorizeUrl
  return <div className={css.hint} role="status">
    <span className={css.status}>{t(attempt.phase === 'waiting-browser' ? 'waiting' : attempt.phase === 'initializing' ? 'loading' : 'signingIn')}</span>
    {attempt.phase === 'waiting-browser' && url !== undefined && <>
      <button type="button" className={css.link} onClick={() => { window.open(url, '_blank', 'noopener,noreferrer') }}>{t('open')}</button>
      <button type="button" className={css.link} disabled={copied}
        onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true) }, () => undefined) }}>
        {t(copied ? 'copied' : 'copy')}
      </button>
    </>}
    {attempt.phase !== 'committing' && <button type="button" className={css.link} onClick={() => { void cancel().catch(() => undefined) }}>{t('cancel')}</button>}
  </div>
}
