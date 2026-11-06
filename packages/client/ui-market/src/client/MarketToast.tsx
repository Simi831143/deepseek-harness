/** Install, uninstall, switch and open-folder outcomes, shown even after the market page is left. */
import type { ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketFace } from './index.ts'
import type { MarketNotice } from './market-store.ts'

/** Props of the market toast. */
export type MarketToastProps = InjectFace<Pick<MarketFace, 'hooks' | 'dismissNotice'>> & PropsLocale<'market'>

/**
 * Render the latest market notice.
 * @param props - market state hook, dismissal and copy.
 * @returns the toast, or nothing without a notice.
 */
export function MarketToast({ useMarket, dismissNotice, t }: MarketToastProps): ReactNode {
  const notice = useMarket(state => state.notice)
  if (notice === null) return null
  const failed = notice.kind.endsWith('failed')
  return (
    <Toast key={notice.seq} text={noticeText(notice, t)} holdMs={failed ? 6000 : 3000}
      {...failed ? { icon: <IconWarningOutlineRegular /> } : { tone: 'success' as const }}
      onDone={dismissNotice} />
  )
}

function noticeText(notice: MarketNotice, t: MarketToastProps['t']): string {
  switch (notice.kind) {
    case 'installed': return t('installDone', { name: notice.name })
    case 'uninstalled': return t('uninstallDone', { name: notice.name })
    case 'removed': return t('removeDone', { name: notice.name })
    case 'install-failed': return t('installFailed', { name: notice.name, reason: notice.reason })
    case 'uninstall-failed': return t('uninstallFailed', { name: notice.name, reason: notice.reason })
    case 'remove-failed': return t('removeFailed', { name: notice.name, reason: notice.reason })
    case 'connect-failed': return t('connectFailed', { name: notice.name, reason: notice.reason })
    case 'reveal-failed': return t('revealFailed', { name: notice.name })
    case 'switch-failed': return t('switchFailed', { reason: notice.reason })
    case 'load-failed': return t('loadFailed', { reason: notice.reason })
  }
}
