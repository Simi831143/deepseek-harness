/** Feishu sign-out confirmation; models and sessions are unaffected. */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FeishuAccountKey } from './locales.ts'
import css from './FeishuAccount.module.css'

/** @param props - sign-out action, dismissal, and localized copy. @returns the confirmation dialog. */
export function SignOutDialog({ signOut, close, t }: {
  signOut: () => Promise<void>
  close: () => void
  t: (key: FeishuAccountKey) => string
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const dismiss = (): void => { if (!busy) close() }
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try { await signOut(); close() } catch (_refused) { setFailed(true) } finally { setBusy(false) }
  }
  return <Modal open headless title={t('signOutTitle')} onClose={dismiss} className={css.dialog as string}>
    <div className={css.dialogContent}>
      <h2 className={css.dialogTitle}>{t('signOutTitle')}</h2>
      <p className={css.dialogText}>{t('signOutDescription')}</p>
      {failed && <p className={css.alert} role="alert">{t('failed')}</p>}
    </div>
    <div className={css.dialogActions}>
      <Button variant="outline" disabled={busy} onClick={dismiss}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy} onClick={() => { void confirm() }}>{t('signOut')}</Button>
    </div>
  </Modal>
}
