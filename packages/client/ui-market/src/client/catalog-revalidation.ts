/** Background catalog revalidation while the market page is shown. */

/**
 * Revalidate the catalog when the window regains focus or the document becomes visible, and after each delay while
 * the document stays visible. One revalidation runs at a time, and the next delay starts after it settles.
 * @param revalidate - reads the catalog again; it reports nothing and never rejects.
 * @param delayMs - current delay between timed revalidations in milliseconds, read before each one is scheduled.
 * @returns the stop function; a revalidation already running finishes without scheduling another.
 */
export function revalidateWhileShown(revalidate: () => Promise<void>, delayMs: () => number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  let stopped = false
  const schedule = (): void => {
    clearTimeout(timer)
    timer = stopped || document.visibilityState === 'hidden' ? undefined : setTimeout(run, delayMs())
  }
  const run = (): void => {
    running ??= revalidate().finally(() => { running = undefined; schedule() })
  }
  const visibility = (): void => {
    if (document.visibilityState !== 'hidden') { run(); return }
    clearTimeout(timer)
    timer = undefined
  }
  window.addEventListener('focus', run)
  document.addEventListener('visibilitychange', visibility)
  schedule()
  return () => {
    stopped = true
    clearTimeout(timer)
    window.removeEventListener('focus', run)
    document.removeEventListener('visibilitychange', visibility)
  }
}
