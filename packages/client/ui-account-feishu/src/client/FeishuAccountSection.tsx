/** Settings account page: Feishu identity, QR sign-in, account switch, and sign-out. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FeishuAccountFace } from './index.ts'
import { AccountAvatar } from './AccountAvatar.tsx'
import { AttemptStatus, attemptActive } from './attempt-status.tsx'
import { SignOutDialog } from './SignOutDialog.tsx'
import css from './FeishuAccount.module.css'

/** Props assembled by the Settings section slot. */
export type FeishuAccountSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.accountFeishu'> & InjectFace<FeishuAccountFace>

/** @param props - localized copy, account state, and account operations. @returns the account settings page. */
export function FeishuAccountSection({ t, useSession, signIn, cancel, signOut }: FeishuAccountSectionProps) {
  const session = useSession(value => value)
  const [busy, setBusy] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const signedIn = session.view?.status === 'credential-stored'
  const attempt = session.view?.attempt
  const running = attemptActive(attempt)
  const begin = async (): Promise<void> => {
    setBusy(true)
    try { await signIn() } catch (_refused) { /* The attempt state carries the failure. */ } finally { setBusy(false) }
  }
  const profile = session.profile
  const name = signedIn ? profile?.name ?? (profile === undefined ? t('loading') : t('signedIn')) : t('signedOutTitle')
  const secondary = signedIn ? profile?.contact ?? t('signedIn') : t('signedOutDescription')
  return <section className={css.section} aria-label={t('nav')}>
    <div className={css.card}>
      <div className={css.identity}>
        <AccountAvatar url={signedIn ? profile?.avatarUrl : null} name={signedIn ? profile?.name : null} size={40} />
        <div className={css.identityCopy}>
          <span className={css.name}>{name}</span>
          <span className={css.secondary}>{secondary}</span>
        </div>
      </div>
      <div className={css.actions}>
        {signedIn
          ? <>
            <Button variant="outline" disabled={busy || running} onClick={() => { void begin() }}>{t('switchAccount')}</Button>
            <Button variant="outline" disabled={busy || running} onClick={() => { setConfirmSignOut(true) }}>{t('signOut')}</Button>
          </>
          : <Button variant="primary" disabled={busy || running || session.view === undefined} onClick={() => { void begin() }}>
            {attempt?.phase === 'failed' || attempt?.phase === 'expired' ? t('retry') : t('signIn')}
          </Button>}
      </div>
    </div>
    <AttemptStatus attempt={attempt} cancel={cancel} t={t} />
    {session.failed && <p className={css.alert} role="alert">{t('failed')}</p>}
    {confirmSignOut && signedIn && <SignOutDialog signOut={signOut} close={() => { setConfirmSignOut(false) }} t={t} />}
  </section>
}
