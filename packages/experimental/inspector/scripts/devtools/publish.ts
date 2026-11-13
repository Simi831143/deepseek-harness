/** Publish a completed DevTools directory despite transient Windows file-handle contention. */
import { rename, rm } from 'node:fs/promises'

const WINDOWS_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RETRY_LIMIT = 8
const RETRY_INITIAL_MS = 20
const RETRY_MAX_MS = 200

/**
 * Replace the previous frontend with a complete staging directory. Windows rename failures caused
 * by file handles are retried for a bounded interval; other failures reject immediately. The caller
 * owns staging cleanup on failure, and the previous output may already have been removed.
 * @param temporary - complete staging directory on the output's filesystem.
 * @param output - build-owned directory receiving the frontend.
 */
export async function publishFrontend(temporary: string, output: string): Promise<void> {
  await rm(output, { recursive: true, force: true, maxRetries: RETRY_LIMIT, retryDelay: RETRY_INITIAL_MS })
  let delay = RETRY_INITIAL_MS
  // Windows can retain directory handles after removal completes.
  for (let retries = 0;; retries += 1) {
    try {
      await rename(temporary, output)
      return
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (process.platform !== 'win32' || typeof code !== 'string' || !WINDOWS_RENAME_ERRORS.has(code) || retries >= RETRY_LIMIT) throw error
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
}
