/** Progress of one running market install: the step it is in and how far that step has come. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { MarketInstallProgress } from '@deepseek-ai/dsh-market/types'
import type { MarketPageProps } from './MarketPage.tsx'
import css from './InstallProgress.module.css'

const MEGABYTE = 1024 * 1024

/**
 * Render the step and bar of one install.
 * @param props - the progress entry, the copy, and `compact` for the bar alone along a card's bottom edge.
 * @returns the step label above the bar, or the bar alone when compact.
 */
export function InstallProgress({ progress, t, compact = false }: {
  progress: MarketInstallProgress
  t: MarketPageProps['t']
  compact?: boolean
}): ReactNode {
  const label = stepLabel(progress, t)
  const percent = progress.total === 0 ? 100 : Math.min(100, Math.floor(progress.done * 100 / progress.total))
  return (
    <div className={clsx(css.progress, compact && css.compact)}>
      {!compact && <span className={css.label}>{label}</span>}
      <div className={css.track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className={css.bar} style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  )
}

function stepLabel(progress: MarketInstallProgress, t: MarketPageProps['t']): string {
  switch (progress.phase) {
    case 'download':
      return t('installDownloading', { done: (progress.done / MEGABYTE).toFixed(1), total: (progress.total / MEGABYTE).toFixed(1) })
    case 'unpack':
      return t('installUnpacking', { done: progress.done, total: progress.total })
  }
}
