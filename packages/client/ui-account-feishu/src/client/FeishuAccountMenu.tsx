/** Sidebar account launcher: Feishu avatar and name, with settings, account switch, and sign-out. */
import { useRef, useState } from 'react'
import { IconEllipsisOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium, IconUsersOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FeishuAccountFace } from './index.ts'
import { AccountAvatar } from './AccountAvatar.tsx'
import { attemptActive } from './attempt-status.tsx'
import { SignOutDialog } from './SignOutDialog.tsx'
import css from './FeishuAccount.module.css'

/** Props assembled by the settings launcher slot. */
export type FeishuAccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.accountFeishu'> & InjectFace<FeishuAccountFace>

/** Logout glyph matching the 16px menu icon grid. */
function SignOutIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 2.5H4.2c-.98 0-1.7.72-1.7 1.7v7.6c0 .98.72 1.7 1.7 1.7H6M10.5 11l3-3-3-3M13.3 8H6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

/**
 * Show the signed-in identity in the sidebar; signing in, switching, and
 * settings are one menu away. Signing in starts the QR flow directly.
 * @param props - sidebar geometry, settings navigation, account state and operations.
 * @returns the account launcher.
 */
export function FeishuAccountMenu({ t, wide, settingsShortcut, openSettings, useSession, signIn, signOut }: FeishuAccountMenuProps) {
  const session = useSession(value => value)
  const [open, setOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const signedIn = session.view?.status === 'credential-stored'
  const running = attemptActive(session.view?.attempt)
  const name = session.profile?.name ?? (session.profile === undefined ? '' : t('signedIn'))
  const begin = (): void => {
    setOpen(false)
    void signIn().catch(() => undefined)
    openSettings()
  }
  return <div className={css.menuRoot}>
    <Menu open={open} side="top" portal autoFocus className={css.menuAnchor} listClassName={css.menuList}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide} aria-label={t('menu')}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {signedIn
          ? <AccountAvatar url={session.profile?.avatarUrl} name={session.profile?.name} size={24} />
          : <IconEllipsisOutlineMedium size={14} />}
        {wide && <span className={css.triggerLabel}>{signedIn ? name : t('more')}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
        ...(signedIn
          ? [{ id: 'switch', label: t('switchAccount'), icon: <IconUsersOutlineMedium size={16} />, disabled: running },
            { id: 'signout', label: t('signOut'), icon: <SignOutIcon /> }]
          : [{ id: 'signin', label: t('signIn'), icon: <IconUserOutlineMedium size={16} />, disabled: running }]),
      ]}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        if (id === 'settings') { setOpen(false); trigger.current?.focus(); openSettings() }
        else if (id === 'signout') { setOpen(false); setConfirmSignOut(true) }
        else begin()
      }} />
    {confirmSignOut && signedIn && <SignOutDialog signOut={signOut} close={() => { setConfirmSignOut(false) }} t={t} />}
  </div>
}
