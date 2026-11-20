// @vitest-environment jsdom
/** An open market page revalidates the catalog on focus, on becoming visible, and on a timer while visible. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { revalidateWhileShown } from '../src/client/catalog-revalidation.ts'

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  visibility = 'visible'
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

function show(next: DocumentVisibilityState): void {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

it('revalidates after each delay while visible and reads the delay before scheduling each one', async () => {
  const revalidate = vi.fn(() => Promise.resolve())
  let delay = 1000
  const stop = revalidateWhileShown(revalidate, () => delay)
  await vi.advanceTimersByTimeAsync(999)
  expect(revalidate).not.toHaveBeenCalled()
  delay = 5000
  await vi.advanceTimersByTimeAsync(1)
  expect(revalidate).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(4999)
  expect(revalidate).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(revalidate).toHaveBeenCalledTimes(2)
  stop()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(revalidate).toHaveBeenCalledTimes(2)
})

it('stops the timer while hidden and revalidates at once when the window returns', async () => {
  const revalidate = vi.fn(() => Promise.resolve())
  const stop = revalidateWhileShown(revalidate, () => 1000)
  show('hidden')
  await vi.advanceTimersByTimeAsync(5000)
  expect(revalidate).not.toHaveBeenCalled()
  show('visible')
  expect(revalidate).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new Event('focus'))
  // The revalidation from becoming visible is still running; focus joins it.
  expect(revalidate).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  window.dispatchEvent(new Event('focus'))
  expect(revalidate).toHaveBeenCalledTimes(2)
  stop()
  window.dispatchEvent(new Event('focus'))
  show('hidden')
  show('visible')
  expect(revalidate).toHaveBeenCalledTimes(2)
})

it('starts no timer for a page opened in a hidden window and schedules none after a stop mid-read', async () => {
  visibility = 'hidden'
  let settle!: () => void
  const revalidate = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
  const stop = revalidateWhileShown(revalidate, () => 1000)
  await vi.advanceTimersByTimeAsync(5000)
  expect(revalidate).not.toHaveBeenCalled()
  show('visible')
  expect(revalidate).toHaveBeenCalledTimes(1)
  stop()
  settle()
  await vi.advanceTimersByTimeAsync(5000)
  expect(revalidate).toHaveBeenCalledTimes(1)
})
