/** Swap a completely staged runtime directory into its final application-resource location. */
import { rename } from 'node:fs/promises'

// Windows endpoint scanners can hold a handle while they inspect a newly extracted tree.
// Keep the complete staged directory intact for the same 60-second window as the installer.
const DIRECTORY_REPLACE_ATTEMPTS = 240
const DIRECTORY_REPLACE_DELAY_MS = 250

/**
 * Rename a staged directory over an absent destination, retrying transient Windows handle refusals.
 * @param source - Complete staged directory on the destination's volume.
 * @param destination - Final directory path, already removed by the caller.
 * @param label - Runtime name used in the final failure message.
 * @returns Resolves after the rename succeeds; rejects on a non-transient error or after the retry window.
 */
export async function replacePreparedDirectory(source: string, destination: string, label: string): Promise<void> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < DIRECTORY_REPLACE_ATTEMPTS; attempt++) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
      lastError = error instanceof Error ? error : new Error(String(error), { cause: error })
      await new Promise<void>(resolve => setTimeout(resolve, DIRECTORY_REPLACE_DELAY_MS))
    }
  }
  throw lastError ?? new Error(`${label}: unable to replace ${destination}`)
}
